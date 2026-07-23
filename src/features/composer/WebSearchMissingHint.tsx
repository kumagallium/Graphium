// external（外部参照）選択時に Web 検索手段が見当たらないことを知らせる警告バナー。
// チャットパネルでは入力欄の直上、Cmd+K Composer ではチップ行の下に置く。
// 「使えない」ではなく「Web を見ずに回答する」劣化の告知なので、既存の
// no-models バナーより軽く、× で閉じられる（onDismiss は呼び出し側が state 管理）。
// 表示判定は use-web-search-availability.ts が持つ。

import { AlertTriangle, X } from "lucide-react";
import { useT } from "@/i18n";

type Props = {
  /** 指定すると右端に × を出す。閉じた状態の管理は呼び出し側（セッション内 state）。 */
  onDismiss?: () => void;
};

export function WebSearchMissingHint({ onDismiss }: Props) {
  const t = useT();
  const openAiSettings = () => {
    // panel.tsx / MissingApiKeyBanner と同じ間接化イベント。MCP セクションは AI タブ内。
    window.dispatchEvent(
      new CustomEvent("graphium-open-settings", { detail: { tab: "ai" } }),
    );
  };
  return (
    <div
      role="status"
      style={{
        display: "flex",
        alignItems: "flex-start",
        gap: 6,
        padding: "6px 8px 6px 10px",
        borderRadius: 8,
        border: "1px solid var(--color-warning-border)",
        background: "var(--color-warning-bg)",
        color: "var(--color-warning)",
        fontSize: 11,
        lineHeight: 1.5,
      }}
    >
      <AlertTriangle size={12} aria-hidden style={{ flexShrink: 0, marginTop: 2 }} />
      <span style={{ flex: 1 }}>
        {t("composer.scope.webSearchMissing")}{" "}
        <button
          type="button"
          onClick={openAiSettings}
          style={{
            display: "inline",
            padding: 0,
            border: "none",
            background: "none",
            cursor: "pointer",
            font: "inherit",
            color: "inherit",
            fontWeight: 600,
            textDecoration: "underline",
            textUnderlineOffset: 2,
          }}
        >
          {t("composer.scope.webSearchMissingCta")}
        </button>
      </span>
      {onDismiss && (
        <button
          type="button"
          onClick={onDismiss}
          aria-label={t("common.close")}
          style={{
            flexShrink: 0,
            display: "inline-flex",
            padding: 2,
            margin: -2,
            border: "none",
            background: "none",
            cursor: "pointer",
            color: "inherit",
            opacity: 0.7,
          }}
        >
          <X size={12} aria-hidden />
        </button>
      )}
    </div>
  );
}
