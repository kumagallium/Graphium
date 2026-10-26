// ノートに紐づかないチャットの一覧
//
// 見た目は src/features/wiki/WikiListView.tsx のテーブル（見出し行・行のクラス）に揃える。
// 新しい配色・余白は作らず、そこで使っているクラスをそのまま流用する。
// 保存・AI 呼び出しは別途行う（ここは表示のみ）。

import { useMemo, useState } from "react";
import { MessageSquare, Trash2 } from "lucide-react";
import { Breadcrumb } from "../../components/Breadcrumb";
import { useT } from "../../i18n";
import { formatDateTime } from "../../lib/format-datetime";
import type { GroundingScope } from "../../lib/grounding-scope";
import { StandaloneChatComposer } from "./StandaloneChatComposer";
import { DEFAULT_STANDALONE_CHAT_SCOPE } from "./scope";
import type { StandaloneChatSummary } from "./types";

type SortKey = "messageCount" | "modifiedAt";
type SortDirection = "asc" | "desc";

export function StandaloneChatListView({
  chats,
  onSelect,
  onStart,
  onDelete,
  onBack,
  aiConfigured = true,
}: {
  chats: StandaloneChatSummary[];
  onSelect: (chatId: string) => void;
  /** 先頭の入力欄から新しい会話を始める。呼び出し側が会話を作って全画面へ移り、text を送る */
  onStart: (text: string, scope: GroundingScope) => void;
  onDelete?: (chatId: string) => void;
  /** パンくずの「ホーム」クリック。省略時はパンくずの当該項目をリンクにしない */
  onBack?: () => void;
  /** AI 未設定のときは onStart 側で案内だけ出すので、入力欄の文字を消さない */
  aiConfigured?: boolean;
}) {
  const t = useT();
  const [sortKey, setSortKey] = useState<SortKey>("modifiedAt");
  const [sortDir, setSortDir] = useState<SortDirection>("desc");
  // 先頭の入力欄の渡す範囲。会話が始まると会話側（StandaloneChat.scope）が引き継ぐ
  const [scope, setScope] = useState<GroundingScope>(DEFAULT_STANDALONE_CHAT_SCOPE);

  // WikiListView の handleSort と同じ作法（同じ列を再クリックで昇順・降順を反転）
  const handleSort = (key: SortKey) => {
    setSortKey((prev) => {
      if (prev === key) {
        setSortDir((d) => (d === "desc" ? "asc" : "desc"));
        return key;
      }
      setSortDir("desc");
      return key;
    });
  };

  const sorted = useMemo(() => {
    const list = [...chats];
    list.sort((a, b) => {
      const cmp =
        sortKey === "messageCount"
          ? a.messageCount - b.messageCount
          : new Date(a.modifiedAt).getTime() - new Date(b.modifiedAt).getTime();
      return sortDir === "desc" ? -cmp : cmp;
    });
    return list;
  }, [chats, sortKey, sortDir]);

  return (
    <div className="flex-1 flex flex-col overflow-hidden bg-background">
      {/* ヘッダー */}
      <div className="flex items-center gap-3 px-6 py-4 border-b border-border">
        <Breadcrumb items={[
          { label: t("nav.home"), onClick: onBack },
          { label: t("sidebar.chat") },
        ]} />
      </div>

      {/* 新しいチャットの入口 — ボタンではなく入力欄そのものを一覧の先頭に置く
          （一般的なチャットツールと同じく、開いたらすぐ話しかけられる）。
          送ると会話が作られて全画面へ移り、この入力欄が会話画面の下へ移ったように見える。
          列幅は会話画面の本文（max-w-[46rem]）に揃える */}
      <div className="px-6 pt-5 pb-4 border-b border-border/50">
        <div className="mx-auto w-full max-w-[46rem]">
          <div className="text-sm font-semibold text-foreground mb-2">{t("standaloneChat.newChatTitle")}</div>
          <StandaloneChatComposer
            onSend={(text) => onStart(text, scope)}
            scope={scope}
            onScopeChange={setScope}
            aiConfigured={aiConfigured}
            autoFocus
          />
        </div>
      </div>

      {/* テーブル */}
      <div className="flex-1 overflow-auto px-6">
        {sorted.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 gap-2">
            <MessageSquare size={24} className="opacity-30" />
            <p className="text-sm text-muted-foreground">{t("standaloneChat.empty")}</p>
          </div>
        ) : (
          <table className="w-full min-w-[720px] text-sm">
            <thead>
              <tr className="text-left text-xs font-semibold bg-secondary text-secondary-foreground border-b border-border">
                <th className="py-2 px-3">{t("standaloneChat.colTitle")}</th>
                <th className="py-2 px-3">{t("standaloneChat.colFirstQuestion")}</th>
                <th
                  className="py-2 pl-3 w-[110px] cursor-pointer hover:text-foreground tabular-nums"
                  onClick={() => handleSort("messageCount")}
                >
                  {t("standaloneChat.colMessageCount")}
                  {sortKey === "messageCount" && (sortDir === "desc" ? " ↓" : " ↑")}
                </th>
                <th
                  className="py-2 pl-3 w-[140px] cursor-pointer hover:text-foreground"
                  onClick={() => handleSort("modifiedAt")}
                >
                  {t("standaloneChat.colModified")}
                  {sortKey === "modifiedAt" && (sortDir === "desc" ? " ↓" : " ↑")}
                </th>
                <th className="py-2 px-2 w-[40px]" />
              </tr>
            </thead>
            <tbody>
              {sorted.map((chat) => (
                <tr
                  key={chat.id}
                  className="border-b border-border/50 hover:bg-muted/50 transition-colors cursor-pointer group"
                  onClick={() => onSelect(chat.id)}
                >
                  <td className="py-2 px-3 text-foreground max-w-[240px] truncate">
                    {chat.title ?? <span className="text-muted-foreground/40">—</span>}
                  </td>
                  <td className="py-2 px-3 text-foreground/70 max-w-[360px] truncate">
                    {chat.firstQuestion}
                  </td>
                  <td className="py-2 pl-3 text-xs text-muted-foreground tabular-nums">
                    {chat.messageCount}
                  </td>
                  <td className="py-2 pl-3 text-xs text-muted-foreground tabular-nums whitespace-nowrap">
                    {formatDateTime(chat.modifiedAt)}
                  </td>
                  <td className="py-2 px-2" onClick={(e) => e.stopPropagation()}>
                    {onDelete && (
                      <button
                        onClick={() => {
                          if (
                            typeof window !== "undefined" &&
                            !window.confirm(t("standaloneChat.deleteConfirm"))
                          )
                            return;
                          onDelete(chat.id);
                        }}
                        className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive transition-all p-1"
                        aria-label={t("common.delete")}
                        data-tooltip={t("common.delete")}
                      >
                        <Trash2 size={14} />
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
