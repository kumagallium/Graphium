// ──────────────────────────────────────────────
// Graphium clipboard serializer
//
// BlockNote v0.47 は clipboardSerializer / clipboardParser を公式 API として
// 提供していないため、DOM レベルの copy / paste イベントに介入して
// カスタム MIME `application/x-graphium-clipboard` に
// { blockIds, labels, links } を JSON で載せる。
//
// ペースト時は BlockNote のネイティブパースを動作させたまま、
// paste 前後の document 差分から旧 ID → 新 ID を順序対応で紐付け、
// labels / links を新 ID 側に復元する。
//
// 設計判断: docs/internal/design-registry.md L-001（A 方式: 独立アノテーション層）
// Phase 3 の位置づけは docs/internal/external-source-note.md 参照。
// ──────────────────────────────────────────────

import type { BlockLink } from "../block-link/link-types";
import type { StepAttributes } from "../context-label/label-attributes";
import { bytesToBase64 } from "@/lib/base64";

export const GRAPHIUM_CLIPBOARD_MIME = "application/x-graphium-clipboard";
export const GRAPHIUM_CLIPBOARD_VERSION = 1;

// Chrome は text/plain / text/html / image/* 以外のカスタム MIME を
// OS clipboard に書き出す際に捨てる。回避策として、コピー時に text/html の
// 先頭に HTML コメント（パーサが無視するノード）として base64 で埋め込み、
// paste 時に取り出す。
const HTML_PAYLOAD_PREFIX = "<!--graphium-clipboard:";
const HTML_PAYLOAD_SUFFIX = "-->";
const HTML_PAYLOAD_REGEX = /<!--graphium-clipboard:([A-Za-z0-9+/=]+)-->/;

/** UTF-8 を含む文字列を base64 にエンコード（btoa は ASCII しか扱えないため） */
function encodeBase64Utf8(str: string): string {
  // TextEncoder で UTF-8 バイト列に変換 → base64
  return bytesToBase64(new TextEncoder().encode(str));
}

/** base64 → UTF-8 文字列 */
function decodeBase64Utf8(b64: string): string {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

/** payload を text/html に埋め込む（既存 html がなければ単独で返す） */
export function embedPayloadInHtml(payload: GraphiumClipboardPayload, existingHtml: string): string {
  const encoded = encodeBase64Utf8(JSON.stringify(payload));
  return `${HTML_PAYLOAD_PREFIX}${encoded}${HTML_PAYLOAD_SUFFIX}${existingHtml}`;
}

/** text/html から graphium payload を抽出（無ければ null） */
export function extractPayloadFromHtml(html: string | null | undefined): GraphiumClipboardPayload | null {
  if (!html) return null;
  const m = html.match(HTML_PAYLOAD_REGEX);
  if (!m) return null;
  try {
    return parseClipboardPayload(decodeBase64Utf8(m[1]));
  } catch {
    return null;
  }
}

/**
 * @リンク（行き先がノート・素材の reference リンク）1 件分。行き先はブロックではないので
 * links（両端がコピー範囲の中にあるものだけ）とは別に運ぶ。
 */
export type MentionLinkRecord = {
  sourceBlockId: string;
  /** ノート ID、または外部ソース ID（"data:<fileId>" 等） */
  targetNoteId: string;
  /**
   * 表のセルの @リンクなら、その行の identity。貼った先の表で同じ identity の行
   * （振り直されたらその行）に紐づけ直す。番号で運ばないのは、行の一部だけをコピー
   * すると貼った表の行の並びが元とずれ、同名の素材が並ぶ表で別の行に付くため
   */
  sourceRowIdentity?: string;
};

export type GraphiumClipboardPayload = {
  version: number;
  /** コピー対象のブロック ID（深さ優先順） */
  blockIds: string[];
  /** blockId → ラベル文字列（内部キー） */
  labels: Record<string, string>;
  /** blockId → 連動属性（procedure の StepAttributes 等） */
  attributes?: Record<string, StepAttributes>;
  /** コピー対象集合の内側で閉じたリンクのみ運ぶ */
  links: BlockLink[];
  /** コピーしたブロックの @リンク（旧いペイロードには無い） */
  mentionLinks?: MentionLinkRecord[];
};

/**
 * BlockNote の document ツリーを深さ優先で平坦化してブロック ID 配列を返す。
 * children 属性があるブロックは親 → 子の順で列挙する。
 */
export function flattenBlockIds(blocks: readonly any[]): string[] {
  const result: string[] = [];
  const walk = (list: readonly any[]) => {
    for (const block of list) {
      if (block?.id) result.push(block.id);
      if (Array.isArray(block?.children) && block.children.length > 0) {
        walk(block.children);
      }
    }
  };
  walk(blocks);
  return result;
}

/**
 * ブロックのラベル・ブロック間リンクを運ぶペイロードか（@リンクだけなら false）。
 * 空のリスト項目への貼り付けの救済は、構造を運ぶペイロードのときだけ見送る —
 * @リンクだけのもの（段落の文字のコピー）は、前と同じく文字として差し込む
 */
export function carriesBlockStructure(payload: GraphiumClipboardPayload): boolean {
  return Object.keys(payload.labels).length > 0 || payload.links.length > 0;
}

/**
 * 新しく追加されたブロック ID を、コピー元の順序と対応付けて map にする。
 * 長さが一致しない場合（BlockNote のマージ等でブロック数が減る）は短い方に合わせる。
 */
export function computeIdMap(
  oldIds: readonly string[],
  newIds: readonly string[],
): Map<string, string> {
  const map = new Map<string, string>();
  const n = Math.min(oldIds.length, newIds.length);
  for (let i = 0; i < n; i++) {
    const from = oldIds[i];
    const to = newIds[i];
    if (from && to && from !== to) {
      map.set(from, to);
    }
  }
  return map;
}

export type SerializeInput = {
  /** コピー対象ブロックの document 順序でのリスト */
  blockIds: readonly string[];
  /** blockId → ラベル */
  getLabel: (blockId: string) => string | undefined;
  /** blockId → 連動属性 */
  getAttributes: (blockId: string) => StepAttributes | undefined;
  /** ドキュメント内の全リンク */
  allLinks: readonly BlockLink[];
  /**
   * 選択が表の 1 行の中だけなら、その表とその行の identity（identity の無い行は null）。
   * ほかの行に紐づく @リンクを運ばないのに使う
   */
  copiedRow?: { blockId: string; rowIdentity: string | null } | null;
  /**
   * その行き先の `@ラベル` がコピーした中身に入っているか。入っていない @リンクは運ばない
   * （URL だけを選んでコピーしたのにペイロードが付き、貼り付けの URL メニュー等が
   * 出なくなるのを防ぐ）。無ければ全部運ぶ
   */
  carriesMention?: (targetNoteId: string) => boolean;
};

/**
 * クリップボードに載せる JSON ペイロードを組み立てる。
 * 何も運ぶものがない（labels も links も空）場合は null を返す。
 */
export function buildClipboardPayload(input: SerializeInput): GraphiumClipboardPayload | null {
  const blockIdSet = new Set(input.blockIds);
  const labels: Record<string, string> = {};
  const attributes: Record<string, StepAttributes> = {};

  for (const id of input.blockIds) {
    const label = input.getLabel(id);
    if (label) labels[id] = label;
    const attrs = input.getAttributes(id);
    if (attrs) attributes[id] = attrs;
  }

  // 両端が選択範囲に含まれるリンクだけ運ぶ（意味論が曖昧な片端リンクは捨てる）
  const links = input.allLinks.filter(
    (l) => blockIdSet.has(l.sourceBlockId) && blockIdSet.has(l.targetBlockId),
  );

  // @リンクは行き先がブロックの外（ノート・素材）なので、出どころがコピー範囲にあれば運ぶ。
  // 本文の `@ラベル` だけが貼られてリンクが残らないと、貼った先のクリックは名前の
  // 逆引きになり、同名の素材があると取り違える。貼った先に実際にどのメンションが
  // 入ったかは貼る側が見て絞る（mention-paste.ts）
  const mentionLinks: MentionLinkRecord[] = [];
  const copiedRow = input.copiedRow ?? null;
  for (const l of input.allLinks) {
    if (!blockIdSet.has(l.sourceBlockId)) continue;
    if (l.type !== "reference" || !l.targetNoteId || l.targetBlockId) continue;
    if (input.carriesMention && !input.carriesMention(l.targetNoteId)) continue;
    // 表の 1 行の中だけをコピーしたときは、ほかの行に紐づくリンクを運ばない
    // （行の記録が無い旧いリンクは、どの行のものか分からないので残す）
    if (
      copiedRow &&
      l.sourceBlockId === copiedRow.blockId &&
      l.sourceRowIdentity &&
      l.sourceRowIdentity !== copiedRow.rowIdentity
    ) {
      continue;
    }
    mentionLinks.push({
      sourceBlockId: l.sourceBlockId,
      targetNoteId: l.targetNoteId,
      ...(l.sourceRowIdentity ? { sourceRowIdentity: l.sourceRowIdentity } : {}),
    });
  }

  if (Object.keys(labels).length === 0 && links.length === 0 && mentionLinks.length === 0) {
    return null;
  }

  const payload: GraphiumClipboardPayload = {
    version: GRAPHIUM_CLIPBOARD_VERSION,
    blockIds: [...input.blockIds],
    labels,
    links,
  };
  if (Object.keys(attributes).length > 0) {
    payload.attributes = attributes;
  }
  if (mentionLinks.length > 0) payload.mentionLinks = mentionLinks;
  return payload;
}

/**
 * クリップボードから取り出した生 JSON を型付きペイロードに復元。
 * 不正な JSON / version 不一致 / 必須フィールド欠落はすべて null で返す。
 */
export function parseClipboardPayload(raw: string | null | undefined): GraphiumClipboardPayload | null {
  if (!raw) return null;
  let parsed: any;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;
  if (parsed.version !== GRAPHIUM_CLIPBOARD_VERSION) return null;
  if (!Array.isArray(parsed.blockIds)) return null;
  if (!parsed.labels || typeof parsed.labels !== "object") return null;
  if (!Array.isArray(parsed.links)) return null;
  // @リンクは後から足した欄。無い（旧いペイロード）・形が崩れているものは落とす
  const mentionLinks = Array.isArray(parsed.mentionLinks)
    ? parsed.mentionLinks.filter(
        (m: any): m is MentionLinkRecord =>
          !!m &&
          typeof m.sourceBlockId === "string" &&
          typeof m.targetNoteId === "string" &&
          (m.sourceRowIdentity === undefined || typeof m.sourceRowIdentity === "string"),
      )
    : undefined;
  return {
    version: parsed.version,
    blockIds: parsed.blockIds.filter((id: unknown): id is string => typeof id === "string"),
    labels: parsed.labels,
    attributes: parsed.attributes && typeof parsed.attributes === "object" ? parsed.attributes : undefined,
    links: parsed.links,
    ...(mentionLinks && mentionLinks.length > 0 ? { mentionLinks } : {}),
  };
}

export type ApplyPasteTarget = {
  setLabel: (blockId: string, label: string | null) => void;
  setAttributes: (blockId: string, attrs: Partial<StepAttributes>) => void;
  addLink: (params: {
    sourceBlockId: string;
    targetBlockId: string;
    type: BlockLink["type"];
    createdBy: BlockLink["createdBy"];
    targetPageId?: string;
    targetNoteId?: string;
    layer?: BlockLink["layer"];
  }) => unknown;
};

/**
 * idMap に従って payload の labels / attributes / links を新 ID 側に復元する。
 * idMap にない旧 ID はスキップ（paste 範囲外なので運ばない）。
 */
export function applyClipboardPayload(
  idMap: ReadonlyMap<string, string>,
  payload: GraphiumClipboardPayload,
  target: ApplyPasteTarget,
): void {
  for (const [oldId, label] of Object.entries(payload.labels)) {
    const newId = idMap.get(oldId);
    if (!newId) continue;
    target.setLabel(newId, label);
    const attrs = payload.attributes?.[oldId];
    if (attrs) target.setAttributes(newId, attrs);
  }
  for (const link of payload.links) {
    const newSource = idMap.get(link.sourceBlockId);
    const newTarget = idMap.get(link.targetBlockId);
    if (!newSource || !newTarget) continue;
    target.addLink({
      sourceBlockId: newSource,
      targetBlockId: newTarget,
      type: link.type,
      createdBy: link.createdBy,
      targetPageId: link.targetPageId,
      targetNoteId: link.targetNoteId,
      layer: link.layer,
    });
  }
}
