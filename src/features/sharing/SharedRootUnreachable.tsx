// 共有フォルダに到達できないときの案内と、その場で直すためのボタン。
//
// NAS の共有は macOS ではスリープ復帰・再起動で静かにマウントが外れ、Windows では
// ネットワークドライブが「切断」で残る。Finder / エクスプローラーで一度開けば繋がり直すが、
// 利用者から見ると「NAS は見えているのに Graphium だけ読めない」になるので、
//   - OS ごとの一言（何が起きたか・どう直るか）
//   - 「再接続」（控えてある smb:// や \\host\share を OS に渡す → 見えたら自動で読み直す）
//   - 別名でマウントされているときの候補（/Volumes/Kumagai-1/… → 「このパスを使う」）
// を 1 枚にまとめる。Library と設定の接続テストの両方から使う。

import { useCallback, useEffect, useRef, useState } from "react";
import { AlertTriangle, Loader2, Plug, RefreshCw } from "lucide-react";
import { useT } from "../../i18n";
import { isMacLike } from "../../lib/shortcut-label";
import {
  reconnectSharedRoot,
  waitForSharedRoot,
  type SharedRootDiagnosis,
} from "../../lib/storage/shared";

type Props = {
  /** 到達できなかった共有ルート */
  root: string;
  /** 診断結果（reachable が false のときだけ描く） */
  diagnosis: SharedRootDiagnosis;
  /** 見えるようになった（またはユーザーが押した）ときの読み直し */
  onReload: () => void;
  /** 別名マウントの候補を採用する。渡さなければ候補はパスの表示だけ */
  onUseAlternative?: (path: string) => void;
  /** テスト・ストーリー用の差し替え。既定は Tauri コマンド */
  reconnect?: (remote: string) => Promise<void>;
  waitUntilReachable?: (root: string) => Promise<boolean>;
};

type Phase =
  | { kind: "idle" }
  | { kind: "waiting" }
  | { kind: "timeout" }
  | { kind: "failed"; error: string };

export function SharedRootUnreachable({
  root,
  diagnosis,
  onReload,
  onUseAlternative,
  reconnect = reconnectSharedRoot,
  waitUntilReachable = waitForSharedRoot,
}: Props) {
  const t = useT();
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const handleReconnect = useCallback(async () => {
    if (!diagnosis.remote) return;
    setPhase({ kind: "waiting" });
    try {
      await reconnect(diagnosis.remote);
    } catch (e) {
      if (alive.current) setPhase({ kind: "failed", error: e instanceof Error ? e.message : String(e) });
      return;
    }
    // Finder / エクスプローラーが繋ぎ直すのを待ち、見えたらこちらで読み直す
    const ok = await waitUntilReachable(root);
    if (!alive.current) return;
    if (ok) {
      setPhase({ kind: "idle" });
      onReload();
    } else {
      setPhase({ kind: "timeout" });
    }
  }, [diagnosis.remote, reconnect, waitUntilReachable, root, onReload]);

  const hint = t(isMacLike() ? "library.unreachable.hint.mac" : "library.unreachable.hint.windows");
  const waiting = phase.kind === "waiting";

  return (
    <div
      className="m-3 p-3 rounded border border-destructive/30 bg-destructive/5 text-xs space-y-2 shrink-0"
      data-testid="shared-root-unreachable"
    >
      <div className="flex items-start gap-2 text-destructive">
        <AlertTriangle size={14} className="mt-0.5 shrink-0" />
        <div className="min-w-0">
          <div className="font-semibold">{t("library.unreachable.title")}</div>
          <div className="font-mono break-all text-foreground/80 mt-0.5">{root}</div>
        </div>
      </div>

      <p className="text-muted-foreground">{hint}</p>

      {diagnosis.alternatives.length > 0 && (
        <div className="space-y-1">
          <div className="text-foreground">{t("library.unreachable.alternatives")}</div>
          <ul className="space-y-1">
            {diagnosis.alternatives.map((path) => (
              <li key={path} className="flex items-center gap-2 flex-wrap">
                <code className="font-mono break-all text-foreground/80">{path}</code>
                {onUseAlternative && (
                  <button
                    type="button"
                    onClick={() => onUseAlternative(path)}
                    className="px-2 py-0.5 rounded border border-border bg-background hover:bg-muted text-foreground"
                  >
                    {t("library.unreachable.useAlternative")}
                  </button>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="flex items-center gap-2 flex-wrap">
        {diagnosis.remote ? (
          <button
            type="button"
            onClick={handleReconnect}
            disabled={waiting}
            className="px-2 py-1 rounded bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-60 flex items-center gap-1"
          >
            {waiting ? <Loader2 size={12} className="animate-spin" /> : <Plug size={12} />}
            {waiting
              ? t("library.unreachable.reconnecting")
              : t("library.unreachable.reconnect", { remote: diagnosis.remote })}
          </button>
        ) : (
          <span className="text-muted-foreground">{t("library.unreachable.noRemote")}</span>
        )}
        <button
          type="button"
          onClick={onReload}
          disabled={waiting}
          className="px-2 py-1 rounded border border-border bg-background hover:bg-muted text-foreground disabled:opacity-60 flex items-center gap-1"
        >
          <RefreshCw size={12} />
          {t("library.unreachable.reload")}
        </button>
      </div>

      {phase.kind === "timeout" && (
        <p className="text-muted-foreground">{t("library.unreachable.reconnectTimeout")}</p>
      )}
      {phase.kind === "failed" && (
        <p className="text-destructive break-all">
          {t("library.unreachable.reconnectFailed", { error: phase.error })}
        </p>
      )}
    </div>
  );
}
