// ノートに紐づかないチャットの画面（子ナビ + 会話）。
//
// 左サイドバーの「チャット」を開いた本文領域を、左列の子ナビ（StandaloneChatNav）と
// 右の会話（StandaloneChatView）の 2 列にする。ChatGPT / Claude のチャット画面と同じ
// 並びで、一覧 → ピーク → 全画面の往復は無い。会話が選ばれていないときは
// 「新しいチャット」として入力欄が中央に出る（StandaloneChatView の空状態）。
//
// 狭い画面（md 未満）では 1 列ずつ: 子ナビを出し、選ぶと会話に切り替わり、戻るで子ナビへ。
// 表示だけを受け持ち、読み込み・保存・AI 呼び出しは呼び出し側（props）が行う。

import { useEffect, useState } from "react";
import { PanelLeft } from "lucide-react";
import { Breadcrumb } from "../../components/Breadcrumb";
import { useIsDesktop } from "../../hooks/use-media-query";
import { useT } from "../../i18n";
import type { GroundingScope } from "../../lib/grounding-scope";
import type { SourceLinkHandlers } from "../ai-assistant/panel";
import { StandaloneChatNav } from "./StandaloneChatNav";
import { StandaloneChatView } from "./StandaloneChatView";
import { DEFAULT_STANDALONE_CHAT_SCOPE, toStandaloneChatScope } from "./scope";
import type { StandaloneChat, StandaloneChatSummary } from "./types";

export function StandaloneChatWorkspace({
  chats,
  activeChatId,
  activeChat,
  loading,
  error,
  onSelectChat,
  onNewChat,
  onDeleteChat,
  onSend,
  onStop,
  onScopeChange,
  onHome,
  aiConfigured = true,
  attachedNotes,
  onRemoveAttachedNote,
  onSaveAsAnswer,
  onResend,
  onFork,
  onOpenWiki,
  sourceLinks,
  now,
}: {
  chats: StandaloneChatSummary[];
  /** 選択中の会話 id。null なら「新しいチャット」（まだ保存されていない） */
  activeChatId: string | null;
  /** 選択中の会話の全文。id があるのに null なら読み込み中 */
  activeChat: StandaloneChat | null;
  loading: boolean;
  error?: string;
  onSelectChat: (chatId: string) => void;
  onNewChat: () => void;
  onDeleteChat?: (chatId: string) => void;
  /** 送信。会話が無い（新しいチャット）ときは呼び出し側が会話を作ってから送る */
  onSend: (text: string, scope: GroundingScope) => void;
  onStop?: () => void;
  /** 選択中の会話の渡す範囲を変えたとき。未選択時の値はこの部品が持つ */
  onScopeChange: (scope: GroundingScope) => void;
  /** パンくずの「ホーム」 */
  onHome?: () => void;
  aiConfigured?: boolean;
  attachedNotes?: { id: string; title: string; isWiki?: boolean }[];
  onRemoveAttachedNote?: (id: string) => void;
  onSaveAsAnswer?: (question: string, answer: string) => Promise<string | null>;
  onResend?: (text: string, rewindIndex: number) => void;
  onFork?: (index: number) => void;
  onOpenWiki?: (wikiId: string) => void;
  sourceLinks?: SourceLinkHandlers;
  /** 子ナビの日付グループの基準時刻（ストーリー用） */
  now?: Date;
}) {
  const t = useT();
  const isDesktop = useIsDesktop();
  const [navOpen, setNavOpen] = useState(true);
  // 狭い画面での表示面。会話が外から選ばれたら（⌘K・URL）会話面に切り替える
  const [mobilePane, setMobilePane] = useState<"nav" | "chat">(activeChatId ? "chat" : "nav");
  useEffect(() => {
    if (activeChatId) setMobilePane("chat");
  }, [activeChatId]);
  // まだ会話が無いときの渡す範囲。会話ができたら会話側（StandaloneChat.scope）が持つ
  const [draftScope, setDraftScope] = useState<GroundingScope>(DEFAULT_STANDALONE_CHAT_SCOPE);
  const scope = activeChat ? toStandaloneChatScope(activeChat.scope) : draftScope;
  const handleScopeChange = (next: GroundingScope) => {
    if (activeChat) onScopeChange(next);
    else setDraftScope(next);
  };

  const showNav = isDesktop ? navOpen : mobilePane === "nav";
  const showChat = isDesktop || mobilePane === "chat";

  return (
    <div className="flex-1 flex flex-col overflow-hidden bg-background">
      {/* ヘッダー: 子ナビの開閉 + パンくず（他の一覧画面と同じ高さ・余白） */}
      <div className="flex items-center gap-3 px-4 md:px-6 py-4 border-b border-border">
        {isDesktop && (
          <button
            onClick={() => setNavOpen((v) => !v)}
            aria-pressed={navOpen}
            aria-label={navOpen ? t("standaloneChat.hideNav") : t("standaloneChat.showNav")}
            data-tooltip={navOpen ? t("standaloneChat.hideNav") : t("standaloneChat.showNav")}
            className="p-1 rounded text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
          >
            <PanelLeft size={16} />
          </button>
        )}
        <Breadcrumb items={[{ label: t("nav.home"), onClick: onHome }, { label: t("sidebar.chat") }]} />
      </div>

      <div className="flex-1 flex min-h-0">
        {showNav && (
          <aside className={`${isDesktop ? "w-60 shrink-0 border-r border-border" : "flex-1"} min-h-0 bg-secondary/30`}>
            <StandaloneChatNav
              chats={chats}
              activeChatId={activeChatId}
              onSelect={(id) => {
                onSelectChat(id);
                setMobilePane("chat");
              }}
              onNew={() => {
                onNewChat();
                setMobilePane("chat");
              }}
              onDelete={onDeleteChat}
              now={now}
            />
          </aside>
        )}
        {showChat && (
          <div className="flex-1 min-w-0 flex">
            <StandaloneChatView
              title={activeChat?.title}
              messages={activeChat?.messages ?? []}
              loading={loading}
              error={error}
              attachedNotes={attachedNotes}
              onRemoveAttachedNote={onRemoveAttachedNote}
              onSend={(text) => onSend(text, scope)}
              onStop={onStop}
              // 狭い画面だけ戻るを出し、子ナビへ戻す。デスクトップは子ナビが隣にあるので不要
              onBack={isDesktop ? undefined : () => setMobilePane("nav")}
              aiConfigured={aiConfigured}
              onSaveAsAnswer={onSaveAsAnswer}
              onResend={onResend}
              onFork={onFork}
              onOpenWiki={onOpenWiki}
              sourceLinks={sourceLinks}
              scope={scope}
              onScopeChange={handleScopeChange}
            />
          </div>
        )}
      </div>
    </div>
  );
}
