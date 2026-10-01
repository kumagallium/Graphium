// 文字色・背景色のショートカット（⌘⇧H / Ctrl+Shift+H）
//
// 「直前に使った色」をもう一度付ける。Notion と同じ型で、覚えるキーは 1 つだけ。
// - 色を選ぶのは今まで通り書式ツールバーの色メニュー。そこで選んだ色（文字色か背景色）を覚える
// - 選択範囲にもう同じ色が付いていれば外す（太字の ⌘B と同じ付け外し）
// - まだ一度も色を使っていなければ黄色の背景（蛍光ペン）
//
// 色メニュー（BlockNote の ColorStyleButton）は差し替えない。色を付けると addStyles が
// AddMarkStep を積むので、それをトランザクションから拾って覚える（watchLastColor）。
// 貼り付け・ドロップ・取り消し／やり直しで付いた色は「選んだ色」ではないので拾わない。
// 覚えた色は端末ごとの好みとして localStorage に置く（ノートのデータには書かない）。

/** 色を表す BlockNote の style */
export type ColorStyleKey = "textColor" | "backgroundColor";

export type LastColor = { style: ColorStyleKey; color: string };

/** まだ色を使っていないときの色（蛍光ペンの黄色） */
export const DEFAULT_LAST_COLOR: LastColor = { style: "backgroundColor", color: "yellow" };

/** BlockNote の色パレット（"default" は「色なし」なので覚えない） */
const PALETTE = new Set([
  "gray",
  "brown",
  "red",
  "orange",
  "yellow",
  "green",
  "blue",
  "purple",
  "pink",
]);

const STORAGE_KEY = "graphium-last-color";

/** ショートカットの物理キー（JIS / US 配列の差を受けない） */
const SHORTCUT_CODE = "KeyH";

let cached: LastColor | undefined;

function isColorStyleKey(value: unknown): value is ColorStyleKey {
  return value === "textColor" || value === "backgroundColor";
}

function normalize(value: unknown): LastColor | null {
  if (!value || typeof value !== "object") return null;
  const { style, color } = value as Record<string, unknown>;
  if (!isColorStyleKey(style) || typeof color !== "string" || !PALETTE.has(color)) return null;
  return { style, color };
}

/** 直前に使った色。未使用・読めないときは DEFAULT_LAST_COLOR */
export function getLastColor(): LastColor {
  if (cached) return cached;
  let stored: LastColor | null = null;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    stored = raw ? normalize(JSON.parse(raw)) : null;
  } catch {
    /* プライベートモード等で読めなければ既定の色 */
  }
  cached = stored ?? DEFAULT_LAST_COLOR;
  return cached;
}

export function setLastColor(next: LastColor): void {
  const value = normalize(next);
  if (!value) return;
  cached = value;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
  } catch {
    /* 書けなくても、このセッションの間はメモリ上の値で効く */
  }
}

/** テスト用: 覚えた色を忘れる */
export function resetLastColorForTest(): void {
  cached = undefined;
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* noop */
  }
}

/** watchLastColor が見るトランザクションの最小形 */
type TransactionLike = {
  docChanged: boolean;
  steps: readonly { toJSON: () => any }[];
  getMeta: (key: string) => unknown;
};

/**
 * トランザクションから「人が選んで付けた色」を取り出す。無ければ null。
 * 色メニューの addStyles は AddMarkStep を積む。貼り付け・ドロップ・メンションの挿入は
 * ReplaceStep なので、そもそも引っかからない。取り消し／やり直しは明示的に除く
 * （prosemirror-history の PluginKey は "history$"）。
 */
export function lastColorFromTransaction(tr: TransactionLike): LastColor | null {
  if (!tr.docChanged) return null;
  if (tr.getMeta("history$") || tr.getMeta("paste")) return null;
  const uiEvent = tr.getMeta("uiEvent");
  if (uiEvent === "paste" || uiEvent === "drop") return null;
  let found: LastColor | null = null;
  for (const step of tr.steps) {
    const json = step.toJSON();
    if (json?.stepType !== "addMark") continue;
    const style = json.mark?.type;
    if (!isColorStyleKey(style)) continue;
    const color = normalize({ style, color: json.mark?.attrs?.stringValue });
    if (color) found = color;
  }
  return found;
}

/**
 * エディタで色が付けられるたびに覚える。戻り値は購読の解除。
 * メイン・サイドピークどちらのエディタでも同じ「直前の色」を共有する。
 */
export function watchLastColor(editor: any): () => void {
  const tiptap = editor?._tiptapEditor;
  if (!tiptap?.on) return () => {};
  const onTransaction = ({ transaction }: { transaction: TransactionLike }) => {
    const color = lastColorFromTransaction(transaction);
    if (color) setLastColor(color);
  };
  tiptap.on("transaction", onTransaction);
  return () => tiptap.off?.("transaction", onTransaction);
}

/**
 * 直前の色を選択範囲に付ける。もう同じ色が付いていれば外す。
 * 選択が空ならこれから打つ文字に効く（太字の ⌘B と同じ）。
 */
export function applyRepeatColor(editor: any): boolean {
  if (editor?.isEditable === false) return false;
  const { style, color } = getLastColor();
  if (!(style in (editor?.schema?.styleSchema ?? {}))) return false;
  const active = editor.getActiveStyles?.() ?? {};
  if (active[style] === color) {
    editor.removeStyles({ [style]: color });
  } else {
    editor.addStyles({ [style]: color });
  }
  return true;
}

/** ⌘⇧H / Ctrl+Shift+H か（Alt 併用は対象外） */
export function isRepeatColorShortcut(e: KeyboardEvent): boolean {
  return (e.metaKey || e.ctrlKey) && e.shiftKey && !e.altKey && e.code === SHORTCUT_CODE;
}

/** keydown からの色付け。処理したら true（呼び出し側で preventDefault） */
export function handleRepeatColorShortcut(editor: any, e: KeyboardEvent): boolean {
  if (!isRepeatColorShortcut(e) || e.isComposing) return false;
  // Shift+矢印で選んだ直後は PM の選択の同期が済んでいないことがある
  // （インラインラベルのショートカットと同じ事情）。保留中の DOM 変化を先に流す
  try {
    editor?._tiptapEditor?.view?.domObserver?.flush?.();
  } catch {
    /* PM 内部 API のため念のため握りつぶす */
  }
  return applyRepeatColor(editor);
}
