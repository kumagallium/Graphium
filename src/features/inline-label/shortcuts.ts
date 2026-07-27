// インライン（ハイライト）ラベルの選択トグル共通経路とキーボードショートカット
//
// FormattingToolbar のボタンと ⌘⇧+一文字ショートカットの両方がここを通る。
// 「選択して I でインプット」のような素のアルファベット割り当ては、選択中の
// タイプ置換（選択→文字入力で上書き）と衝突してデータを壊すため採用せず、
// ⌘⇧ 付きにする。T はブラウザ予約（タブ復元）で奪えないので ツール は E(quipment)。

import { LABEL_TO_STYLE } from "./styles";
import { isSelectionInsideStep } from "../../blocks/step/view";

export type InlineLabelKey = keyof typeof LABEL_TO_STYLE;

// BlockNote のテーブル構造を構成する ProseMirror ノード名。
// セル内の選択ではこれらが祖先チェーンに必ず現れる。
const TABLE_NODE_NAMES = new Set([
  "table",
  "tableRow",
  "tableCell",
  "tableHeader",
  "tableParagraph",
]);

/**
 * 現在の選択がテーブルセル内にあるかを判定する。
 *
 * テーブルは「列見出し=属性キー / 行=Entity」の構造として PROV に変換される
 * （parseStructuredTable + ブロックラベル経路）。1 セル = 1 つの atomic な値で
 * あり、セル内にインラインラベルを付けても下流（PROV 生成・attribute 紐付け）は
 * テーブル構造を走査しないため黙って捨てられる（サイレント故障）。
 * そこでセル内ではインラインラベルを付けず、構造解釈に一本化する。
 */
export function isSelectionInTableCell(editor: any): boolean {
  const tiptap = editor?._tiptapEditor;
  if (!tiptap) return false;
  const $from = tiptap.state?.selection?.$from;
  if (!$from) return false;
  for (let depth = $from.depth; depth >= 0; depth--) {
    const name = $from.node(depth)?.type?.name;
    if (name && TABLE_NODE_NAMES.has(name)) return true;
  }
  return false;
}

/** ランダムな entityId を生成（テキスト inline 用） */
export function makeEntityId(label: InlineLabelKey): string {
  const rand = Math.random().toString(36).slice(2, 10);
  return `ent_${label}_${rand}`;
}

/**
 * テキスト選択へのインラインラベルの付け外し。
 * 付与も解除もできない状況（複数ブロック選択・テーブルセル内）は false を返す。
 */
export function toggleInlineLabelForSelection(
  editor: any,
  label: InlineLabelKey,
): boolean {
  const styleKey = LABEL_TO_STYLE[label];
  const selection = editor.getSelection();
  if (selection?.blocks && selection.blocks.length > 1) return false;
  if (isSelectionInTableCell(editor)) return false;
  const activeStyles = editor.getActiveStyles?.() ?? {};
  const isActive = Boolean(activeStyles[styleKey]);
  if (isActive) {
    editor.removeStyles({ [styleKey]: activeStyles[styleKey] } as any);
  } else {
    editor.addStyles({ [styleKey]: makeEntityId(label) } as any);
  }
  return true;
}

/** e.code → ラベルの対応（JIS/US 配列差の影響を受けない物理キー判定） */
export const INLINE_LABEL_SHORTCUT_CODES: Record<string, InlineLabelKey> = {
  KeyI: "material", // Input
  KeyE: "tool", // Equipment（KeyT は ⌘⇧T=閉じたタブ復元でブラウザに奪われる）
  KeyP: "attribute", // Parameter
  KeyO: "output", // Output
};

const LABEL_TO_KEY_CHAR: Record<InlineLabelKey, string> = {
  material: "I",
  tool: "E",
  attribute: "P",
  output: "O",
};

const isMacLike = () =>
  typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);

/** tooltip 表示用のショートカット表記（mac: ⌘⇧I / それ以外: Ctrl+Shift+I） */
export function getInlineLabelShortcutHint(label: InlineLabelKey): string {
  const ch = LABEL_TO_KEY_CHAR[label];
  return isMacLike() ? `⌘⇧${ch}` : `Ctrl+Shift+${ch}`;
}

/**
 * keydown からのインラインラベルトグル。処理したら true（呼び出し側で preventDefault）。
 *
 * ガード:
 * - ⌘/Ctrl + Shift + 対象キーのみ（Alt 併用は無視）
 * - IME 変換中は無視
 * - 空選択・読み取り専用は対象外
 * - ハイライトは step の中でだけ付けられる。既にラベルが付いている選択は
 *   step 外でも解除できる（toolbar の表示条件と同じ）。
 */
export function handleInlineLabelShortcut(editor: any, e: KeyboardEvent): boolean {
  if (!(e.metaKey || e.ctrlKey) || !e.shiftKey || e.altKey) return false;
  const label = INLINE_LABEL_SHORTCUT_CODES[e.code];
  if (!label) return false;
  if (e.isComposing) return false;
  if (editor?.isEditable === false) return false;
  const tiptap = editor?._tiptapEditor;
  if (!tiptap) return false;
  // Shift+矢印での選択直後は、ProseMirror の state 同期（selectionchange 経由・
  // 非同期）が済んでおらず state.selection が古いことがある。保留中の
  // DOM 変化・選択を flush してから判定しないと、空選択扱いになったり
  // 古い位置にラベルが付いたりする。
  try {
    tiptap.view?.domObserver?.flush?.();
  } catch {
    /* PM 内部 API のため念のため握りつぶす（この場合は現在の state で判定） */
  }
  if (tiptap.state?.selection?.empty) return false;
  const activeStyles = editor.getActiveStyles?.() ?? {};
  const hasExistingLabel = Object.values(LABEL_TO_STYLE).some((k) =>
    Boolean(activeStyles[k]),
  );
  if (!isSelectionInsideStep(editor) && !hasExistingLabel) return false;
  return toggleInlineLabelForSelection(editor, label);
}
