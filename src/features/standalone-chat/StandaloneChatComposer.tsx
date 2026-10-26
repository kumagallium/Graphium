// ノートに紐づかないチャットの入力欄。
//
// 一覧の先頭（「新しいチャット」をここから始める）と、会話画面の下（続きを送る）の
// 2 か所で同じ部品を使う。開いた一覧の入力欄が、そのまま会話画面の下へ移ったように
// 見えるよう、見た目は 1 つに揃える。送信・停止・エラー表示・渡す範囲チップ・
// Web 検索未設定の警告までをここで持ち、AI 呼び出しと保存は呼び出し側に任せる。

import { useCallback, useState, type ChangeEvent, type KeyboardEvent } from "react";
import { Square, Send } from "lucide-react";
import { Button } from "@ui/button";
import { Textarea } from "@ui/form-field";
import { GroundingScopeChip } from "../composer/GroundingScopeChip";
import { WebSearchMissingHint } from "../composer/WebSearchMissingHint";
import { useWebSearchAvailability } from "../composer/use-web-search-availability";
import { useImeEnterGuard } from "../../hooks/use-ime-enter-guard";
import { useT } from "../../i18n";
import { formatShortcut } from "../../lib/shortcut-label";
import type { GroundingScope } from "../../lib/grounding-scope";
import { DEFAULT_STANDALONE_CHAT_SCOPE, STANDALONE_CHAT_SCOPES } from "./scope";

export function StandaloneChatComposer({
  onSend,
  loading = false,
  onStop,
  error,
  aiConfigured = true,
  scope = DEFAULT_STANDALONE_CHAT_SCOPE,
  onScopeChange,
  autoFocus = false,
}: {
  onSend: (text: string) => void;
  /** 応答待ち。入力を止め、onStop があれば送信ボタンを停止に置き換える */
  loading?: boolean;
  onStop?: () => void;
  error?: string;
  /** AI 未設定のときは送信が成立せず（onSend 側でエラー表示のみ）、入力を消さない */
  aiConfigured?: boolean;
  /** 渡す範囲（外部参照 / 内部参照）。値は呼び出し側が持つ */
  scope?: GroundingScope;
  /** チップで渡す範囲を切り替えたとき。未指定ならチップを出さない */
  onScopeChange?: (scope: GroundingScope) => void;
  /** 一覧の先頭に置くときは開いた直後から打てるようにする */
  autoFocus?: boolean;
}) {
  const t = useT();
  const { compositionHandlers, isImeKey } = useImeEnterGuard();
  const [input, setInput] = useState("");
  // 外部参照なのに Web 検索手段が無い構成への警告（ai-assistant/panel.tsx と同じ付属品）
  const webSearch = useWebSearchAvailability(!!onScopeChange && scope === "external");
  const [webSearchHintDismissed, setWebSearchHintDismissed] = useState(false);

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

  return (
    <div className="w-full min-w-0">
      {error && (
        <div className="bg-destructive/10 border border-destructive/30 rounded-lg p-2 text-xs text-destructive mb-2">
          {error}
        </div>
      )}
      {/* 外部参照なのに Web 検索手段が無い構成への警告。入力の直上に出し、× で閉じられる */}
      {onScopeChange && scope === "external" && webSearch === "missing" && !webSearchHintDismissed && (
        <div className="mb-2">
          <WebSearchMissingHint onDismiss={() => setWebSearchHintDismissed(true)} />
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
          autoFocus={autoFocus}
          className="flex-1 text-xs resize-none"
        />
        {loading && onStop ? (
          <Button
            size="sm"
            variant="outline"
            onClick={onStop}
            data-tooltip={t("standaloneChat.stop")}
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
      {/* 送信ヒントの右に渡す範囲チップ（ノート内チャットの右パネルと同じ置き場）。
          ピーク（320px 級）ではチップが縮まないので 2 行目に折り返す */}
      <div className="text-xs text-muted-foreground mt-2 flex flex-wrap items-center justify-between gap-3">
        <span>{t("standaloneChat.sendHint", { shortcut: formatShortcut(["mod", "Enter"], { macSeparator: "+" }) })}</span>
        {onScopeChange && (
          <span className="ml-auto">
            <GroundingScopeChip value={scope} onChange={onScopeChange} scopes={STANDALONE_CHAT_SCOPES} />
          </span>
        )}
      </div>
    </div>
  );
}
