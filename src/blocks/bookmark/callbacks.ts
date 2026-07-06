// ブックマークブロックのエディタ単位コールバックレジストリ。
// index.ts（ブロック登録）と view.tsx（render）の両方から参照されるため、
// 循環 import（index → view → index）を避ける目的で独立モジュールにしている。
// 外部からは従来どおり ./index 経由で import できる（index.ts が再エクスポート）。

// ブックマークピッカーを開くコールバック。エディタ単位で登録する
// （main editor / SidePeek / list-SidePeek の各々が自分用のピッカーを持つ）。
const bookmarkPickerCallbacks = new WeakMap<object, () => void>();

export function setBookmarkPickerCallback(editor: any, cb: (() => void) | null) {
  if (!editor) return;
  if (cb) bookmarkPickerCallbacks.set(editor, cb);
  else bookmarkPickerCallbacks.delete(editor);
}

// 登録済みのピッカーを開く（スラッシュメニューから使う）。
export function openBookmarkPicker(editor: any) {
  bookmarkPickerCallbacks.get(editor)?.();
}

// ブックマークをサイドピークで開くコールバック。エディタ単位で登録する
// （main editor / SidePeek / list-SidePeek の各々が自分用の開き手を持つ）。
const bookmarkPeekCallbacks = new WeakMap<object, (url: string) => void>();

export function setBookmarkPeekCallback(editor: any, cb: ((url: string) => void) | null) {
  if (!editor) return;
  if (cb) bookmarkPeekCallbacks.set(editor, cb);
  else bookmarkPeekCallbacks.delete(editor);
}

// 登録済みなら true を返してサイドピークを開く。未登録なら false（呼び出し側で外部リンクにフォールバック）。
export function openBookmarkPeek(editor: any, url: string): boolean {
  if (!editor) return false;
  const cb = bookmarkPeekCallbacks.get(editor);
  if (!cb) return false;
  cb(url);
  return true;
}
