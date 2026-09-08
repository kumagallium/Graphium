// 複数ブロック選択の統合コンポーネント
// BlockNoteView の children として配置し、選択検知・ハイライト・ツールバーを管理する

import { useEffect } from "react";
import { useBlockNoteEditor } from "@blocknote/react";
import { useBlockSelection } from "./use-block-selection";
import { SelectionToolbar } from "./selection-toolbar";

const STYLE_ID = "block-selection-highlight";

export function BlockSelectionManager() {
  const editor = useBlockNoteEditor<any, any, any>();
  const { selectedBlockIds, clearSelection } = useBlockSelection(editor);

  // 選択ブロックに動的ハイライトスタイルを注入
  useEffect(() => {
    let styleEl = document.getElementById(STYLE_ID) as HTMLStyleElement | null;
    if (!styleEl) {
      styleEl = document.createElement("style");
      styleEl.id = STYLE_ID;
      document.head.appendChild(styleEl);
    }

    if (selectedBlockIds.length < 2) {
      styleEl.textContent = "";
      return;
    }

    const selectors = selectedBlockIds
      .map((id) => `[data-id="${id}"][data-node-type="blockOuter"]`)
      .join(",\n");

    // Crucible テーマに合わせたグリーン系ハイライト。存在が分かる程度に薄く（内容を暗くしない）。
    // 名前付きの表（data-caption-space）は上余白に浮かぶキャプション行まで塗る
    const captionedSelectors = selectedBlockIds
      .map((id) => `[data-id="${id}"][data-node-type="blockOuter"][data-caption-space]`)
      .join(",\n");
    styleEl.textContent = `
${selectors} {
  position: relative;
  background: rgba(75, 122, 82, 0.05) !important;
  border-radius: 4px;
  transition: background 0.15s ease;
}
${selectors} > .bn-block > .bn-block-content {
  outline: none !important;
}
${captionedSelectors}::before {
  content: "";
  position: absolute;
  left: 0;
  right: 0;
  top: -26px;
  height: 26px;
  background: rgba(75, 122, 82, 0.05);
  border-radius: 4px 4px 0 0;
  pointer-events: none;
}
`;

    return () => {
      if (styleEl) styleEl.textContent = "";
    };
  }, [selectedBlockIds]);

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
