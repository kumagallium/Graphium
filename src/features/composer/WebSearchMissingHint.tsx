// external（外部参照）選択時に Web 検索手段が見当たらないことを知らせる 1 行ヒント。
// GroundingScopeChip の下に置く想定（チャットパネル / Cmd+K Composer 共通）。
// 「使えない」ではなく「本領を発揮しない」レベルの劣化なので、既存の
// no-models バナーより軽い控えめな警告行 + 設定（AI タブ）への導線に留める。
// 表示判定は use-web-search-availability.ts が持つ。

import { AlertTriangle } from "lucide-react";
import { useT } from "@/i18n";

export function WebSearchMissingHint() {
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
        gap: 5,
        fontSize: 11,
        lineHeight: 1.5,
        color: "var(--color-warning)",
      }}
    >
      <AlertTriangle size={12} aria-hidden style={{ flexShrink: 0, marginTop: 2 }} />
      <span>
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
    </div>
  );
}
