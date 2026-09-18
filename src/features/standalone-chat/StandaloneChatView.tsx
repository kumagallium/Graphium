// ノートに紐づかないチャット（standalone chat）1 件の会話画面
//
// 表示だけを受け持つ純粋な部品。AI 呼び出し・保存は呼び出し側（props 経由）で行う。
// メッセージの見た目は src/features/ai-assistant/panel.tsx の ChatBubble を再利用する。
// ナレッジに残す・編集&再実行・回答の再生成・分岐は文書に依存しないので配線する。
// 挿入・置換・派生・「ナレッジにする」（候補ピッカー）は文書に紐づく／未対応のため渡さない。

import { useCallback, useState, type ChangeEvent, type KeyboardEvent } from "react";
import { X, Square, Send } from "lucide-react";
import { Button } from "@ui/button";
import { Textarea } from "@ui/form-field";
import { NavBackButton } from "../../components/NavBackButton";
import { ChatBubble, type SourceLinkHandlers } from "../ai-assistant/panel";
import { useImeEnterGuard } from "../../hooks/use-ime-enter-guard";
import { useT } from "../../i18n";
import { formatShortcut } from "../../lib/shortcut-label";
import type { ChatMessage } from "../../lib/document-types";

export function StandaloneChatView({
  title,
  messages,
  loading,
  error,
  attachedNotes,
  onRemoveAttachedNote,
  onSend,
  onStop,
  onBack,
  aiConfigured = true,
  onSaveAsAnswer,
  onResend,
  onFork,
  onOpenWiki,
  sourceLinks,
}: {
  title?: string;
  messages: ChatMessage[];
  loading: boolean;
  error?: string;
  attachedNotes?: { id: string; title: string; isWiki?: boolean }[];
  onRemoveAttachedNote?: (id: string) => void;
  onSend: (text: string) => void;
  onStop?: () => void;
  onBack: () => void;
  /** AI 未設定のときは送信が成立せず（onSend 側でエラー表示のみ）、入力を消さない */
  aiConfigured?: boolean;
  /** この回答をナレッジ層の「回答」ページとして保存する。成功したら新規ページ id を返す */
  onSaveAsAnswer?: (question: string, answer: string) => Promise<string | null>;
  /** 「編集&再実行」「回答の再生成」共通の巻き戻し送信。rewindIndex 以降を捨てて text から送り直す */
  onResend?: (text: string, rewindIndex: number) => void;
  /** index までを引き継いだ新しい会話に分岐する */
  onFork?: (index: number) => void;
  /** 保存した回答ページを開く。ChatBubble が保存後の「開く」導線に使う */
  onOpenWiki?: (wikiId: string) => void;
  /** [Source: "title"] 引用のリンク化（Wiki / ノート / 素材）。panel.tsx の useSourceLinks と
   *  同じ組み立て。未指定ならプレーンテキストのまま（panel.tsx 側の従来挙動を変えない） */
  sourceLinks?: SourceLinkHandlers;
}) {
  const t = useT();
  const { compositionHandlers, isImeKey } = useImeEnterGuard();
  const [input, setInput] = useState("");

  const firstQuestion = messages.find((m) => m.role === "user")?.content;
  const displayTitle = title || firstQuestion || t("standaloneChat.newChatTitle");

  const handleInputChange = useCallback((e: ChangeEvent<HTMLTextAreaElement>) => {
    setInput(e.target.value);
  }, []);

  const handleSend = useCallback(() => {
    const trimmed = input.trim();
    if (!trimmed || loading) return;
    onSend(trimmed);
    // AI 未設定のときは onSend 側でメッセージを積まずエラー表示だけ行うため、
    // 入力を消すと質問がどこにも残らない（ai-assistant/panel.tsx と同じ判定順）。
    if (aiConfigured) setInput("");
  }, [input, loading, onSend, aiConfigured]);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLTextAreaElement>) => {
      // IME 変換確定の Enter は送信扱いにしない（共通ガード。src/lib/ime-enter.ts 参照）
      if (isImeKey(e)) return;
      if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        handleSend();
      }
    },
    [isImeKey, handleSend],
  );

  // ルートの w-full min-w-0 は、ピークが display:flex の枠に入れるため必要。
  // 幅指定が無いと中身の幅にすぼまって左に寄る（全画面側は元から幅いっぱいなので影響しない）
  return (
    <div className="flex flex-col h-full w-full min-w-0">
      {/* ヘッダー */}
      <div className="px-3 py-2 border-b border-border flex items-center gap-2">
        <NavBackButton onBack={onBack} canGoBack />
        <span className="text-sm font-semibold text-foreground truncate">{displayTitle}</span>
      </div>

      {/* 引用チップ */}
      {attachedNotes && attachedNotes.length > 0 && (
        <div className="px-3 py-2 border-b border-border flex flex-wrap gap-1">
          {attachedNotes.map((note) => (
            <span
              key={note.id}
              className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-xs max-w-[200px] bg-violet-100 dark:bg-violet-900/30 text-violet-700 dark:text-violet-300"
            >
              <span className="truncate">{note.isWiki ? `🤖 ${note.title}` : note.title}</span>
              {onRemoveAttachedNote && (
                <button
                  onClick={() => onRemoveAttachedNote(note.id)}
                  className="shrink-0 hover:text-destructive"
                  aria-label={t("standaloneChat.removeAttachment", { title: note.title })}
                >
                  <X size={9} />
                </button>
              )}
            </span>
          ))}
        </div>
      )}

      {/* メッセージ一覧 */}
      <div className="flex-1 overflow-y-auto px-3 py-2">
        {/* 会話の列は読みやすい幅で止める。ChatBubble は右パネル（320px 級）向けの作りで、
            全画面の幅いっぱいに広げると本文と操作ボタンが左右に離れて浮いて見える。 */}
        <div className="mx-auto w-full max-w-[46rem] space-y-3">
        {messages.length === 0 && !loading && (
          <div className="text-xs text-muted-foreground text-center py-8">
            {t("standaloneChat.startHint")}
          </div>
        )}
        {messages.map((msg, i) => (
          <ChatBubble
            key={i}
            message={msg}
            busy={loading}
            onSaveAsAnswer={
              onSaveAsAnswer && i > 0 && msg.role === "assistant"
                ? () => {
                    const userMsg = messages[i - 1];
                    return userMsg?.role === "user"
                      ? onSaveAsAnswer(userMsg.content, msg.content)
                      : Promise.resolve(null);
                  }
                : undefined
            }
            onEditResend={
              onResend && msg.role === "user" ? (newText) => onResend(newText, i) : undefined
            }
            onRegenerate={
              onResend && msg.role === "assistant" && messages[i - 1]?.role === "user"
                ? () => onResend(messages[i - 1].content, i - 1)
                : undefined
            }
            onFork={onFork && msg.role === "assistant" ? () => onFork(i) : undefined}
            onOpenWiki={onOpenWiki}
            sourceLinks={sourceLinks}
          />
        ))}
        {loading && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground py-2">
            <span className="inline-block w-3 h-3 border-2 border-violet-400/30 border-t-violet-400 rounded-full animate-spin" />
            {t("aiChat.thinking")}
          </div>
        )}
        </div>
      </div>

      {/* 入力エリア */}
      <div className="border-t border-border p-3">
        <div className="mx-auto w-full max-w-[46rem]">
        {error && (
          <div className="bg-destructive/10 border border-destructive/30 rounded-lg p-2 text-xs text-destructive mb-2">
            {error}
          </div>
        )}
        <div className="flex gap-2">
          <Textarea
            value={input}
            onChange={handleInputChange}
            {...compositionHandlers}
            onKeyDown={handleKeyDown}
            placeholder={t("standaloneChat.placeholder")}
            disabled={loading}
            rows={2}
            className="flex-1 text-xs resize-none"
          />
          {loading && onStop ? (
            <Button
              size="sm"
              variant="outline"
              onClick={onStop}
              title={t("standaloneChat.stop")}
              aria-label={t("standaloneChat.stop")}
              className="self-end"
            >
              <Square size={12} className="fill-current" />
            </Button>
          ) : (
            <Button
              size="sm"
              onClick={handleSend}
              disabled={loading || !input.trim()}
              className="self-end"
            >
              <Send size={12} />
            </Button>
          )}
        </div>
        <div className="text-xs text-muted-foreground mt-2">
          {t("standaloneChat.sendHint", { shortcut: formatShortcut(["mod", "Enter"], { macSeparator: "+" }) })}
        </div>
        </div>
      </div>
    </div>
  );
}
