// AI 回答をノート本文へ挿入する際、回答末尾の「Knowledge referenced」や本文中の
// `[Source: "title"]` を、クリックで Wiki（knowledge）ノートを開ける青い `@title` mention に
// 変換するためのユーティリティ。
//
// note-app のグローバルクリックハンドラは「`@` 始まりの textColor: blue テキスト」を拾って
// SidePeek を開く。チャット欄の 📎 リンク（panel.tsx replaceSourceLinks）と同じ体験を
// 本文側でも実現するため、ここでは同じ正規表現で `[Source]` を検出し、同じ青テキスト表現に
// 揃える。title が解決できない引用（hallucination）は変換せずそのまま残す。

/** AI 回答内の `[Source: "title"]` を検出する正規表現（チャット表示側 panel.tsx と揃える）。 */
export const SOURCE_MENTION_RE = /\[Source:\s*"([^"]+)"\]/g;

/**
 * 1 つのテキスト文字列内の `[Source: "title"]` を、クリックで Wiki を開ける青い `@title`
 * mention（textColor: blue）に分割する。解決できた wikiNoteId を uniq で返す（reference リンク用）。
 * 解決できる Source が 1 つも無ければ元のテキストノードをそのまま返す。
 */
export function splitSourceMentions(
  text: string,
  styles: any,
  wikiTitleToNoteId: Map<string, string>,
): { nodes: any[]; wikiIds: string[] } {
  if (!text.includes("[Source:") || wikiTitleToNoteId.size === 0) {
    return { nodes: [{ type: "text", text, styles }], wikiIds: [] };
  }
  const nodes: any[] = [];
  const wikiIds = new Set<string>();
  let lastIdx = 0;
  let m: RegExpExecArray | null;
  SOURCE_MENTION_RE.lastIndex = 0;
  while ((m = SOURCE_MENTION_RE.exec(text)) !== null) {
    const title = m[1];
    const wikiId = wikiTitleToNoteId.get(title);
    if (!wikiId) continue; // 未解決はそのまま（後でテキストとして残す）
    if (m.index > lastIdx) nodes.push({ type: "text", text: text.slice(lastIdx, m.index), styles });
    nodes.push({ type: "text", text: `@${title}`, styles: { textColor: "blue" } });
    wikiIds.add(wikiId);
    lastIdx = SOURCE_MENTION_RE.lastIndex;
  }
  if (wikiIds.size === 0) return { nodes: [{ type: "text", text, styles }], wikiIds: [] };
  if (lastIdx < text.length) nodes.push({ type: "text", text: text.slice(lastIdx), styles });
  return { nodes, wikiIds: [...wikiIds] };
}

/**
 * パース済みブロック配列を走査し、各テキストノード内の `[Source: "title"]` を青い `@title`
 * mention に置換する。ブロック数・children 数は変えない（インライン content のみ分割する）ため、
 * extractLabelMarkersFromBlocks が返す path がそのまま有効に保たれる。
 * 各ブロックに張るべき reference 先 wikiNoteId を path 付きで refs に集める。
 */
export function linkifySourceMentions(
  blocks: any[],
  wikiTitleToNoteId: Map<string, string>,
): { blocks: any[]; refs: { path: number[]; wikiIds: string[] }[] } {
  const refs: { path: number[]; wikiIds: string[] }[] = [];
  if (wikiTitleToNoteId.size === 0) return { blocks, refs };

  const walk = (block: any, path: number[]): any => {
    const wikiIdsHere = new Set<string>();
    let content = block.content;
    if (Array.isArray(content)) {
      const newContent: any[] = [];
      for (const node of content) {
        if (node?.type === "text" && typeof node.text === "string" && node.text.includes("[Source:")) {
          const { nodes, wikiIds } = splitSourceMentions(node.text, node.styles ?? {}, wikiTitleToNoteId);
          newContent.push(...nodes);
          for (const w of wikiIds) wikiIdsHere.add(w);
        } else {
          newContent.push(node);
        }
      }
      content = newContent;
    }
    const children = Array.isArray(block.children)
      ? block.children.map((c: any, i: number) => walk(c, [...path, i]))
      : block.children;
    if (wikiIdsHere.size > 0) refs.push({ path, wikiIds: [...wikiIdsHere] });
    return { ...block, content, children };
  };

  return { blocks: blocks.map((b, i) => walk(b, [i])), refs };
}
