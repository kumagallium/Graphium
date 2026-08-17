// Wiki ドキュメントのセクション抽出（葉モジュール）
//
// embedding（意味検索）と語彙インデックス（BM25）が同じ「H2 セクション」単位で
// 索引するための共通抽出。wiki-service（重い依存を持つ）から切り出してある。
// ここは document-types の型以外に依存しないこと — lexical-search からも import され、
// wiki-service / retriever と循環させないための置き場所。

import type { GraphiumDocument } from "../../lib/document-types";

/** embedding / 語彙インデックス共通のセクション */
export type WikiSection = {
  documentId: string;
  /** H2 ブロックの id。最初の H2 より前の本文は擬似 id "lead" */
  sectionId: string;
  /** 階層コンテキスト付き本文: "{kind}: {title} > {heading}: {content}" */
  text: string;
};

/**
 * マルチカラム（columnList / column）をレイアウト用ラッパーとして透過し、
 * 文書順の flat なブロック列にする。wiki 文書はパイプライン生成時はフラット
 * だがユーザーが手編集でカラム化できるため、本文走査系（セクション抽出・
 * preview・embedding・merge 再構成）は必ずこれを通してから走査する。
 */
export function flattenColumns(blocks: any[]): any[] {
  return (blocks ?? []).flatMap((block) =>
    block?.type === "columnList" || block?.type === "column"
      ? flattenColumns(block.children)
      : [block],
  );
}

/** inline / 表コンテンツをプレーンテキストにする */
function inlineText(content: any): string {
  if (!content) return "";
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content.map((c: any) => c.text ?? c.content ?? "").join("");
  }
  if (content.type === "tableContent" && Array.isArray(content.rows)) {
    return content.rows
      .map((row: any) => (row.cells ?? []).map((cell: any) => inlineText(cell)).join(" "))
      .join(" ")
      .trim();
  }
  return "";
}

/**
 * Wiki ドキュメントから索引対象のセクションを抽出する
 * 階層コンテキスト付き: "{WikiKind}: {タイトル} > {セクション見出し}: {本文}"
 */
export function extractWikiSections(documentId: string, doc: GraphiumDocument): WikiSection[] {
  const page = doc.pages[0];
  if (!page) return [];

  const kind = doc.wikiMeta?.kind ?? "claim";
  const docTitle = doc.title;
  const sections: WikiSection[] = [];

  let currentHeading: { id: string; text: string } | null = null;
  let currentContent: string[] = [];
  // 最初の H2 より前の本文（lead）。Atom は洞察の本文がここに来るため、
  // H2 セクションだけを embed すると重複判定・Retriever が「Source Claims」
  // （Claim タイトルの列挙）頼みになり、本文の主張で照合できない。
  const leadContent: string[] = [];

  const flushSection = () => {
    if (currentHeading && currentContent.length > 0) {
      const content = currentContent.join(" ").trim();
      if (content) {
        sections.push({
          documentId,
          sectionId: currentHeading.id,
          text: `${kind}: ${docTitle} > ${currentHeading.text}: ${content}`,
        });
      }
    }
    currentContent = [];
  };

  // カラム透過（flattenColumns）: しないとカラム内の本文が embedding から
  // 漏れ、Retriever・重複判定に不可視になる。
  for (const block of flattenColumns(page.blocks)) {
    if (block.type === "heading" && block.props?.level === 2) {
      flushSection();
      const headingText = inlineText(block.content);
      currentHeading = { id: block.id, text: headingText };
    } else if (currentHeading) {
      const text = inlineText(block.content);
      if (text) currentContent.push(text);
    } else {
      const text = inlineText(block.content);
      if (text) leadContent.push(text);
    }
  }
  flushSection();

  // lead は先頭に置く（本文の主張が照合の主役になるように）。
  // sectionId "lead" は擬似 ID — embedding store の複合キー要素と検索結果の
  // スニペット表示にしか使われず、block ID として逆引きされることはない。
  const lead = leadContent.join(" ").trim();
  if (lead) {
    sections.unshift({
      documentId,
      sectionId: "lead",
      text: `${kind}: ${docTitle}: ${lead}`,
    });
  }

  return sections;
}
