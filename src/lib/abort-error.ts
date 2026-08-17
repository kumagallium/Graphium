// AbortController による中断の判定（依存なし・サーバー / クライアント共有）。
//
// fetch も AI SDK も、signal が abort されると name === "AbortError" のエラーを投げる。
// ブラウザ / WKWebView では DOMException、Node では通常の Error になるので両方を見る。
// 中断は「失敗」ではないため、呼び出し側はこれを catch したらエラー表示ではなく
// 「中断された」として扱う（chat-run-manager の "aborted" と同じ流儀）。

export function isAbortError(err: unknown): boolean {
  if (typeof DOMException !== "undefined" && err instanceof DOMException) {
    return err.name === "AbortError";
  }
  return typeof err === "object" && err !== null && (err as { name?: string }).name === "AbortError";
}
