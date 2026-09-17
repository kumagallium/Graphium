// 出典照合（Source check, v1.1） — トピック本文から「照合する文」を取り出す。
//
// 本文ブロックのうち `References` 見出し（buildTopicReferenceBlocks が作る）より前の
// ブロックを走査する。ブロック B が引いている知見（下記 (a)〜(d) の和集合）が 1 つ以上
// あれば、B のプレーンテキスト（引用部分は取り除く）を「照合する文」として、引いた各知見を
// 「出典」とする。引用を持たないブロック（定義の段落など）は照合しない。
//
// 実データで判明した罠: トピック本文の要点ブロックでは、引用が knowledgeLinks（type
// "reference"）としてではなく、ただの inline テキストとして保存されていることがある
// （例: 本文の後に区切りなく知見タイトルがそのまま続く）。knowledgeLinks が付くのは
// References 見出し以降の行だけ。そのため、次の 4 通りの一致方法の和集合で「引用」を判定する:
//   (a) sourceBlockId がそのブロックの reference リンク（従来どおり）
//   (b) inline テキスト要素のうち、trim して先頭の "@"/"🤖"/空白を除いたテキストが、
//       References 以降から作った「知見タイトル → 知見 ID」対応表のタイトルと完全一致するもの
//   (c) ブロックのプレーンテキストが対応表のタイトルで終わる（要素が 1 つに結合されている
//       場合の保険）
//   (d) `[[claim:<id>]]` の文字列で id が derivedFromClaims にあるもの（未解決の旧形式）
// 推測で結び付けない（完全一致のみ）。

import type { GraphiumDocument } from "../../lib/document-types";

export type TopicStatement = {
  /** 照合する文（プレーンテキスト。引用部分は除く） */
  text: string;
  /** そのブロックの ID（statementBlockId 用） */
  blockId: string;
  /** そのブロックが引いている知見 ID（derivedFromClaims に含まれるもののみ） */
  claimIds: string[];
};

/**
 * buildTopicReferenceBlocks（wiki-service.ts）が生成する References 見出しと同じ形
 * （type: "heading", テキスト "References"）を検出する。wiki-service.ts 側の
 * isReferencesHeading は "関連" 等の別表記も許すが、buildTopicReferenceBlocks は常に
 * 英語 "References" 固定で出力するため、ここでは生成形式にだけ厳密に一致させる
 * （手で "関連" 等の見出しを書いても本関数は References 扱いしない — 誤って本文を
 *  照合対象から除外しないための保守的な判定）。
 */
function isGeneratedReferencesHeading(block: any): boolean {
  if (!block || block.type !== "heading") return false;
  const text = extractPlainInlineText(block.content).trim();
  return text === "References";
}

/** 見出し判定・タイトル抽出専用: スタイルを見ずそのままのテキストを連結する */
function extractPlainInlineText(content: any): string {
  if (!content) return "";
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content.map((c: any) => c.text ?? c.content ?? "").join("");
}

/** 先頭の "@"・"🤖"・空白をすべて取り除く（References 行のタイトル抽出・(b) の比較両方で使う） */
function stripCitationMarkers(text: string): string {
  return text.replace(/^[@🤖\s]+/, "").trim();
}

/** (a) 旧来の青文字 "@..." 引用要素か */
function isBlueCitationElement(el: any): boolean {
  return (
    el?.type === "text" &&
    el?.styles?.textColor === "blue" &&
    typeof el.text === "string" &&
    el.text.startsWith("@")
  );
}

/** `[[claim:<id>]]` 形式の未解決引用を text から取り除きつつ、該当 id を集める */
function extractLegacyClaimRefs(
  text: string,
  derivedFromClaims: ReadonlySet<string>,
): { text: string; claimIds: string[] } {
  const claimIds: string[] = [];
  const next = text.replace(/\[\[claim:([^\]]+)\]\]/g, (whole, id) => {
    if (derivedFromClaims.has(id)) {
      claimIds.push(id);
      return "";
    }
    return whole;
  });
  return { text: next, claimIds };
}

/**
 * References より後のブロックから「知見タイトル → 知見 ID」対応表を作る。
 * そのブロックの reference リンクの targetNoteId が derivedFromClaims にあるものだけを拾う。
 */
function buildTitleToClaimId(
  referenceBlocks: any[],
  referenceLinksByBlock: Map<string, string[]>,
): Map<string, string> {
  const map = new Map<string, string>();
  for (const block of referenceBlocks) {
    const claimIds = referenceLinksByBlock.get(block.id);
    if (!claimIds || claimIds.length === 0) continue;
    const title = stripCitationMarkers(extractPlainInlineText(block.content));
    if (!title) continue;
    map.set(title, claimIds[0]);
  }
  return map;
}

/**
 * 1 ブロックから「照合する文」と、引いている知見 ID を組み立てる。
 * 引いている知見が 1 つも無ければ null。
 */
function extractStatementFromBlock(
  block: any,
  referenceLinksByBlock: Map<string, string[]>,
  titleToClaimId: Map<string, string>,
  derivedFromClaims: ReadonlySet<string>,
): { text: string; claimIds: string[] } | null {
  const content = block.content;
  if (!Array.isArray(content)) return null;

  const claimIds = new Set<string>();

  // (a) sourceBlockId 一致（従来どおり）
  for (const id of referenceLinksByBlock.get(block.id) ?? []) claimIds.add(id);

  // (a) の青文字要素を除去しつつ、(b) 完全一致要素も除去して残りのテキストを組み立てる
  const parts: string[] = [];
  for (const el of content) {
    if (isBlueCitationElement(el)) continue; // (a) の可視表現。テキストからは除く
    const raw = typeof el?.text === "string" ? el.text : (el?.content ?? "");
    if (typeof raw === "string") {
      const stripped = stripCitationMarkers(raw);
      const matchedClaimId = stripped ? titleToClaimId.get(stripped) : undefined;
      if (matchedClaimId) {
        claimIds.add(matchedClaimId); // (b) 完全一致
        continue; // テキストからは除く
      }
    }
    parts.push(raw ?? "");
  }
  let text = parts.join("");

  // (d) [[claim:<id>]] 形式（未解決の旧形式）
  const legacy = extractLegacyClaimRefs(text, derivedFromClaims);
  text = legacy.text;
  for (const id of legacy.claimIds) claimIds.add(id);

  // (c) ブロックのプレーンテキストが対応表のタイトルで終わる（要素結合済みの保険）。
  // 複数の引用が区切りなく連結されている場合に備え、末尾から繰り返し剥がす。
  const titlesByLengthDesc = [...titleToClaimId.keys()].sort((a, b) => b.length - a.length);
  let stripped = true;
  while (stripped) {
    stripped = false;
    const trimmedEnd = text.trimEnd();
    for (const title of titlesByLengthDesc) {
      if (!title) continue;
      if (trimmedEnd.endsWith(title)) {
        claimIds.add(titleToClaimId.get(title)!);
        text = trimmedEnd.slice(0, trimmedEnd.length - title.length);
        stripped = true;
        break;
      }
    }
  }

  if (claimIds.size === 0) return null;
  const finalText = text.trim();
  if (!finalText) return null;
  return { text: finalText, claimIds: [...claimIds] };
}

/** `[[source:<id>]]` を検出する正規表現（id は空白・`]` を含まない） */
const SOURCE_CITATION_RE = /\[\[source:([^\]]+?)\]\]/g;

/**
 * 新形式トピック（wikiMeta.topicMarkdown あり）から「照合する文」を取り出す（純関数）。
 * 資料の全文を直接読んで改訂する取り込み（PR 3b）向けの土台。
 *
 * 旧形式（extractTopicStatements）はビルド済み BlockNote ブロックから引用を復元するが、
 * 新形式は正本の markdown をそのまま行単位で走査する — `[[source:<id>]]` は
 * convertSectionsToBlocks を通す際にブラケットが失われる（pushCitation の仕様）ため、
 * ビルド後のブロックから復元しようとすると旧形式と同じ罠を踏む。markdown を直接見ることで
 * これを避ける。
 *
 * `##` 見出し行と、引用を持たない行（定義の前置き等）は対象外。id は資料 id をそのまま使い
 * （"claim:" プレフィックスは付けない＝出典照合が 1 段になる）、claimIds フィールドに積む
 * （旧形式と同じ型を再利用するための命名 — 意味は「引いた出典 id」）。
 */
export function extractSourceTopicStatements(doc: GraphiumDocument): TopicStatement[] {
  const meta = doc.wikiMeta;
  if (!meta || meta.kind !== "topic" || !meta.topicMarkdown) return [];

  const lines = meta.topicMarkdown.split("\n");
  const statements: TopicStatement[] = [];
  lines.forEach((rawLine, index) => {
    const line = rawLine.trim();
    if (!line) return;
    if (/^#{1,6}\s/.test(line)) return; // 見出し行は対象外

    const sourceIds: string[] = [];
    const text = line.replace(SOURCE_CITATION_RE, (_match, rawId: string) => {
      sourceIds.push(rawId.trim());
      return "";
    }).trim();

    if (sourceIds.length === 0 || !text) return;
    statements.push({ text, blockId: `line-${index}`, claimIds: sourceIds });
  });
  return statements;
}

/**
 * トピックドキュメントから「照合する文」の一覧を取り出す（純関数）。
 * doc.wikiMeta.kind !== "topic" のときは空配列を返す。
 */
export function extractTopicStatements(doc: GraphiumDocument): TopicStatement[] {
  const meta = doc.wikiMeta;
  if (!meta || meta.kind !== "topic") return [];
  const page = doc.pages[0];
  if (!page) return [];

  const derivedFromClaims = new Set(meta.derivedFromClaims ?? []);
  const referenceLinksByBlock = new Map<string, string[]>();
  for (const link of page.knowledgeLinks ?? []) {
    if (link.type !== "reference") continue;
    if (!link.targetNoteId || !derivedFromClaims.has(link.targetNoteId)) continue;
    const list = referenceLinksByBlock.get(link.sourceBlockId);
    if (list) list.push(link.targetNoteId);
    else referenceLinksByBlock.set(link.sourceBlockId, [link.targetNoteId]);
  }

  const blocks = page.blocks ?? [];
  const refHeadingIndex = blocks.findIndex((b: any) => isGeneratedReferencesHeading(b));
  const bodyBlocks = refHeadingIndex === -1 ? blocks : blocks.slice(0, refHeadingIndex);
  const referenceBlocks = refHeadingIndex === -1 ? [] : blocks.slice(refHeadingIndex + 1);

  const titleToClaimId = buildTitleToClaimId(referenceBlocks, referenceLinksByBlock);

  const statements: TopicStatement[] = [];
  for (const block of bodyBlocks) {
    const result = extractStatementFromBlock(block, referenceLinksByBlock, titleToClaimId, derivedFromClaims);
    if (!result) continue;
    statements.push({ text: result.text, blockId: block.id, claimIds: result.claimIds });
  }
  return statements;
}
