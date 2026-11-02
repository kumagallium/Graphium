// 素材の見出しに常に出す「アプリで開く」ボタン（デスクトップ版のドキュメントのみ）
//
// ⋯ メニューの中だけだと遠いので、全画面表示のボタンの隣にも置く。
// 押したときの処理は open-in-app.ts と同じ（編集できるコピーを OS の既定のアプリで開く）。
// 開けなかったときは、ボタンの色とツールチップで知らせる。

import { useState } from "react";
import { ExternalLink } from "lucide-react";
import { useT } from "../../i18n";
import { canOpenInApp, openInApp } from "./open-in-app";
import type { MediaIndexEntry } from "./media-index";

export function OpenInAppButton({
  entry,
  className,
  style,
}: {
  entry: MediaIndexEntry;
  className?: string;
  style?: React.CSSProperties;
}) {
  const t = useT();
  const [failed, setFailed] = useState(false);
  if (!canOpenInApp(entry)) return null;
  const label = failed ? t("asset.openInAppFailed") : t("asset.openInApp");
  return (
    <button
      type="button"
      onClick={() => {
        setFailed(false);
        openInApp(entry).catch((err) => {
          console.error("[open-in-app] アプリで開けませんでした:", err);
          setFailed(true);
        });
      }}
      data-tooltip={label}
      aria-label={label}
      className={className}
      style={failed ? { ...style, color: "var(--color-destructive, #c0392b)" } : style}
    >
      <ExternalLink size={14} />
    </button>
  );
}
