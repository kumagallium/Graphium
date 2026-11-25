// ノートに紐づかないチャットの子ナビ（チャット一覧）。
//
// 「チャット」を開いた本文領域の左列に置く。ChatGPT / Claude の履歴と同じ作りで、
// 先頭に「+ 新しいチャット」、その下に題を日付のまとまり（今日 / 昨日 / 過去 7 日 /
// それ以前）で並べる。題は AI が後から付けるので、無いうちは最初の質問を出す。
// 表示だけを受け持ち、読み込み・削除・名前変更の実体は呼び出し側が行う。
// 名前は行の鉛筆から、その場の入力欄で変える（Enter / 欄の外で確定、Esc で取り消し）。

import { useRef, useState } from "react";
import { Trash2, MessageSquare, Pencil } from "lucide-react";
import { useT } from "../../i18n";
import { useImeEnterGuard } from "../../hooks/use-ime-enter-guard";
import { confirmAction } from "../../ui/confirm-dialog";
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
  onRename,
  now,
}: {
  chats: StandaloneChatSummary[];
  activeChatId: string | null;
  onSelect: (chatId: string) => void;
  onNew: () => void;
  onDelete?: (chatId: string) => void;
  /** 題を変える。渡したときだけ行に鉛筆を出す */
  onRename?: (chatId: string, title: string) => void;
  /** 日付グループの基準時刻（ストーリーで固定するため）。省略時は現在 */
  now?: Date;
}) {
  const t = useT();
  const groups = groupChatsByDate(chats, now);
  // 名前を変えている行の id と、入力中の文字
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const { compositionHandlers, isImeKey } = useImeEnterGuard();
  // Esc や Enter で閉じた直後に欄の blur が来ても、二度目の確定をしないための印
  const closedRef = useRef(false);

  const startRename = (chat: StandaloneChatSummary) => {
    closedRef.current = false;
    setDraft(chat.title ?? chat.firstQuestion);
    setEditingId(chat.id);
  };

  const commitRename = (chat: StandaloneChatSummary) => {
    if (closedRef.current) return;
    closedRef.current = true;
    const next = draft.trim();
    setEditingId(null);
    // 空・変わっていないときは保存しない（題が無い会話は最初の質問が見出しなので、それとも比べる）
    if (!next || next === (chat.title ?? chat.firstQuestion)) return;
    onRename?.(chat.id, next);
  };

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
                      {editingId === chat.id ? (
                        <input
                          type="text"
                          autoFocus
                          value={draft}
                          aria-label={t("standaloneChat.renameLabel")}
                          onChange={(e) => setDraft(e.target.value)}
                          onFocus={(e) => e.currentTarget.select()}
                          onBlur={() => commitRename(chat)}
                          {...compositionHandlers}
                          onKeyDown={(e) => {
                            // IME 変換確定の Enter では確定しない
                            if (e.key === "Enter" && !isImeKey(e)) {
                              e.preventDefault();
                              commitRename(chat);
                            }
                            if (e.key === "Escape") {
                              e.preventDefault();
                              closedRef.current = true;
                              setEditingId(null);
                            }
                          }}
                          className="w-full px-2 py-1 rounded text-xs bg-background border border-primary/50 outline-none text-foreground"
                        />
                      ) : (
                      <>
                      <button
                        onClick={() => onSelect(chat.id)}
                        aria-current={active ? "page" : undefined}
                        title={label}
                        onDoubleClick={onRename ? () => startRename(chat) : undefined}
                        className={`w-full text-left px-2 py-1.5 ${onRename && onDelete ? "pr-12" : "pr-7"} rounded text-xs truncate transition-colors ${
                          active
                            ? "bg-muted text-foreground font-medium"
                            : "text-foreground/80 hover:bg-muted/50 hover:text-foreground"
                        }`}
                      >
                        {label || <span className="text-muted-foreground/40">—</span>}
                      </button>
                      {onRename && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            startRename(chat);
                          }}
                          className={`absolute ${onDelete ? "right-6" : "right-1"} top-1/2 -translate-y-1/2 p-1 rounded opacity-0 group-hover:opacity-100 focus:opacity-100 text-muted-foreground hover:text-foreground transition-all`}
                          aria-label={t("standaloneChat.rename")}
                          data-tooltip={t("standaloneChat.rename")}
                        >
                          <Pencil size={12} />
                        </button>
                      )}
                      {onDelete && (
                        <button
                          onClick={async (e) => {
                            e.stopPropagation();
                            if (!(await confirmAction(t("standaloneChat.deleteConfirm"), { destructive: true }))) return;
                            onDelete(chat.id);
                          }}
                          className="absolute right-1 top-1/2 -translate-y-1/2 p-1 rounded opacity-0 group-hover:opacity-100 focus:opacity-100 text-muted-foreground hover:text-destructive transition-all"
                          aria-label={t("common.delete")}
                          data-tooltip={t("common.delete")}
                        >
                          <Trash2 size={12} />
                        </button>
                      )}
                      </>
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
