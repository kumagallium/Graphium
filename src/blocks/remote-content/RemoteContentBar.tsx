// ノート単位の「外部画像を読み込む」バー。
//
// メールクライアントと同じ形。ノートを開いた時点では取りに行かず、押したときだけ
// このノートの外部メディアを読み込む。押した同意はこのセッション限りで、ノートにも
// localStorage にも残さない（理由は store.ts の冒頭）。
//
// 見た目はアーカイブ／ゴミ箱バナー（note-app.tsx・side-peek.tsx）に合わせる。

import { EyeOff } from "lucide-react";
import { useLocale } from "../../i18n";
import { useRemoteContentGate } from "./store";

export type RemoteContentBarProps = {
  /** ゲートの scope。本文を出しているエディタに渡したものと同じ値（useRemoteContentScope） */
  scope: string;
  /** 外側の余白の付け方。メインエディタは中央寄せの帯、SidePeek は本文と同じ幅 */
  variant?: "page" | "inline";
};

export function RemoteContentBar({ scope, variant = "page" }: RemoteContentBarProps) {
  const { t } = useLocale();
  const { blockedCount, allowed, allow } = useRemoteContentGate(scope);

  // 読み込み済み・設定で常時許可・そもそも外部メディアが無いノートでは出さない
  if (allowed || blockedCount === 0) return null;

  const bar = (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        maxWidth: variant === "page" ? 720 : undefined,
        margin: variant === "page" ? "0 auto" : undefined,
        marginBottom: variant === "inline" ? 12 : undefined,
        padding: "6px 12px",
        borderRadius: "var(--r-1)",
        background: "var(--paper)",
        border: "1px solid var(--rule)",
        color: "var(--ink-2)",
        fontSize: 13,
      }}
    >
      <EyeOff size={14} style={{ flexShrink: 0, color: "var(--ink-3)" }} />
      <span style={{ flex: 1, lineHeight: 1.4 }}>
        {t("note.remoteContent.blocked", { count: String(blockedCount) })}
      </span>
      <button
        onClick={allow}
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 4,
          flexShrink: 0,
          padding: "4px 10px",
          borderRadius: "var(--r-1)",
          border: "1px solid var(--rule)",
          background: "var(--paper-2)",
          color: "var(--ink-2)",
          fontSize: 12,
          fontWeight: 500,
          cursor: "pointer",
        }}
        title={t("note.remoteContent.loadHint")}
      >
        {t("note.remoteContent.load")}
      </button>
    </div>
  );

  if (variant === "inline") return bar;
  return <div style={{ padding: "0 16px", marginTop: 8 }}>{bar}</div>;
}
