// AI アシスタントの状態管理
// モーダルの開閉・引用ブロック・実行状態を管理する

import { ReactNode, createContext, useCallback, useContext, useState } from "react";

export type AiAssistantState = {
  /** モーダルが開いているか */
  isOpen: boolean;
  /** 引用元ブロックIDリスト */
  sourceBlockIds: string[];
  /** 引用テキスト（Markdown） */
  quotedMarkdown: string;
  /** AI 実行中か */
  loading: boolean;
  /** エラーメッセージ */
  error: string | null;
};

export type AiAssistantActions = {
  /** モーダルを開く（引用ブロック情報を渡す） */
  open: (params: { sourceBlockIds: string[]; quotedMarkdown: string }) => void;
  /** モーダルを閉じる */
  close: () => void;
  /** ローディング状態を設定 */
  setLoading: (loading: boolean) => void;
  /** エラーを設定 */
  setError: (error: string | null) => void;
};

export type AiAssistantStore = AiAssistantState & AiAssistantActions;

const AiAssistantContext = createContext<AiAssistantStore | null>(null);

const INITIAL_STATE: AiAssistantState = {
  isOpen: false,
  sourceBlockIds: [],
  quotedMarkdown: "",
  loading: false,
  error: null,
};

export function AiAssistantProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AiAssistantState>(INITIAL_STATE);

  const open = useCallback(
    (params: { sourceBlockIds: string[]; quotedMarkdown: string }) => {
      setState({
        isOpen: true,
        sourceBlockIds: params.sourceBlockIds,
        quotedMarkdown: params.quotedMarkdown,
        loading: false,
        error: null,
      });
    },
    [],
  );

  const close = useCallback(() => {
    setState(INITIAL_STATE);
  }, []);

  const setLoading = useCallback((loading: boolean) => {
    setState((prev) => ({ ...prev, loading }));
  }, []);

  const setError = useCallback((error: string | null) => {
    setState((prev) => ({ ...prev, error, loading: false }));
  }, []);

  return (
    <AiAssistantContext.Provider value={{ ...state, open, close, setLoading, setError }}>
      {children}
    </AiAssistantContext.Provider>
  );
}

export function useAiAssistant(): AiAssistantStore {
  const ctx = useContext(AiAssistantContext);
  if (!ctx) throw new Error("AiAssistantProvider が見つかりません");
  return ctx;
}
