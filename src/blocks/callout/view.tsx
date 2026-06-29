// Callout ブロック
// Notion 風の「枠付き・アイコン付き」注記ブロック。本文はインライン編集可能。
//
// 配色・アイコンは design.md のデザインガイドラインに準拠する:
//   - 色は app.css の セマンティックトークン（--color-info / --color-success /
//     --color-warning / --color-error）と ブランドニュートラル（--color-muted /
//     --color-border / --color-primary）のみを使う。ハードコード色は使わない。
//   - アイコンはアプリ共通の lucide-react を使う（絵文字ではなく統一されたアイコン言語）。
//
// 種類（variant）がアイコンと配色をまとめて決める。アイコンをクリックすると
// 種類を切り替えられる。配置（textAlignment）は BlockNote の defaultProps を
// 流用し、サイドメニューの「配置」から操作できる。

import { createReactBlockSpec } from "@blocknote/react";
import { defaultProps } from "@blocknote/core";
import { useState, useRef, useEffect } from "react";
import {
  Lightbulb,
  Info,
  CheckCircle2,
  AlertTriangle,
  AlertCircle,
  type LucideIcon,
} from "lucide-react";
import { getCalloutVariantLabel } from "../../i18n";

export type CalloutVariant = "note" | "info" | "success" | "warning" | "danger";

// 各 variant の見た目。色はすべて CSS 変数（design.md のトークン）で参照する。
type VariantStyle = {
  Icon: LucideIcon;
  bg: string;
  border: string;
  fg: string; // アイコン色
};

export const CALLOUT_VARIANTS: Record<CalloutVariant, VariantStyle> = {
  note: {
    Icon: Lightbulb,
    bg: "var(--color-muted)",
    border: "var(--color-border)",
    fg: "var(--color-primary)",
  },
  info: {
    Icon: Info,
    bg: "var(--color-info-bg)",
    border: "var(--color-info-border)",
    fg: "var(--color-info)",
  },
  success: {
    Icon: CheckCircle2,
    bg: "var(--color-success-bg)",
    border: "var(--color-success-border)",
    fg: "var(--color-success)",
  },
  warning: {
    Icon: AlertTriangle,
    bg: "var(--color-warning-bg)",
    border: "var(--color-warning-border)",
    fg: "var(--color-warning)",
  },
  danger: {
    Icon: AlertCircle,
    bg: "var(--color-error-bg)",
    border: "var(--color-error-border)",
    fg: "var(--color-error)",
  },
};

const VARIANT_ORDER: CalloutVariant[] = ["note", "info", "success", "warning", "danger"];

function normalizeVariant(v: unknown): CalloutVariant {
  return VARIANT_ORDER.includes(v as CalloutVariant) ? (v as CalloutVariant) : "note";
}

export const CalloutBlock = createReactBlockSpec(
  {
    type: "callout" as const,
    propSchema: {
      // 配置は BlockNote 標準の既定プロパティを流用（サイドメニュー「配置」で操作）
      textAlignment: defaultProps.textAlignment,
      // 種類: アイコンと配色をまとめて決める
      variant: { default: "note" as const },
    },
    content: "inline" as const,
  },
  {
    render: (props) => {
      const variant = normalizeVariant(props.block.props.variant);
      const style = CALLOUT_VARIANTS[variant];
      const Icon = style.Icon;
      const [pickerOpen, setPickerOpen] = useState(false);
      const rootRef = useRef<HTMLDivElement>(null);

      // 外側クリックでピッカーを閉じる
      useEffect(() => {
        if (!pickerOpen) return;
        const onDown = (e: MouseEvent) => {
          if (!rootRef.current?.contains(e.target as Node)) setPickerOpen(false);
        };
        document.addEventListener("mousedown", onDown);
        return () => document.removeEventListener("mousedown", onDown);
      }, [pickerOpen]);

      const pickVariant = (v: CalloutVariant) => {
        (props.editor as any).updateBlock(props.block, { props: { variant: v } });
        setPickerOpen(false);
      };

      return (
        <div
          ref={rootRef}
          data-test="callout-block"
          data-callout-variant={variant}
          style={{
            display: "flex",
            gap: 10,
            padding: "12px 14px",
            borderRadius: 8,
            background: style.bg,
            border: `1px solid ${style.border}`,
            alignItems: "flex-start",
            width: "100%",
          }}
        >
          {/* アイコン（クリックで種類を変更） */}
          <div style={{ position: "relative", flex: "0 0 auto" }} contentEditable={false}>
            <button
              type="button"
              onClick={() => setPickerOpen((v) => !v)}
              title={getCalloutVariantLabel(variant)}
              aria-label={getCalloutVariantLabel(variant)}
              style={{
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                width: 24,
                height: 24,
                marginTop: 1,
                padding: 0,
                background: "transparent",
                border: "none",
                cursor: "pointer",
                color: style.fg,
                borderRadius: 6,
              }}
            >
              <Icon size={18} strokeWidth={2} />
            </button>
            {pickerOpen && (
              <div role="menu" style={pickerStyles.menu}>
                {VARIANT_ORDER.map((v) => {
                  const vs = CALLOUT_VARIANTS[v];
                  const VIcon = vs.Icon;
                  const active = v === variant;
                  return (
                    <button
                      key={v}
                      type="button"
                      onClick={() => pickVariant(v)}
                      style={{
                        ...pickerStyles.item,
                        background: active ? "var(--color-surface-hover, #edf3ed)" : "transparent",
                      }}
                    >
                      <span style={{ display: "inline-flex", color: vs.fg }}>
                        <VIcon size={16} strokeWidth={2} />
                      </span>
                      <span style={pickerStyles.itemLabel}>{getCalloutVariantLabel(v)}</span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
          {/* 本文（インライン編集領域） */}
          <div
            ref={props.contentRef}
            style={{ flex: 1, minWidth: 0, lineHeight: "1.6" }}
          />
        </div>
      );
    },
  }
);

const pickerStyles: Record<string, React.CSSProperties> = {
  menu: {
    position: "absolute",
    top: "calc(100% + 4px)",
    left: 0,
    zIndex: 20,
    display: "flex",
    flexDirection: "column",
    gap: 2,
    padding: 6,
    minWidth: 140,
    borderRadius: 8,
    background: "var(--color-card)",
    border: "1px solid var(--color-border)",
    boxShadow: "0 4px 16px rgba(26,46,29,0.12)",
  },
  item: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    padding: "6px 8px",
    border: "none",
    borderRadius: 6,
    cursor: "pointer",
    textAlign: "left",
  },
  itemLabel: {
    fontSize: 13,
    color: "var(--color-foreground)",
  },
};
