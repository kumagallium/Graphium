// ──────────────────────────────────────────────
// 手順パラメータの引き継ぎピッカー
//
// 同じ名前の手順を過去にどう記録したかを見て、パラメータの「key だけ」を
// 今の step に写す。値は実験ごとに変わるが、何を測るか・何を制御するかは
// あまり変わらない、という観察に基づく。
//
// 値は入れない。過去の値を初期値にすると、書き換え忘れが前回の条件として
// 残ってしまう。あくまで「欄を用意する」に留める。
//
// 表記ゆれ（「温度」「焼成温度」）は統合せずそのまま並べる。件数順に出して
// 選ぶのはユーザーに委ねる — 意味の違うものを勝手にまとめるほうが害が大きい。
// ──────────────────────────────────────────────

import { useMemo, useState } from "react";
import { Check, Plus } from "lucide-react";
import { useT } from "../../i18n";
import type { ParamKeyStat } from "./process-index";

export type StepParamPickerProps = {
  /** 今の step のタイトル。空なら候補を出しようがないので促しを出す */
  stepName: string;
  /** collectParamKeysForStep の結果（件数の降順で渡ってくる前提） */
  stats: ParamKeyStat[];
  /** この手順名を使ったノート数（collectStepNames 由来）。見出しの補足に出す */
  noteCount?: number;
  /** 選んだ key を空欄のパラメータとして step に追加する */
  onInsert: (keys: string[]) => void;
  onClose: () => void;
};

const styles = {
  menu: {
    position: "absolute" as const,
    top: "calc(100% + 6px)",
    right: 0,
    zIndex: 30,
    width: 300,
    maxHeight: 380,
    display: "flex",
    flexDirection: "column" as const,
    background: "var(--color-card)",
    border: "1px solid var(--color-border)",
    borderRadius: 10,
    boxShadow: "var(--shadow-2)",
    overflow: "hidden",
  },
  header: {
    padding: "10px 12px 8px",
    borderBottom: "1px solid var(--color-border-subtle)",
  },
  title: {
    fontSize: 12,
    fontWeight: 600,
    color: "var(--color-foreground)",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap" as const,
  },
  list: { overflowY: "auto" as const, padding: 4 },
  item: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    width: "100%",
    padding: "7px 8px",
    border: "none",
    borderRadius: 6,
    cursor: "pointer",
    textAlign: "left" as const,
    fontSize: 12,
    background: "transparent",
  },
  keyText: {
    flex: "1 1 auto",
    minWidth: 0,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap" as const,
  },
  sample: { fontSize: 10, color: "var(--color-text-tertiary)", fontWeight: 400 },
  count: {
    flex: "0 0 auto",
    fontSize: 10,
    color: "var(--color-text-tertiary)",
    fontVariantNumeric: "tabular-nums" as const,
  },
  // 件数の帯。数字だけだと差が読み取りにくいので、背後に薄く敷く
  bar: {
    position: "absolute" as const,
    left: 0,
    top: 0,
    bottom: 0,
    background: "var(--color-label-activity-bg)",
    borderRadius: 6,
    pointerEvents: "none" as const,
  },
  empty: {
    padding: "16px 12px",
    fontSize: 11,
    lineHeight: 1.6,
    color: "var(--color-text-tertiary)",
    textAlign: "center" as const,
  },
  footer: {
    display: "flex",
    alignItems: "center",
    gap: 6,
    padding: "8px 10px",
    borderTop: "1px solid var(--color-border-subtle)",
    background: "var(--color-surface)",
  },
  textButton: {
    padding: "4px 6px",
    border: "none",
    background: "transparent",
    borderRadius: 5,
    cursor: "pointer",
    fontSize: 11,
    color: "var(--color-muted-foreground)",
  },
  primaryButton: {
    marginLeft: "auto",
    display: "inline-flex",
    alignItems: "center",
    gap: 4,
    padding: "5px 10px",
    border: "none",
    borderRadius: 6,
    cursor: "pointer",
    fontSize: 11,
    fontWeight: 600,
    background: "var(--color-primary)",
    color: "var(--color-primary-foreground)",
  },
  hint: {
    padding: "0 12px 10px",
    fontSize: 10,
    lineHeight: 1.5,
    color: "var(--color-text-tertiary)",
  },
};

export function StepParamPicker({
  stepName,
  stats,
  noteCount,
  onInsert,
  onClose,
}: StepParamPickerProps) {
  const t = useT();
  const [selected, setSelected] = useState<Set<string>>(() => new Set());

  const maxCount = useMemo(
    () => stats.reduce((max, s) => Math.max(max, s.noteCount), 0),
    [stats],
  );
  const toggle = (key: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const named = stepName.trim().length > 0;

  return (
    <div role="menu" style={styles.menu} data-test="step-param-picker">
      <div style={styles.header}>
        <div style={styles.title}>
          {named ? t("stepParams.title", { name: stepName.trim() }) : t("stepParams.button")}
        </div>
        {named && noteCount !== undefined && stats.length > 0 && (
          <div style={{ ...styles.count, marginTop: 2 }}>
            {t("stepParams.usedInNotes", { n: String(noteCount) })}
          </div>
        )}
      </div>

      {!named && <div style={styles.empty}>{t("stepParams.noStepName")}</div>}
      {named && stats.length === 0 && <div style={styles.empty}>{t("stepParams.empty")}</div>}

      {named && stats.length > 0 && (
        <>
          <div style={styles.list}>
            {stats.map((stat) => {
              const on = selected.has(stat.key);
              const ratio = maxCount > 0 ? stat.noteCount / maxCount : 0;
              return (
                <button
                  key={stat.key}
                  type="button"
                  role="menuitemcheckbox"
                  aria-checked={on}
                  onClick={() => toggle(stat.key)}
                  style={{
                    ...styles.item,
                    position: "relative",
                    color: on ? "var(--color-label-activity)" : "var(--color-foreground)",
                    fontWeight: on ? 600 : 400,
                  }}
                >
                  <span style={{ ...styles.bar, width: `${Math.round(ratio * 100)}%`, opacity: on ? 1 : 0.5 }} />
                  <span
                    aria-hidden
                    style={{
                      position: "relative",
                      flex: "0 0 auto",
                      width: 14,
                      height: 14,
                      display: "inline-flex",
                      alignItems: "center",
                      justifyContent: "center",
                      borderRadius: 3,
                      border: `1px solid ${on ? "var(--color-label-activity)" : "var(--color-border)"}`,
                      background: on ? "var(--color-label-activity)" : "transparent",
                      color: "var(--color-card)",
                    }}
                  >
                    {on && <Check size={10} strokeWidth={3} />}
                  </span>
                  <span style={{ ...styles.keyText, position: "relative" }}>
                    {stat.key}
                    {stat.sampleValue && (
                      <span style={{ ...styles.sample, marginLeft: 6 }}>
                        {t("stepParams.sample", { value: stat.sampleValue })}
                      </span>
                    )}
                  </span>
                  <span style={{ ...styles.count, position: "relative" }}>
                    {t("stepParams.noteCount", { n: String(stat.noteCount) })}
                  </span>
                </button>
              );
            })}
          </div>
          <div style={styles.hint}>{t("stepParams.hint")}</div>
          <div style={styles.footer}>
            <button
              type="button"
              style={styles.textButton}
              onClick={() =>
                setSelected((prev) =>
                  prev.size === stats.length ? new Set() : new Set(stats.map((s) => s.key)),
                )
              }
            >
              {selected.size === stats.length ? t("stepParams.clearAll") : t("stepParams.selectAll")}
            </button>
            <button
              type="button"
              style={{
                ...styles.primaryButton,
                opacity: selected.size === 0 ? 0.5 : 1,
                cursor: selected.size === 0 ? "not-allowed" : "pointer",
              }}
              disabled={selected.size === 0}
              onClick={() => {
                // 表示順（件数の降順）のまま渡す。選んだ順に並べると再現しない
                onInsert(stats.map((s) => s.key).filter((k) => selected.has(k)));
                onClose();
              }}
            >
              <Plus size={12} strokeWidth={2.4} />
              {t("stepParams.insert")}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
