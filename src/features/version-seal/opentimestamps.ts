// OpenTimestamps（OTS）の自前実装（形式の読み書き・カレンダー応答の合成・upgrade・Bitcoin 照合）。
//
// 公式 JS ライブラリ（LGPL-3.0）は使わず、公開されているプロトコル仕様だけから書いている。
// 画面（WebView）と sidecar（Node）の両方で動く純粋な処理で、ネットワークは呼ばない
// （カレンダーへの POST/GET やブロックヘッダの取得は呼び出し側が行う）。
//
// 形式の要点:
// - .ots = マジック + 版(varuint 1) + ファイルハッシュの op + ダイジェスト + timestamp 木
// - timestamp 木のノード = 「attestation の並び」+「op → 子ノード の並び」。
//   要素が複数あるとき、最後以外の前に 0xff（fork）を置く。
// - 直列化は attestation を先、op を後に並べる（公式実装と同じ正規形）。
//   読み込みもこの並びだけを受け付けるので、読み → 書きでバイト単位で同じになる。

import { bytesToHex, hexToBytes } from "./rfc3161";

// ---------- 定数 ----------

/** .ots ファイルの先頭に付くマジック */
export const OTS_MAGIC = new Uint8Array([
  0x00, 0x4f, 0x70, 0x65, 0x6e, 0x54, 0x69, 0x6d, 0x65, 0x73, 0x74, 0x61, 0x6d, 0x70, 0x73, 0x00,
  0x00, 0x50, 0x72, 0x6f, 0x6f, 0x66, 0x00, 0xbf, 0x89, 0xe2, 0xe8, 0x84, 0xe8, 0x92, 0x94,
]);

export const OP_SHA1 = 0x02;
export const OP_RIPEMD160 = 0x03;
export const OP_SHA256 = 0x08;
export const OP_KECCAK256 = 0x67;
export const OP_APPEND = 0xf0;
export const OP_PREPEND = 0xf1;
export const OP_REVERSE = 0xf2;
export const OP_HEXLIFY = 0xf3;

const UNARY_OPS = new Set([OP_SHA1, OP_RIPEMD160, OP_SHA256, OP_KECCAK256, OP_REVERSE, OP_HEXLIFY]);
const BINARY_OPS = new Set([OP_APPEND, OP_PREPEND]);

/** attestation のタグ（8 バイト） */
export const TAG_PENDING = new Uint8Array([0x83, 0xdf, 0xe3, 0x0d, 0x2e, 0xf9, 0x0c, 0x8e]);
export const TAG_BITCOIN = new Uint8Array([0x05, 0x88, 0x96, 0x0d, 0x73, 0xd7, 0x19, 0x01]);

/** 入力の大きさの上限（解析器を巨大な入力で突かれないため） */
export const MAX_OTS_BYTES = 256 * 1024;
/** 木の深さの上限（再帰の暴走防止） */
export const MAX_TREE_DEPTH = 256;
/** op の引数（append/prepend）の長さの上限 */
export const MAX_OP_ARG_BYTES = 4096;
/** attestation の payload の長さの上限 */
export const MAX_ATTESTATION_PAYLOAD_BYTES = 8192;
/** 評価中のメッセージの長さの上限（hexlify の連鎖で倍々に増えるのを止める） */
const MAX_MESSAGE_BYTES = 64 * 1024;
/** varuint の最大バイト数（49 ビット。number で安全に扱える範囲） */
const MAX_VARUINT_BYTES = 7;

// ---------- 型 ----------

export class OtsFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OtsFormatError";
  }
}

export interface OtsOp {
  /** op のコード（OP_*） */
  code: number;
  /** append / prepend のときだけ */
  arg?: Uint8Array;
}

export interface OtsAttestation {
  /** 8 バイトのタグ */
  tag: Uint8Array;
  /** タグごとの payload（varbytes の中身）。未知のタグもそのまま保持する */
  payload: Uint8Array;
}

export interface OtsEdge {
  op: OtsOp;
  child: OtsNode;
}

export interface OtsNode {
  attestations: OtsAttestation[];
  edges: OtsEdge[];
}

export interface OtsFile {
  /** ファイルハッシュの op（OP_SHA256 など） */
  fileHashOp: number;
  /** 時刻証明の対象のダイジェスト */
  digest: Uint8Array;
  root: OtsNode;
}

// ---------- バイト列のヘルパー ----------

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

function compareBytes(a: Uint8Array, b: Uint8Array): number {
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) if (a[i] !== b[i]) return a[i] - b[i];
  return a.length - b.length;
}

function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((s, p) => s + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

/** varuint（7 ビットずつ・下位から・最上位ビットが継続） */
export function encodeVaruint(value: number): Uint8Array {
  if (!Number.isSafeInteger(value) || value < 0) throw new OtsFormatError("varuint は 0 以上の整数");
  const out: number[] = [];
  let v = value;
  do {
    const low = v % 128;
    v = Math.floor(v / 128);
    out.push(v > 0 ? low | 0x80 : low);
  } while (v > 0);
  if (out.length > MAX_VARUINT_BYTES) throw new OtsFormatError("varuint が大きすぎます");
  return new Uint8Array(out);
}

export function encodeVarbytes(bytes: Uint8Array): Uint8Array {
  return concat(encodeVaruint(bytes.length), bytes);
}

class Reader {
  pos = 0;
  constructor(readonly data: Uint8Array) {}

  get remaining(): number {
    return this.data.length - this.pos;
  }

  byte(): number {
    if (this.pos >= this.data.length) throw new OtsFormatError("データが途中で切れています");
    return this.data[this.pos++];
  }

  bytes(n: number): Uint8Array {
    if (n < 0 || n > this.remaining) throw new OtsFormatError("データが途中で切れています");
    const out = this.data.subarray(this.pos, this.pos + n);
    this.pos += n;
    return out;
  }

  varuint(): number {
    let value = 0;
    for (let i = 0; i < MAX_VARUINT_BYTES; i++) {
      const b = this.byte();
      value += (b & 0x7f) * 2 ** (7 * i);
      if ((b & 0x80) === 0) {
        // 最小の長さで書かれていない（末尾が 0 の継続）ものは往復で形が変わるので弾く
        if (i > 0 && b === 0) throw new OtsFormatError("varuint が最小の形ではありません");
        return value;
      }
    }
    throw new OtsFormatError("varuint が長すぎます");
  }

  varbytes(max: number): Uint8Array {
    const len = this.varuint();
    if (len > max) throw new OtsFormatError(`長さ ${len} が上限 ${max} を超えています`);
    return this.bytes(len);
  }
}

// ---------- 読み込み ----------

function readOp(r: Reader, code: number): OtsOp {
  if (UNARY_OPS.has(code)) return { code };
  if (BINARY_OPS.has(code)) return { code, arg: new Uint8Array(r.varbytes(MAX_OP_ARG_BYTES)) };
  throw new OtsFormatError(`未知の op です: 0x${code.toString(16)}`);
}

function readNode(r: Reader, depth: number): OtsNode {
  if (depth > MAX_TREE_DEPTH) throw new OtsFormatError("木が深すぎます");
  const node: OtsNode = { attestations: [], edges: [] };
  for (;;) {
    let tag = r.byte();
    const isLast = tag !== 0xff;
    if (!isLast) tag = r.byte();
    if (tag === 0xff) throw new OtsFormatError("fork が連続しています");
    if (tag === 0x00) {
      // attestation は op より前に並ぶ（正規形）
      if (node.edges.length > 0) throw new OtsFormatError("attestation が op の後ろにあります");
      const attTag = new Uint8Array(r.bytes(8));
      const payload = new Uint8Array(r.varbytes(MAX_ATTESTATION_PAYLOAD_BYTES));
      node.attestations.push({ tag: attTag, payload });
    } else {
      const op = readOp(r, tag);
      node.edges.push({ op, child: readNode(r, depth + 1) });
    }
    if (isLast) return node;
  }
}

/** ヘッダ無しの timestamp 木（カレンダーの応答）を読む。末尾の余りはエラー */
export function parseTimestampBody(bytes: Uint8Array): OtsNode {
  if (bytes.length > MAX_OTS_BYTES) throw new OtsFormatError("入力が大きすぎます");
  const r = new Reader(bytes);
  const node = readNode(r, 0);
  if (r.remaining !== 0) throw new OtsFormatError("末尾に余りがあります");
  return node;
}

function digestLengthOf(op: number): number {
  if (op === OP_SHA256) return 32;
  if (op === OP_SHA1 || op === OP_RIPEMD160) return 20;
  throw new OtsFormatError(`ファイルハッシュの op に使えません: 0x${op.toString(16)}`);
}

/** .ots（詳細ファイル）を読む */
export function parseOts(bytes: Uint8Array): OtsFile {
  if (bytes.length > MAX_OTS_BYTES) throw new OtsFormatError("入力が大きすぎます");
  const r = new Reader(bytes);
  if (!bytesEqual(r.bytes(OTS_MAGIC.length), OTS_MAGIC)) throw new OtsFormatError("OpenTimestamps のファイルではありません");
  const version = r.varuint();
  if (version !== 1) throw new OtsFormatError(`未対応の版です: ${version}`);
  const fileHashOp = r.byte();
  const digest = new Uint8Array(r.bytes(digestLengthOf(fileHashOp)));
  const root = readNode(r, 0);
  if (r.remaining !== 0) throw new OtsFormatError("末尾に余りがあります");
  return { fileHashOp, digest, root };
}

// ---------- 書き出し ----------

function writeOp(op: OtsOp): Uint8Array {
  if (UNARY_OPS.has(op.code)) return new Uint8Array([op.code]);
  if (BINARY_OPS.has(op.code) && op.arg) return concat(new Uint8Array([op.code]), encodeVarbytes(op.arg));
  throw new OtsFormatError(`書けない op です: 0x${op.code.toString(16)}`);
}

/** timestamp 木（ノード）の直列化。attestation → op の順 */
export function serializeTimestampNode(node: OtsNode): Uint8Array {
  const total = node.attestations.length + node.edges.length;
  if (total === 0) throw new OtsFormatError("空のノードは書けません");
  const parts: Uint8Array[] = [];
  let i = 0;
  const fork = () => {
    if (i++ < total - 1) parts.push(new Uint8Array([0xff]));
  };
  for (const a of node.attestations) {
    fork();
    parts.push(new Uint8Array([0x00]), a.tag, encodeVarbytes(a.payload));
  }
  for (const e of node.edges) {
    fork();
    parts.push(writeOp(e.op), serializeTimestampNode(e.child));
  }
  return concat(...parts);
}

export function serializeOts(file: OtsFile): Uint8Array {
  if (file.digest.length !== digestLengthOf(file.fileHashOp)) throw new OtsFormatError("ダイジェストの長さが op と合いません");
  return concat(OTS_MAGIC, encodeVaruint(1), new Uint8Array([file.fileHashOp]), file.digest, serializeTimestampNode(file.root));
}

// ---------- 木の合流 ----------

function sameOp(a: OtsOp, b: OtsOp): boolean {
  if (a.code !== b.code) return false;
  if (a.arg || b.arg) return !!a.arg && !!b.arg && bytesEqual(a.arg, b.arg);
  return true;
}

/**
 * src を dst に合流させる（同じメッセージから始まる木どうし）。
 * 同じ attestation / 同じ op の枝は重ねず、子どうしを再帰で合流させる。
 * 触ったノードは正規形（attestation も op も整列済み）に並べ直す。
 */
export function mergeNodes(dst: OtsNode, src: OtsNode): void {
  for (const a of src.attestations) {
    if (!dst.attestations.some((x) => bytesEqual(x.tag, a.tag) && bytesEqual(x.payload, a.payload))) {
      dst.attestations.push({ tag: a.tag.slice(), payload: a.payload.slice() });
    }
  }
  for (const e of src.edges) {
    const hit = dst.edges.find((x) => sameOp(x.op, e.op));
    if (hit) mergeNodes(hit.child, e.child);
    else dst.edges.push({ op: { code: e.op.code, arg: e.op.arg?.slice() }, child: cloneNode(e.child) });
  }
  dst.attestations.sort((x, y) => compareBytes(x.tag, y.tag) || compareBytes(x.payload, y.payload));
  dst.edges.sort((x, y) => x.op.code - y.op.code || compareBytes(x.op.arg ?? new Uint8Array(), y.op.arg ?? new Uint8Array()));
}

function cloneNode(n: OtsNode): OtsNode {
  return {
    attestations: n.attestations.map((a) => ({ tag: a.tag.slice(), payload: a.payload.slice() })),
    edges: n.edges.map((e) => ({ op: { code: e.op.code, arg: e.op.arg?.slice() }, child: cloneNode(e.child) })),
  };
}

// ---------- カレンダー応答の合成 ----------

/**
 * カレンダーに 32 バイトのダイジェストを POST して得た応答（ヘッダ無しの木）を、
 * 複数まとめて 1 つの .ots にする。応答は同じダイジェストから始まる木なので、
 * 根のノードに fork で並べる（mergeNodes）。
 */
export function buildOtsFromCalendarResponses(digest: Uint8Array, responses: Uint8Array[]): Uint8Array {
  if (digest.length !== 32) throw new OtsFormatError("ダイジェストは 32 バイトです");
  if (responses.length === 0) throw new OtsFormatError("カレンダーの応答がありません");
  const root: OtsNode = { attestations: [], edges: [] };
  for (const res of responses) mergeNodes(root, parseTimestampBody(res));
  return serializeOts({ fileHashOp: OP_SHA256, digest: digest.slice(), root });
}

/**
 * 乱数で隠してから出す（公式クライアントと同じ考え方）。
 * カレンダーには sha256(digest || nonce) だけを出し、.ots には
 * 「digest に nonce を append → sha256 → カレンダーの木」の経路を書く。
 * カレンダー側は元のダイジェスト（＝封印ファイルのハッシュ）を知らないので、
 * 同じハッシュを受け取った別のサービス（RFC 3161 の局など）と突き合わせられない。
 */
export async function blindDigest(
  digest: Uint8Array,
  nonce: Uint8Array = crypto.getRandomValues(new Uint8Array(16)),
): Promise<{ blinded: Uint8Array; nonce: Uint8Array }> {
  if (digest.length !== 32) throw new OtsFormatError("ダイジェストは 32 バイトです");
  const blinded = new Uint8Array(await crypto.subtle.digest("SHA-256", concat(digest, nonce) as BufferSource));
  return { blinded, nonce };
}

/** blindDigest で隠したものへのカレンダー応答から .ots を作る */
export function buildBlindedOts(
  digest: Uint8Array,
  nonce: Uint8Array,
  responses: Uint8Array[],
): Uint8Array {
  if (digest.length !== 32) throw new OtsFormatError("ダイジェストは 32 バイトです");
  if (responses.length === 0) throw new OtsFormatError("カレンダーの応答がありません");
  const calendars: OtsNode = { attestations: [], edges: [] };
  for (const res of responses) mergeNodes(calendars, parseTimestampBody(res));
  const root: OtsNode = {
    attestations: [],
    edges: [
      {
        op: { code: OP_APPEND, arg: nonce.slice() },
        child: { attestations: [], edges: [{ op: { code: OP_SHA256 }, child: calendars }] },
      },
    ],
  };
  return serializeOts({ fileHashOp: OP_SHA256, digest: digest.slice(), root });
}

// ---------- 評価 ----------

class UnsupportedOpError extends Error {}

async function applyOp(op: OtsOp, msg: Uint8Array): Promise<Uint8Array> {
  let out: Uint8Array;
  switch (op.code) {
    case OP_SHA256:
      out = new Uint8Array(await crypto.subtle.digest("SHA-256", msg as BufferSource));
      break;
    case OP_SHA1:
      out = new Uint8Array(await crypto.subtle.digest("SHA-1", msg as BufferSource));
      break;
    case OP_APPEND:
      out = concat(msg, op.arg ?? new Uint8Array());
      break;
    case OP_PREPEND:
      out = concat(op.arg ?? new Uint8Array(), msg);
      break;
    case OP_REVERSE:
      out = msg.slice().reverse();
      break;
    case OP_HEXLIFY:
      out = new TextEncoder().encode(bytesToHex(msg));
      break;
    case OP_RIPEMD160:
      throw new UnsupportedOpError("ripemd160 を含む経路は検証できません");
    case OP_KECCAK256:
      throw new UnsupportedOpError("keccak256 を含む経路は検証できません");
    default:
      throw new UnsupportedOpError(`未知の op 0x${op.code.toString(16)} を含む経路は検証できません`);
  }
  if (out.length > MAX_MESSAGE_BYTES) throw new UnsupportedOpError("途中のメッセージが大きすぎるため検証できません");
  return out;
}

export interface OtsLeaf {
  /** attestation が付いているノード（upgrade の合流先） */
  node: OtsNode;
  attestation: OtsAttestation;
  /** その時点のメッセージ */
  msg: Uint8Array;
}

export interface OtsEvaluation {
  leaves: OtsLeaf[];
  /** 評価できなかった経路の理由 */
  unverifiable: string[];
}

/** 根のメッセージ（ファイルのダイジェスト）から木を辿り、各 attestation での値を求める */
export async function evaluateTree(root: OtsNode, startMsg: Uint8Array): Promise<OtsEvaluation> {
  const leaves: OtsLeaf[] = [];
  const unverifiable: string[] = [];
  const walk = async (node: OtsNode, msg: Uint8Array): Promise<void> => {
    for (const attestation of node.attestations) leaves.push({ node, attestation, msg });
    for (const e of node.edges) {
      let next: Uint8Array;
      try {
        next = await applyOp(e.op, msg);
      } catch (err) {
        if (err instanceof UnsupportedOpError) {
          unverifiable.push(err.message);
          continue;
        }
        throw err;
      }
      await walk(e.child, next);
    }
  };
  await walk(root, startMsg);
  return { leaves, unverifiable };
}

// ---------- attestation の読み取り ----------

function tagIs(a: OtsAttestation, tag: Uint8Array): boolean {
  return bytesEqual(a.tag, tag);
}

/** Pending の payload（varbytes(URI の UTF-8)）から URI を取り出す */
export function decodePendingUri(att: OtsAttestation): string {
  const r = new Reader(att.payload);
  const raw = r.varbytes(MAX_ATTESTATION_PAYLOAD_BYTES);
  if (r.remaining !== 0) throw new OtsFormatError("Pending の payload に余りがあります");
  return new TextDecoder("utf-8", { fatal: true }).decode(raw);
}

/** Bitcoin の payload（varuint(ブロック高)）を取り出す */
export function decodeBitcoinHeight(att: OtsAttestation): number {
  const r = new Reader(att.payload);
  const h = r.varuint();
  if (r.remaining !== 0) throw new OtsFormatError("Bitcoin の payload に余りがあります");
  return h;
}

/** attestation 付きのノードが upgrade 済みか（枝がある、または Pending 以外の attestation がある） */
function isResolved(node: OtsNode): boolean {
  return node.edges.length > 0 || node.attestations.some((a) => !tagIs(a, TAG_PENDING));
}

// ---------- pending の一覧と upgrade ----------

export interface PendingEntry {
  /** カレンダーの URI */
  uri: string;
  /** その時点のメッセージ（hex）。upgrade では GET <uri>/timestamp/<commitment> に使う */
  commitment: string;
}

function toFile(input: OtsFile | Uint8Array): OtsFile {
  return input instanceof Uint8Array ? parseOts(input) : input;
}

/** まだ upgrade されていない Pending を一覧する（URI が読めないものは除く） */
export async function listPending(input: OtsFile | Uint8Array): Promise<PendingEntry[]> {
  const file = toFile(input);
  const ev = await evaluateTree(file.root, file.digest);
  const out: PendingEntry[] = [];
  for (const leaf of ev.leaves) {
    if (!tagIs(leaf.attestation, TAG_PENDING) || isResolved(leaf.node)) continue;
    try {
      out.push({ uri: decodePendingUri(leaf.attestation), commitment: bytesToHex(leaf.msg) });
    } catch {
      // 壊れた Pending は無視（verify 側で unverifiable として出る）
    }
  }
  return out;
}

/**
 * カレンダーが GET /timestamp/<commitment hex> で返した木（その commitment から始まる）を、
 * 元の木の該当ノードに合流させる。合流させた数を返す。file を直接書き換える。
 * 方針: Pending は消さずに残す（公式クライアントは消すが、どちらでも検証は成り立つ）。
 * 残しても isResolved により listPending / verify には出てこない。
 */
export async function applyUpgrade(file: OtsFile, commitmentHex: string, upgrade: Uint8Array, uri?: string): Promise<number> {
  const commitment = commitmentHex.toLowerCase();
  const body = parseTimestampBody(upgrade);
  const ev = await evaluateTree(file.root, file.digest);
  let merged = 0;
  for (const leaf of ev.leaves) {
    if (!tagIs(leaf.attestation, TAG_PENDING) || bytesToHex(leaf.msg) !== commitment) continue;
    if (uri !== undefined) {
      try {
        if (decodePendingUri(leaf.attestation) !== uri) continue;
      } catch {
        continue;
      }
    }
    mergeNodes(leaf.node, body);
    merged++;
  }
  return merged;
}

// ---------- Bitcoin の照合 ----------

export interface BitcoinClaim {
  height: number;
  /** ブロックの merkle root に一致するはずのダイジェスト（hex） */
  digest: string;
}

/** 木を評価して Bitcoin attestation ごとの { height, digest } を返す */
export async function listBitcoinClaims(input: OtsFile | Uint8Array): Promise<BitcoinClaim[]> {
  const file = toFile(input);
  const ev = await evaluateTree(file.root, file.digest);
  const out: BitcoinClaim[] = [];
  for (const leaf of ev.leaves) {
    if (!tagIs(leaf.attestation, TAG_BITCOIN)) continue;
    try {
      out.push({ height: decodeBitcoinHeight(leaf.attestation), digest: bytesToHex(leaf.msg) });
    } catch {
      // 壊れたものは verify 側で扱う
    }
  }
  return out;
}

/** Bitcoin 本体の作業証明の上限（powLimit。これより易しい target は本物のブロックにならない） */
const POW_LIMIT = BigInt("0x00000000ffff0000000000000000000000000000000000000000000000000000");

/**
 * ヘッダの作業証明を確かめる: ヘッダの二重 SHA-256 が、ヘッダ自身の bits が示す target 以下か、
 * その target が Bitcoin の上限より易しくないか。偽のヘッダを作るには、この計算を実際に解く必要がある。
 * ブロック高との対応（本当にその高さのブロックか）は、取得先 2 か所の突き合わせで補う（sidecar 側）。
 */
export async function headerMeetsProofOfWork(headerHex: string): Promise<boolean> {
  const header = hexToBytes(headerHex.trim());
  if (header.length !== 80) return false;
  const bits = new DataView(header.buffer, header.byteOffset + 72, 4).getUint32(0, true);
  const exponent = bits >>> 24;
  const mantissa = bits & 0x007fffff;
  if (bits & 0x00800000 || mantissa === 0) return false; // 負の値・0 は不正
  const target = exponent <= 3
    ? BigInt(mantissa) >> BigInt(8 * (3 - exponent))
    : BigInt(mantissa) << BigInt(8 * (exponent - 3));
  if (target <= 0n || target > POW_LIMIT) return false;
  const once = new Uint8Array(await crypto.subtle.digest("SHA-256", header as BufferSource));
  const twice = new Uint8Array(await crypto.subtle.digest("SHA-256", once as BufferSource));
  const hashValue = BigInt("0x" + bytesToHex(twice.slice().reverse()));
  return hashValue <= target;
}

export interface HeaderCheck {
  /** digest がヘッダの merkle root（バイト 36〜68 をそのままの並び）と一致するか */
  merkleRootMatches: boolean;
  /** ブロックの時刻（UNIX 秒。バイト 68〜72 のリトルエンディアン uint32） */
  time: number;
}

/**
 * ブロックヘッダ（80 バイトの hex）と照合する。
 * ヘッダ自体の正しさ（PoW・ブロック高との対応）は取得元を信頼する前提で、ここでは確かめない。
 */
export function checkBitcoinHeader(headerHex: string, digestHex: string): HeaderCheck {
  const header = hexToBytes(headerHex.trim());
  if (header.length !== 80) throw new OtsFormatError("ブロックヘッダは 80 バイトです");
  const merkle = header.subarray(36, 68);
  const time = new DataView(header.buffer, header.byteOffset + 68, 4).getUint32(0, true);
  return { merkleRootMatches: bytesToHex(merkle) === digestHex.toLowerCase(), time };
}

// ---------- 全体の検証 ----------

export type OtsPathResult =
  | { status: "confirmed"; height: number; time: number; digest: string }
  | { status: "pending"; uri: string; commitment: string }
  | { status: "invalid"; height: number; reason: string }
  | { status: "unverifiable"; reason: string };

export interface OtsVerification {
  /** .ots のファイルハッシュが expectedDigestHex と一致するか（sha256 のみ） */
  fileHashMatches: boolean;
  results: OtsPathResult[];
  /** ファイルハッシュが一致し、確定した経路が 1 つ以上ある */
  ok: boolean;
  /** 確定した経路のうち最も早いブロック時刻（UNIX 秒） */
  earliestTime?: number;
}

/**
 * .ots と「時刻証明の対象のダイジェスト（hex）」を照合する。
 * getBlockHeader(height) はブロックヘッダ 80 バイトの hex を返す（取得は呼び出し側）。
 * ファイルハッシュが合わなければ経路の評価（とヘッダの取得）は行わない。
 */
export async function verifyOts(
  otsBytes: Uint8Array,
  expectedDigestHex: string,
  getBlockHeader: (height: number) => Promise<string>,
): Promise<OtsVerification> {
  const file = parseOts(otsBytes);
  const fileHashMatches = file.fileHashOp === OP_SHA256 && bytesToHex(file.digest) === expectedDigestHex.toLowerCase();
  if (!fileHashMatches) return { fileHashMatches, results: [], ok: false };

  const ev = await evaluateTree(file.root, file.digest);
  const results: OtsPathResult[] = [];
  for (const leaf of ev.leaves) {
    const a = leaf.attestation;
    if (tagIs(a, TAG_PENDING)) {
      if (isResolved(leaf.node)) continue; // upgrade 済みの Pending は出さない
      try {
        results.push({ status: "pending", uri: decodePendingUri(a), commitment: bytesToHex(leaf.msg) });
      } catch {
        results.push({ status: "unverifiable", reason: "Pending の URI を読めません" });
      }
    } else if (tagIs(a, TAG_BITCOIN)) {
      let height: number;
      try {
        height = decodeBitcoinHeight(a);
      } catch {
        results.push({ status: "unverifiable", reason: "Bitcoin のブロック高を読めません" });
        continue;
      }
      const digest = bytesToHex(leaf.msg);
      try {
        const headerHex = await getBlockHeader(height);
        if (!(await headerMeetsProofOfWork(headerHex))) {
          results.push({ status: "invalid", height, reason: "ブロックヘッダの作業証明が成り立ちません" });
          continue;
        }
        const check = checkBitcoinHeader(headerHex, digest);
        if (check.merkleRootMatches) results.push({ status: "confirmed", height, time: check.time, digest });
        else results.push({ status: "invalid", height, reason: "ブロックの merkle root と一致しません" });
      } catch (err) {
        results.push({ status: "unverifiable", reason: `ブロック ${height} のヘッダを確かめられません: ${err instanceof Error ? err.message : String(err)}` });
      }
    } else {
      results.push({ status: "unverifiable", reason: `未知の attestation です（タグ ${bytesToHex(a.tag)}）` });
    }
  }
  for (const reason of ev.unverifiable) results.push({ status: "unverifiable", reason });

  const times = results.flatMap((r) => (r.status === "confirmed" ? [r.time] : []));
  return {
    fileHashMatches,
    results,
    ok: times.length > 0,
    earliestTime: times.length ? Math.min(...times) : undefined,
  };
}
