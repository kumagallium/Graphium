// 本文の上付き・下付き（superscript / subscript）のエディタ定義
//
// BlockNote には上付き・下付きの style が無いので、boolean の style として足す
// （保存形式は content[].styles.superscript / .subscript = true）。
// - 表示: <sup> / <sub>
// - 貼り付け: <sup> / <sub> と vertical-align: super / sub（Word・Google ドキュメント・Web）
// - ショートカット: ⌘. / ⌘,（Google ドキュメントと同じ割り当て）
// - 上付きと下付きは同時に付けない。片方を付けるともう片方は外れる
//
// 読込時サニタイズ（blocks/registry.ts の KNOWN_STYLE_KEYS）にも必ず登録すること。
// 漏れると保存 → 再読込で書式だけが剥がされ、そのまま自動保存される。
// Markdown との相互変換（<sup> / <sub>）は lib/script-styles.ts。

import { createStyleSpec, type StyleSpec } from "@blocknote/core";
import { oppositeScriptStyle, scriptStyleTag, type ScriptStyle } from "../lib/script-styles";

/** ショートカットの文字キー（修飾キーは ⌘ / Ctrl） */
const SHORTCUT_KEYS: Record<ScriptStyle, string> = {
  superscript: ".",
  subscript: ",",
};

/** TipTap のキー表記（"Mod-."） */
export function scriptStyleShortcut(style: ScriptStyle): string {
  return `Mod-${SHORTCUT_KEYS[style]}`;
}

/** BlockNote のツールチップ表記（"Mod+."。formatKeyboardShortcut で ⌘ / Ctrl に直す） */
export function scriptStyleShortcutLabel(style: ScriptStyle): string {
  return `Mod+${SHORTCUT_KEYS[style]}`;
}

/** 切り替えに使う TipTap エディタの最小インターフェース */
type ChainableEditor = {
  chain: () => {
    unsetMark: (name: string) => any;
  };
};

/**
 * 選択範囲（カーソルだけならこれから打つ文字）の上付き・下付きを切り替える。
 * ツールバーのボタンとショートカットの共通経路。付けるときは相手側を先に外す。
 * 付け外しの判定は TipTap の toggleMark と同じ（選択範囲全体に付いていれば外す）。
 */
export function toggleScriptStyle(tiptap: ChainableEditor, style: ScriptStyle): boolean {
  return tiptap.chain().unsetMark(oppositeScriptStyle(style)).toggleMark(style).run();
}

function createScriptStyleSpec<S extends ScriptStyle>(
  style: S,
): StyleSpec<{ type: S; propSchema: "boolean" }> {
  const tag = scriptStyleTag(style);
  const verticalAlign = style === "superscript" ? "super" : "sub";
  const spec = createStyleSpec(
    { type: style, propSchema: "boolean" },
    {
      render: () => {
        const el = document.createElement(tag);
        return { dom: el, contentDOM: el };
      },
      // 外からの貼り付けを拾う。Word・Web は <sup> / <sub>、Google ドキュメントは
      // vertical-align の span で上付き・下付きを表す
      parse: (element) =>
        element.tagName.toLowerCase() === tag || element.style?.verticalAlign === verticalAlign
          ? true
          : undefined,
    },
  );
  // ショートカットは mark 自身に持たせる。ProseMirror のキーマップで処理されるので、
  // document の keydown を購読するアプリ側ショートカットとは経路が別になる
  const mark = spec.implementation.mark.extend({
    addKeyboardShortcuts() {
      return {
        [scriptStyleShortcut(style)]: () => toggleScriptStyle(this.editor, style),
      };
    },
  });
  return { ...spec, implementation: { ...spec.implementation, mark } };
}

/** BlockNoteSchema.create の styleSpecs に混ぜる style 定義 */
export const scriptStyleSpecs = {
  superscript: createScriptStyleSpec("superscript"),
  subscript: createScriptStyleSpec("subscript"),
};
