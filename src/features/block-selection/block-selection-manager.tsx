// 複数ブロック選択の統合コンポーネント
// BlockNoteView の children として配置し、選択検知・ハイライト・ツールバーを管理する

import { useEffect } from "react";
import { useBlockNoteEditor } from "@blocknote/react";
import { useBlockSelection } from "./use-block-selection";
import { useMarqueeSelection } from "./marquee-selection";
import { SelectionToolbar } from "./selection-toolbar";
import { getCaptionedBlockIds } from "../table-meta/caption-layer";

const STYLE_ID = "block-selection-highlight";

/**
 * 複数ブロック選択のハイライト CSS を組み立てる。
 *
 * 本文ブロックはブラウザ自身の選択色が文字に付くので、ブロック背景を薄く塗るだけで足りる。
 * 画像・動画は背景を覆い隠すうえ、BlockNote が user-select:none にしているので選択色も付かず、
 * 「選ばれているのか」が見た目から分からない。そこで:
 * - 画像・動画（.bn-visual-media-wrapper）には中身の上に薄い色を重ね、枠を付ける
 * - 文字を持たない他のブロック（数式・PDF・ブックマーク・チャート等）には単独選択と同じ枠を付ける
 *
 * ブロック丸ごとの選択（矩形選択。blockMode）では文字の一部を選んでいるのではないので、
 * 文字の選択色は消し、代わりにブロック全体を少し濃く塗る（文字・画像・数式で同じ見た目にそろえる）。
 *
 * React で描くカスタムブロックは .bn-block > .react-renderer > .bn-block-content の 3 段になるので、
 * 自分の中身だけを指すセレクタは 2 通り用意する（子ブロックの中身は巻き込まない）。
 */
export function buildSelectionHighlightCss(
  selectedBlockIds: string[],
  captioned: ReadonlySet<string>,
  blockMode = false,
): string {
  if (selectedBlockIds.length < 2) return "";

  const outer = (id: string) => `[data-id="${id}"][data-node-type="blockOuter"]`;
  const ownContent = (tail: string) =>
    selectedBlockIds
      .flatMap((id) => [
        `${outer(id)} > .bn-block > .bn-block-content${tail}`,
        `${outer(id)} > .bn-block > .react-renderer > .bn-block-content${tail}`,
      ])
      .join(",\n");

  const selectors = selectedBlockIds.map(outer).join(",\n");
  // 名前付きの表は上余白のキャプション行まで塗る。判定は DOM 属性ではなく caption-layer の共有 Set
  const captionedSelectors = selectedBlockIds
    .filter((id) => captioned.has(id))
    .map(outer)
    .join(",\n");

  // 文字の選択色がある通常の選択は存在が分かる程度に薄く、文字の選択色を消すブロック選択は少し濃く
  const tint = blockMode
    ? "color-mix(in oklab, var(--color-primary) 12%, transparent)"
    : "rgba(75, 122, 82, 0.05)";
  const hideTextSelection = blockMode
    ? `
${selectedBlockIds.map((id) => `${outer(id)} *::selection`).join(",\n")} {
  background: transparent;
}`
    : "";
  // Crucible テーマに合わせたグリーン系ハイライト。存在が分かる程度に薄く（内容を暗くしない）。
  // 文字なしブロックの枠は app.css の単独選択枠（.ProseMirror-selectednode）と揃える。
  // 画像は面積が大きく枠だけだと見落とすので、枠を少し濃くし中身に色を重ねる
  return `
${selectors} {
  position: relative;
  background: ${tint} !important;
  border-radius: 4px;
  transition: background 0.15s ease;
}${hideTextSelection}
${ownContent("")} {
  outline: none !important;
}
${ownContent(" .bn-visual-media-wrapper")} {
  outline: color-mix(in oklab, var(--color-primary) 55%, transparent) solid 2px;
  outline-offset: 2px;
  border-radius: 4px;
}
${ownContent(" .bn-visual-media-wrapper::after")} {
  content: "";
  position: absolute;
  inset: 0;
  background: color-mix(in oklab, var(--color-primary) 22%, transparent);
  border-radius: 4px;
  pointer-events: none;
}
${ownContent(":not(:has(.bn-inline-content)):not(:has(.bn-visual-media-wrapper)) > *")} {
  outline: color-mix(in oklab, var(--color-primary) 35%, transparent) solid 2px;
  outline-offset: 2px;
  border-radius: 6px;
}
${captionedSelectors ? captionedSelectors + "::before" : ".gph-no-captioned-selection"} {
  content: "";
  position: absolute;
  left: 0;
  right: 0;
  top: -26px;
  height: 26px;
  background: ${tint};
  border-radius: 4px 4px 0 0;
  pointer-events: none;
}
`;
}

export function BlockSelectionManager() {
  const editor = useBlockNoteEditor<any, any, any>();
  const { selectedBlockIds, blockMode, clearSelection } = useBlockSelection(editor);
  useMarqueeSelection(editor);

  // 選択ブロックに動的ハイライトスタイルを注入
  useEffect(() => {
    let styleEl = document.getElementById(STYLE_ID) as HTMLStyleElement | null;
    if (!styleEl) {
      styleEl = document.createElement("style");
      styleEl.id = STYLE_ID;
      document.head.appendChild(styleEl);
    }

    styleEl.textContent = buildSelectionHighlightCss(
      selectedBlockIds,
      getCaptionedBlockIds(),
      blockMode,
    );

    return () => {
      if (styleEl) styleEl.textContent = "";
    };
  }, [selectedBlockIds, blockMode]);

  // クリーンアップ: コンポーネントのアンマウント時にスタイルを削除
  useEffect(() => {
    return () => {
      const styleEl = document.getElementById(STYLE_ID);
      if (styleEl) styleEl.remove();
    };
  }, []);

  return (
    <SelectionToolbar
      selectedBlockIds={selectedBlockIds}
      onClear={clearSelection}
    />
  );
}
