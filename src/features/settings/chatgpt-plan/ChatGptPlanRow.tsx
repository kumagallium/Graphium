// ChatGPT のプランのモデルの行に添える部品の配線。サインインの状態を読み、サインアウトを担う。
// サインアウトしても登録済みのモデルは残す（次に使うと認証切れの案内が出る）。

import { useCallback, useEffect, useState } from "react";
import { openExternalUrl } from "../../../lib/external-link";
import * as api from "./api";
import { CHATGPT_USAGE_URL } from "./ChatGptPlanConnect";
import { ChatGptPlanRowView } from "./ChatGptPlanRowView";

export function ChatGptPlanRow({
  expired,
  onSignInAgain,
}: {
  expired: boolean;
  onSignInAgain: () => void;
}) {
  const [signedIn, setSignedIn] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [showRevokeHint, setShowRevokeHint] = useState(false);

  const refresh = useCallback(() => {
    return api
      .getStatus()
      .then((s) => setSignedIn(s.account !== null))
      .catch(() => setSignedIn(null));
  }, []);

  // 開いたとき、と、認証切れの通知が変わったときに読み直す
  useEffect(() => {
    void refresh();
  }, [refresh, expired]);

  const handleSignOut = async () => {
    setBusy(true);
    try {
      const { revoked } = await api.signOut();
      setShowRevokeHint(!revoked);
      setSignedIn(false);
    } catch {
      // 失敗したら状態を読み直して、実際の姿に合わせる
      await refresh();
    } finally {
      setBusy(false);
    }
  };

  return (
    <ChatGptPlanRowView
      signedIn={signedIn}
      expired={expired}
      showRevokeHint={showRevokeHint}
      busy={busy}
      onManageUsage={() => void openExternalUrl(CHATGPT_USAGE_URL)}
      onSignOut={() => void handleSignOut()}
      onSignInAgain={onSignInAgain}
    />
  );
}
