// Cmd+K Composer の grounding スコープ切り替えチップ。
// 発散（overview）/ 収束（primary）の 2 状態セグメント。
//   - 発散: ナレッジ（知見・洞察・関連項目）も含めて広く（着想・構成向け・デフォルト）
//   - 収束: 原文＋メモに絞る（執筆・引用・検証向け）
// 詳細: docs/internal/citation-grounding-scope-design-2026-06.md
//
// 純粋な制御コンポーネント（value/onChange のみ）。状態は呼び出し側が持つ。

import { Network, Target } from "lucide-react";
import { useT } from "@/i18n";
import type { GroundingScope } from "../../lib/grounding-scope";

type Props = {
  value: GroundingScope;
  onChange: (scope: GroundingScope) => void;
};

const SEGMENTS: {
  scope: GroundingScope;
  Icon: typeof Network;
  labelKey: string;
  hintKey: string;
}[] = [
  {
    scope: "overview",
    Icon: Network,
    labelKey: "composer.scope.overview",
    hintKey: "composer.scope.overviewHint",
  },
  {
    scope: "primary",
    Icon: Target,
    labelKey: "composer.scope.primary",
    hintKey: "composer.scope.primaryHint",
  },
];

export function GroundingScopeChip({ value, onChange }: Props) {
  const t = useT();
  return (
    <div
      role="group"
      aria-label={t("composer.scope.label")}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 2,
        padding: 2,
        border: "1px solid var(--rule)",
        borderRadius: 999,
        background: "var(--paper)",
      }}
    >
      {SEGMENTS.map(({ scope, Icon, labelKey, hintKey }) => {
        const active = value === scope;
        return (
          <button
            key={scope}
            type="button"
            onClick={() => onChange(scope)}
            title={t(hintKey)}
            aria-pressed={active}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 4,
              padding: "2px 9px",
              border: "none",
              borderRadius: 999,
              cursor: "pointer",
              fontSize: 11,
              fontFamily: "inherit",
              lineHeight: 1.6,
              whiteSpace: "nowrap",
              background: active ? "var(--forest)" : "transparent",
              color: active ? "var(--paper)" : "var(--ink-4)",
              fontWeight: active ? 600 : 400,
              transition: "background 120ms ease, color 120ms ease",
            }}
          >
            <Icon size={12} aria-hidden />
            <span>{t(labelKey)}</span>
          </button>
        );
      })}
    </div>
  );
}
