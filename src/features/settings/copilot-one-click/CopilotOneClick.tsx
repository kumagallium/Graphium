// 設定 > AI の空状態に置く、GitHub Copilot ワンクリック接続の容器。
// 見た目は CopilotOneClickView、状態遷移は state.ts の reducer に任せ、ここは API 呼び出しだけを担う。

import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { openExternalUrl } from "../../../lib/external-link";
import * as api from "./api";
import { CopilotOneClickView } from "./CopilotOneClickView";
import { needsPolling, reducer, type Phase } from "./state";

const POLL_MS = 500;
// 学生・教員の無料枠の条件（GitHub 公式）
const ELIGIBILITY_URL = "https://docs.github.com/copilot/how-tos/manage-your-account/get-free-access-to-copilot-pro";
const COPILOT_SETTINGS_URL = "https://github.com/settings/copilot";

const errInfo = (err: unknown) => ({
  code: err instanceof api.CopilotApiError ? err.code : null,
  message: err instanceof Error ? err.message : String(err),
});

export function CopilotOneClick({
  onConnected,
  onAddManually,
  mode = "connect",
  autoStart = false,
  onCancel,
}: {
  onConnected: () => void | Promise<void>;
  /** 「API キーやサーバーを指定して使う」の行 */
  onAddManually: () => void;
  /** relogin = 接続済みの人のログインし直し。流れは connect と同じで、idle の見た目と完了時の扱いだけ違う */
  mode?: "connect" | "relogin";
  /** 開いたらすぐ流れを始める（idle の見た目を挟まない） */
  autoStart?: boolean;
  /** relogin でやめたとき（親が部品を閉じる） */
  onCancel?: () => void;
}) {
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

  // autoStart: 最初の idle で一度だけ流れを始める（失敗やキャンセルで idle に戻っても繰り返さない）
  const autoStartedRef = useRef(false);
  useEffect(() => {
    if (!autoStart || autoStartedRef.current || phase.kind !== "idle") return;
    autoStartedRef.current = true;
    dispatch({ type: "click" });
  }, [autoStart, phase.kind]);

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
      mode={mode}
      onCancel={onCancel}
      onCancelInstall={() => {
        void api.cancelInstall().catch(() => {});
        dispatch({ type: "reset" });
        if (mode === "relogin") onCancel?.();
      }}
      onCancelLogin={() => {
        void api.cancelLogin().catch(() => {});
        dispatch({ type: "reset" });
        if (mode === "relogin") onCancel?.();
      }}
      onUseDeviceCode={handleUseDeviceCode}
      onCopyCode={handleCopy}
      onOpenGithub={(url) => void openExternalUrl(url)}
      onOpenCopilotSettings={() => void openExternalUrl(COPILOT_SETTINGS_URL)}
      onRetry={() => dispatch({ type: "click" })}
      onAddManually={onAddManually}
      onOpenEligibility={() => void openExternalUrl(ELIGIBILITY_URL)}
      onRecheck={() => dispatch({ type: "recheck" })}
    />
  );
}
