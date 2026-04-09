// AI アシスタントの状態管理
// チャットパネル・引用ブロック・チャット履歴・実行状態を管理する

import { ReactNode, createContext, useCallback, useContext, useState } from "react";
import type { ChatMessage, ScopeChat } from "../../lib/google-drive";

export type AiAssistantState = {
  /** 引用元ブロックIDリスト */
  sourceBlockIds: string[];
  /** 引用テキスト（Markdown） */
  quotedMarkdown: string;
  /** AI 実行中か */
  loading: boolean;
  /** エラーメッセージ */
  error: string | null;
  /** チャット履歴 */
  messages: ChatMessage[];
  /** アクティブなチャット ID */
  activeChatId: string | null;
  /** 全チャット（ドキュメントから読み込み） */
  chats: ScopeChat[];
  /** crucible-agent セッション ID（チャット継続用） */
  sessionId: string | null;
  /** Chat タブを開くリクエスト（カウンター。変化を検知して rightTab を切り替える） */
  chatRequestSeq: number;
};

export type AiAssistantActions = {
  /** Chat タブを開く（引用ブロック情報を渡し、rightTab 切り替えをリクエスト） */
  openChat: (params: { sourceBlockIds: string[]; quotedMarkdown: string }) => void;
  /** ローディング状態を設定 */
  setLoading: (loading: boolean) => void;
  /** エラーを設定 */
  setError: (error: string | null) => void;
  /** メッセージを追加 */
  addMessage: (message: ChatMessage) => void;
  /** チャットを選択（既存チャットを開く） */
  selectChat: (chatId: string) => void;
  /** チャット一覧を復元 */
  restoreChats: (chats: ScopeChat[]) => void;
  /** 現在のチャットを ScopeChat として取得 */
  getCurrentChat: () => ScopeChat | null;
  /** セッション ID を設定 */
  setSessionId: (sessionId: string | null) => void;
  /** メッセージをクリア（新しい会話を開始） */
  clearMessages: () => void;
  /** 現在のチャットを退避して非アクティブにする（リスト表示用） */
  parkChat: () => void;
};

export type AiAssistantStore = AiAssistantState & AiAssistantActions;

const AiAssistantContext = createContext<AiAssistantStore | null>(null);

const INITIAL_STATE: AiAssistantState = {
  sourceBlockIds: [],
  quotedMarkdown: "",
  loading: false,
  error: null,
  messages: [],
  activeChatId: null,
  chats: [],
  sessionId: null,
  chatRequestSeq: 0,
};

// sourceBlockIds からスコープ種別を判定するヘルパー
function resolveScopeType(sourceBlockIds: string[]): ScopeChat["scopeType"] {
  return sourceBlockIds.length > 0 ? "heading" : "page";
}

// チャット退避時に generatedBy を構築するヘルパー
function buildGeneratedBy(
  prev: AiAssistantState,
  existing: ScopeChat | null | undefined,
): ScopeChat["generatedBy"] {
  return {
    agent: existing?.generatedBy?.agent ?? "crucible-agent",
    sessionId: prev.sessionId ?? existing?.generatedBy?.sessionId ?? "",
    model: existing?.generatedBy?.model,
    tokenUsage: existing?.generatedBy?.tokenUsage,
  };
}

export function AiAssistantProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AiAssistantState>(INITIAL_STATE);

  const openChat = useCallback(
    (params: { sourceBlockIds: string[]; quotedMarkdown: string }) => {
      setState((prev) => {
        // 現在進行中のチャットがあれば chats に退避
        let updatedChats = prev.chats;
        if (prev.messages.length > 0) {
          const now = new Date().toISOString();
          const existing = prev.activeChatId
            ? prev.chats.find((c) => c.id === prev.activeChatId)
            : null;
          const currentChat: ScopeChat = {
            id: existing?.id ?? crypto.randomUUID(),
            scopeBlockId: prev.sourceBlockIds[0] ?? "",
            scopeType: resolveScopeType(prev.sourceBlockIds),
            messages: prev.messages,
            generatedBy: buildGeneratedBy(prev, existing),
            createdAt: existing?.createdAt ?? now,
            modifiedAt: now,
          };
          const idx = updatedChats.findIndex((c) => c.id === currentChat.id);
          updatedChats = idx >= 0
            ? updatedChats.map((c, i) => i === idx ? currentChat : c)
            : [...updatedChats, currentChat];
        }
        return {
          ...prev,
          chats: updatedChats,
          sourceBlockIds: params.sourceBlockIds,
          quotedMarkdown: params.quotedMarkdown,
          loading: false,
          error: null,
          messages: [],
          activeChatId: null,
          sessionId: null,
          chatRequestSeq: prev.chatRequestSeq + 1,
        };
      });
    },
    [],
  );

  const setLoading = useCallback((loading: boolean) => {
    setState((prev) => ({ ...prev, loading }));
  }, []);

  const setError = useCallback((error: string | null) => {
    setState((prev) => ({ ...prev, error, loading: false }));
  }, []);

  const addMessage = useCallback((message: ChatMessage) => {
    setState((prev) => ({
      ...prev,
      messages: [...prev.messages, message],
      // 最初のメッセージ追加時に activeChatId を確定（保存時の ID 安定化）
      activeChatId: prev.activeChatId ?? crypto.randomUUID(),
    }));
  }, []);

  const setSessionId = useCallback((sessionId: string | null) => {
    setState((prev) => ({ ...prev, sessionId }));
  }, []);

  const selectChat = useCallback((chatId: string) => {
    setState((prev) => {
      const chat = prev.chats.find((c) => c.id === chatId);
      if (!chat) return prev;
      return {
        ...prev,
        activeChatId: chatId,
        messages: chat.messages,
        sourceBlockIds: chat.scopeType === "page" ? [] : [chat.scopeBlockId],
        quotedMarkdown: "",
        error: null,
        sessionId: chat.generatedBy?.sessionId ?? null,
      };
    });
  }, []);

  const restoreChats = useCallback((chats: ScopeChat[]) => {
    setState((prev) => ({ ...prev, chats }));
  }, []);

  const getCurrentChat = useCallback((): ScopeChat | null => {
    const s = state;
    if (s.messages.length === 0) return null;
    const now = new Date().toISOString();
    const existing = s.activeChatId ? s.chats.find((c) => c.id === s.activeChatId) : null;
    return {
      id: existing?.id ?? crypto.randomUUID(),
      scopeBlockId: s.sourceBlockIds[0] ?? "",
      scopeType: resolveScopeType(s.sourceBlockIds),
      messages: s.messages,
      generatedBy: buildGeneratedBy(s, existing),
      createdAt: existing?.createdAt ?? now,
      modifiedAt: now,
    };
  }, [state]);

  const clearMessages = useCallback(() => {
    setState((prev) => {
      // 現在のチャットを chats に退避してからクリア
      let updatedChats = prev.chats;
      if (prev.messages.length > 0) {
        const now = new Date().toISOString();
        const existing = prev.activeChatId
          ? prev.chats.find((c) => c.id === prev.activeChatId)
          : null;
        const currentChat: ScopeChat = {
          id: existing?.id ?? crypto.randomUUID(),
          scopeBlockId: prev.sourceBlockIds[0] ?? "",
          scopeType: resolveScopeType(prev.sourceBlockIds),
          messages: prev.messages,
          generatedBy: buildGeneratedBy(prev, existing),
          createdAt: existing?.createdAt ?? now,
          modifiedAt: now,
        };
        const idx = updatedChats.findIndex((c) => c.id === currentChat.id);
        updatedChats = idx >= 0
          ? updatedChats.map((c, i) => i === idx ? currentChat : c)
          : [...updatedChats, currentChat];
      }
      return {
        ...prev,
        chats: updatedChats,
        messages: [],
        activeChatId: null,
        sessionId: null,
        error: null,
      };
    });
  }, []);

  const parkChat = useCallback(() => {
    setState((prev) => {
      let updatedChats = prev.chats;
      if (prev.messages.length > 0) {
        const now = new Date().toISOString();
        const existing = prev.activeChatId
          ? prev.chats.find((c) => c.id === prev.activeChatId)
          : null;
        const currentChat: ScopeChat = {
          id: existing?.id ?? crypto.randomUUID(),
          scopeBlockId: prev.sourceBlockIds[0] ?? "",
          scopeType: resolveScopeType(prev.sourceBlockIds),
          messages: prev.messages,
          generatedBy: buildGeneratedBy(prev, existing),
          createdAt: existing?.createdAt ?? now,
          modifiedAt: now,
        };
        const idx = updatedChats.findIndex((c) => c.id === currentChat.id);
        updatedChats = idx >= 0
          ? updatedChats.map((c, i) => i === idx ? currentChat : c)
          : [...updatedChats, currentChat];
      }
      return {
        ...prev,
        chats: updatedChats,
        messages: [],
        activeChatId: null,
        sessionId: null,
        sourceBlockIds: [],
        quotedMarkdown: "",
        error: null,
      };
    });
  }, []);

  return (
    <AiAssistantContext.Provider
      value={{
        ...state,
        openChat,
        setLoading,
        setError,
        addMessage,
        setSessionId,
        selectChat,
        restoreChats,
        getCurrentChat,
        clearMessages,
        parkChat,
      }}
    >
      {children}
    </AiAssistantContext.Provider>
  );
}

export function useAiAssistant(): AiAssistantStore {
  const ctx = useContext(AiAssistantContext);
  if (!ctx) throw new Error("AiAssistantProvider が見つかりません");
  return ctx;
}
