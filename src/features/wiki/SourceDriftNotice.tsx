// 「書いたあとで資料から消えた一節」の知らせ（トピック・問答・要約のページを開いたとき）。
// 判定は source-drift.ts（AI を使わない文字列の照合）。見つかったときだけ出す。
// 「読み直す」は、そのノートを取り込み直す（そのノートを引くページがすべて、一節の照合ごと見直される）。

import { useEffect, useState } from "react";
import { AlertTriangle, RefreshCw } from "lucide-react";
import { useT } from "../../i18n";
import type { SourceDrift } from "./source-drift";

export function SourceDriftNotice({
  pageKey,
  loadSourceDrift,
  titleOf,
  onReread,
}: {
  /** 開いているページを表す値（ID と更新日時）。変わったら照合し直す */
  pageKey: string;
  /** そのページの「書いたあとで資料から消えた一節」を求める（note-app が資料の読み方を持つ） */
  loadSourceDrift: () => Promise<SourceDrift[]>;
  /** 資料 id → 表示名 */
  titleOf: (sourceId: string) => string;
  /** そのノートを読み直す（取り込み直す）。渡さなければボタンを出さない */
  onReread?: (sourceId: string) => void;
}) {
  const t = useT();
  const [drift, setDrift] = useState<SourceDrift[]>([]);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setDrift([]);
    loadSourceDrift()
      .then((d) => { if (!cancelled) setDrift(d); })
      .catch(() => { /* 照合できなければ何も出さない（ページの表示は止めない） */ });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pageKey]);

  if (drift.length === 0) return null;
  const count = drift.reduce((n, d) => n + d.gone.length, 0);

  return (
    <div
      role="status"
      style={{
        margin: "6px 0",
        padding: "6px 10px",
        borderRadius: "var(--r-2)",
        background: "var(--amber-soft, var(--paper))",
        color: "var(--amber-ink, #b45309)",
        fontSize: 13,
        lineHeight: 1.55,
      }}
    >
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        style={{
          display: "flex",
          alignItems: "flex-start",
          gap: 6,
          width: "100%",
          padding: 0,
          border: "none",
          background: "transparent",
          color: "inherit",
          font: "inherit",
          textAlign: "left",
          cursor: "pointer",
        }}
      >
        <AlertTriangle size={13} style={{ marginTop: 3, flexShrink: 0 }} />
        <span>{t("sourceDrift.summary", { count: String(count) })}</span>
      </button>
      {open && (
        <div style={{ marginTop: 6, display: "flex", flexDirection: "column", gap: 8 }}>
          {drift.map((d) => (
            <div key={d.sourceId}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                <span style={{ color: "var(--ink-2)" }}>
                  {t("sourceDrift.source", { title: titleOf(d.sourceId), date: d.editedAt.slice(0, 10) })}
                </span>
                {onReread && (
                  <button
                    type="button"
                    onClick={() => onReread(d.sourceId)}
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 4,
                      padding: "1px 8px",
                      borderRadius: "var(--r-1)",
                      border: "1px solid var(--rule)",
                      background: "var(--paper)",
                      color: "var(--ink-2)",
                      fontSize: 12,
                      cursor: "pointer",
                    }}
                  >
                    <RefreshCw size={11} />
                    {t("sourceDrift.reread")}
                  </button>
                )}
              </div>
              <ul style={{ margin: "4px 0 0", paddingLeft: 18, color: "var(--ink-2)" }}>
                {d.gone.map((g, i) => (
                  <li key={i} style={{ marginBottom: 4 }}>
                    <div>{g.statement}</div>
                    <div style={{ color: "var(--ink-3)", fontSize: 12 }}>
                      {t("sourceDrift.passage")} “{g.passage}”
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          ))}
          <div style={{ color: "var(--ink-3)", fontSize: 12 }}>{t("sourceDrift.hint")}</div>
        </div>
      )}
    </div>
  );
}
