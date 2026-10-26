// ノートに紐づかないチャットの子ナビ（チャット一覧）。
//
// 「チャット」を開いた本文領域の左列に置く。ChatGPT / Claude の履歴と同じ作りで、
// 先頭に「+ 新しいチャット」、その下に題を日付のまとまり（今日 / 昨日 / 過去 7 日 /
// それ以前）で並べる。題は AI が後から付けるので、無いうちは最初の質問を出す。
// 表示だけを受け持ち、読み込み・削除の実体は呼び出し側が行う。

import { Trash2, MessageSquare } from "lucide-react";
import { useT } from "../../i18n";
import { groupChatsByDate, type ChatNavGroupKey } from "./nav-groups";
import type { StandaloneChatSummary } from "./types";

const GROUP_LABEL_KEY: Record<ChatNavGroupKey, string> = {
  today: "standaloneChat.groupToday",
  yesterday: "standaloneChat.groupYesterday",
  week: "standaloneChat.groupWeek",
  older: "standaloneChat.groupOlder",
};

export function StandaloneChatNav({
  chats,
  activeChatId,
  onSelect,
  onNew,
  onDelete,
  now,
}: {
  chats: StandaloneChatSummary[];
  activeChatId: string | null;
  onSelect: (chatId: string) => void;
  onNew: () => void;
  onDelete?: (chatId: string) => void;
  /** 日付グループの基準時刻（ストーリーで固定するため）。省略時は現在 */
  now?: Date;
}) {
  const t = useT();
  const groups = groupChatsByDate(chats, now);

  return (
    <nav aria-label={t("standaloneChat.navLabel")} className="h-full flex flex-col overflow-hidden">
      {/* 新しいチャット — 常に先頭。選択を外して空の会話（中央の入力欄）へ */}
      <div className="px-2 pt-2 pb-1">
        <button
          onClick={onNew}
          className={`w-full px-3 py-1.5 text-xs font-medium rounded border border-dashed transition-colors text-left ${
            activeChatId === null
              ? "border-foreground/30 text-foreground"
              : "border-border text-muted-foreground hover:text-foreground hover:border-foreground/30"
          }`}
        >
          {t("aiChat.newChat")}
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-2 pb-2">
        {groups.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-10 gap-2">
            <MessageSquare size={20} className="opacity-30" />
            <p className="text-xs text-muted-foreground">{t("standaloneChat.empty")}</p>
          </div>
        ) : (
          groups.map((group) => (
            <div key={group.key} className="mt-3 first:mt-2">
              <div className="px-2 pb-1 text-xs font-semibold text-muted-foreground/70">
                {t(GROUP_LABEL_KEY[group.key])}
              </div>
              <ul className="space-y-0.5">
                {group.chats.map((chat) => {
                  const active = chat.id === activeChatId;
                  const label = chat.title ?? chat.firstQuestion;
                  return (
                    <li key={chat.id} className="group relative">
                      <button
                        onClick={() => onSelect(chat.id)}
                        aria-current={active ? "page" : undefined}
                        title={label}
                        className={`w-full text-left px-2 py-1.5 pr-7 rounded text-xs truncate transition-colors ${
                          active
                            ? "bg-muted text-foreground font-medium"
                            : "text-foreground/80 hover:bg-muted/50 hover:text-foreground"
                        }`}
                      >
                        {label || <span className="text-muted-foreground/40">—</span>}
                      </button>
                      {onDelete && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            if (typeof window !== "undefined" && !window.confirm(t("standaloneChat.deleteConfirm"))) return;
                            onDelete(chat.id);
                          }}
                          className="absolute right-1 top-1/2 -translate-y-1/2 p-1 rounded opacity-0 group-hover:opacity-100 focus:opacity-100 text-muted-foreground hover:text-destructive transition-all"
                          aria-label={t("common.delete")}
                          data-tooltip={t("common.delete")}
                        >
                          <Trash2 size={12} />
                        </button>
                      )}
                    </li>
                  );
                })}
              </ul>
            </div>
          ))
        )}
      </div>
    </nav>
  );
}
