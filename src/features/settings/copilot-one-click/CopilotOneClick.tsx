// 設定 > AI の空状態に置く、GitHub Copilot ワンクリック接続の容器。
// 見た目は CopilotOneClickView、状態遷移は state.ts の reducer に任せ、ここは API 呼び出しだけを担う。

import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { openExternalUrl } from "../../../lib/external-link";
import * as api from "./api";
import { CopilotOneClickView } from "./CopilotOneClickView";
import { needsPolling, reducer, type Phase } from "./state";

const POLL_MS = 500;
const COPILOT_SETTINGS_URL = "https://github.com/settings/copilot";

const errInfo = (err: unknown) => ({
  code: err instanceof api.CopilotApiError ? err.code : null,
  message: err instanceof Error ? err.message : String(err),
});

export function CopilotOneClick({ onConnected }: { onConnected: () => void | Promise<void> }) {
  const [phase, dispatch] = useReducer(reducer, { kind: "loading" } as Phase);
  const [copied, setCopied] = useState(false);
  const onConnectedRef = useRef(onConnected);
  onConnectedRef.current = onConnected;

  // 開いたとき status を読む。裏で取得や承認待ちが続いていればその画面に戻る
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

  // ボタン直後: CLI が無ければ取得を始める（すでに取得中なら続きを見る）
  useEffect(() => {
    if (phase.kind !== "preparing") return;
    let cancelled = false;
    (async () => {
      try {
        const status = await api.getStatus();
        if (status.cli === "missing" && status.installable) {
          try {
            await api.startInstall();
          } catch (err) {
            if (!(err instanceof api.CopilotApiError && err.code === "ALREADY_INSTALLING")) throw err;
          }
        }
        if (!cancelled) dispatch({ type: "prepared", status });
      } catch (err) {
        if (!cancelled) dispatch({ type: "error", stage: "install", ...errInfo(err) });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [phase.kind]);

  // 確認中: モデル一覧を取る。未ログインなら続けて承認（web）を始める
  const afterLogin = phase.kind === "verifying" ? phase.afterLogin : false;
  useEffect(() => {
    if (phase.kind !== "verifying") return;
    let cancelled = false;
    (async () => {
      try {
        const result = await api.getAuth();
        if (!result.ok && result.code === "COPILOT_NOT_SIGNED_IN" && !afterLogin) {
          try {
            await api.startLogin("web");
          } catch (err) {
            if (!(err instanceof api.CopilotApiError && err.code === "ALREADY_SIGNING_IN")) throw err;
          }
        }
        if (!cancelled) dispatch({ type: "auth", result });
      } catch (err) {
        if (!cancelled) dispatch({ type: "error", stage: "login", ...errInfo(err) });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [phase.kind, afterLogin]);

  // 取得中・承認待ちは 500ms ごとに status を読む。アンマウントで止める（裏の処理は止めない）
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

  // 確認が済んだら登録を親に任せる（失敗しても親が表示するので、ここは最初の画面に戻す）
  useEffect(() => {
    if (phase.kind !== "connected") return;
    let cancelled = false;
    Promise.resolve(onConnectedRef.current())
      .catch(() => {})
      .finally(() => {
        if (!cancelled) dispatch({ type: "reset" });
      });
    return () => {
      cancelled = true;
    };
  }, [phase.kind]);

  const handleUseDeviceCode = useCallback(() => {
    dispatch({ type: "switchToDevice" });
    api.startLogin("device").catch((err) => {
      if (err instanceof api.CopilotApiError && err.code === "ALREADY_SIGNING_IN") return;
      dispatch({ type: "error", stage: "login", ...errInfo(err) });
    });
  }, []);

  const handleCopy = useCallback((code: string) => {
    void navigator.clipboard?.writeText(code).then(
      () => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      },
      () => {},
    );
  }, []);

  return (
    <CopilotOneClickView
      phase={phase}
      copied={copied}
      onStart={() => dispatch({ type: "click" })}
      onCancelInstall={() => {
        void api.cancelInstall().catch(() => {});
        dispatch({ type: "reset" });
      }}
      onCancelLogin={() => {
        void api.cancelLogin().catch(() => {});
        dispatch({ type: "reset" });
      }}
      onUseDeviceCode={handleUseDeviceCode}
      onCopyCode={handleCopy}
      onOpenGithub={(url) => void openExternalUrl(url)}
      onOpenCopilotSettings={() => void openExternalUrl(COPILOT_SETTINGS_URL)}
      onRetry={() => dispatch({ type: "click" })}
      onRecheck={() => dispatch({ type: "recheck" })}
    />
  );
}
