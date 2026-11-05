import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import type { StorageProvider } from "../../lib/storage/types";
import { listSnapshots } from "../version-snapshots/snapshot-store";
import { headerMeetsProofOfWork, listPending, parseOts, serializeTimestampNode } from "./opentimestamps";
import { sha256HexOfBytes } from "./manifest";
import { bytesToBase64, bytesToHex } from "./rfc3161";
import { attachOts, checkReceipts, upgradeOts, loadReceiptBytes } from "./receipts";

// 実データ（opentimestamps/javascript-opentimestamps の examples/。詳しくは opentimestamps.test.ts）
const dir = join(dirname(fileURLToPath(import.meta.url)), "__fixtures__/ots");
const load = (name: string) => new Uint8Array(readFileSync(join(dir, name)));
// ブロック 523364 のヘッダ（opentimestamps.test.ts と同じ値）
const HEADER_523364 =
  "000000201b9f358f5d101e27a0cd6089f972bcd0efc877b1f6ca1400000000000000000039780753a0e7785eea0fabafa8fbef1ef2539d26f6cbf3beac738a1de0e74f3c69e5ff5aa9ec4317826c0349";

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
      savedAt: "2018-05-19T00:00:00.000Z",
      contentHash: "x",
      seal: { sealedAt: "2018-05-19T00:00:00.000Z", sealHash, sealIndex: 1, receipts: [] },
    },
  ]);
  return { provider, store };
}

describe("OpenTimestamps の取り付け", () => {
  it("乱数で隠したハッシュを出し、応答から .ots を作って pending で保存する（登録簿に無い応答は捨てる）", async () => {
    const two = parseOts(load("two-calendars.txt.ots"));
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
    const osdsp = load("osdsp.txt.ots");
    const digest = bytesToHex(parseOts(osdsp).digest);
    const { provider } = await sealedProvider(digest);
    await provider.writeAppData!("seal-receipt-s1-1", bytesToBase64(osdsp));
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
        expect(h).toBe(523364);
        return HEADER_523364;
      },
    });
    expect(res).toEqual({ status: "confirmed", genTime: new Date(1526719849 * 1000) });
    const [meta] = await listSnapshots(provider, "n1");
    expect(meta.seal?.receipts[0].status).toBe("confirmed");
    const checks = await checkReceipts(provider, meta, async () => HEADER_523364);
    expect(checks[0]).toMatchObject({ kind: "opentimestamps", ok: true });
    expect(checks[0].provenAt?.toISOString()).toBe("2018-05-19T08:50:49.000Z");
    // osdsp の Pending の URI は登録簿の取得先だけが呼ばれる
    expect(calls.every((c) => /opentimestamps\.org|eternitywall\.com/.test(c))).toBe(true);
  });

  it("証明の対象が封印ファイルと違えば通らない", async () => {
    const osdsp = load("osdsp.txt.ots");
    const { provider } = await sealedProvider("0".repeat(64));
    await provider.writeAppData!("seal-receipt-s1-1", bytesToBase64(osdsp));
    const idx = (await provider.readAppData!("snapshot-index:n1")) as any[];
    idx[0].seal.receipts = [
      { kind: "opentimestamps", endpoint: "opentimestamps", status: "confirmed", receiptKey: "seal-receipt-s1-1", updatedAt: "" },
    ];
    await provider.writeAppData!("snapshot-index:n1", idx);
    const [meta] = await listSnapshots(provider, "n1");
    const checks = await checkReceipts(provider, meta, async () => HEADER_523364);
    expect(checks[0].ok).toBe(false);
  });
});

describe("ブロックヘッダの作業証明", () => {
  it("本物のヘッダは通り、1 バイト変えると通らない", async () => {
    expect(await headerMeetsProofOfWork(HEADER_523364)).toBe(true);
    const tampered = HEADER_523364.slice(0, 80) + "ff" + HEADER_523364.slice(82);
    expect(await headerMeetsProofOfWork(tampered)).toBe(false);
  });

  it("易しすぎる target（bits を書き換えたもの）は通らない", async () => {
    // bits を 0x207fffff（regtest 並みに易しい）に書き換える
    const easy = HEADER_523364.slice(0, 144) + "ffff7f20" + HEADER_523364.slice(152);
    expect(await headerMeetsProofOfWork(easy)).toBe(false);
  });
});
