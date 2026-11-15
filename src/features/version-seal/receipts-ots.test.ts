import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import type { StorageProvider } from "../../lib/storage/types";
import { listSnapshots } from "../version-snapshots/snapshot-store";
import {
  OP_APPEND,
  OP_SHA256,
  TAG_BITCOIN,
  TAG_PENDING,
  buildOtsFromCalendarResponses,
  encodeVarbytes,
  encodeVaruint,
  parseTimestampBody,
  serializeOts,
  verifyOts,
  headerMeetsProofOfWork,
  listPending,
  listBitcoinClaims,
  parseOts,
  serializeTimestampNode,
  type OtsNode,
} from "./opentimestamps";
import { sha256HexOfBytes } from "./manifest";
import { bytesToBase64, bytesToHex, hexToBytes } from "./rfc3161";
import { attachOts, checkReceipts, upgradeOts, loadReceiptBytes, pickPendingRoundRobin } from "./receipts";

// 実データ（Graphium 自身が封印して確定まで取りに行った証明。詳しくは opentimestamps.test.ts）
const dir = join(dirname(fileURLToPath(import.meta.url)), "__fixtures__/ots");
const load = (name: string) => new Uint8Array(readFileSync(join(dir, name)));
// ブロック 975121 のヘッダ（opentimestamps.test.ts と同じ値）
const HEIGHT = 975121;
const HEADER =
  "0020072033f06f00647418001b5259d38aaa8542dd9b6d2a4ef900000000000000000000c58e00730cc785b0ed2a5369abcfd057932403061143ffb5010ba3471ca6bf8e1833f16aace501177b2a0077";
const PROOF = "graphium-seal.json.ots";

/** append(arg) → sha256 → Pending(uri) の 1 段の応答 */
function pendingNode(uri: string, arg: number[]): OtsNode {
  const leaf: OtsNode = { attestations: [{ tag: TAG_PENDING, payload: encodeVarbytes(new TextEncoder().encode(uri)) }], edges: [] };
  return {
    attestations: [],
    edges: [{ op: { code: OP_APPEND, arg: new Uint8Array(arg) }, child: { attestations: [], edges: [{ op: { code: OP_SHA256 }, child: leaf }] } }],
  };
}

/** 封印済みの版を 1 つ持つプロバイダ（sealHash は与えたダイジェスト） */
async function sealedProvider(sealHash: string) {
  const store = new Map<string, string>();
  const provider = {
    readAppData: async (k: string) => (store.has(k) ? JSON.parse(store.get(k)!) : null),
    writeAppData: async (k: string, v: unknown) => {
      store.set(k, JSON.stringify(v));
    },
  } as unknown as StorageProvider;
  await provider.writeAppData!("seal-s1", "manifest");
  await provider.writeAppData!("snapshot-index:n1", [
    {
      id: "s1",
      noteId: "n1",
      version: 1,
      savedAt: "2026-11-09T01:53:47.117Z",
      contentHash: "x",
      seal: { sealedAt: "2026-11-09T01:53:47.118Z", sealHash, sealIndex: 1, receipts: [] },
    },
  ]);
  return { provider, store };
}

describe("OpenTimestamps の取り付け", () => {
  it("乱数で隠したハッシュを出し、応答から .ots を作って pending で保存する（登録簿に無い応答は捨てる）", async () => {
    // カレンダー 2 か所の Pending を持つ応答（テストの中で組み立てる）
    const two = parseOts(
      buildOtsFromCalendarResponses(new Uint8Array(32).fill(1), [
        serializeTimestampNode(pendingNode("https://alice.btc.calendar.opentimestamps.org", [1, 2, 3])),
        serializeTimestampNode(pendingNode("https://bob.btc.calendar.opentimestamps.org", [9, 9])),
      ]),
    );
    const digest = "ab".repeat(32);
    const nonce = new Uint8Array(16).fill(7);
    const expectedBlinded = await sha256HexOfBytes(new Uint8Array([...new Uint8Array(32).fill(0xab), ...nonce]));
    const { provider } = await sealedProvider(digest);
    const body = bytesToBase64(serializeTimestampNode(two.root));
    const res = await attachOts(provider, "n1", "s1", {
      nonce,
      post: async (url, b: any) => {
        expect(url).toMatch(/\/seal\/ots\/submit$/);
        // 封印ファイルのハッシュそのものは出さない
        expect(b.hash).not.toBe(digest);
        expect(b).toEqual({ hash: expectedBlinded });
        return {
          status: 200,
          json: {
            responses: [
              { calendar: "https://a.pool.opentimestamps.org", body },
              { calendar: "https://evil.example", body },
            ],
          },
        };
      },
    });
    expect(res.status).toBe("pending");
    const [meta] = await listSnapshots(provider, "n1");
    expect(meta.seal?.receipts).toMatchObject([{ kind: "opentimestamps", status: "pending" }]);
    const saved = await loadReceiptBytes(provider, meta.seal!.receipts[0].receiptKey);
    // .ots の対象は封印ファイルのハッシュ。隠した経路をたどると、カレンダーの Pending に着く
    expect(bytesToHex(parseOts(saved!).digest)).toBe(digest);
    expect((await listPending(saved!)).length).toBeGreaterThan(0);
  });

  it("カレンダーに届かなければ failed（次に開いたときに出し直す）", async () => {
    const { provider } = await sealedProvider("a".repeat(64));
    const res = await attachOts(provider, "n1", "s1", { post: async () => ({ status: 502, json: {} }) });
    expect(res.status).toBe("pending");
    const [meta] = await listSnapshots(provider, "n1");
    expect(meta.seal?.receipts[0].status).toBe("failed");
  });
});

describe("OpenTimestamps の確定", () => {
  it("Bitcoin の記録があり、ブロックヘッダと照合できたら confirmed", async () => {
    const proof = load(PROOF);
    const digest = bytesToHex(parseOts(proof).digest);
    const { provider } = await sealedProvider(digest);
    await provider.writeAppData!("seal-receipt-s1-1", bytesToBase64(proof));
    const idx = (await provider.readAppData!("snapshot-index:n1")) as any[];
    idx[0].seal.receipts = [
      { kind: "opentimestamps", endpoint: "opentimestamps", status: "pending", receiptKey: "seal-receipt-s1-1", updatedAt: "" },
    ];
    await provider.writeAppData!("snapshot-index:n1", idx);

    const calls: string[] = [];
    const res = await upgradeOts(provider, "n1", "s1", {
      // 登録簿に無いカレンダーには取りに行かない。ここでは「まだ」と返す
      post: async (_u, b: any) => {
        calls.push(b.calendar);
        return { status: 200, json: { status: "pending" } };
      },
      getHeader: async (h) => {
        expect(h).toBe(HEIGHT);
        return HEADER;
      },
    });
    expect(res).toEqual({ status: "confirmed", genTime: new Date("2026-11-09T02:42:32.000Z") });
    const [meta] = await listSnapshots(provider, "n1");
    expect(meta.seal?.receipts[0].status).toBe("confirmed");
    const checks = await checkReceipts(provider, meta, async () => HEADER);
    expect(checks[0]).toMatchObject({ kind: "opentimestamps", ok: true });
    expect(checks[0].provenAt?.toISOString()).toBe("2026-11-09T02:42:32.000Z");
    // 残っている Pending の取得先（登録簿にあるもの）だけが呼ばれる
    expect(calls.every((c) => /opentimestamps\.org|eternitywall\.com/.test(c))).toBe(true);
  });

  it("証明の対象が封印ファイルと違えば通らない", async () => {
    const proof = load(PROOF);
    const { provider } = await sealedProvider("0".repeat(64));
    await provider.writeAppData!("seal-receipt-s1-1", bytesToBase64(proof));
    const idx = (await provider.readAppData!("snapshot-index:n1")) as any[];
    idx[0].seal.receipts = [
      { kind: "opentimestamps", endpoint: "opentimestamps", status: "confirmed", receiptKey: "seal-receipt-s1-1", updatedAt: "" },
    ];
    await provider.writeAppData!("snapshot-index:n1", idx);
    const [meta] = await listSnapshots(provider, "n1");
    const checks = await checkReceipts(provider, meta, async () => HEADER);
    expect(checks[0].ok).toBe(false);
  });
});

describe("ブロックヘッダの作業証明", () => {
  it("本物のヘッダは通り、1 バイト変えると通らない", async () => {
    expect(await headerMeetsProofOfWork(HEADER)).toBe(true);
    const tampered = HEADER.slice(0, 80) + "ff" + HEADER.slice(82);
    expect(await headerMeetsProofOfWork(tampered)).toBe(false);
  });

  it("易しすぎる target（bits を書き換えたもの）は通らない", async () => {
    // bits を 0x207fffff（regtest 並みに易しい）に書き換える
    const easy = HEADER.slice(0, 144) + "ffff7f20" + HEADER.slice(152);
    expect(await headerMeetsProofOfWork(easy)).toBe(false);
  });
});

// ── 乗っ取り・不正な応答への頑健さ ──

/** append([i]) の枝を n 本並べ、各枝の先に Bitcoin attestation（高さ base+i）を付けた木 */
function bitcoinFork(n: number, base: number): OtsNode {
  return {
    attestations: [],
    edges: Array.from({ length: n }, (_, i) => ({
      op: { code: OP_APPEND, arg: new Uint8Array([i]) },
      child: { attestations: [{ tag: TAG_BITCOIN, payload: encodeVaruint(base + i) }], edges: [] },
    })),
  };
}

describe("OpenTimestamps の不正な応答への頑健さ", () => {
  const alice = "https://alice.btc.calendar.opentimestamps.org";
  const bob = "https://bob.btc.calendar.opentimestamps.org";

  it("1 件が OTS でない本体でも、正常なほかのカレンダーの応答で .ots を作る", async () => {
    const good = bytesToBase64(serializeTimestampNode(pendingNode(alice, [1, 2, 3])));
    const junk = bytesToBase64(new TextEncoder().encode("<html>502 Bad Gateway</html>"));
    const { provider } = await sealedProvider("ab".repeat(32));
    const res = await attachOts(provider, "n1", "s1", {
      post: async () => ({
        status: 200,
        json: {
          responses: [
            { calendar: "https://a.pool.opentimestamps.org", body: junk },
            { calendar: "https://b.pool.opentimestamps.org", body: good },
          ],
        },
      }),
    });
    expect(res.status).toBe("pending");
    const [meta] = await listSnapshots(provider, "n1");
    expect(meta.seal?.receipts).toMatchObject([{ kind: "opentimestamps", status: "pending" }]);
    expect((await listPending((await loadReceiptBytes(provider, meta.seal!.receipts[0].receiptKey))!)).length).toBe(1);
  });

  it("全部が不正でも例外にせず failed に倒して失敗を数える", async () => {
    const junk = bytesToBase64(new Uint8Array([1, 2, 3]));
    const { provider } = await sealedProvider("ab".repeat(32));
    const res = await attachOts(provider, "n1", "s1", {
      post: async () => ({ status: 200, json: { responses: [{ calendar: "https://a.pool.opentimestamps.org", body: junk }] } }),
    });
    expect(res.status).toBe("pending");
    const [meta] = await listSnapshots(provider, "n1");
    expect(meta.seal?.receipts[0]).toMatchObject({ status: "failed", failures: 1 });
  });

  it("attestation を大量に並べた木は読み込みで断る", () => {
    expect(() => parseTimestampBody(serializeTimestampNode(bitcoinFork(200, 1)))).toThrow(/多すぎ/);
    expect(() => parseTimestampBody(serializeTimestampNode(bitcoinFork(100, 1)))).not.toThrow();
  });

  it("提出の合流で attestation が上限を超えるときは、読み戻せる分だけで .ots を書く", async () => {
    const { provider } = await sealedProvider("ab".repeat(32));
    const big1 = bytesToBase64(serializeTimestampNode(bitcoinFork(100, 1)));
    const big2 = bytesToBase64(serializeTimestampNode(bitcoinFork(100, 500)));
    const good = bytesToBase64(serializeTimestampNode(pendingNode(alice, [1, 2, 3])));
    const res = await attachOts(provider, "n1", "s1", {
      post: async () => ({
        status: 200,
        json: {
          responses: [
            { calendar: "https://a.pool.opentimestamps.org", body: big1 },
            { calendar: "https://b.pool.opentimestamps.org", body: big2 },
            { calendar: "https://alice.btc.calendar.opentimestamps.org", body: good },
          ],
        },
      }),
    });
    expect(res.status).toBe("pending");
    const [meta] = await listSnapshots(provider, "n1");
    const saved = await loadReceiptBytes(provider, meta.seal!.receipts[0].receiptKey);
    // 書いた .ots は自分で読み戻せる（次回の parseOts が上限超えで落ちない）
    expect(saved).not.toBeNull();
    expect(() => parseOts(saved!)).not.toThrow();
  });

  it("偽の Bitcoin attestation を何個前に並べても、後ろの記録を確かめに行く", async () => {
    const digest = new Uint8Array(32).fill(7);
    const ots = buildOtsFromCalendarResponses(digest, [serializeTimestampNode(bitcoinFork(20, 1))]);
    let calls = 0;
    await verifyOts(ots, bytesToHex(digest), async () => {
      calls++;
      return HEADER;
    });
    // 取りに行く高さは 16 件まで（木に現れた順）
    expect(calls).toBe(16);
  });

  it("ヘッダを取りに行く高さが 16 件を超えても、先頭 16 件の中に本物があれば確定する", async () => {
    const digest = hexToBytes(HEADER.slice(72, 136));
    const attestations = Array.from({ length: 40 }, (_, i) => ({
      tag: TAG_BITCOIN,
      payload: encodeVaruint(i === 3 ? HEIGHT : 1_000_000 + i),
    }));
    const file = serializeOts({ fileHashOp: OP_SHA256, digest, root: { attestations, edges: [] } });
    const heights: number[] = [];
    const v = await verifyOts(file, bytesToHex(digest), async (h) => {
      heights.push(h);
      if (h !== HEIGHT) throw new Error("not found");
      return HEADER;
    });
    expect(heights.length).toBe(16);
    expect(v.ok).toBe(true);
  });

  it("本物が 17 件目以降にあって確かめられないときは確定にせず unverifiable を残す", async () => {
    const digest = hexToBytes(HEADER.slice(72, 136));
    const attestations = Array.from({ length: 20 }, (_, i) => ({
      tag: TAG_BITCOIN,
      payload: encodeVaruint(i === 19 ? HEIGHT : 1_000_000 + i),
    }));
    const file = serializeOts({ fileHashOp: OP_SHA256, digest, root: { attestations, edges: [] } });
    const v = await verifyOts(file, bytesToHex(digest), async (h) => {
      if (h !== HEIGHT) throw new Error("not found");
      return HEADER;
    });
    expect(v.ok).toBe(false);
    expect(v.results.some((r) => r.status === "unverifiable" && /上限/.test(r.reason))).toBe(true);
  });

  it("upgrade で 1 台が 128 個の attestation を返しても、ほかの正常なカレンダーの確定は書き戻す", async () => {
    const digest = new Uint8Array(32).fill(5);
    const ots = buildOtsFromCalendarResponses(digest, [
      serializeTimestampNode(pendingNode(alice, [1])),
      serializeTimestampNode(pendingNode(bob, [2])),
    ]);
    const { provider } = await sealedProvider(bytesToHex(digest));
    await provider.writeAppData!("seal-receipt-s1-1", bytesToBase64(ots));
    const idx = (await provider.readAppData!("snapshot-index:n1")) as any[];
    idx[0].seal.receipts = [
      { kind: "opentimestamps", endpoint: "opentimestamps", status: "pending", receiptKey: "seal-receipt-s1-1", updatedAt: "" },
    ];
    await provider.writeAppData!("snapshot-index:n1", idx);
    const hostile = bytesToBase64(serializeTimestampNode(bitcoinFork(128, 1)));
    const honest = bytesToBase64(serializeTimestampNode(bitcoinFork(1, 900_000)));
    const res = await upgradeOts(provider, "n1", "s1", {
      post: async (_url: string, body: any) => ({
        status: 200,
        json: { status: "upgraded", body: body.calendar.startsWith(alice) ? hostile : honest },
      }),
      getHeader: async () => {
        throw new Error("not found");
      },
    });
    expect(res.status).toBe("pending");
    const [meta] = await listSnapshots(provider, "n1");
    const saved = await loadReceiptBytes(provider, meta.seal!.receipts[0].receiptKey);
    const reread = parseOts(saved!);
    // bob の確定は書き戻され、alice（過大な応答）は Pending のまま残る
    expect((await listPending(reread)).length).toBe(1);
    expect((await listBitcoinClaims(reread)).length).toBe(1);
  });

  it("upgrade の合流で .ots が上限を超えるときは書き戻さず、元の証明を残す", async () => {
    const digest = new Uint8Array(32).fill(5);
    const ots = buildOtsFromCalendarResponses(digest, [
      serializeTimestampNode(pendingNode(alice, [1])),
      serializeTimestampNode(pendingNode(bob, [2])),
    ]);
    const { provider } = await sealedProvider(bytesToHex(digest));
    await provider.writeAppData!("seal-receipt-s1-1", bytesToBase64(ots));
    const idx = (await provider.readAppData!("snapshot-index:n1")) as any[];
    idx[0].seal.receipts = [
      { kind: "opentimestamps", endpoint: "opentimestamps", status: "pending", receiptKey: "seal-receipt-s1-1", updatedAt: "" },
    ];
    await provider.writeAppData!("snapshot-index:n1", idx);
    // 2 か所それぞれが 100 個の Bitcoin attestation を返す（合計 200 個 > 上限）
    const hostile = bytesToBase64(serializeTimestampNode(bitcoinFork(100, 1)));
    const res = await upgradeOts(provider, "n1", "s1", {
      post: async () => ({ status: 200, json: { status: "upgraded", body: hostile } }),
      getHeader: async () => {
        throw new Error("ヘッダは取りに行かない");
      },
    });
    expect(res.status).toBe("pending");
    // 保存済みの .ots は元のまま読める
    const [meta] = await listSnapshots(provider, "n1");
    const saved = await loadReceiptBytes(provider, meta.seal!.receipts[0].receiptKey);
    expect(() => parseOts(saved!)).not.toThrow();
    expect((await listPending(saved!)).length).toBe(2);
  });

  it("Bitcoin attestation が大量にあっても、ブロックヘッダの取得は attestation の上限（128）と高さの重複除きで抑える", async () => {
    const digest = new Uint8Array(32).fill(9);
    const file = serializeOts({ fileHashOp: OP_SHA256, digest, root: bitcoinFork(100, 1_000_000) });
    const heights: number[] = [];
    const v = await verifyOts(file, bytesToHex(digest), async (h) => {
      heights.push(h);
      throw new Error("not found");
    });
    expect(heights.length).toBeLessThanOrEqual(128);
    expect(v.ok).toBe(false);
  });
  it("確定が複数あるときも途中で打ち切らず、全部の確定を評価する（最も早い時刻を取るため）", async () => {
    // ヘッダの merkle root（バイト 36〜68）をそのままダイジェストにして、同じ場所に 2 つの確定を置く
    const digest = hexToBytes(HEADER.slice(72, 136));
    const root: OtsNode = {
      attestations: [
        { tag: TAG_BITCOIN, payload: encodeVaruint(HEIGHT) },
        { tag: TAG_BITCOIN, payload: encodeVaruint(HEIGHT + 1) },
      ],
      edges: [],
    };
    const file = serializeOts({ fileHashOp: OP_SHA256, digest, root });
    const heights: number[] = [];
    const v = await verifyOts(file, bytesToHex(digest), async (h) => {
      heights.push(h);
      return HEADER;
    });
    expect(heights.length).toBe(2);
    expect(v.results.filter((r) => r.status === "confirmed").length).toBe(2);
  });

  it("偽の Pending を大量に並べても、ほかのカレンダーの枠を押し出さない", () => {
    const a = "https://a.pool.opentimestamps.org";
    const b = "https://b.pool.opentimestamps.org";
    const al = "https://alice.btc.calendar.opentimestamps.org";
    const all = [
      ...Array.from({ length: 100 }, (_, i) => ({ uri: a, commitment: `c${i}` })),
      { uri: b, commitment: "cb" },
      { uri: al, commitment: "ca" },
      { uri: "https://evil.example.com", commitment: "ce" },
      { uri: a, commitment: "c0" }, // 重複
    ];
    const picked = pickPendingRoundRobin(all, 16);
    expect(picked.length).toBe(16);
    expect(picked.some((p) => p.uri === b)).toBe(true);
    expect(picked.some((p) => p.uri === al)).toBe(true);
    expect(picked.some((p) => p.uri.includes("evil"))).toBe(false);
  });
});
