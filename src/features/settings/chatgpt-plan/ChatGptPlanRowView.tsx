// 設定のモデル一覧で、ChatGPT のプランのモデルの行に添える表示（見た目だけ）。
// Copilot の行と同じ位置・同じ流儀: 説明の 1 行と、押せる文字ボタン。

import { useT } from "../../../i18n";

const linkBtn = "text-xs text-primary hover:text-primary/80 font-medium disabled:opacity-60";

export type ChatGptPlanRowViewProps = {
  /** サインイン中か。null = まだ読んでいない（何も出さない） */
  signedIn: boolean | null;
  /** 認証切れの通知を受けている（サインインし直しを促す） */
  expired?: boolean;
  /** サインアウトしたあと、ChatGPT 側の接続は残っている（revoked: false）ときの案内を出す */
  showRevokeHint?: boolean;
  busy?: boolean;
  /** 「Manage usage」 */
  onManageUsage: () => void;
  onSignOut: () => void;
  /** 「Continue with ChatGPT」でもう一度サインイン */
  onSignInAgain: () => void;
};

export function ChatGptPlanRowView({
  signedIn,
  expired = false,
  showRevokeHint = false,
  busy = false,
  onManageUsage,
  onSignOut,
  onSignInAgain,
}: ChatGptPlanRowViewProps) {
  const t = useT();
  if (signedIn === null) return null;
  const needsSignIn = !signedIn || expired;
  return (
    <div className="mt-1 space-y-1">
      {needsSignIn ? (
        <>
          <p className="text-xs text-muted-foreground">{t("settings.chatgptPlan.row.signedOut")}</p>
          <button type="button" onClick={onSignInAgain} disabled={busy} className={linkBtn}>
            {t("settings.chatgptPlan.button")}
          </button>
        </>
      ) : (
        <>
          <p className="text-xs text-muted-foreground">{t("settings.chatgptPlan.usingPlan")}</p>
          <div className="flex items-center gap-3">
            <button type="button" onClick={onManageUsage} className={linkBtn}>
              {t("settings.chatgptPlan.manageUsage")}
            </button>
            <button type="button" onClick={onSignOut} disabled={busy} className={linkBtn}>
              {t("settings.chatgptPlan.signOut")}
            </button>
          </div>
        </>
      )}
      {showRevokeHint && (
        <p className="text-xs text-muted-foreground">{t("settings.chatgptPlan.revokeHint")}</p>
      )}
    </div>
  );
}
