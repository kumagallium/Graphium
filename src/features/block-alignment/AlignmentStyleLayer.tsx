// blockAlignmentStore の内容を CSS として注入し、配置を実際に効かせるレイヤ。
//
// BlockNote はブロックを頻繁に再描画するため、DOM 属性を直接書き換えると消える。
// そこで `.bn-block-outer[data-id="..."]` という安定したセレクタに対する CSS を
// <style> として注入する方式にする（再描画に強い）。
//
// - テーブル: `table { margin-inline: auto }` で中央 / 右寄せ。
// - flex 系メディア（audio / file）: コンテンツの justify-content で寄せる。
// 段落・見出し・画像・動画・Callout は標準 textAlignment で配置するため対象外。

import { useBlockAlignmentStoreOptional } from "./store";

export function AlignmentStyleLayer() {
  const store = useBlockAlignmentStoreOptional();
  if (!store || store.alignments.size === 0) return null;

  const rules: string[] = [];
  for (const [blockId, align] of store.alignments) {
    if (align !== "center" && align !== "right") continue;
    const sel = `.bn-block-outer[data-id="${CSS.escape(blockId)}"]`;
    if (align === "center") {
      rules.push(`${sel} .bn-block-content table { margin-left: auto; margin-right: auto; }`);
      rules.push(`${sel} > .bn-block > .bn-block-content { justify-content: center; }`);
    } else {
      rules.push(`${sel} .bn-block-content table { margin-left: auto; margin-right: 0; }`);
      rules.push(`${sel} > .bn-block > .bn-block-content { justify-content: flex-end; }`);
    }
  }

  if (rules.length === 0) return null;
  return <style data-graphium-block-alignment>{rules.join("\n")}</style>;
}
