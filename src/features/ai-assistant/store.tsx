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
  /**
   * メッセージを追加。chatId を渡すと activeChatId が未発行のときだけその id を
   * 採用する（チャット実行のアプリレベル管理が、送信前に応答の書き戻し先 id を
   * 確定させるため）。既発行なら無視される。
   */
  addMessage: (message: ChatMessage, chatId?: string) => void;
  /**
   * messages を index 直前まで巻き戻し、新しい user メッセージで置き換える。
   * 編集&再実行（index = 編集した user の位置）と回答の再生成
   * （index = 再送する user の位置）の両方で使う。index 以降は破棄される。
   * chatId は addMessage と同じ扱い。
   */
  rewriteFrom: (index: number, message: ChatMessage, chatId?: string) => void;
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
  /**
   * 実行中（または直後に完了/失敗した）チャット run をアクティブ会話として復元する。
   * ノート切替からの復帰時、chat-run-manager のスナップショットから会話と
   * ローディング表示を再現するために使う（remount で store が初期化されるため）。
   * chat は chats へ upsert され、そのままアクティブ展開される。
   */
  resumeRunningChat: (
    chat: ScopeChat,
    opts: {
      sourceBlockIds: string[];
      quotedMarkdown: string;
      sessionId: string | null;
      forkedFrom: ScopeChat["forkedFrom"] | null;
      running: boolean;
      error?: string;
    },
  ) => void;
  /**
   * チャット run の完了結果を反映する。chat.id が activeChatId と一致すれば
   * アクティブ会話（messages / sessionId）を確定形に置き換え、一致しなければ
   * chats への upsert のみ行う（応答待ち中に別チャットへ切り替えても、応答が
   * 切替先へ混入しない）。いずれも loading を解除する。冪等に再適用できる。
   */
  applyChatRunResult: (chat: ScopeChat, sessionId: string | null) => void;
  /** チャット run の失敗を反映する。対象チャット表示中のみエラー文言を出す */
  applyChatRunError: (chatId: string, error: string) => void;
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

  const addMessage = useCallback((message: ChatMessage, chatId?: string) => {
    setState((prev) => ({
      ...prev,
      messages: [...prev.messages, message],
      // 最初のメッセージ追加時に activeChatId を確定（保存時の ID 安定化）。
      // chatId 指定時はそれを採用する（run 側と書き戻し先 id を一致させる）
      activeChatId: prev.activeChatId ?? chatId ?? crypto.randomUUID(),
    }));
  }, []);

  const rewriteFrom = useCallback((index: number, message: ChatMessage, chatId?: string) => {
    setState((prev) => ({
      ...prev,
      messages: [...prev.messages.slice(0, index), message],
      activeChatId: prev.activeChatId ?? chatId ?? crypto.randomUUID(),
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

  const resumeRunningChat = useCallback(
    (
      chat: ScopeChat,
      opts: {
        sourceBlockIds: string[];
        quotedMarkdown: string;
        sessionId: string | null;
        forkedFrom: ScopeChat["forkedFrom"] | null;
        running: boolean;
        error?: string;
      },
    ) => {
      setState((prev) => ({
        ...prev,
        // 別のチャットが表示中なら先に退避する（上書きで消さない）
        chats: upsertChat(
          prev.activeChatId !== chat.id
            ? upsertChat(prev.chats, buildCurrentChat(prev))
            : prev.chats,
          chat,
        ),
        activeChatId: chat.id,
        messages: chat.messages,
        sourceBlockIds: opts.sourceBlockIds,
        quotedMarkdown: opts.quotedMarkdown,
        sessionId: opts.sessionId,
        forkedFrom: opts.forkedFrom ?? null,
        loading: opts.running,
        error: opts.error ?? null,
      }));
    },
    [],
  );

  const applyChatRunResult = useCallback((chat: ScopeChat, sessionId: string | null) => {
    setState((prev) => {
      const chats = upsertChat(prev.chats, chat);
      if (prev.activeChatId === chat.id) {
        return {
          ...prev,
          chats,
          messages: chat.messages,
          sessionId,
          loading: false,
          error: null,
        };
      }
      // 応答待ち中に別チャットへ切り替えた場合: 応答は元チャット（chats 内）にのみ
      // 反映し、表示中の会話には混入させない
      return { ...prev, chats, loading: false };
    });
  }, []);

  const applyChatRunError = useCallback((chatId: string, error: string) => {
    setState((prev) => {
      if (prev.activeChatId !== chatId) {
        return { ...prev, loading: false };
      }
      return { ...prev, loading: false, error };
    });
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
        resumeRunningChat,
        applyChatRunResult,
        applyChatRunError,
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
