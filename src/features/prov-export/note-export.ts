// ──────────────────────────────────────────────
// ノート 1 冊分の PROV-JSON-LD 書き出し（手順グラフ + ノート自体の記録）
//
// 手順グラフ（buildW3CProvJsonLd）に加えて、ノート Entity・本文 Entity・フォルダ・出典・
// 素材・表 Collection・メモ（oa:Annotation）・AI チャット・人の Agent を同じ @graph に並置する。
//
// - 純関数。DOM / React / Node 固有 API に依存しない（MCP サーバーの Node からも呼ぶ）。
// - 呼び出し側が I/O して集めた付属情報（NoteProvExtras）を受け取るだけ（note-extras.ts が収集）。
// - バレル（prov-generator/index.ts）経由でなく個別ファイルから import する。
// - 値参照は常に {"@id": …}。時刻は toISOString() に正規化し、不正な日時は出さない。
// ──────────────────────────────────────────────

import type { ProvJsonLd } from "../prov-generator/generator";
import type { BlockLink } from "../block-link/link-types";
import type { GraphiumPage, TableSource } from "../../lib/document-types";
import type { SourceInfo } from "../asset-browser/media-index";
import { blocksToPlainText } from "../prov-generator/plain-text";
import { splitMemoBodyAndSource } from "../mobile-capture/memo-insert";
import {
  buildW3CProvJsonLd,
  OPENPROVENANCE_CONTEXT_URL,
  PROV_EXPORT_CONTEXT_BASE,
  toW3CLabel,
  type W3CProvDocument,
  type W3CProvNode,
  type WikiEntityInfo,
} from "./export-jsonld";

const enc = encodeURIComponent;

/**
 * Wiki / Skill ドキュメントの fileId・noteId は "wiki:<id>" / "skill:<id>" で保存される。
 * ノートとの照合は両辺をこの関数に通してから行う（メモ・素材の usedIn も同じ）。
 */
export function stripDocKeyPrefix(id: string): string {
  return id.replace(/^(wiki|skill):/, "");
}

// ── 入力の型 ──

export type MemoExportEntry = {
  id: string;
  text: string;
  createdAt: string;
  modifiedAt?: string;
  /** 本文を書き換えた履歴がある（editHistory が空でない） */
  edited: boolean;
  /** 作成者のメールアドレス */
  createdBy?: string;
  sourceNote?: { fileId: string; blockId?: string; blockText?: string };
  sourceAsset?: { fileId: string; type: string; pageNumber?: number };
  usedInThisNote: boolean;
  /** sourceAsset があり、本文に "\n\n— " の出典行がある（素材からの引用メモ） */
  isQuote: boolean;
};

export type AssetExportEntry = {
  fileId: string;
  /** MediaIndexEntry.type（pdf / image / video / audio / document / data / url / other …） */
  type: string;
  name?: string;
  url?: string;
  /** 分かれば dc:format に出す（無ければ pdf と拡張子から推す） */
  mimeType?: string;
  sourceInfo?: SourceInfo;
};

export type ChatExportEntry = {
  id: string;
  scopeBlockId?: string;
  scopeType: "heading" | "block" | "page";
  model?: string;
  messages: { role: "user" | "assistant"; content: string; timestamp: string }[];
};

export type NoteProvExtras = {
  modifiedAt?: string;
  folders?: string[];
  sources?: {
    kind: "url" | "pdf" | "document" | "text" | "note" | "template" | "shared" | "import";
    id: string;
    label?: string;
  }[];
  influences?: { kind: "asset" | "wiki"; id: string; type?: string; label?: string }[];
  partOfPlanNoteId?: string;
  memos?: MemoExportEntry[];
  assets?: AssetExportEntry[];
  chats?: ChatExportEntry[];
  tableMeta?: Record<string, { caption?: string; source?: TableSource }>;
  /** メディア URL（media-server:// 等）→ 素材 fileId。当たらなければ null */
  resolveFileId?: (url: string) => string | null;
  humanAgent?: { name?: string; email?: string };
  /** 計画の線の名前（実績）。リンクに名前が無ければ undefined */
  edgeLabelForLink?: (link: BlockLink) => string | undefined;
};

export type NoteProvExportInput = {
  provDoc: ProvJsonLd;
  title: string;
  noteId: string;
  /** 本文 hash と純テキスト用 */
  page: GraphiumPage;
  wikiEntities?: WikiEntityInfo[];
  crossNoteLinks?: BlockLink[];
  extras?: NoteProvExtras;
  options?: { includeBody?: boolean; includeMemos?: boolean; includeChats?: boolean };
};

// ── @context ──

/** buildW3CProvJsonLd の context に末尾追加する語彙 */
export const PROV_EXPORT_CONTEXT_ADDED: Record<string, string> = {
  "p-plan": "http://purl.org/net/p-plan#",
  oa: "http://www.w3.org/ns/oa#",
  dc: "http://purl.org/dc/elements/1.1/",
};

/** ノート書き出し・計画書き出しの @context（既存 inline context + 追加語彙 + リモート context） */
export function buildProvExportContext(): [Record<string, any>, string] {
  return [{ ...PROV_EXPORT_CONTEXT_BASE, ...PROV_EXPORT_CONTEXT_ADDED }, OPENPROVENANCE_CONTEXT_URL];
}

// ── 純 JS のハッシュ（sha1 / sha256）──
// crypto.subtle は非同期、node:crypto は Node 限定。書き出しを同期の純関数に保つため自前で持つ。
// sha256 は computePageHash（document-provenance/diff.ts）と同じ値になる（テストで固定）。

function utf8(input: string): Uint8Array {
  return new TextEncoder().encode(input);
}

function toHex(words: number[]): string {
  return words.map((w) => (w >>> 0).toString(16).padStart(8, "0")).join("");
}

/** 入力に 0x80・0 埋め・ビット長（64bit big endian）を足して 64 バイトの倍数にする */
function padMessage(bytes: Uint8Array): DataView {
  const len = bytes.length;
  const total = (((len + 8) >> 6) + 1) * 64;
  const buf = new Uint8Array(total);
  buf.set(bytes);
  buf[len] = 0x80;
  const view = new DataView(buf.buffer);
  view.setUint32(total - 8, Math.floor((len * 8) / 0x100000000));
  view.setUint32(total - 4, (len * 8) >>> 0);
  return view;
}

export function sha1Hex(input: string): string {
  const view = padMessage(utf8(input));
  const rotl = (n: number, s: number) => (n << s) | (n >>> (32 - s));
  let h0 = 0x67452301;
  let h1 = 0xefcdab89;
  let h2 = 0x98badcfe;
  let h3 = 0x10325476;
  let h4 = 0xc3d2e1f0;
  const w = new Uint32Array(80);
  for (let off = 0; off < view.byteLength; off += 64) {
    for (let i = 0; i < 16; i++) w[i] = view.getUint32(off + i * 4);
    for (let i = 16; i < 80; i++) w[i] = rotl(w[i - 3] ^ w[i - 8] ^ w[i - 14] ^ w[i - 16], 1);
    let a = h0;
    let b = h1;
    let c = h2;
    let d = h3;
    let e = h4;
    for (let i = 0; i < 80; i++) {
      let f: number;
      let k: number;
      if (i < 20) {
        f = (b & c) | (~b & d);
        k = 0x5a827999;
      } else if (i < 40) {
        f = b ^ c ^ d;
        k = 0x6ed9eba1;
      } else if (i < 60) {
        f = (b & c) | (b & d) | (c & d);
        k = 0x8f1bbcdc;
      } else {
        f = b ^ c ^ d;
        k = 0xca62c1d6;
      }
      const temp = (rotl(a, 5) + f + e + k + w[i]) >>> 0;
      e = d;
      d = c;
      c = rotl(b, 30) >>> 0;
      b = a;
      a = temp;
    }
    h0 = (h0 + a) >>> 0;
    h1 = (h1 + b) >>> 0;
    h2 = (h2 + c) >>> 0;
    h3 = (h3 + d) >>> 0;
    h4 = (h4 + e) >>> 0;
  }
  return toHex([h0, h1, h2, h3, h4]);
}

// sha256 の定数は「素数の平方根 / 立方根の小数部の上位 32bit」。手で写さず計算で作る
// （写し間違いはテストの crypto.subtle 照合でも検知する）。
let sha256Consts: { init: number[]; k: number[] } | null = null;
function getSha256Consts(): { init: number[]; k: number[] } {
  if (sha256Consts) return sha256Consts;
  const primes: number[] = [];
  for (let n = 2; primes.length < 64; n++) {
    if (primes.every((p) => n % p !== 0)) primes.push(n);
  }
  const frac32 = (x: number) => Math.floor((x - Math.floor(x)) * 0x100000000) >>> 0;
  sha256Consts = {
    init: primes.slice(0, 8).map((p) => frac32(Math.sqrt(p))),
    k: primes.map((p) => frac32(Math.cbrt(p))),
  };
  return sha256Consts;
}

export function sha256Hex(input: string): string {
  const { init, k } = getSha256Consts();
  const view = padMessage(utf8(input));
  const h = init.slice();
  const w = new Uint32Array(64);
  const rotr = (n: number, s: number) => (n >>> s) | (n << (32 - s));
  for (let off = 0; off < view.byteLength; off += 64) {
    for (let i = 0; i < 16; i++) w[i] = view.getUint32(off + i * 4);
    for (let i = 16; i < 64; i++) {
      const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3);
      const s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
    }
    let [a, b, c, d, e, f, g, hh] = h;
    for (let i = 0; i < 64; i++) {
      const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const t1 = (hh + S1 + ch + k[i] + w[i]) >>> 0;
      const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (S0 + maj) >>> 0;
      hh = g;
      g = f;
      f = e;
      e = (d + t1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (t1 + t2) >>> 0;
    }
    h[0] = (h[0] + a) >>> 0;
    h[1] = (h[1] + b) >>> 0;
    h[2] = (h[2] + c) >>> 0;
    h[3] = (h[3] + d) >>> 0;
    h[4] = (h[4] + e) >>> 0;
    h[5] = (h[5] + f) >>> 0;
    h[6] = (h[6] + g) >>> 0;
    h[7] = (h[7] + hh) >>> 0;
  }
  return toHex(h);
}

/** computePageHash（document-provenance/diff.ts）の同期版。同じ JSON から同じ SHA-256 を返す */
export function computePageHashSync(page: GraphiumPage): string {
  return sha256Hex(
    JSON.stringify({
      blocks: page.blocks,
      labels: page.labels,
      provLinks: page.provLinks,
      knowledgeLinks: page.knowledgeLinks,
    }),
  );
}

// ── IRI と小さなヘルパー ──

export function noteIriOf(noteId: string): string {
  return `graphium:note/${enc(noteId)}`;
}

/** 時刻を toISOString() に正規化する。読めなければ undefined（出さない） */
export function normalizeTime(value: string | undefined | null): string | undefined {
  if (!value) return undefined;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
}

function typedTime(value: string | undefined | null): { "@value": string; "@type": "xsd:dateTime" } | undefined {
  const iso = normalizeTime(value);
  return iso ? { "@value": iso, "@type": "xsd:dateTime" } : undefined;
}

const ref = (id: string): { "@id": string } => ({ "@id": id });

function isExternal(node: W3CProvNode): boolean {
  return node["graphium:external"] === true;
}

/** 宣言だけの最小ノード（resolveSourceEntity が作る URL / PDF などの参照用）か */
const BARE_KEYS = new Set(["@type", "@id", "label", "graphium:sourceKind"]);
function isBare(node: W3CProvNode): boolean {
  return !isExternal(node) && Object.keys(node).every((k) => BARE_KEYS.has(k));
}

/** 最小ノードの優劣（項目が多い方、同数なら URL そのままでない label を持つ方） */
function bareScore(n: W3CProvNode): number {
  const label = Array.isArray(n.label) ? n.label[0]?.["@value"] : undefined;
  const readable = typeof label === "string" && label !== "" && !/^https?:\/\//.test(label);
  return Object.keys(n).length * 10 + (readable ? 1 : 0);
}

/** 同じ @id の最小ノードが複数あれば、優劣の高い 1 つだけ残す */
function pickBareWinners(nodes: W3CProvNode[]): Map<string, W3CProvNode> {
  const winners = new Map<string, W3CProvNode>();
  for (const n of nodes) {
    const id = n["@id"];
    if (typeof id !== "string" || !isBare(n)) continue;
    const cur = winners.get(id);
    if (!cur || bareScore(n) > bareScore(cur)) winners.set(id, n);
  }
  return winners;
}

/** nodes のうち、同じ @id の本体に置き換えられるスタブを落とす */
function dropStubs(nodes: W3CProvNode[], anyBody: Set<string>, richBody: Set<string>): W3CProvNode[] {
  const winners = pickBareWinners(nodes);
  return nodes.filter((n) => {
    const id = n["@id"];
    if (typeof id !== "string") return true;
    if (isExternal(n)) return !anyBody.has(id);
    if (isBare(n)) return !richBody.has(id) && winners.get(id) === n;
    return true;
  });
}

function collectBodies(nodes: W3CProvNode[], anyBody: Set<string>, richBody: Set<string>): void {
  for (const n of nodes) {
    const id = n["@id"];
    if (typeof id !== "string" || isExternal(n)) continue;
    anyBody.add(id);
    if (!isBare(n)) richBody.add(id);
  }
}

/**
 * スタブと本体が同じ @id で並んでいたら、スタブを落とす。
 * - スタブ = graphium:external 付きのノード
 * - 宣言だけの最小ノード（@type / label / graphium:sourceKind のみ）も、項目の多い本体があれば落とす
 * Bundle の中（名前付きグラフ）のスタブも、本体が外か同じ Bundle 内にあれば落とす。
 */
export function dedupeStubs(graph: W3CProvNode[]): W3CProvNode[] {
  const anyBody = new Set<string>();
  const richBody = new Set<string>();
  collectBodies(graph, anyBody, richBody);
  return dropStubs(graph, anyBody, richBody).map((n) => {
    if (!Array.isArray(n["@graph"])) return n;
    const inner: W3CProvNode[] = n["@graph"];
    const innerAny = new Set(anyBody);
    const innerRich = new Set(richBody);
    collectBodies(inner, innerAny, innerRich);
    return { ...n, "@graph": dropStubs(inner, innerAny, innerRich) };
  });
}

// ── 素材 ──

const EXT_MIME: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  svg: "image/svg+xml",
  mp4: "video/mp4",
  mov: "video/quicktime",
  webm: "video/webm",
  mp3: "audio/mpeg",
  wav: "audio/wav",
  m4a: "audio/mp4",
  pdf: "application/pdf",
  csv: "text/csv",
  txt: "text/plain",
  json: "application/json",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
};

/** dc:format に出す MIME。分かるものだけ（mimeType → pdf → 名前の拡張子） */
function guessMime(a: AssetExportEntry): string | undefined {
  if (a.mimeType) return a.mimeType;
  if (a.type === "pdf") return "application/pdf";
  const ext = a.name?.split(".").pop()?.toLowerCase();
  return ext && ext !== a.name?.toLowerCase() ? EXT_MIME[ext] : undefined;
}

/** 素材の IRI。url 素材は URL（不明なら fileId）、他は <type>/<fileId> */
function assetIriOf(type: string, fileId: string, url?: string): string {
  if (type === "url") return `graphium:url/${enc(url || fileId)}`;
  return `graphium:${enc(type)}/${enc(fileId)}`;
}

function buildAssetNode(a: AssetExportEntry): W3CProvNode {
  const node: W3CProvNode = {
    "@type": "Entity",
    "@id": assetIriOf(a.type, a.fileId, a.url),
    label: toW3CLabel(a.name || a.url || a.fileId),
    "graphium:sourceKind": a.type,
  };
  const mime = guessMime(a);
  if (mime) node["dc:format"] = mime;
  const info = a.sourceInfo;
  if (info) {
    const authors = (info.authors ?? []).filter((s) => typeof s === "string" && s.trim() !== "");
    if (authors.length > 0) node["dc:creator"] = authors;
    if (typeof info.year === "number") node["dc:date"] = String(info.year);
    if (info.venue) node["dc:publisher"] = info.venue;
    if (info.doi) {
      node["dc:identifier"] = `doi:${info.doi}`;
      node["rdfs:seeAlso"] = ref(`https://doi.org/${encodeURI(info.doi)}`);
    }
  }
  return node;
}

// ── 他ノート参照の関係ノードを引く ──

const INLINE_PREFIXES = ["inline_material_", "inline_tool_", "inline_output_"];
function inlineEntityIdOf(nodeId: string): string | null {
  for (const p of INLINE_PREFIXES) if (nodeId.startsWith(p)) return nodeId.slice(p.length);
  return null;
}

// ── JSON-LD 処理系で落ちるキーの双子 ──

/** IRI として不正になる文字（空白・<>"{}|\^`）を含むローカル名か */
const INVALID_IRI_CHARS = /[\s<>"{}|\\^`]/;

/**
 * 空白などを含む `graphium:<列名>` は IRI にならず JSON-LD 展開で捨てられるため
 * `graphium:parameter` に {rdfs:label, rdf:value} で写す。`type` の @value 配列は
 * `graphium:entityType` のリテラルにも写す。元のキーは残す。
 */
function addReadableTwins(node: W3CProvNode): void {
  const params: Array<{ "rdfs:label": string; "rdf:value": string }> = [];
  for (const [key, value] of Object.entries(node)) {
    if (!key.startsWith("graphium:") || typeof value !== "string") continue;
    const local = key.slice("graphium:".length);
    if (INVALID_IRI_CHARS.test(local)) params.push({ "rdfs:label": local, "rdf:value": value });
  }
  if (params.length > 0) node["graphium:parameter"] = params;

  const t = (node as any)["type"];
  if (Array.isArray(t)) {
    const first = t.find((x) => x && typeof x === "object" && typeof x["@value"] === "string");
    if (first) node["graphium:entityType"] = first["@value"];
  }
}

// ── 本体 ──

/**
 * ノートの記録全体を @graph のノート配列にする（@context なし・スタブの後処理なし）。
 * 計画書き出し（plan-export）が複数ノート分を束ねて最後に dedupeStubs を掛けるための土台。
 */
export function buildNoteProvGraph(input: NoteProvExportInput): W3CProvNode[] {
  const { provDoc, title, noteId, page } = input;
  const includeBody = input.options?.includeBody ?? true;
  const includeMemos = input.options?.includeMemos ?? true;
  const includeChats = input.options?.includeChats ?? false;
  const extras = input.extras ?? {};

  const noteIri = noteIriOf(noteId);
  const idPrefix = `${noteIri}/`;

  // ── 1. 手順グラフ（idPrefix で前置、内容ノードに dcterms:isPartOf）──
  const built = buildW3CProvJsonLd(provDoc, title, input.wikiEntities, input.crossNoteLinks, {
    idPrefix,
    noteIri,
  });
  const graph = built["@graph"];
  // 標準で読める「双子」を足す（既存キーは残す）。内容ノード（Activity / Entity）のみ
  for (const n of graph) {
    if (n["@type"] === "Activity" || n["@type"] === "Entity") addReadableTwins(n);
  }
  const graphIds = new Set<string>();
  for (const n of graph) if (typeof n["@id"] === "string") graphIds.add(n["@id"]);

  // 追加ノート（@id → ノード）。本体はスタブを置き換え、スタブは既存を置き換えない
  const added = new Map<string, W3CProvNode>();
  function declare(node: W3CProvNode): void {
    const id = node["@id"];
    const cur = added.get(id);
    if (cur) {
      if (isExternal(cur) && !isExternal(node)) added.set(id, node);
      // 本体どうしが同じ @id（URL 出典と URL 素材など）なら、項目を合わせて 1 つにする
      else if (!isExternal(cur) && !isExternal(node)) added.set(id, { ...cur, ...node });
      return;
    }
    if (isExternal(node) && graphIds.has(id)) return;
    added.set(id, node);
  }
  const noteStub = (id: string, label?: string): string => {
    const iri = noteIriOf(id);
    declare({ "@type": "Entity", "@id": iri, label: toW3CLabel(label || id), "graphium:external": true });
    return iri;
  };

  // ── 2. 線の名前（実績）を関係ノードの label に ──
  if (extras.edgeLabelForLink && input.crossNoteLinks) {
    const refsByLink = new Map((provDoc["graphium:crossNoteLinks"] ?? []).map((r) => [r.linkId, r]));
    for (const link of input.crossNoteLinks) {
      if (link.type !== "informed_by" || !link.targetNoteId || !link.targetEntityId) continue;
      const name = extras.edgeLabelForLink(link)?.trim();
      if (!name) continue;
      const stubId = `graphium:note/${enc(link.targetNoteId)}/output/${enc(link.targetEntityId)}`;
      const isCross = (n: W3CProvNode) => typeof n["@id"] === "string" && n["@id"].includes("cross_note_");
      // 受け側ローカルノード（生成器が解決済みならそれ、無ければ emitCrossNoteLinks と同じ規則）
      let localId = refsByLink.get(link.id)?.localEntityId;
      if (!localId && link.sourceEntityId) {
        const local =
          provDoc["@graph"].find((n) => n["graphium:tableRowId"] === link.sourceEntityId) ??
          provDoc["@graph"].find((n) => inlineEntityIdOf(n["@id"]) === link.sourceEntityId);
        localId = local?.["@id"];
      }
      const rel = localId
        ? graph.find(
            (n) =>
              n["@type"] === "Derivation" &&
              isCross(n) &&
              n.usedEntity === stubId &&
              n.generatedEntity === `${idPrefix}${localId}`,
          )
        : graph.find(
            (n) =>
              n["@type"] === "Usage" &&
              isCross(n) &&
              n.entity === stubId &&
              n.activity === `${idPrefix}activity_${link.sourceBlockId}`,
          );
      if (rel) rel.label = toW3CLabel(name);
    }
  }

  // ── 素材の索引 ──
  const assetsById = new Map<string, AssetExportEntry>();
  for (const a of extras.assets ?? []) assetsById.set(a.fileId, a);
  const referencedAssets = new Set<string>();
  /** 素材への参照 IRI を返す。素材が索引にあれば本体を宣言し、無ければスタブを宣言する */
  function assetRef(fileId: string, fallbackType: string | undefined): string {
    const a = assetsById.get(fileId);
    if (a) {
      referencedAssets.add(fileId);
      return assetIriOf(a.type, a.fileId, a.url);
    }
    const type = fallbackType || "other";
    const iri = assetIriOf(type, fileId);
    declare({
      "@type": "Entity",
      "@id": iri,
      label: toW3CLabel(fileId),
      "graphium:sourceKind": type,
      "graphium:external": true,
    });
    return iri;
  }

  // ── 人の Agent（参照されたものだけ宣言）──
  const humanEmail = extras.humanAgent?.email?.trim().toLowerCase() || undefined;
  // 名前は「書き出す人」のメールと一致する人にだけ付ける（呼び出し順に依存させない）。
  // メールの無い anonymous は別人かもしれないので名前を付けない
  function personAgent(email: string | undefined): string {
    const mail = email?.trim().toLowerCase();
    const iri = mail ? `graphium:agent/person/${sha1Hex(mail)}` : "graphium:agent/person/anonymous";
    if (!added.has(iri)) {
      const node: W3CProvNode = { "@type": ["Agent", "prov:Person"] as any, "@id": iri };
      const name = mail && mail === humanEmail ? extras.humanAgent?.name : undefined;
      if (name) {
        node.label = toW3CLabel(name);
        node["foaf:name"] = name;
      }
      // FOAF の定義どおり mailto: URI の sha1。生のメールアドレスは出さない
      if (mail) node["foaf:mbox_sha1sum"] = sha1Hex(`mailto:${mail}`);
      added.set(iri, node);
    }
    return iri;
  }
  const aiAgent = (model: string): string => {
    const iri = `graphium:agent/${enc(model)}`;
    if (!graphIds.has(iri)) {
      declare({ "@type": "Agent", "@id": iri, label: toW3CLabel(model), "graphium:agentType": "ai" });
    }
    return iri;
  };

  // ── ブロックの PROV ノード（activity_<blockId> があればそれ、無ければ最初の Entity）──
  const blockNode = (blockId: string): string | undefined => {
    const act = `${idPrefix}activity_${blockId}`;
    if (graphIds.has(act)) return act;
    return graph.find((n) => n["@type"] === "Entity" && n["graphium:blockId"] === blockId)?.["@id"];
  };

  // ── 3. ノート Entity ──
  const noteNode: W3CProvNode = { "@type": "Entity", "@id": noteIri };
  if (title.trim() !== "") noteNode.label = toW3CLabel(title);

  const folders = [...new Set((extras.folders ?? []).filter((f) => typeof f === "string" && f.trim() !== ""))];
  if (folders.length > 0) {
    noteNode["prov:atLocation"] = folders.map((f) => {
      const iri = `graphium:folder/${enc(f)}`;
      declare({ "@type": "prov:Location", "@id": iri, label: toW3CLabel(f) });
      return ref(iri);
    });
  }

  const primary: { "@id": string }[] = [];
  const derived: { "@id": string }[] = [];
  const influenced: { "@id": string }[] = [];
  const pushUnique = (list: { "@id": string }[], iri: string) => {
    if (iri !== noteIri && !list.some((r) => r["@id"] === iri)) list.push(ref(iri));
  };

  for (const s of extras.sources ?? []) {
    if (!s.id) continue;
    switch (s.kind) {
      case "url": {
        const iri = `graphium:url/${enc(s.id)}`;
        declare({
          "@type": "Entity",
          "@id": iri,
          label: toW3CLabel(s.label || s.id),
          "graphium:sourceKind": "url",
        });
        pushUnique(primary, iri);
        break;
      }
      case "pdf":
      case "document":
      case "text": {
        // 素材の索引にあれば本体（素材 Entity）を、無ければスタブを宣言する
        const iri = assetsById.has(s.id)
          ? assetRef(s.id, s.kind)
          : (() => {
              const i = `graphium:${s.kind}/${enc(s.id)}`;
              declare({
                "@type": "Entity",
                "@id": i,
                label: toW3CLabel(s.label || s.id),
                "graphium:sourceKind": s.kind,
                "graphium:external": true,
              });
              return i;
            })();
        pushUnique(primary, iri);
        break;
      }
      case "note":
        if (s.id !== noteId) pushUnique(derived, noteStub(s.id, s.label));
        break;
      case "template":
      case "shared":
      case "import": {
        const iri = `graphium:${s.kind}/${enc(s.id)}`;
        declare({
          "@type": "Entity",
          "@id": iri,
          label: toW3CLabel(s.label || s.id),
          "graphium:sourceKind": s.kind,
        });
        pushUnique(derived, iri);
        break;
      }
    }
  }

  for (const inf of extras.influences ?? []) {
    if (!inf.id) continue;
    if (inf.kind === "asset") {
      pushUnique(influenced, assetRef(inf.id, inf.type));
    } else {
      const wiki = input.wikiEntities?.find((w) => w.id === inf.id);
      pushUnique(
        influenced,
        wiki ? `graphium:wiki/${enc(wiki.title)}` : inf.id === noteId ? noteIri : noteStub(inf.id, inf.label),
      );
    }
  }

  if (extras.partOfPlanNoteId && extras.partOfPlanNoteId !== noteId) {
    // Plan 型を付けないスタブ（計画の書き出しでは本体が並び、dedupeStubs が落とす）
    noteNode["dcterms:isPartOf"] = ref(noteStub(extras.partOfPlanNoteId));
  }

  // 編集履歴 Bundle があれば結ぶ（wiki と同じ作法）
  const bundleIri = `graphium:documentProvenance/${enc(title)}`;
  if (graph.some((n) => n["@type"] === "prov:Bundle" && n["@id"] === bundleIri)) {
    noteNode["graphium:provenanceBundle"] = ref(bundleIri);
  }

  // ── 4. 本文 Entity ──
  let bodyNode: W3CProvNode | null = null;
  const bodyText = includeBody ? blocksToPlainText(page.blocks ?? []) : "";
  // 本文が空なら本文 Entity は作らない
  if (includeBody && bodyText.trim() !== "") {
    bodyNode = {
      "@type": "Entity",
      "@id": `${noteIri}/text/${computePageHashSync(page)}`,
      "prov:specializationOf": ref(noteIri),
      "prov:value": bodyText,
      "dc:format": "text/plain",
    };
    if (title.trim() !== "") bodyNode.label = toW3CLabel(title);
    const t = typedTime(extras.modifiedAt);
    if (t) bodyNode["prov:generatedAtTime"] = t;
  }

  // ── 5. 表 Collection と取り込み元 ──
  const nodesByBlock = new Map<string, W3CProvNode[]>();
  for (const n of graph) {
    const bid = n["graphium:blockId"];
    if (typeof bid !== "string") continue;
    const list = nodesByBlock.get(bid);
    if (list) list.push(n);
    else nodesByBlock.set(bid, [n]);
  }
  const graphById = new Map<string, W3CProvNode>();
  for (const n of graph) if (typeof n["@id"] === "string") graphById.set(n["@id"], n);

  for (const [blockId, meta] of Object.entries(extras.tableMeta ?? {})) {
    const caption = meta.caption?.trim() || undefined;
    const source = meta.source;
    if (!caption && !source) continue;
    const members = nodesByBlock.get(blockId) ?? [];
    const entities = members.filter((n) => n["@type"] === "Entity");
    if (entities.length > 0) {
      const collection: W3CProvNode = {
        "@type": ["Entity", "prov:Collection"] as any,
        "@id": `${noteIri}/collection/${enc(blockId)}`,
        label: toW3CLabel(caption || source!.fileName),
        "prov:hadMember": entities.map((n) => ref(n["@id"])),
        "dcterms:isPartOf": ref(noteIri),
      };
      if (source) {
        const importIri = `${noteIri}/import/${enc(blockId)}`;
        const importNode: W3CProvNode = {
          "@type": "Entity",
          "@id": importIri,
          label: toW3CLabel(source.fileName),
        };
        const metaPairs = (source.meta ?? []).map((m) => ({ "rdfs:label": m.key, "rdf:value": m.value }));
        if (metaPairs.length > 0) importNode["graphium:meta"] = metaPairs;
        const delimiter =
          source.options?.delimiter === "custom" ? source.options.customDelimiter : source.options?.delimiter;
        if (delimiter) importNode["graphium:delimiter"] = delimiter;
        const importedAt = typedTime(source.importedAt);
        if (importedAt) importNode["prov:generatedAtTime"] = importedAt;
        // 取り込んだデータ素材があれば結ぶ（素材が索引に無ければ外部スタブ）
        if (source.fileId) importNode["prov:wasDerivedFrom"] = ref(assetRef(source.fileId, "data"));
        declare(importNode);
        collection["prov:wasDerivedFrom"] = [ref(importIri)];
      }
      declare(collection);
    } else if (caption) {
      // 段階（stage）表: Collection は作らず、段階の親 Activity に名前を残す
      for (const act of members.filter((n) => n["@type"] === "Activity")) {
        const parents: { "@id": string }[] = Array.isArray(act["graphium:partOf"]) ? act["graphium:partOf"] : [];
        for (const p of parents) {
          const parent = graphById.get(p["@id"]);
          if (parent && parent["@type"] === "Activity") parent["graphium:tableCaption"] = caption;
        }
      }
    }
  }

  // ── 6. 素材（内容グラフのメディアノード → 素材）──
  if (extras.resolveFileId) {
    for (const n of graph) {
      if (n["@type"] !== "Entity") continue;
      const url = n["graphium:mediaUrl"];
      if (typeof url !== "string" || url === "") continue;
      const fileId = extras.resolveFileId(url);
      if (fileId && assetsById.has(fileId)) {
        n["prov:specializationOf"] = ref(assetRef(fileId, undefined));
      }
    }
  }

  // ── 7. メモ ──
  const memoNodes: W3CProvNode[] = [];
  if (includeMemos) {
    for (const memo of extras.memos ?? []) {
      const isQuote = memo.isQuote && !!memo.sourceAsset;
      const memoNoteKey = memo.sourceNote ? stripDocKeyPrefix(memo.sourceNote.fileId) : undefined;
      const ownKey = stripDocKeyPrefix(noteId);
      const inScope =
        memoNoteKey === ownKey ||
        (memo.sourceAsset && assetsById.has(memo.sourceAsset.fileId)) ||
        memo.usedInThisNote;
      if (!inScope) continue;

      const memoIri = `graphium:memo/${enc(memo.id)}`;
      const targets: any[] = [];

      if (memo.sourceNote) {
        if (memoNoteKey !== ownKey) {
          targets.push(ref(noteStub(memoNoteKey!)));
        } else if (memo.sourceNote.blockId) {
          const bid = memo.sourceNote.blockId;
          const spec: W3CProvNode = {
            "@type": "oa:SpecificResource",
            "oa:hasSource": ref(noteIri),
            "oa:hasSelector": [
              {
                "@type": "oa:FragmentSelector",
                "rdf:value": bid,
                "dcterms:conformsTo": ref("https://kumagallium.github.io/Graphium/ns#block-id"),
              },
              { "@type": "oa:CssSelector", "rdf:value": `[data-id="${bid}"]` },
            ],
          } as any;
          if (memo.sourceNote.blockText) spec["graphium:blockText"] = memo.sourceNote.blockText;
          targets.push(spec);
          const prov = blockNode(bid);
          if (prov) targets.push(ref(prov));
        } else {
          targets.push(ref(noteIri));
        }
      }

      if (memo.sourceAsset) {
        const assetIri = assetRef(memo.sourceAsset.fileId, memo.sourceAsset.type);
        let selector: W3CProvNode | undefined;
        if (isQuote) {
          const quoted = splitMemoBodyAndSource(memo.text).body;
          const textQuote: W3CProvNode | undefined =
            !memo.edited && quoted.trim() !== ""
              ? ({ "@type": "oa:TextQuoteSelector", "oa:exact": quoted } as any)
              : undefined;
          const page = memo.sourceAsset.pageNumber;
          // page= + rfc3778 は PDF 専用
          if (memo.sourceAsset.type === "pdf" && typeof page === "number") {
            selector = {
              "@type": "oa:FragmentSelector",
              "rdf:value": `page=${page}`,
              "dcterms:conformsTo": ref("http://tools.ietf.org/rfc/rfc3778"),
              ...(textQuote ? { "oa:refinedBy": textQuote } : {}),
            } as any;
          } else if (textQuote) {
            selector = textQuote;
          }
        }
        targets.push(
          selector
            ? { "@type": "oa:SpecificResource", "oa:hasSource": ref(assetIri), "oa:hasSelector": selector }
            : ref(assetIri),
        );
      }

      // target は 1 つ以上が MUST。どれにも当たらなければノート自身
      if (targets.length === 0) targets.push(ref(noteIri));

      const agentIri = personAgent(memo.createdBy);
      const node: W3CProvNode = {
        "@type": ["oa:Annotation", "Entity"] as any,
        "@id": memoIri,
        "oa:motivatedBy": isQuote
          ? [ref("oa:highlighting"), ref("oa:commenting")]
          : [ref("oa:commenting")],
        "oa:hasBody": { "@type": "oa:TextualBody", "rdf:value": memo.text, "dc:format": "text/plain" },
        "oa:hasTarget": targets,
      };
      const created = typedTime(memo.createdAt);
      if (created) {
        node["dcterms:created"] = created;
        node["prov:generatedAtTime"] = created;
      }
      const modified = typedTime(memo.modifiedAt);
      if (modified) node["dcterms:modified"] = modified;
      node["dcterms:creator"] = ref(agentIri);
      node["prov:wasAttributedTo"] = ref(agentIri);
      memoNodes.push(node);

      if (memo.usedInThisNote) pushUnique(influenced, memoIri);
    }
  }

  // ── 8. チャット（既定 OFF）──
  const chatNodes: W3CProvNode[] = [];
  if (includeChats) {
    for (const chat of extras.chats ?? []) {
      if (!chat.messages || chat.messages.length === 0) continue;
      const chatIri = `graphium:chat/${enc(noteId)}/${enc(chat.id)}`;
      const firstUser = chat.messages.find((m) => m.role === "user") ?? chat.messages[0];
      const chatLabel = Array.from(firstUser.content.trim()).slice(0, 60).join("") || chat.id;

      const used = new Set<string>();
      const msgIris: string[] = [];
      let lastUserIri: string | undefined;
      const msgNodes: W3CProvNode[] = [];
      chat.messages.forEach((m, i) => {
        let iri = `${chatIri}/msg/${enc(m.timestamp)}`;
        if (used.has(iri)) iri = `${iri}_${i}`;
        used.add(iri);
        msgIris.push(iri);
        const node: W3CProvNode = {
          "@type": "Entity",
          "@id": iri,
          "prov:value": m.content,
          "graphium:role": m.role,
          "graphium:messageIndex": i,
        };
        const t = typedTime(m.timestamp);
        if (t) node["prov:generatedAtTime"] = t;
        if (m.role === "user") {
          node["prov:wasAttributedTo"] = ref(personAgent(humanEmail));
          lastUserIri = iri;
        } else {
          if (chat.model) node["prov:wasAttributedTo"] = ref(aiAgent(chat.model));
          if (lastUserIri) node["prov:wasInfluencedBy"] = ref(lastUserIri);
        }
        msgNodes.push(node);
      });

      const influencedBy: { "@id": string }[] = [ref(noteIri)];
      if (chat.scopeBlockId) {
        const scope = blockNode(chat.scopeBlockId);
        if (scope) influencedBy.push(ref(scope));
      }
      chatNodes.push({
        "@type": ["Entity", "prov:Collection"] as any,
        "@id": chatIri,
        label: toW3CLabel(chatLabel),
        "prov:wasInfluencedBy": influencedBy,
        "prov:hadMember": msgIris.map(ref),
      });
      chatNodes.push(...msgNodes);
    }
  }

  // ── 素材 Entity（参照されたものだけ本体を宣言）──
  for (const fileId of referencedAssets) {
    const a = assetsById.get(fileId);
    if (a) declare(buildAssetNode(a));
  }

  // ── ノート Entity の関係を確定 ──
  if (primary.length > 0) noteNode["prov:hadPrimarySource"] = primary;
  if (derived.length > 0) noteNode["prov:wasDerivedFrom"] = derived;
  if (influenced.length > 0) noteNode["prov:wasInfluencedBy"] = influenced;

  // ── 9. 組み立て（ノート Entity・本文 Entity を先頭に）──
  return [
    noteNode,
    ...(bodyNode ? [bodyNode] : []),
    ...graph,
    ...added.values(),
    ...memoNodes,
    ...chatNodes,
  ];
}

/**
 * ノート 1 冊の PROV-JSON-LD（W3C 形式）を組み立てる。
 * 手順グラフ・ノート Entity・本文・フォルダ・出典・素材・表 Collection・メモ（・チャット）を含む。
 */
export function buildNoteProvJsonLd(input: NoteProvExportInput): W3CProvDocument {
  return {
    "@context": buildProvExportContext(),
    "@graph": dedupeStubs(buildNoteProvGraph(input)),
  };
}
