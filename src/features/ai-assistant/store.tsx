// AI アシスタントの状態管理
// チャットパネル・引用ブロック・チャット履歴・実行状態を管理する

import { ReactNode, createContext, useCallback, useContext, useState } from "react";
import type { ChatMessage, ScopeChat } from "../../lib/document-types";

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
  /** アクティブなチャットのフォーク元（分岐で作られたチャットのみ） */
  forkedFrom: ScopeChat["forkedFrom"] | null;
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
  /**
   * messages を index 直前まで巻き戻し、新しい user メッセージで置き換える。
   * 編集&再実行（index = 編集した user の位置）と回答の再生成
   * （index = 再送する user の位置）の両方で使う。index 以降は破棄される。
   */
  rewriteFrom: (index: number, message: ChatMessage) => void;
  /**
   * 現在のチャットを退避し、messages[0..index]（そのメッセージを含む）を
   * コピーした新チャットに分岐する。新チャットは forkedFrom を持つ。
   */
  forkChatAt: (index: number) => void;
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

export type AiAssistantStore = AiAssistantState & AiAssistantActions & {
  /** AI バックエンドが利用可能か */
  aiAvailable: boolean;
};

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
  forkedFrom: null,
  chatRequestSeq: 0,
};

// sourceBlockIds からスコープ種別を判定するヘルパー
function resolveScopeType(sourceBlockIds: string[]): ScopeChat["scopeType"] {
  return sourceBlockIds.length > 0 ? "heading" : "page";
}

// 現在のチャットに割り当てるべき安定 ID を返す。
// 優先順位: 既に chats に存在するエントリの ID > activeChatId（addMessage 時に発行済み）
// > 新規 UUID。
// 注意: activeChatId が立っているのに新規 UUID を生成すると、保存ごとに別 ID で
// チャットが増殖する（重複バグの原因）。
function resolveChatId(
  state: AiAssistantState,
  existing: ScopeChat | null | undefined,
): string {
  return existing?.id ?? state.activeChatId ?? crypto.randomUUID();
}

// チャット退避時に generatedBy を構築するヘルパー
function buildGeneratedBy(
  prev: AiAssistantState,
  existing: ScopeChat | null | undefined,
): ScopeChat["generatedBy"] {
  // 旧 crucible-agent ブランドは廃止。新規チャットは neutral な "ai" を使う。
  // 既存 ScopeChat に保存された agent 値はそのまま尊重する（履歴互換）。
  return {
    agent: existing?.generatedBy?.agent ?? "ai",
    sessionId: prev.sessionId ?? existing?.generatedBy?.sessionId ?? "",
    model: existing?.generatedBy?.model,
    tokenUsage: existing?.generatedBy?.tokenUsage,
  };
}

// 現在アクティブなチャットを ScopeChat として構築する。
// ScopeChat にフィールドを追加したら必ずここに通線すること
// （ここに無いフィールドはチャットのアクティブ化→退避のたびに脱落する）。
// export はユニットテスト用。
export function buildCurrentChat(state: AiAssistantState): ScopeChat | null {
  if (state.messages.length === 0) return null;
  const now = new Date().toISOString();
  const existing = state.activeChatId
    ? state.chats.find((c) => c.id === state.activeChatId)
    : null;
  return {
    id: resolveChatId(state, existing),
    scopeBlockId: state.sourceBlockIds[0] ?? "",
    scopeType: resolveScopeType(state.sourceBlockIds),
    messages: state.messages,
    generatedBy: buildGeneratedBy(state, existing),
    ...(state.forkedFrom ?? existing?.forkedFrom
      ? { forkedFrom: state.forkedFrom ?? existing?.forkedFrom }
      : {}),
    createdAt: existing?.createdAt ?? now,
    modifiedAt: now,
  };
}

// chats に chat を upsert する（同 ID があれば置換、無ければ末尾追加）
// export はユニットテスト用。
export function upsertChat(chats: ScopeChat[], chat: ScopeChat | null): ScopeChat[] {
  if (!chat) return chats;
  const idx = chats.findIndex((c) => c.id === chat.id);
  return idx >= 0 ? chats.map((c, i) => (i === idx ? chat : c)) : [...chats, chat];
}

export function AiAssistantProvider({ children, aiAvailable = true }: { children: ReactNode; aiAvailable?: boolean }) {
  const [state, setState] = useState<AiAssistantState>(INITIAL_STATE);

  const openChat = useCallback(
    (params: { sourceBlockIds: string[]; quotedMarkdown: string }) => {
      setState((prev) => ({
        ...prev,
        // 現在進行中のチャットがあれば chats に退避
        chats: upsertChat(prev.chats, buildCurrentChat(prev)),
        sourceBlockIds: params.sourceBlockIds,
        quotedMarkdown: params.quotedMarkdown,
        loading: false,
        error: null,
        messages: [],
        activeChatId: null,
        sessionId: null,
        forkedFrom: null,
        chatRequestSeq: prev.chatRequestSeq + 1,
      }));
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

  const rewriteFrom = useCallback((index: number, message: ChatMessage) => {
    setState((prev) => ({
      ...prev,
      messages: [...prev.messages.slice(0, index), message],
      activeChatId: prev.activeChatId ?? crypto.randomUUID(),
    }));
  }, []);

  const forkChatAt = useCallback((index: number) => {
    setState((prev) => {
      const current = buildCurrentChat(prev);
      if (!current) return prev;
      return {
        ...prev,
        // 元チャットを全量のまま chats に退避し、途中までのコピーで分岐する。
        // sourceBlockIds / quotedMarkdown は同一スコープの分岐なので引き継ぐ。
        chats: upsertChat(prev.chats, current),
        messages: prev.messages.slice(0, index + 1),
        activeChatId: crypto.randomUUID(),
        sessionId: null,
        forkedFrom: { chatId: current.id, messageIndex: index },
        error: null,
      };
    });
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
        forkedFrom: chat.forkedFrom ?? null,
      };
    });
  }, []);

  const restoreChats = useCallback((chats: ScopeChat[]) => {
    setState((prev) => ({ ...prev, chats }));
  }, []);

  const getCurrentChat = useCallback((): ScopeChat | null => {
    return buildCurrentChat(state);
  }, [state]);

  const clearMessages = useCallback(() => {
    setState((prev) => ({
      ...prev,
      // 現在のチャットを chats に退避してからクリア
      chats: upsertChat(prev.chats, buildCurrentChat(prev)),
      messages: [],
      activeChatId: null,
      sessionId: null,
      forkedFrom: null,
      error: null,
    }));
  }, []);

  const parkChat = useCallback(() => {
    setState((prev) => ({
      ...prev,
      chats: upsertChat(prev.chats, buildCurrentChat(prev)),
      messages: [],
      activeChatId: null,
      sessionId: null,
      forkedFrom: null,
      sourceBlockIds: [],
      quotedMarkdown: "",
      error: null,
    }));
  }, []);

  return (
    <AiAssistantContext.Provider
      value={{
        ...state,
        aiAvailable,
        openChat,
        setLoading,
        setError,
        addMessage,
        rewriteFrom,
        forkChatAt,
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
