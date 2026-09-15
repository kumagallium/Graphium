// キーボードショートカットの「表示」を OS に合わせて組み立てる共通ユーティリティ。
//
// キーの判定は各ハンドラが `metaKey || ctrlKey` で両対応しているので、Windows / Linux でも
// Ctrl で動く。表示だけ ⌘ 決め打ちだと「⌘ キーが無い」と読めてしまうため、表示はここに集約する。
// 書式は mac が記号（⌘⇧M）、それ以外が名前を + で繋ぐ（Ctrl+Shift+M）。

/** 修飾キー。`mod` は mac の ⌘ / それ以外の Ctrl */
export type ShortcutModifier = "mod" | "shift" | "alt";

const MAC_LABELS: Record<ShortcutModifier, string> = { mod: "⌘", shift: "⇧", alt: "⌥" };
const PC_LABELS: Record<ShortcutModifier, string> = { mod: "Ctrl", shift: "Shift", alt: "Alt" };

/** ⌘ 表記を使う環境か（macOS / iOS / iPadOS） */
export function isMacLike(): boolean {
  return typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);
}

function isModifier(key: string): key is ShortcutModifier {
  return key === "mod" || key === "shift" || key === "alt";
}

function keyLabels(keys: readonly string[], mac: boolean): string[] {
  const labels = mac ? MAC_LABELS : PC_LABELS;
  return keys.map((k) => (isModifier(k) ? labels[k] : k));
}

/**
 * 文字列表記。mac: ⌘⇧M / それ以外: Ctrl+Shift+M
 * mac 側の区切りは既存の見た目に合わせて呼び出し側が選ぶ
 * （ツールチップ・ヒント文は `macSeparator: "+"` で ⌘+⇧+M、チップやメニューは詰めて ⌘K）。
 */
export function formatShortcut(
  keys: readonly string[],
  options: { macSeparator?: string } = {},
): string {
  const mac = isMacLike();
  return keyLabels(keys, mac).join(mac ? (options.macSeparator ?? "") : "+");
}

/**
 * キーキャップ（<kbd>）用の配列。
 * mac はキーごとに分離（⌘ ⇧ M）— まとめると ⇧ が埋もれて「⌘M で効かない」と誤解された。
 * Windows / Linux は記号キーが無く名前が長いので 1 キャップに畳む（Ctrl+Shift+M）。
 */
export function shortcutKeycaps(keys: readonly string[]): string[] {
  return isMacLike() ? keyLabels(keys, true) : [formatShortcut(keys)];
}

/**
 * サイドバー開閉（⌘+\）のツールチップ用パラメータ。
 * JIS 配列では同じ位置の ¥ キーでも効く（判定は Backslash || IntlYen）ので、日本語文言は併記する。
 */
export function sidebarToggleShortcutParams(): { shortcut: string; shortcutYen: string } {
  return {
    shortcut: formatShortcut(["mod", "\\"], { macSeparator: "+" }),
    shortcutYen: formatShortcut(["mod", "¥"], { macSeparator: "+" }),
  };
}
