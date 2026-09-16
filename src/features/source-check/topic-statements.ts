// 出典照合（Source check, v1.1） — トピック本文から「照合する文」を取り出す。
//
// 本文ブロックのうち `References` 見出し（buildTopicReferenceBlocks が作る）より前の
// ブロックを走査する。ブロック B が knowledgeLinks の "reference" 種別で
// `wikiMeta.derivedFromClaims` に含まれる知見を 1 つ以上引いていれば、B のプレーンテキスト
// （引用の "@タイトル" 部分は取り除く）を「照合する文」として、引いた各知見を「出典」とする。
// 引用を持たないブロック（定義の段落など）は照合しない。

import type { GraphiumDocument } from "../../lib/document-types";

export type TopicStatement = {
  /** 照合する文（プレーンテキスト。引用の "@タイトル" 部分は除く） */
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

/** 引用（青文字の "@..."）を除いたプレーンテキストを組み立てる */
function extractStatementText(content: any): string {
  if (!content) return "";
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .filter((c: any) => {
      const isCitation =
        c?.type === "text" &&
        c?.styles?.textColor === "blue" &&
        typeof c.text === "string" &&
        c.text.startsWith("@");
      return !isCitation;
    })
    .map((c: any) => c.text ?? c.content ?? "")
    .join("")
    .trim();
}

/** 見出し判定専用: 引用除去はせずそのままのテキストを返す */
function extractPlainInlineText(content: any): string {
  if (!content) return "";
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content.map((c: any) => c.text ?? c.content ?? "").join("");
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

  const statements: TopicStatement[] = [];
  for (const block of page.blocks ?? []) {
    if (isGeneratedReferencesHeading(block)) break;
    const claimIds = referenceLinksByBlock.get(block.id);
    if (!claimIds || claimIds.length === 0) continue;
    const text = extractStatementText(block.content);
    if (!text) continue;
    statements.push({ text, blockId: block.id, claimIds });
  }
  return statements;
}
