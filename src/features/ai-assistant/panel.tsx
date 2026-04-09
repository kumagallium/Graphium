// AI アシスタント サイドパネル
// 右パネルの Chat タブに表示される継続対話 UI

import { useCallback, useEffect, useRef, useState } from "react";
import { Bot, Send, Trash2, FileDown, FilePlus, List, Replace } from "lucide-react";
import { Button } from "@ui/button";
import { Textarea } from "@ui/form-field";
import { useAiAssistant } from "./store";
import { useT } from "../../i18n";
import type { ChatMessage, ScopeChat } from "../../lib/google-drive";

type AiAssistantPanelProps = {
  /** AI にメッセージを送信する */
  onSubmit: (question: string) => void;
  /** AI 回答をスコープ内にブロックとして挿入する */
  onInsertToScope?: (markdown: string) => void;
  /** AI 回答で対象ブロックを置換する */
  onReplaceBlocks?: (markdown: string) => void;
  /** 別ノートとして派生する（従来の buildAiDerivedDocument 動作） */
  onDeriveNote?: (question: string, answer: string) => void;
};

export function AiAssistantPanel({
  onSubmit,
  onInsertToScope,
  onReplaceBlocks,
  onDeriveNote,
}: AiAssistantPanelProps) {
  const {
    messages, loading, error, parkChat,
    chats, selectChat, sourceBlockIds, quotedMarkdown,
  } = useAiAssistant();
  const t = useT();
  const [input, setInput] = useState("");
  // sourceBlockIds がある = openChat で起動された → 新規チャット画面
  // sourceBlockIds が空 + chats あり = 一覧表示
  const [showChatList, setShowChatList] = useState(
    sourceBlockIds.length === 0 && chats.length > 0
  );
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // 新しいメッセージが追加されたら自動スクロール
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const handleSubmit = useCallback(() => {
    const trimmed = input.trim();
    if (!trimmed || loading) return;
    setInput("");
    onSubmit(trimmed);
  }, [input, loading, onSubmit]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        handleSubmit();
      }
    },
    [handleSubmit],
  );

  const handleSelectChat = useCallback(
    (chatId: string) => {
      selectChat(chatId);
      setShowChatList(false);
    },
    [selectChat],
  );

  // 引用元ブロックがある → 置換ボタンを表示
  const canReplace = sourceBlockIds.length > 0 && !!onReplaceBlocks;

  return (
    <div className="flex flex-col h-full">
      {/* ヘッダー */}
      <div className="px-3 py-2 border-b border-border flex items-center gap-2">
        <Bot size={14} className="text-violet-500" />
        <span className="text-xs font-semibold text-foreground">{t("aiChat.title")}</span>
        <div className="ml-auto flex items-center gap-1">
          {chats.length > 0 && !showChatList && (
            <button
              onClick={() => { parkChat(); setShowChatList(true); }}
              title={t("aiChat.history")}
              className="p-1 rounded text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
            >
              <List size={12} />
            </button>
          )}
          {messages.length > 0 && (
            <button
              onClick={() => { parkChat(); setShowChatList(true); }}
              title={t("aiChat.clearChat")}
              className="p-1 rounded text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
            >
              <Trash2 size={12} />
            </button>
          )}
        </div>
      </div>

      {/* 引用表示 */}
      {quotedMarkdown && messages.length === 0 && !showChatList && (
        <div className="px-3 py-2 border-b border-border">
          <div className="text-[10px] text-muted-foreground mb-1">{t("aiChat.quote")}</div>
          <div className="bg-muted/50 rounded p-2 text-[11px] text-foreground/70 max-h-20 overflow-y-auto whitespace-pre-wrap font-mono leading-relaxed">
            {quotedMarkdown}
          </div>
        </div>
      )}

      {/* チャット一覧 */}
      {showChatList ? (
        <ChatListView
          chats={chats}
          onSelect={handleSelectChat}
          onNewChat={() => setShowChatList(false)}
        />
      ) : (
        <>
          {/* メッセージ一覧 */}
          <div className="flex-1 overflow-y-auto px-3 py-2 space-y-3">
            {messages.length === 0 && !loading && (
              <div className="text-xs text-muted-foreground text-center py-8">
                {t("aiChat.helpText").split("\n").map((line, i) => <span key={i}>{line}<br /></span>)}
              </div>
            )}
            {messages.map((msg, i) => (
              <ChatBubble
                key={i}
                message={msg}
                onInsert={onInsertToScope}
                onReplace={canReplace ? onReplaceBlocks : undefined}
                onDerive={
                  onDeriveNote && i > 0 && msg.role === "assistant"
                    ? () => {
                        const userMsg = messages[i - 1];
                        if (userMsg?.role === "user") {
                          onDeriveNote(userMsg.content, msg.content);
                        }
                      }
                    : undefined
                }
              />
            ))}
            {loading && (
              <div className="flex items-center gap-2 text-xs text-muted-foreground py-2">
                <span className="inline-block w-3 h-3 border-2 border-violet-400/30 border-t-violet-400 rounded-full animate-spin" />
                {t("aiChat.thinking")}
              </div>
            )}
            {error && (
              <div className="bg-destructive/10 border border-destructive/30 rounded-lg p-2 text-xs text-destructive">
                {error}
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>

          {/* 入力エリア */}
          <div className="border-t border-border p-3">
            <div className="flex gap-2">
              <Textarea
                ref={textareaRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder={t("aiChat.placeholder")}
                disabled={loading}
                rows={2}
                className="flex-1 text-xs resize-none"
              />
              <Button
                size="sm"
                onClick={handleSubmit}
                disabled={loading || !input.trim()}
                className="self-end"
              >
                <Send size={12} />
              </Button>
            </div>
            <div className="text-[10px] text-muted-foreground mt-1">
              {t("aiChat.sendHint")}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

// チャット一覧ビュー
function ChatListView({
  chats,
  onSelect,
  onNewChat,
}: {
  chats: ScopeChat[];
  onSelect: (chatId: string) => void;
  onNewChat: () => void;
}) {
  const t = useT();
  return (
    <div className="flex-1 overflow-y-auto">
      <div className="px-3 py-2">
        <button
          onClick={onNewChat}
          className="w-full text-left px-3 py-2 rounded-lg border border-dashed border-border text-xs text-muted-foreground hover:text-foreground hover:border-foreground/30 transition-colors mb-2"
        >
          {t("aiChat.newChat")}
        </button>
        {chats.map((chat) => {
          const isPageChat = chat.scopeType === "page";
          const scopeLabel = isPageChat
            ? t("aiChat.pageScope")
            : chat.scopeBlockId ? chat.scopeBlockId.slice(0, 8) : "";
          const firstUserMsg = chat.messages.find((m) => m.role === "user");
          const preview = firstUserMsg?.content.slice(0, 60) || t("aiChat.emptyChat");
          const date = new Date(chat.modifiedAt).toLocaleDateString("ja-JP", {
            month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
          });
          return (
            <button
              key={chat.id}
              onClick={() => onSelect(chat.id)}
              className="w-full text-left px-3 py-2 rounded-lg hover:bg-background transition-colors mb-1"
            >
              <div className="flex items-center gap-1.5 mb-0.5">
                {scopeLabel && <span className={`text-[10px] font-medium truncate ${isPageChat ? "text-emerald-600" : "text-violet-600"}`}>{scopeLabel}</span>}
                <span className="text-[10px] text-muted-foreground ml-auto shrink-0">{date}</span>
              </div>
              <div className="text-xs text-foreground/70 truncate">{preview}</div>
              <div className="text-[10px] text-muted-foreground">{t("aiChat.messageCount", { count: String(chat.messages.length) })}</div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

// チャットバブルコンポーネント
function ChatBubble({
  message,
  onInsert,
  onReplace,
  onDerive,
}: {
  message: ChatMessage;
  onInsert?: (markdown: string) => void;
  onReplace?: (markdown: string) => void;
  onDerive?: () => void;
}) {
  const t = useT();
  const isUser = message.role === "user";
  return (
    <div className={`flex flex-col ${isUser ? "items-end" : "items-start"}`}>
      <div
        className={`rounded-lg px-3 py-2 text-xs max-w-[90%] whitespace-pre-wrap ${
          isUser
            ? "bg-primary text-primary-foreground"
            : "bg-muted text-foreground"
        }`}
      >
        {message.content}
      </div>
      {!isUser && (onInsert || onReplace || onDerive) && (
        <div className="flex gap-1 mt-1 flex-wrap">
          {onReplace && (
            <button
              onClick={() => onReplace(message.content)}
              title={t("aiChat.replaceInNote")}
              className="flex items-center gap-1 px-1.5 py-0.5 text-[10px] text-blue-600 hover:text-blue-700 rounded hover:bg-blue-50 transition-colors font-medium"
            >
              <Replace size={10} />
              {t("aiChat.replaceInNote")}
            </button>
          )}
          {onInsert && (
            <button
              onClick={() => onInsert(message.content)}
              title={t("aiChat.insertToNote")}
              className="flex items-center gap-1 px-1.5 py-0.5 text-[10px] text-muted-foreground hover:text-foreground rounded hover:bg-muted transition-colors"
            >
              <FileDown size={10} />
              {t("aiChat.insertToNote")}
            </button>
          )}
          {onDerive && (
            <button
              onClick={onDerive}
              title={t("aiChat.deriveAsNote")}
              className="flex items-center gap-1 px-1.5 py-0.5 text-[10px] text-muted-foreground hover:text-foreground rounded hover:bg-muted transition-colors"
            >
              <FilePlus size={10} />
              {t("aiChat.deriveAsNote")}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
