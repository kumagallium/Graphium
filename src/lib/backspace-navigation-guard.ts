// Backspace で「ページが戻る」のを止める。
//
// WebKit（デスクトップ版の WKWebView）は、文字を書けない場所にフォーカスがあるとき
// Backspace を「履歴を 1 段戻る」に使う。ブロックメニューを閉じた直後などはフォーカスが
// body やボタンに落ちているので、「ブロックを消したい」つもりの Backspace でノートから
// 前の画面へ戻ってしまう。アプリには Backspace で戻る操作を割り当てていないので、
// 文字を書ける場所以外では既定動作だけを止める（他のハンドラには届く）。

/** 文字を書ける入力欄の type。これ以外の input（チェックボックス等）では Backspace は何も消さない */
const TEXT_INPUT_TYPES = new Set([
  "", "text", "search", "url", "tel", "email", "password", "number",
  "date", "datetime-local", "month", "time", "week",
]);

/** Backspace が文字を消す対象か（＝既定動作を残すべきか） */
export function isTextEditingTarget(el: Element | null): boolean {
  if (!el) return false;
  if ((el as HTMLElement).isContentEditable) return true;
  if (el instanceof HTMLTextAreaElement) return !el.readOnly && !el.disabled;
  if (el instanceof HTMLInputElement) {
    return TEXT_INPUT_TYPES.has(el.type.toLowerCase()) && !el.readOnly && !el.disabled;
  }
  return false;
}

export function installBackspaceNavigationGuard(target: Window = window): () => void {
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key !== "Backspace" || e.defaultPrevented) return;
    // shadow DOM 内の入力欄も見るため、イベントの起点から判定する
    const origin = (e.composedPath()[0] as Element | undefined) ?? (e.target as Element | null);
    if (isTextEditingTarget(origin instanceof Element ? origin : null)) return;
    e.preventDefault();
  };
  // バブリングの最後（window）で見る。各機能の Backspace ハンドラを先に通すため
  target.addEventListener("keydown", onKeyDown);
  return () => target.removeEventListener("keydown", onKeyDown);
}
