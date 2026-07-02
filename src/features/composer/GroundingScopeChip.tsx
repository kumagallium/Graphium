// Cmd+K Composer の grounding スコープ切り替えチップ。
// 外部参照（external）/ 内部参照（internal）/ ノート内参照（notes）の 3 状態セグメント。
//   - 外部参照: Web 検索を強制して世界の知見を取り込む（調査向け）
//   - 内部参照: 引用したもの ＋ 蓄積した知識を横断検索（着想・構成向け・デフォルト）
//   - ノート内参照: 引用したものだけに絞る（横断検索しない・執筆・引用向け）
// 詳細: docs/internal/citation-grounding-scope-design-2026-06.md
//
// 純粋な制御コンポーネント（value/onChange のみ）。状態は呼び出し側が持つ。

import { Globe, Network, Target } from "lucide-react";
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
    scope: "external",
    Icon: Globe,
    labelKey: "composer.scope.external",
    hintKey: "composer.scope.externalHint",
  },
  {
    scope: "internal",
    Icon: Network,
    labelKey: "composer.scope.internal",
    hintKey: "composer.scope.internalHint",
  },
  {
    scope: "notes",
    Icon: Target,
    labelKey: "composer.scope.notes",
    hintKey: "composer.scope.notesHint",
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
