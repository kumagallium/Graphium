// 設定 > AI の、ChatGPT のプランでつなぐ流れの容器（Sign in with ChatGPT）。
// 見た目は ChatGptPlanConnectView、状態遷移は state.ts の reducer に任せ、ここは API 呼び出しだけを担う。

import { useEffect, useReducer, useRef } from "react";
import { openExternalUrl } from "../../../lib/external-link";
import * as api from "./api";
import { ChatGptPlanConnectView } from "./ChatGptPlanConnectView";
import { needsPolling, reducer, type ChatGptModel, type Phase } from "./state";

const POLL_MS = 1500;
/** ChatGPT の使用量の設定（外部ブラウザで開く） */
export const CHATGPT_USAGE_URL = "https://chatgpt.com/settings/usage";

const errInfo = (err: unknown) => ({
  code: err instanceof api.ChatGptApiError ? err.code : null,
  message: err instanceof Error ? err.message : String(err),
});

export function ChatGptPlanConnect({
  onConnected,
  mode = "embedded",
  autoStart = false,
  onCancel,
}: {
  /** 確認が済んだ。モデルの登録（relogin では登録し直さず状態を読み直すだけ）は親に任せる */
  onConnected: (model: ChatGptModel) => void | Promise<void>;
  /** relogin = 接続済みの人のサインインし直し。embedded = つなぎ先の選択画面から始めた初回の接続 */
  mode?: "embedded" | "relogin";
  /** 開いたらすぐ流れを始める（idle の見た目を挟まない） */
  autoStart?: boolean;
  /** やめる・別の接続先を選ぶ（親が部品を閉じる） */
  onCancel?: () => void;
}) {
  const [phase, dispatch] = useReducer(reducer, { kind: "loading" } as Phase);
  const onConnectedRef = useRef(onConnected);
  onConnectedRef.current = onConnected;

  // 開いたとき status を読む。裏で承認待ちが続いていればその画面に戻る
  useEffect(() => {
    let cancelled = false;
    api
      .getStatus()
      .then((status) => !cancelled && dispatch({ type: "init", status }))
      .catch(() => !cancelled && dispatch({ type: "init", status: null }));
    return () => {
      cancelled = true;
    };
  }, []);

  // autoStart: 最初の idle で一度だけ流れを始める（失敗やキャンセルで idle に戻っても繰り返さない）
  const autoStartedRef = useRef(false);
  useEffect(() => {
    if (!autoStart || autoStartedRef.current || phase.kind !== "idle") return;
    autoStartedRef.current = true;
    dispatch({ type: "click" });
  }, [autoStart, phase.kind]);

  // 部品が本当に外れたか（開始の途中で閉じられたら、握ったままの 1455 番を解放する）
  const mountedRef = useRef(false);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // ボタン直後: サインインを始め、返ってきた認可 URL をシステムブラウザで開く。
  // URL は機微なので、ログにも state にも残さない
  useEffect(() => {
    if (phase.kind !== "starting") return;
    let cancelled = false;
    (async () => {
      try {
        const { authUrl } = await api.startSignIn();
        if (!mountedRef.current) {
          // ブラウザを開かないまま終わる。待ち受けを残さないよう取り消す
          void api.cancelSignIn().catch(() => {});
          return;
        }
        if (cancelled) return;
        void openExternalUrl(authUrl);
        dispatch({ type: "started" });
      } catch (err) {
        if (cancelled) return;
        // すでに進行中なら、その続きを待つ
        if (err instanceof api.ChatGptApiError && err.code === "ALREADY_SIGNING_IN") {
          dispatch({ type: "alreadySigningIn" });
          return;
        }
        dispatch({ type: "error", ...errInfo(err) });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [phase.kind]);

  // 承認待ちは 1.5 秒ごとに status を読む。アンマウントで止める（裏の処理は止めない）
  const polling = needsPolling(phase);
  useEffect(() => {
    if (!polling) return;
    let cancelled = false;
    let inFlight = false;
    const timer = setInterval(() => {
      if (inFlight) return;
      inFlight = true;
      api
        .getStatus()
        .then((status) => !cancelled && dispatch({ type: "status", status }))
        .catch(() => {})
        .finally(() => {
          inFlight = false;
        });
    }, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [polling]);

  // 確認中: モデル一覧を取る（サインインとプラン利用の許可の確認を兼ねる）
  useEffect(() => {
    if (phase.kind !== "verifying") return;
    let cancelled = false;
    api
      .getModels()
      .then((result) => !cancelled && dispatch({ type: "models", result }))
      .catch((err) => !cancelled && dispatch({ type: "error", ...errInfo(err) }));
    return () => {
      cancelled = true;
    };
  }, [phase.kind]);

  // 確認が済んだら登録を親に任せる（失敗しても親が表示するので、ここは最初の画面に戻す）
  const connectedModel = phase.kind === "connected" ? phase.model : null;
  useEffect(() => {
    if (!connectedModel) return;
    let cancelled = false;
    Promise.resolve(onConnectedRef.current(connectedModel))
      .catch(() => {})
      .finally(() => {
        if (!cancelled) dispatch({ type: "reset" });
      });
    return () => {
      cancelled = true;
    };
  }, [connectedModel]);

  return (
    <ChatGptPlanConnectView
      phase={phase}
      mode={mode}
      onStart={() => dispatch({ type: "click" })}
      onCancelSignIn={() => {
        void api.cancelSignIn().catch(() => {});
        dispatch({ type: "reset" });
        onCancel?.();
      }}
      onWelcomeDone={() => {
        // 案内を済ませた印はサーバーに残す。失敗しても先へ進む（次回また出るだけ）
        void api.markWelcomed().catch(() => {});
        dispatch({ type: "welcomeDone" });
      }}
      onOpenUsage={() => void openExternalUrl(CHATGPT_USAGE_URL)}
      onRetry={() => dispatch({ type: "click" })}
      onChooseOther={() => {
        dispatch({ type: "reset" });
        onCancel?.();
      }}
      onCancel={onCancel}
    />
  );
}
