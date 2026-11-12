// ChatGPT のプランでつなぐ流れの、見た目だけの部品。状態は props で受けて描くだけ。
// ロゴ画像は置かず、文字だけで作る（OpenAI の UI ガイドラインの文言は英語のまま使う）。

import { Loader2 } from "lucide-react";
import { useEffect, useRef } from "react";
import { useT } from "../../../i18n";
import { SETTINGS_CARD_CLASS } from "../SettingsGroup";
import type { Phase } from "./state";

const primaryBtn =
  "inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-60";
const rowPrimary =
  "shrink-0 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 transition-colors";
const rowClass = `${SETTINGS_CARD_CLASS} p-3 text-left`;
const subBtn =
  "rounded-lg border border-border px-2 py-0.5 text-xs text-foreground hover:bg-accent transition-colors";
const linkBtn = "text-primary underline-offset-2 hover:underline";

export type ChatGptPlanConnectViewProps = {
  phase: Phase;
  /** embedded = つなぎ先の選択画面から始めた初回の接続 / relogin = 接続済みの人のサインインし直し（主ボタン 1 つ） */
  mode?: "embedded" | "relogin";
  /** 「Continue with ChatGPT」 */
  onStart: () => void;
  onCancelSignIn: () => void;
  /** 初回の案内の「Got it」 */
  onWelcomeDone: () => void;
  /** 「Manage usage」: ChatGPT の使用量の設定を開く */
  onOpenUsage: () => void;
  /** 失敗からやり直す */
  onRetry: () => void;
  /** 別の接続先を選ぶ（API キーなど） */
  onChooseOther: () => void;
  /** やめて閉じる */
  onCancel?: () => void;
};

export function ChatGptPlanConnectView({
  phase,
  mode = "embedded",
  onStart,
  onCancelSignIn,
  onWelcomeDone,
  onOpenUsage,
  onRetry,
  onChooseOther,
  onCancel,
}: ChatGptPlanConnectViewProps) {
  const t = useT();

  // 待ちの枠が出たら見える位置に持ってくる（選択画面が畳まれて、枠が画面の外に出るため）
  const rootRef = useRef<HTMLDivElement>(null);
  const waiting = phase.kind === "waiting";
  useEffect(() => {
    if (waiting) rootRef.current?.scrollIntoView?.({ block: "nearest", behavior: "smooth" });
  }, [waiting]);

  const body = () => {
    switch (phase.kind) {
      case "loading":
      case "unavailable":
        return null;

      case "idle":
        // 再サインイン: すでに接続済みの人なので説明は出さず、主ボタンだけ置く
        if (mode === "relogin") {
          return (
            <div className="flex items-center justify-center">
              <button type="button" onClick={onStart} className={primaryBtn}>
                {t("settings.chatgptPlan.button")}
              </button>
            </div>
          );
        }
        return (
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h4 className="text-xs font-semibold text-foreground">{t("settings.aiConnect.chatgpt.title")}</h4>
              <p className="mt-0.5 text-xs text-muted-foreground">{t("settings.aiConnect.chatgpt.summary")}</p>
            </div>
            <button type="button" onClick={onStart} className={rowPrimary}>
              {t("settings.chatgptPlan.button")}
            </button>
          </div>
        );

      case "starting":
      case "verifying":
      case "connected":
        return (
          <div className="flex items-center justify-center gap-2 text-xs text-muted-foreground" role="status">
            <Loader2 size={12} className="animate-spin" />
            {t("settings.chatgptPlan.verifying")}
          </div>
        );

      case "waiting":
        return (
          <div className="space-y-2" role="status">
            <div className="flex items-center justify-center gap-2 text-xs text-muted-foreground">
              <Loader2 size={12} className="animate-spin" />
              {t("settings.chatgptPlan.waitingBrowser")}
            </div>
            <div className="flex items-center justify-center gap-2">
              <button type="button" className={subBtn} onClick={onCancelSignIn}>
                {t("settings.chatgptPlan.cancel")}
              </button>
            </div>
          </div>
        );

      case "welcome":
        // 初回だけ。使うのは ChatGPT プランの枠であること・使用量は ChatGPT 側で見られることを伝える
        return (
          <div className="space-y-2" role="status">
            <p className="text-xs text-foreground">
              {t("settings.chatgptPlan.welcome")}{" "}
              <button type="button" onClick={onOpenUsage} className={linkBtn}>
                {t("settings.chatgptPlan.manageUsage")}
              </button>
            </p>
            <div className="flex items-center justify-center">
              <button type="button" className={primaryBtn} onClick={onWelcomeDone}>
                {t("settings.chatgptPlan.gotIt")}
              </button>
            </div>
          </div>
        );

      case "notGranted":
        // 許可し直すか、別の接続先を選ぶ。責める文にしない
        return (
          <div className="space-y-2">
            <p className="text-xs text-foreground">{t("settings.chatgptPlan.notGranted")}</p>
            <div className="flex items-center justify-center gap-2">
              <button type="button" className={primaryBtn} onClick={onRetry}>
                {t("settings.chatgptPlan.button")}
              </button>
              <button type="button" className={subBtn} onClick={onChooseOther}>
                {t("settings.chatgptPlan.chooseOther")}
              </button>
            </div>
          </div>
        );

      case "portInUse":
        return (
          <div className="space-y-2">
            <p className="text-xs text-destructive">{t("settings.chatgptPlan.portInUse")}</p>
            <button type="button" className={primaryBtn} onClick={onRetry}>
              {t("settings.chatgptPlan.retry")}
            </button>
          </div>
        );

      case "denied":
        return (
          <div className="space-y-2">
            <p className="text-xs text-foreground">{t("settings.chatgptPlan.denied")}</p>
            <button type="button" className={primaryBtn} onClick={onRetry}>
              {t("settings.chatgptPlan.retry")}
            </button>
          </div>
        );

      case "notEligible":
        // やり直しても変わらないので、再試行のボタンは出さず、別の接続先へ案内する
        return (
          <div className="space-y-2">
            <p className="text-xs text-foreground">{t("settings.chatgptPlan.notEligible")}</p>
            <div className="flex items-center justify-center">
              <button type="button" className={subBtn} onClick={onChooseOther}>
                {t("settings.chatgptPlan.chooseOther")}
              </button>
            </div>
          </div>
        );

      case "checkFailed":
        return (
          <div className="space-y-2">
            <p className="text-xs text-destructive">{t("settings.chatgptPlan.checkFailed")}</p>
            <button type="button" className={primaryBtn} onClick={onRetry}>
              {t("settings.chatgptPlan.retry")}
            </button>
          </div>
        );
    }
  };

  if (phase.kind === "loading" || phase.kind === "unavailable") return null;
  // 進行中・初回の案内は自前の操作がある。それ以外は「やめる」を添える
  const hasOwnAction = phase.kind === "waiting" || phase.kind === "welcome" || phase.kind === "notEligible" || phase.kind === "notGranted";
  return (
    <div ref={rootRef} className="space-y-2">
      <div className={rowClass}>{body()}</div>
      {!hasOwnAction && onCancel && (
        <div className="flex justify-end">
          <button type="button" className={subBtn} onClick={onCancel}>
            {t("settings.chatgptPlan.cancel")}
          </button>
        </div>
      )}
    </div>
  );
}
