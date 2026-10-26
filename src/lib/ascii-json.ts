// HTTP ヘッダーに入れる JSON を ASCII だけで作る。
//
// Web モードはモデル設定（表示名を含む）や MCP サーバー一覧（名前を含む）を
// X-LLM-API-Key / X-MCP-Servers ヘッダーで送る。fetch のヘッダー値は ISO-8859-1 の
// 範囲しか許されず、日本語の表示名（例: Copilot の既定名「GitHub Copilot（サブスクリプション）」）
// が混ざると fetch 自体が "String contains non ISO-8859-1 code point" で失敗する。
// JSON.stringify のあと ASCII の外の文字を \uXXXX に置き換えると、値は有効な JSON の
// ままなので受け側（JSON.parse）は何も変えなくてよい。サロゲートペアも片割れずつ
// 😀 の形になり、JSON として正しく元の文字に戻る。

/** JSON.stringify と同じ結果を、ASCII の外の文字を \uXXXX に逃がして返す */
export function toAsciiJson(value: unknown): string {
  return JSON.stringify(value).replace(
    /[\u0080-￿]/g,
    (ch) => `\\u${ch.charCodeAt(0).toString(16).padStart(4, "0")}`,
  );
}
