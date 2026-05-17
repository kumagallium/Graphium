// AI アシスタント サイドパネル
// 右パネルの Chat タブに表示される継続対話 UI

import { Children, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Bot, BookPlus, Send, Trash2, FileDown, FilePlus, List, Replace, AlertCircle, X, AtSign, Info } from "lucide-react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { Button } from "@ui/button";
import { Textarea } from "@ui/form-field";
import { useAiAssistant } from "./store";
import { getWikiTitleToIdMap } from "../wiki/retriever";
import { fetchModels } from "./api";
import { ensureSidecar } from "../../lib/sidecar";
import { AiBackendDiagnostic } from "./AiBackendDiagnostic";
import { useT } from "../../i18n";
import type { ChatMessage, ScopeChat } from "../../lib/document-types";
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
  /** Wiki ノートを開く（[Source: "title"] 引用クリック時の遷移先） */
  onOpenWiki?: (wikiId: string) => void;
};

export function AiAssistantPanel({
  onSubmit,
  onInsertToScope,
  onReplaceBlocks,
  onDeriveNote,
  onIngestChat,
  noteIndex,
  onOpenWiki,
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

  // [Source: "title"] 引用クリック用にタイトル→wikiId マップを構築。
  // Retriever が LLM に渡したのと同じタイトル空間を使う（noteIndex に wiki が無くても動く）。
  // messages 更新で再計算（最新応答が含む新規 wiki のために）。
  const wikiTitleToId = useMemo(() => {
    const map = getWikiTitleToIdMap();
    // noteIndex に wiki エントリがある場合はそれもマージ（重複時は noteIndex 優先）
    if (noteIndex) {
      for (const n of noteIndex.notes) {
        if (n.wikiKind && n.title) map.set(n.title, n.noteId);
      }
    }
    return map;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [noteIndex, messages.length]);

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

  // メッセージが追加されたら会話ビューに戻す。
  // Cmd+K Composer からの送信のように、チャット一覧を表示中でも外部からメッセージが
  // 追加される経路があるため、messages が 0→N に変化したら showChatList を下ろす。
  useEffect(() => {
    if (messages.length > 0) setShowChatList(false);
  }, [messages.length]);

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

  // 診断 UI 手動展開（接続できているように見えても、検証者が
  // バックエンド情報をコピーできる経路を用意しておく）
  const [showManualDiag, setShowManualDiag] = useState(false);
  const aiStatusForCtx = aiStatus;
  const buildDiagContext = useCallback(
    () => `aiStatus=${aiStatusForCtx ?? "checking"}`,
    [aiStatusForCtx],
  );

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
              <BookPlus size={12} />
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
          {/* 診断 UI を任意のタイミングで開ける入口（接続成功時にも検証情報を吸い出せる） */}
          <button
            onClick={() => setShowManualDiag((v) => !v)}
            title={t("aiChat.diagnostics")}
            className={`p-1 rounded transition-colors ${
              showManualDiag
                ? "bg-muted text-foreground"
                : "text-muted-foreground hover:text-foreground hover:bg-muted"
            }`}
          >
            <Info size={12} />
          </button>
        </div>
      </div>

      {/* ヘッダーの (i) からいつでも開ける診断 UI */}
      {showManualDiag && (
        <AiBackendDiagnostic
          variant="manual"
          onClose={() => setShowManualDiag(false)}
          onRecovered={(next) => setAiStatus(next)}
          extraContext={buildDiagContext}
        />
      )}

      {/* AI 利用不可バナー（sidecar 起動失敗時は診断 UI を自動表示） */}
      {aiStatus === "no-backend" && !showManualDiag && (
        <AiBackendDiagnostic
          onRecovered={(next) => setAiStatus(next)}
          extraContext={buildDiagContext}
        />
      )}
      {aiStatus === "no-models" && (
        <div className="px-3 py-2.5 border-b border-amber-200 bg-amber-50 dark:bg-amber-950/20 dark:border-amber-800">
          <div className="flex items-start gap-2 text-xs text-amber-700 dark:text-amber-400">
            <AlertCircle size={14} className="mt-0.5 shrink-0" />
            <span>{t("settings.aiNotConfigured")}</span>
          </div>
        </div>
      )}

      {/* 引用表示（会話開始後も「何を引用したか」が分かるように残す） */}
      {quotedMarkdown && !showChatList && (
        <div className="px-3 py-2 border-b border-border">
          <div className="text-xs text-muted-foreground mb-1">{t("aiChat.quote")}</div>
          <div className="bg-muted/50 rounded p-2 text-xs text-foreground/70 max-h-20 overflow-y-auto whitespace-pre-wrap font-mono leading-relaxed">
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
                wikiTitleToId={wikiTitleToId}
                onOpenWiki={onOpenWiki}
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
                    className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-violet-100 dark:bg-violet-900/30 text-xs text-violet-700 dark:text-violet-300 max-w-[160px]"
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
            <div className="text-xs text-muted-foreground mt-1">
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
        {[...chats].sort((a, b) => new Date(b.modifiedAt).getTime() - new Date(a.modifiedAt).getTime()).map((chat) => {
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
                {scopeLabel && <span className={`text-xs font-medium truncate ${isPageChat ? "text-emerald-600" : "text-violet-600"}`}>{scopeLabel}</span>}
                <span className="text-xs text-muted-foreground ml-auto shrink-0">{date}</span>
              </div>
              <div className="text-sm text-foreground/70 truncate">{preview}</div>
              <div className="text-xs text-muted-foreground">{t("aiChat.messageCount", { count: String(chat.messages.length) })}</div>
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
  wikiTitleToId,
  onOpenWiki,
}: {
  message: ChatMessage;
  onInsert?: (markdown: string) => void;
  onReplace?: (markdown: string) => void;
  onDerive?: () => void;
  wikiTitleToId?: Map<string, string>;
  onOpenWiki?: (wikiId: string) => void;
}) {
  const t = useT();
  const isUser = message.role === "user";
  // 表示用にノイズを除去する（生データは message.content に残し、ノート挿入時はそちらを使う）:
  //   - [[label:xxx]]      … ノート挿入時に消費する PROV ラベルマーカー
  //   - [[m]]X[[/m]] 等    … PROV inline label（material / tool / activity / output）。
  //                          BlockNote に貼られた時にスタイル付けされるが、人間の閲覧時はノイズ。
  const displayContent = isUser
    ? message.content
    : stripDisplayMarkers(message.content);
  return (
    <div className={`flex flex-col ${isUser ? "items-end" : "items-start"}`}>
      <div
        className={`rounded-lg px-3 py-2 text-sm max-w-[90%] leading-relaxed ${
          isUser ? "whitespace-pre-wrap" : ""
        } ${
          isUser
            ? "bg-primary text-primary-foreground"
            : "bg-muted text-foreground"
        }`}
      >
        {isUser ? (
          displayContent
        ) : (
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            components={buildMarkdownComponents(wikiTitleToId, onOpenWiki)}
          >
            {displayContent}
          </ReactMarkdown>
        )}
      </div>
      {!isUser && (onInsert || onReplace || onDerive) && (
        <div className="flex gap-1 mt-1 flex-wrap">
          {onReplace && (
            <button
              onClick={() => onReplace(message.content)}
              title={t("aiChat.replaceInNote")}
              className="flex items-center gap-1 px-1.5 py-0.5 text-xs text-blue-600 hover:text-blue-700 rounded hover:bg-blue-50 transition-colors font-medium"
            >
              <Replace size={10} />
              {t("aiChat.replaceInNote")}
            </button>
          )}
          {onInsert && (
            <button
              onClick={() => onInsert(message.content)}
              title={t("aiChat.insertToNote")}
              className="flex items-center gap-1 px-1.5 py-0.5 text-xs text-muted-foreground hover:text-foreground rounded hover:bg-muted transition-colors"
            >
              <FileDown size={10} />
              {t("aiChat.insertToNote")}
            </button>
          )}
          {onDerive && (
            <button
              onClick={onDerive}
              title={t("aiChat.deriveAsNote")}
              className="flex items-center gap-1 px-1.5 py-0.5 text-xs text-muted-foreground hover:text-foreground rounded hover:bg-muted transition-colors"
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

/**
 * チャット表示用にノイジーな内部マーカーを除去する。
 * 生メッセージは別に保持され、ノートにペースト/挿入する際にはそのまま使う。
 */
function stripDisplayMarkers(content: string): string {
  return content
    // 行頭の `[[label:xxx]]` マーカー（ノート挿入時にラベルへ変換される）
    .replace(/\[\[label:[a-z]+\]\][ 　]?/g, "")
    // PROV inline label: [[m]]X[[/m]] / [[t]] / [[a]] / [[o]] → 中身だけ残す
    .replace(/\[\[(m|t|a|o)\]\]([\s\S]*?)\[\[\/\1\]\]/g, "$2");
}

/**
 * テキストノード内の `[Source: "title"]` をクリック可能な Wiki リンクに置換する。
 * react-markdown のカスタムコンポーネントから children を再帰的に処理するために使う。
 */
function replaceSourceLinks(
  text: string,
  wikiTitleToId: Map<string, string> | undefined,
  onOpenWiki: ((wikiId: string) => void) | undefined,
  keyPrefix: string,
): ReactNode[] {
  if (!text.includes("[Source:") || !wikiTitleToId || !onOpenWiki || wikiTitleToId.size === 0) {
    return [text];
  }
  const pattern = /\[Source:\s*"([^"]+)"\]/g;
  const parts: ReactNode[] = [];
  let lastIdx = 0;
  let match: RegExpExecArray | null;
  let n = 0;
  while ((match = pattern.exec(text)) !== null) {
    if (match.index > lastIdx) parts.push(text.slice(lastIdx, match.index));
    const title = match[1];
    const wikiId = wikiTitleToId.get(title);
    if (wikiId) {
      parts.push(
        <button
          key={`${keyPrefix}-src-${n++}`}
          type="button"
          onClick={(e) => { e.stopPropagation(); onOpenWiki(wikiId); }}
          title={`Open Wiki: ${title}`}
          className="inline-flex items-center gap-0.5 px-1 mx-0.5 text-xs text-violet-700 hover:text-violet-900 underline decoration-dotted underline-offset-2 hover:bg-violet-50 rounded transition-colors align-baseline"
        >
          📎{title}
        </button>,
      );
    } else {
      parts.push(match[0]);
    }
    lastIdx = pattern.lastIndex;
  }
  if (lastIdx < text.length) parts.push(text.slice(lastIdx));
  return parts;
}

/** react-markdown の children を走査し、文字列ノードに replaceSourceLinks を適用する */
function processChildren(
  children: ReactNode,
  wikiTitleToId: Map<string, string> | undefined,
  onOpenWiki: ((wikiId: string) => void) | undefined,
): ReactNode {
  return Children.map(children, (child, i) => {
    if (typeof child === "string") {
      return <>{replaceSourceLinks(child, wikiTitleToId, onOpenWiki, `c${i}`)}</>;
    }
    return child;
  });
}

/**
 * チャット用 markdown のカスタムレンダラ。
 * - 既存の bubble に収まるよう見出し・段落の余白を抑える
 * - テキストノード内の [Source: "..."] を Wiki リンクに変換
 */
function buildMarkdownComponents(
  wikiTitleToId: Map<string, string> | undefined,
  onOpenWiki: ((wikiId: string) => void) | undefined,
): Components {
  const proc = (children: ReactNode) => processChildren(children, wikiTitleToId, onOpenWiki);
  return {
    h1: ({ children }) => <h1 className="text-base font-semibold mt-2 mb-1">{proc(children)}</h1>,
    h2: ({ children }) => <h2 className="text-sm font-semibold mt-2 mb-1">{proc(children)}</h2>,
    h3: ({ children }) => <h3 className="text-sm font-semibold mt-1.5 mb-0.5">{proc(children)}</h3>,
    h4: ({ children }) => <h4 className="text-sm font-semibold mt-1.5 mb-0.5">{proc(children)}</h4>,
    h5: ({ children }) => <h5 className="text-sm font-semibold mt-1 mb-0.5">{proc(children)}</h5>,
    h6: ({ children }) => <h6 className="text-sm font-semibold mt-1 mb-0.5">{proc(children)}</h6>,
    p: ({ children }) => <p className="my-1.5 first:mt-0 last:mb-0">{proc(children)}</p>,
    ul: ({ children }) => <ul className="list-disc pl-5 my-1.5 space-y-0.5">{children}</ul>,
    ol: ({ children }) => <ol className="list-decimal pl-5 my-1.5 space-y-0.5">{children}</ol>,
    li: ({ children }) => <li>{proc(children)}</li>,
    strong: ({ children }) => <strong className="font-semibold">{proc(children)}</strong>,
    em: ({ children }) => <em className="italic">{proc(children)}</em>,
    hr: () => <hr className="my-2 border-t border-border" />,
    blockquote: ({ children }) => (
      <blockquote className="border-l-2 border-border pl-2 my-1.5 text-muted-foreground">{children}</blockquote>
    ),
    code: ({ children, className }) => {
      // インラインコードのみここで装飾。pre 内の code は pre 側で扱う。
      if (className) return <code className={className}>{children}</code>;
      return <code className="px-1 py-0.5 rounded bg-background/60 text-xs font-mono">{children}</code>;
    },
    pre: ({ children }) => (
      <pre className="my-1.5 p-2 rounded bg-background/60 text-xs font-mono overflow-x-auto">{children}</pre>
    ),
    a: ({ children, href }) => (
      <a href={href} target="_blank" rel="noopener noreferrer" className="text-blue-600 underline hover:text-blue-800">
        {proc(children)}
      </a>
    ),
    table: ({ children }) => (
      <div className="my-1.5 overflow-x-auto">
        <table className="text-xs border-collapse">{children}</table>
      </div>
    ),
    th: ({ children }) => <th className="border border-border px-1.5 py-0.5 font-semibold text-left">{proc(children)}</th>,
    td: ({ children }) => <td className="border border-border px-1.5 py-0.5">{proc(children)}</td>,
  };
}
