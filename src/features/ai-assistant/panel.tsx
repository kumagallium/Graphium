// AI アシスタント サイドパネル
// 右パネルの Chat タブに表示される継続対話 UI

import { useCallback, useEffect, useRef, useState } from "react";
import { Bot, Send, Trash2, FileDown, FilePlus, List, Replace, AlertCircle, X, AtSign } from "lucide-react";
import { Button } from "@ui/button";
import { Textarea } from "@ui/form-field";
import { useAiAssistant } from "./store";
import { fetchModels } from "./api";
import { ensureSidecar } from "../../lib/sidecar";
import { useT } from "../../i18n";
import type { ChatMessage, ScopeChat } from "../../lib/google-drive";
import type { GraphiumIndex } from "../navigation/index-file";

/** チャットに添付されたノート参照 */
export type AttachedNote = {
  id: string;
  title: string;
  isWiki?: boolean;
};

type AiAssistantPanelProps = {
  /** AI にメッセージを送信する */
  onSubmit: (question: string, attachedNotes?: AttachedNote[]) => void;
  /** AI 回答をスコープ内にブロックとして挿入する */
  onInsertToScope?: (markdown: string) => void;
  /** AI 回答で対象ブロックを置換する */
  onReplaceBlocks?: (markdown: string) => void;
  /** 別ノートとして派生する（従来の buildAiDerivedDocument 動作） */
  onDeriveNote?: (question: string, answer: string) => void;
  /** チャット内容を Knowledge に追加する */
  onIngestChat?: (messages: ChatMessage[]) => void;
  /** ノート/Wiki インデックス（@ メンション候補用） */
  noteIndex?: GraphiumIndex | null;
};

export function AiAssistantPanel({
  onSubmit,
  onInsertToScope,
  onReplaceBlocks,
  onDeriveNote,
  onIngestChat,
  noteIndex,
}: AiAssistantPanelProps) {
  const {
    messages, loading, error, parkChat,
    chats, selectChat, sourceBlockIds, quotedMarkdown,
  } = useAiAssistant();
  const t = useT();
  const [input, setInput] = useState("");
  // "connected" = バックエンド接続済み＆モデルあり
  // "no-models" = バックエンド接続済みだがモデル未登録
  // "no-backend" = バックエンドに接続できない（GitHub Pages 等）
  // null = チェック中
  const [aiStatus, setAiStatus] = useState<"connected" | "no-models" | "no-backend" | null>(null);
  // sourceBlockIds がある = openChat で起動された → 新規チャット画面
  // sourceBlockIds が空 + chats あり = 一覧表示
  const [showChatList, setShowChatList] = useState(
    sourceBlockIds.length === 0 && chats.length > 0
  );
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // @ メンション機能
  const [attachedNotes, setAttachedNotes] = useState<AttachedNote[]>([]);
  const [mentionQuery, setMentionQuery] = useState<string | null>(null);
  const [mentionCursorPos, setMentionCursorPos] = useState(0);
  const [mentionSelectedIdx, setMentionSelectedIdx] = useState(0);
  const mentionMenuRef = useRef<HTMLDivElement>(null);

  // メンション候補を計算
  const mentionSuggestions = (() => {
    if (mentionQuery === null || !noteIndex) return [];
    const q = mentionQuery.toLowerCase();
    const attached = new Set(attachedNotes.map((n) => n.id));
    return noteIndex.notes
      .filter((n) => !attached.has(n.noteId))
      .filter((n) => !q || n.title.toLowerCase().includes(q))
      .sort((a, b) => new Date(b.modifiedAt).getTime() - new Date(a.modifiedAt).getTime())
      .slice(0, 8)
      .map((n) => ({
        id: n.noteId,
        title: n.title,
        isWiki: n.source === "ai",
        kind: n.wikiKind,
      }));
  })();

  // メンション選択を確定する
  const confirmMention = useCallback((note: { id: string; title: string; isWiki?: boolean }) => {
    // テキストから @query 部分を除去
    const textarea = textareaRef.current;
    if (textarea) {
      const before = input.slice(0, mentionCursorPos);
      const atIdx = before.lastIndexOf("@");
      const after = input.slice(textarea.selectionStart);
      setInput(before.slice(0, atIdx) + after);
      // カーソル位置を調整
      setTimeout(() => {
        textarea.selectionStart = textarea.selectionEnd = atIdx;
        textarea.focus();
      }, 0);
    }
    setAttachedNotes((prev) => [...prev, { id: note.id, title: note.title, isWiki: note.isWiki }]);
    setMentionQuery(null);
    setMentionSelectedIdx(0);
  }, [input, mentionCursorPos]);

  // バックエンド接続 + モデル登録状態をチェック（sidecar 死亡時は自動復旧を試みる）
  useEffect(() => {
    const check = async () => {
      // Web モード: localStorage のモデルを確認（サーバーに保存されないため）
      const { isTauri } = await import("../../lib/platform");
      if (!isTauri()) {
        const { getLLMModels } = await import("../settings/store");
        const localModels = getLLMModels();
        setAiStatus(localModels.length > 0 ? "connected" : "no-models");
        return;
      }

      try {
        const res = await fetchModels();
        setAiStatus(res.models.length > 0 ? "connected" : "no-models");
      } catch {
        // sidecar が死んでいたら再起動を試みる
        const recovered = await ensureSidecar();
        if (recovered) {
          try {
            const res = await fetchModels();
            setAiStatus(res.models.length > 0 ? "connected" : "no-models");
            return;
          } catch { /* 復旧後も失敗 */ }
        }
        setAiStatus("no-backend");
      }
    };
    check();
  }, []);

  // 新しいメッセージが追加されたら自動スクロール
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const handleSubmit = useCallback(() => {
    const trimmed = input.trim();
    if (!trimmed || loading) return;
    setInput("");
    onSubmit(trimmed, attachedNotes.length > 0 ? attachedNotes : undefined);
    setAttachedNotes([]);
    setMentionQuery(null);
  }, [input, loading, onSubmit, attachedNotes]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      // メンションメニューが開いている場合
      if (mentionQuery !== null && mentionSuggestions.length > 0) {
        if (e.key === "ArrowDown") {
          e.preventDefault();
          setMentionSelectedIdx((i) => (i + 1) % mentionSuggestions.length);
          return;
        }
        if (e.key === "ArrowUp") {
          e.preventDefault();
          setMentionSelectedIdx((i) => (i - 1 + mentionSuggestions.length) % mentionSuggestions.length);
          return;
        }
        if (e.key === "Enter" || e.key === "Tab") {
          e.preventDefault();
          confirmMention(mentionSuggestions[mentionSelectedIdx]);
          return;
        }
        if (e.key === "Escape") {
          e.preventDefault();
          setMentionQuery(null);
          return;
        }
      }
      if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        handleSubmit();
      }
    },
    [handleSubmit, mentionQuery, mentionSuggestions, mentionSelectedIdx, confirmMention],
  );

  // テキスト入力時の @ 検出
  const handleInputChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      const value = e.target.value;
      setInput(value);

      if (!noteIndex) {
        setMentionQuery(null);
        return;
      }

      const cursorPos = e.target.selectionStart;
      const textBefore = value.slice(0, cursorPos);

      // カーソル前の最後の @ を探す
      const atIdx = textBefore.lastIndexOf("@");
      if (atIdx >= 0) {
        // @ の直前が空白・行頭であること（単語途中の @ は無視）
        const charBefore = atIdx > 0 ? textBefore[atIdx - 1] : " ";
        if (/[\s]/.test(charBefore) || atIdx === 0) {
          const query = textBefore.slice(atIdx + 1);
          // クエリにスペースが2つ以上あるか、改行がある → メンション終了
          if (!/\n/.test(query) && (query.match(/ /g) || []).length <= 1) {
            setMentionQuery(query);
            setMentionCursorPos(cursorPos);
            setMentionSelectedIdx(0);
            return;
          }
        }
      }
      setMentionQuery(null);
    },
    [noteIndex],
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
          {messages.length > 0 && onIngestChat && (
            <button
              onClick={() => onIngestChat(messages)}
              title="Add to Knowledge"
              className="p-1 rounded text-muted-foreground hover:text-primary hover:bg-primary/10 transition-colors"
            >
              <Bot size={12} />
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

      {/* AI 利用不可バナー */}
      {aiStatus === "no-backend" && (
        <div className="px-3 py-2.5 border-b border-border bg-muted/50">
          <div className="flex items-start gap-2 text-xs text-muted-foreground">
            <AlertCircle size={14} className="mt-0.5 shrink-0" />
            <span>{t("aiChat.noBackend")}</span>
          </div>
        </div>
      )}
      {aiStatus === "no-models" && (
        <div className="px-3 py-2.5 border-b border-amber-200 bg-amber-50 dark:bg-amber-950/20 dark:border-amber-800">
          <div className="flex items-start gap-2 text-xs text-amber-700 dark:text-amber-400">
            <AlertCircle size={14} className="mt-0.5 shrink-0" />
            <span>{t("settings.aiNotConfigured")}</span>
          </div>
        </div>
      )}

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
            {/* 添付ノートバッジ */}
            {attachedNotes.length > 0 && (
              <div className="flex flex-wrap gap-1 mb-2">
                {attachedNotes.map((note) => (
                  <span
                    key={note.id}
                    className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-violet-100 dark:bg-violet-900/30 text-[10px] text-violet-700 dark:text-violet-300 max-w-[160px]"
                  >
                    <AtSign size={9} className="shrink-0" />
                    <span className="truncate">{note.isWiki ? `🤖 ${note.title}` : note.title}</span>
                    <button
                      onClick={() => setAttachedNotes((prev) => prev.filter((n) => n.id !== note.id))}
                      className="shrink-0 hover:text-destructive"
                    >
                      <X size={9} />
                    </button>
                  </span>
                ))}
              </div>
            )}
            {/* メンション候補メニュー */}
            {mentionQuery !== null && mentionSuggestions.length > 0 && (
              <div
                ref={mentionMenuRef}
                className="mb-2 border border-border rounded-lg bg-popover shadow-md overflow-hidden max-h-48 overflow-y-auto"
              >
                {mentionSuggestions.map((s, i) => (
                  <button
                    key={s.id}
                    onClick={() => confirmMention(s)}
                    className={`w-full text-left px-3 py-1.5 text-xs flex items-center gap-2 transition-colors ${
                      i === mentionSelectedIdx
                        ? "bg-accent text-accent-foreground"
                        : "hover:bg-muted"
                    }`}
                  >
                    {s.isWiki ? (
                      <Bot size={11} className="shrink-0 text-violet-500" />
                    ) : (
                      <AtSign size={11} className="shrink-0 text-muted-foreground" />
                    )}
                    <span className="truncate">
                      {s.isWiki ? `${s.kind === "summary" ? "Summary" : "Concept"}: ${s.title}` : s.title}
                    </span>
                  </button>
                ))}
              </div>
            )}
            <div className="flex gap-2">
              <Textarea
                ref={textareaRef}
                value={input}
                onChange={handleInputChange}
                onKeyDown={handleKeyDown}
                placeholder={noteIndex ? t("aiChat.placeholder") + "  (@でページ参照)" : t("aiChat.placeholder")}
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
