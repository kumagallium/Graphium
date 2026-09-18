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
import type { StandaloneChatSummary } from "./types";

type SortKey = "messageCount" | "modifiedAt";
type SortDirection = "asc" | "desc";

export function StandaloneChatListView({
  chats,
  onSelect,
  onNewChat,
  onDelete,
  onBack,
}: {
  chats: StandaloneChatSummary[];
  onSelect: (chatId: string) => void;
  onNewChat: () => void;
  onDelete?: (chatId: string) => void;
  /** パンくずの「ホーム」クリック。省略時はパンくずの当該項目をリンクにしない */
  onBack?: () => void;
}) {
  const t = useT();
  const [sortKey, setSortKey] = useState<SortKey>("modifiedAt");
  const [sortDir, setSortDir] = useState<SortDirection>("desc");

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

      {/* ツールバー（新しいチャット） */}
      <div className="flex items-center gap-2 px-6 py-2 border-b border-border/50">
        <button
          onClick={onNewChat}
          className="px-3 py-1.5 text-xs font-medium rounded border border-dashed border-border text-muted-foreground hover:text-foreground hover:border-foreground/30 transition-colors"
        >
          {t("aiChat.newChat")}
        </button>
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
                        title={t("common.delete")}
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
