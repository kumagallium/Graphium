// shared:// 引用ブロックのコールバックレジストリ。
// bookmark と同じパターンで view.tsx との循環 import を回避する。
//
// - ピッカー: エディタ単位（main editor / SidePeek が各自のモーダルを持つ）
// - エントリを開く: アプリ単位（Library ビューはアプリレベルなので 1 個）

const pickerCallbacks = new WeakMap<object, () => void>();

/** スラッシュメニューから共有エントリピッカーを開くコールバックを登録する */
export function setSharedCitePickerCallback(
  editor: object | null | undefined,
  fn: (() => void) | null,
): void {
  if (!editor) return;
  if (fn) pickerCallbacks.set(editor, fn);
  else pickerCallbacks.delete(editor);
}

export function openSharedCitePicker(editor: object | null | undefined): void {
  if (!editor) return;
  pickerCallbacks.get(editor)?.();
}

// ── エントリを開く（Library ビューへ） ──

let openEntryCallback: ((sharedId: string) => void) | null = null;

export function setSharedEntryOpenCallback(
  fn: ((sharedId: string) => void) | null,
): void {
  openEntryCallback = fn;
}

export function hasSharedEntryOpenCallback(): boolean {
  return openEntryCallback !== null;
}

/** 引用カードの「開く」から共有エントリを Library で表示する */
export function openSharedEntry(sharedId: string): void {
  openEntryCallback?.(sharedId);
}
