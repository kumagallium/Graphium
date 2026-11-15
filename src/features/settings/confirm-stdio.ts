// stdio の MCP サーバーを足す前の確認。純粋な表示文は mcp-command-confirm.ts。
// 断られたら呼び出し側は足さない・接続テストもしない。

import { confirmAction } from "../../ui/confirm-dialog";
import { t } from "../../i18n";
import { buildCommandSummary } from "./mcp-command-confirm";
import type { McpStdioServer } from "./store";

// t() は {command} を String.replace で埋めるため、値の `$&` などが解釈される。
// 利用者に見せる文字列が書き換わらないよう、印を置いてから自分で差し込む。
const MARK = "\u0001COMMAND\u0001";

/** 実行されるコマンドを見せて確認する。対象が空なら確認せず true */
export async function confirmStdioCommands(entries: readonly McpStdioServer[]): Promise<boolean> {
  if (entries.length === 0) return true;
  const summary = buildCommandSummary(entries);
  const message = t("settings.mcp.confirmStdio.message", { command: MARK }).split(MARK).join(summary);
  return confirmAction(message, {
    confirmLabel: t("settings.mcp.confirmStdio.add"),
    cancelLabel: t("settings.mcp.confirmStdio.cancel"),
  });
}
