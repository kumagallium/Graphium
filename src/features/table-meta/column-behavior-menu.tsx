// 列のはたらきメニュー（列ヘッダから開く）
//
// 「型を選ぶ」ではなく「この列で何が起きるかをオン・オフする」形にしている。
// 1 つの列に複数のはたらきが同居しうる（日時が自動で入る列の行から、その日の
// 詳細ノートを作る）ため、単一選択のドロップダウンでは表現できない。
//
// このファイルは見た目と操作だけを持つ。ストアとの接続やヘッダ位置の計算は
// 呼び出し側（column-header-layer）が担う。

import { AlertCircle, Check, ChevronDown, Clock, FileSymlink } from "lucide-react";
import { t } from "../../i18n";
import type { ColumnType } from "./types";

/** メニューに並べるはたらき。順序はこの配列が正 */
const BEHAVIORS: { type: ColumnType; labelKey: string; descKey: string }[] = [
  {
    type: "datetime-auto",
    labelKey: "columnBehavior.datetimeAuto",
    descKey: "columnBehavior.datetimeAutoDesc",
  },
  {
    type: "note-link",
    labelKey: "columnBehavior.noteLink",
    descKey: "columnBehavior.noteLinkDesc",
  },
];

export type ColumnBehaviorMenuProps = {
  /** この列の名前（ヘッダのセル文字列）。空のこともある */
  columnName: string;
  /** この列に付いているはたらき */
  behaviors: readonly ColumnType[];
  /**
   * 迷子になった設定。tableMeta の columns にキーが残っているのに、その名前の列が
   * 表に無い状態（列ヘッダを書き換えたとき）。名前だけ渡す。
   */
  orphanColumnName?: string;
  onToggle: (type: ColumnType, next: boolean) => void;
  /** 迷子の設定をこの列に付け直す */
  onReattachOrphan?: () => void;
  /** 迷子の設定を捨てる */
  onDropOrphan?: () => void;
};

export function ColumnBehaviorMenu({
  columnName,
  behaviors,
  orphanColumnName,
  onToggle,
  onReattachOrphan,
  onDropOrphan,
}: ColumnBehaviorMenuProps) {
  return (
    <div
      style={{
        minWidth: 260,
        padding: 6,
        borderRadius: 8,
        border: "1px solid var(--color-border-subtle)",
        background: "var(--color-card)",
        boxShadow: "var(--shadow-2)",
        fontSize: 13,
        color: "var(--color-foreground)",
      }}
    >
      <div
        style={{
          padding: "4px 8px 6px",
          fontSize: 11,
          color: "var(--color-text-tertiary)",
        }}
      >
        {columnName
          ? t("columnBehavior.headingNamed", { column: columnName })
          : t("columnBehavior.heading")}
      </div>

      {BEHAVIORS.map(({ type, labelKey, descKey }) => {
        const on = behaviors.includes(type);
        return (
          <button
            key={type}
            type="button"
            onClick={() => onToggle(type, !on)}
            style={{
              display: "flex",
              alignItems: "flex-start",
              gap: 8,
              width: "100%",
              padding: "6px 8px",
              margin: 0,
              border: "none",
              borderRadius: 6,
              background: "transparent",
              cursor: "pointer",
              textAlign: "left",
            }}
            onMouseEnter={(e) => {
              (e.currentTarget as HTMLElement).style.background = "var(--color-surface-hover)";
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLElement).style.background = "transparent";
            }}
          >
            <span
              aria-hidden
              style={{
                flex: "none",
                width: 14,
                height: 14,
                marginTop: 2,
                borderRadius: 4,
                border: `1px solid ${on ? "var(--color-primary)" : "var(--color-input)"}`,
                background: on ? "var(--color-primary)" : "transparent",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color: "var(--color-primary-foreground)",
              }}
            >
              {on && <Check size={10} strokeWidth={3} />}
            </span>
            <span style={{ display: "flex", flexDirection: "column", gap: 2 }}>
              <span style={{ color: "var(--color-foreground)" }}>{t(labelKey)}</span>
              <span style={{ fontSize: 11, color: "var(--color-text-tertiary)" }}>
                {t(descKey)}
              </span>
            </span>
          </button>
        );
      })}

      {orphanColumnName !== undefined && (
        <div
          style={{
            marginTop: 4,
            paddingTop: 6,
            borderTop: "1px solid var(--color-border-subtle)",
          }}
        >
          <div style={{ padding: "2px 8px 6px", fontSize: 11, color: "var(--color-text-tertiary)" }}>
            {t("columnBehavior.orphanNotice", { column: orphanColumnName })}
          </div>
          <div style={{ display: "flex", gap: 4, padding: "0 4px 2px" }}>
            <button
              type="button"
              onClick={onReattachOrphan}
              style={{
                flex: 1,
                padding: "5px 8px",
                borderRadius: 6,
                border: "1px solid var(--color-input)",
                background: "var(--color-card)",
                color: "var(--color-foreground)",
                fontSize: 12,
                cursor: "pointer",
              }}
            >
              {t("columnBehavior.orphanReattach")}
            </button>
            <button
              type="button"
              onClick={onDropOrphan}
              style={{
                flex: "none",
                padding: "5px 8px",
                borderRadius: 6,
                border: "1px solid transparent",
                background: "transparent",
                color: "var(--color-text-tertiary)",
                fontSize: 12,
                cursor: "pointer",
              }}
            >
              {t("columnBehavior.orphanDrop")}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * 列ヘッダに出す小さな目印。はたらきが付いている列は常に、付いていない列は
 * ホバー中だけ薄く出す（表を読むときの邪魔にならないように）。
 */
export function ColumnBehaviorIndicator({
  behaviors,
  hasOrphan,
  onClick,
}: {
  behaviors: readonly ColumnType[];
  hasOrphan?: boolean;
  onClick: () => void;
}) {
  const active = behaviors.length > 0;
  return (
    <button
      type="button"
      onClick={onClick}
      title={t("columnBehavior.indicatorHint")}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 3,
        height: 18,
        padding: "0 5px",
        borderRadius: 5,
        border: "none",
        background: active ? "var(--color-accent)" : "transparent",
        // 迷子は「壊れている」ではなく「気づいてほしい」程度なので、
        // destructive（赤）ではなく本文色を少し立てるにとどめる
        color: active || hasOrphan
          ? "var(--color-accent-foreground)"
          : "var(--color-text-tertiary)",
        cursor: "pointer",
        opacity: active || hasOrphan ? 1 : 0.55,
      }}
    >
      {behaviors.includes("datetime-auto") && <Clock size={11} aria-hidden />}
      {behaviors.includes("note-link") && <FileSymlink size={11} aria-hidden />}
      {hasOrphan && <AlertCircle size={11} aria-hidden />}
      {!active && !hasOrphan && <ChevronDown size={11} aria-hidden />}
    </button>
  );
}
