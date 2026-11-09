// opentimestamps.ts のテスト。
//
// フィクスチャ（__fixtures__/ots/）は Graphium 自身が作った実データ（2026-11-09）:
//   - graphium-seal.json     : 実際に封印した版の封印ファイル（中身は見本のパン作りの 1 行）
//   - graphium-seal.json.ots : そのハッシュを乱数で隠して本物のカレンダーへ出し、確定まで取りに行った証明。
//                              Bitcoin ブロック 975121 の attestation 1 件と、確定前の Pending 2 件が混ざる
//   作り方は Crucible の experiments/2026-11-09-seal-ots-live/run.mts。
// ブロック 975121 のヘッダ（80 バイト）は blockstream.info と mempool.space の
//   /api/block-height/975121 → /api/block/<hash>/header で一度だけ取得し、両者の一致を確かめて埋め込んだ
//   （テストはネットワーク不使用）。
// 評価できない経路（ripemd160）・未知のタグ・Pending だけの証明は、テストの中で組み立てる。
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { sha256HexOfBytes } from "./manifest";
import { bytesToHex } from "./rfc3161";
import {
  OP_APPEND,
  OP_RIPEMD160,
  OP_SHA256,
  OtsFormatError,
  TAG_BITCOIN,
  TAG_PENDING,
  applyUpgrade,
  buildOtsFromCalendarResponses,
  checkBitcoinHeader,
  encodeVarbytes,
  encodeVaruint,
  headerMeetsProofOfWork,
  listBitcoinClaims,
  maxTargetForHeight,
  listPending,
  parseOts,
  parseTimestampBody,
  serializeOts,
  serializeTimestampNode,
  verifyOts,
  type OtsNode,
} from "./opentimestamps";

const dir = join(__dirname, "__fixtures__", "ots");
const load = (name: string) => new Uint8Array(readFileSync(join(dir, name)));

const HEIGHT = 975121;
const HEADER =
  "0020072033f06f00647418001b5259d38aaa8542dd9b6d2a4ef900000000000000000000c58e00730cc785b0ed2a5369abcfd057932403061143ffb5010ba3471ca6bf8e1833f16aace501177b2a0077";
const BLOCK_TIME = "2026-11-09T02:42:32.000Z";
const getHeader = async (h: number) => {
  if (h !== HEIGHT) throw new Error("想定外の高さ");
  return HEADER;
};
const PROOF = "graphium-seal.json.ots";
const SUBJECT = "graphium-seal.json";

/** ダイジェストから 1 本の経路（op の列）をたどって attestation に着く .ots を組み立てる */
function buildChainOts(digest: Uint8Array, ops: { code: number; arg?: Uint8Array }[], tag: Uint8Array, payload: Uint8Array): Uint8Array {
  let node: OtsNode = { attestations: [{ tag, payload }], edges: [] };
  for (const op of ops.slice().reverse()) node = { attestations: [], edges: [{ op, child: node }] };
  return serializeOts({ fileHashOp: OP_SHA256, digest, root: node });
}

async function sha256(b: Uint8Array): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", b as BufferSource));
}

describe("varuint / varbytes", () => {
  it("書いて読める値の例", () => {
    expect(bytesToHex(encodeVaruint(0))).toBe("00");
    expect(bytesToHex(encodeVaruint(127))).toBe("7f");
    expect(bytesToHex(encodeVaruint(128))).toBe("8001");
    expect(bytesToHex(encodeVaruint(523364))).toBe("e4f81f");
    expect(bytesToHex(encodeVarbytes(new Uint8Array([1, 2])))).toBe("020102");
  });
});

describe("実データの読み込みと往復", () => {
  it("graphium-seal.json.ots はバイト単位で同じに戻る", () => {
    const bytes = load(PROOF);
    expect(Buffer.from(serializeOts(parseOts(bytes)))).toEqual(Buffer.from(bytes));
  });
  it("封印ファイルのハッシュが .ots のダイジェストと一致する", async () => {
    const file = parseOts(load(PROOF));
    expect(file.fileHashOp).toBe(OP_SHA256);
    expect(bytesToHex(file.digest)).toBe(await sha256HexOfBytes(load(SUBJECT)));
  });
});

describe("Bitcoin 照合", () => {
  it("確定した経路の高さ・ダイジェスト・時刻が出る", async () => {
    const claims = await listBitcoinClaims(load(PROOF));
    expect(claims).toHaveLength(1);
    expect(claims[0].height).toBe(HEIGHT);
    const check = checkBitcoinHeader(HEADER, claims[0].digest);
    expect(check.merkleRootMatches).toBe(true);
    expect(new Date(check.time * 1000).toISOString()).toBe(BLOCK_TIME);
  });

  it("verifyOts: confirmed と pending が揃って返る", async () => {
    const expected = await sha256HexOfBytes(load(SUBJECT));
    const v = await verifyOts(load(PROOF), expected, getHeader);
    expect(v.fileHashMatches).toBe(true);
    expect(v.ok).toBe(true);
    expect(new Date(v.earliestTime! * 1000).toISOString()).toBe(BLOCK_TIME);
    expect(v.results.filter((r) => r.status === "confirmed")).toHaveLength(1);
    expect(v.results.filter((r) => r.status === "pending")).toHaveLength(2); // 確定を取りに行く前のカレンダー 2 か所
  });

  it("ダイジェストを 1 ビット変えると通らない", async () => {
    const expected = await sha256HexOfBytes(load(SUBJECT));
    const flipped = (parseInt(expected[0], 16) ^ 1).toString(16) + expected.slice(1);
    const v = await verifyOts(load(PROOF), flipped, getHeader);
    expect(v.fileHashMatches).toBe(false);
    expect(v.ok).toBe(false);
    expect(v.results).toEqual([]);
  });

  it("ヘッダの merkle root が違えば invalid（時刻は出さない）", async () => {
    const expected = await sha256HexOfBytes(load(SUBJECT));
    const bad = HEADER.slice(0, 72 + 1) + (HEADER[73] === "0" ? "1" : "0") + HEADER.slice(74);
    const v = await verifyOts(load(PROOF), expected, async () => bad);
    expect(v.ok).toBe(false);
    expect(v.results.some((r) => r.status === "invalid")).toBe(true);
  });

  it("ヘッダの取得に失敗したら unverifiable", async () => {
    const expected = await sha256HexOfBytes(load(SUBJECT));
    const v = await verifyOts(load(PROOF), expected, async () => {
      throw new Error("offline");
    });
    expect(v.ok).toBe(false);
    expect(v.results.some((r) => r.status === "unverifiable")).toBe(true);
  });

  it("ripemd160 の経路は unverifiable", async () => {
    const digest = new Uint8Array(32).fill(3);
    const expected = bytesToHex(digest);
    const ots = buildChainOts(digest, [{ code: OP_RIPEMD160 }], TAG_BITCOIN, encodeVaruint(HEIGHT));
    const v = await verifyOts(ots, expected, getHeader);
    expect(v.fileHashMatches).toBe(true);
    expect(v.ok).toBe(false);
    expect(v.results).toEqual([{ status: "unverifiable", reason: expect.stringContaining("ripemd160") }]);
  });

  it("未知のタグは unverifiable で、保持されて書き戻せる", async () => {
    const digest = new Uint8Array(32).fill(4);
    const unknownTag = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);
    const ots = buildChainOts(digest, [{ code: OP_SHA256 }], unknownTag, new Uint8Array([9, 9, 9]));
    const v = await verifyOts(ots, bytesToHex(digest), getHeader);
    expect(v.results).toEqual([{ status: "unverifiable", reason: expect.stringContaining("未知の attestation") }]);
    expect(Buffer.from(serializeOts(parseOts(ots)))).toEqual(Buffer.from(ots));
  });

  it("高さの最低難易度: 本物は通り、難易度 1 の bits に書き換えた偽のヘッダは通らない", async () => {
    expect(await headerMeetsProofOfWork(HEADER, HEIGHT)).toBe(true);
    // bits を 0x1d00ffff（難易度 1）にしたヘッダ。2^32 回ほどの計算で作れてしまう水準
    const easy = HEADER.slice(0, 144) + "ffff001d" + HEADER.slice(152);
    expect(maxTargetForHeight(HEIGHT) < maxTargetForHeight(undefined)).toBe(true);
    expect(await headerMeetsProofOfWork(easy, HEIGHT)).toBe(false);
    // 古い高さ（下限より前）は powLimit のまま
    expect(maxTargetForHeight(100_000)).toBe(maxTargetForHeight(undefined));
  });

  it("ヘッダが 80 バイトでなければエラー", () => {
    expect(() => checkBitcoinHeader("00", "00")).toThrow(OtsFormatError);
  });
});

describe("壊れた入力", () => {
  const good = load(PROOF);
  it("途中切れはエラー", () => {
    for (const n of [0, 10, 31, 40, 100, good.length - 1]) expect(() => parseOts(good.slice(0, n))).toThrow(OtsFormatError);
  });
  it("末尾の余りはエラー", () => {
    expect(() => parseOts(new Uint8Array([...good, 0]))).toThrow(OtsFormatError);
  });
  it("マジック違いはエラー", () => {
    const bad = good.slice();
    bad[3] ^= 1;
    expect(() => parseOts(bad)).toThrow(OtsFormatError);
  });
  it("巨大な長さ（op 引数・attestation）はエラー", () => {
    // append に 1 GB 相当の長さを宣言
    const hugeArg = new Uint8Array([OP_APPEND, 0x80, 0x80, 0x80, 0x80, 0x04]);
    expect(() => parseTimestampBody(hugeArg)).toThrow(OtsFormatError);
    const hugeAtt = new Uint8Array([0x00, ...TAG_PENDING, 0xff, 0xff, 0xff, 0x7f]);
    expect(() => parseTimestampBody(hugeAtt)).toThrow(OtsFormatError);
  });
  it("入力が上限を超えればエラー", () => {
    expect(() => parseTimestampBody(new Uint8Array(256 * 1024 + 1))).toThrow(OtsFormatError);
  });
  it("深すぎる木はエラー", () => {
    const deep = new Uint8Array(1000).fill(0x08); // sha256 の連鎖が終わらない
    expect(() => parseTimestampBody(deep)).toThrow(/深すぎ|途中/);
    const chain = new Uint8Array([...new Array(300).fill(0x08), 0x00, ...TAG_PENDING, 0x00]);
    expect(() => parseTimestampBody(chain)).toThrow(/深すぎ/);
  });
  it("最小でない varuint は弾く", () => {
    expect(() => parseTimestampBody(new Uint8Array([0x00, ...TAG_PENDING, 0x80, 0x00]))).toThrow(OtsFormatError);
  });
  it("未知の op はエラー", () => {
    expect(() => parseTimestampBody(new Uint8Array([0x99]))).toThrow(OtsFormatError);
  });
});

function pendingNode(uri: string, steps: number[][]): OtsNode {
  // steps: 各 append の引数。sha256 を挟んで最後に Pending
  const payload = encodeVarbytes(new TextEncoder().encode(uri));
  let node: OtsNode = { attestations: [{ tag: TAG_PENDING, payload }], edges: [] };
  for (const s of steps.slice().reverse()) {
    node = { attestations: [], edges: [{ op: { code: OP_APPEND, arg: new Uint8Array(s) }, child: { attestations: [], edges: [{ op: { code: OP_SHA256 }, child: node }] } }] };
  }
  return node;
}

describe("カレンダー応答の合成・pending・upgrade", () => {
  const digest = new Uint8Array(32).fill(7);
  const resA = serializeTimestampNode(pendingNode("https://a.example.org", [[1, 2, 3]]));
  const resB = serializeTimestampNode(pendingNode("https://b.example.org", [[9, 9]]));

  it("2 件を 1 つの木にまとめ、pending を列挙できる", async () => {
    const ots = buildOtsFromCalendarResponses(digest, [resA, resB]);
    const file = parseOts(ots);
    expect(bytesToHex(file.digest)).toBe("07".repeat(32));
    expect(Buffer.from(serializeOts(file))).toEqual(Buffer.from(ots));
    const pend = await listPending(ots);
    expect(pend.map((p) => p.uri).sort()).toEqual(["https://a.example.org", "https://b.example.org"]);
    const expectA = await sha256(new Uint8Array([...digest, 1, 2, 3]));
    expect(pend.find((p) => p.uri === "https://a.example.org")?.commitment).toBe(bytesToHex(expectA));
  });

  it("同じ応答を二重に入れても重ならない", async () => {
    const ots = buildOtsFromCalendarResponses(digest, [resA, resA]);
    expect(await listPending(ots)).toHaveLength(1);
  });

  it("応答が 0 件・ダイジェスト長違いはエラー", () => {
    expect(() => buildOtsFromCalendarResponses(digest, [])).toThrow(OtsFormatError);
    expect(() => buildOtsFromCalendarResponses(new Uint8Array(31), [resA])).toThrow(OtsFormatError);
  });

  it("upgrade: commitment から始まる木が合流し、Bitcoin の値が出る", async () => {
    const file = parseOts(buildOtsFromCalendarResponses(digest, [resA, resB]));
    const target = (await listPending(file)).find((p) => p.uri === "https://a.example.org")!;
    // カレンダーが返す木: commitment → append(5) → sha256 → Bitcoin(高さ 975121)
    const up: OtsNode = {
      attestations: [],
      edges: [{
        op: { code: OP_APPEND, arg: new Uint8Array([5]) },
        child: { attestations: [], edges: [{ op: { code: OP_SHA256 }, child: { attestations: [{ tag: TAG_BITCOIN, payload: encodeVaruint(HEIGHT) }], edges: [] } }] },
      }],
    };
    const n = await applyUpgrade(file, target.commitment, serializeTimestampNode(up), target.uri);
    expect(n).toBe(1);
    const claims = await listBitcoinClaims(file);
    expect(claims).toHaveLength(1);
    expect(claims[0].height).toBe(HEIGHT);
    const c = Uint8Array.from(Buffer.from(target.commitment, "hex"));
    expect(claims[0].digest).toBe(bytesToHex(await sha256(new Uint8Array([...c, 5]))));
    // upgrade 済みの Pending は一覧から消え、b だけ残る。書き戻しても往復する
    expect((await listPending(file)).map((p) => p.uri)).toEqual(["https://b.example.org"]);
    const again = serializeOts(file);
    expect(Buffer.from(serializeOts(parseOts(again)))).toEqual(Buffer.from(again));
    // 二度目の upgrade は同じ内容なので木が増えない
    await applyUpgrade(file, target.commitment, serializeTimestampNode(up));
    expect(Buffer.from(serializeOts(file))).toEqual(Buffer.from(again));
  });

  it("合致する commitment が無ければ 0 件", async () => {
    const file = parseOts(buildOtsFromCalendarResponses(digest, [resA]));
    expect(await applyUpgrade(file, "00".repeat(32), resB)).toBe(0);
  });

  it("実データの確定前の pending を列挙できる", async () => {
    const pend = await listPending(load(PROOF));
    expect(pend.map((p) => p.uri).sort()).toEqual([
      "https://alice.btc.calendar.opentimestamps.org",
      "https://finney.calendar.eternitywall.com",
    ]);
    for (const p of pend) expect(p.commitment).toMatch(/^[0-9a-f]+$/);
  });
});
