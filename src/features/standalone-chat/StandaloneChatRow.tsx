// ノートに紐づかないチャット一覧の 1 行
//
// 見た目・配色は ai-assistant/panel.tsx の ChatListView の行に揃える（新しい色は作らない）。
// 削除ボタンを行内に置くため、行自体は button にしない（SkillListView と同じ組み方。
// button の入れ子は HTML 仕様違反かつ操作が壊れる）。

import { Trash2 } from "lucide-react";
import { formatDateTime } from "../../lib/format-datetime";
import { useT } from "../../i18n";
import type { StandaloneChatSummary } from "./types";

export function StandaloneChatRow({
  chat,
  onSelect,
  onDelete,
}: {
  chat: StandaloneChatSummary;
  onSelect: (chatId: string) => void;
  onDelete?: (chatId: string) => void;
}) {
  const t = useT();
  const heading = chat.title ?? chat.firstQuestion;
  // title が無い（＝見出しに firstQuestion をそのまま使っている）ときは、
  // 2 段目に同じ文言を重ねて出さない
  const showFirstQuestionLine = Boolean(chat.title);
  const date = formatDateTime(chat.modifiedAt);

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => onSelect(chat.id)}
      onKeyDown={(e) => {
        // 内側の削除ボタンからバブリングしてきたキー入力では行を開かない
        if (e.target !== e.currentTarget) return;
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onSelect(chat.id);
        }
      }}
      className="w-full text-left px-3 py-2 rounded-lg hover:bg-background transition-colors mb-1 cursor-pointer group flex items-start gap-2"
    >
      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium text-foreground truncate mb-0.5">{heading}</div>
        {showFirstQuestionLine && (
          <div className="text-sm text-foreground/70 truncate">{chat.firstQuestion}</div>
        )}
        <div className="text-xs text-muted-foreground">
          {t("aiChat.messageCount", { count: String(chat.messageCount) })}
          <span aria-hidden="true"> · </span>
          {date}
        </div>
      </div>
      {onDelete && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            if (typeof window !== "undefined" && !window.confirm(t("standaloneChat.deleteConfirm"))) return;
            onDelete(chat.id);
          }}
          className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive transition-all p-1 shrink-0"
          title={t("common.delete")}
        >
          <Trash2 size={14} />
        </button>
      )}
    </div>
  );
}
