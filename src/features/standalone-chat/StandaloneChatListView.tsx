// ノートに紐づかないチャットの一覧
//
// 「新しいチャット」ボタン＋各行。並び順は modifiedAt の降順。
// 保存・AI 呼び出しは別途行う（ここは表示のみ）。

import { useT } from "../../i18n";
import { StandaloneChatRow } from "./StandaloneChatRow";
import type { StandaloneChatSummary } from "./types";

export function StandaloneChatListView({
  chats,
  onSelect,
  onNewChat,
  onDelete,
}: {
  chats: StandaloneChatSummary[];
  onSelect: (chatId: string) => void;
  onNewChat: () => void;
  onDelete?: (chatId: string) => void;
}) {
  const t = useT();
  const sorted = [...chats].sort(
    (a, b) => new Date(b.modifiedAt).getTime() - new Date(a.modifiedAt).getTime(),
  );

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="px-3 py-2">
        <button
          onClick={onNewChat}
          className="w-full text-left px-3 py-2 rounded-lg border border-dashed border-border text-xs text-muted-foreground hover:text-foreground hover:border-foreground/30 transition-colors mb-2"
        >
          {t("aiChat.newChat")}
        </button>
        {sorted.length === 0 ? (
          <div className="text-xs text-muted-foreground px-3 py-2">{t("standaloneChat.empty")}</div>
        ) : (
          sorted.map((chat) => (
            <StandaloneChatRow key={chat.id} chat={chat} onSelect={onSelect} onDelete={onDelete} />
          ))
        )}
      </div>
    </div>
  );
}
