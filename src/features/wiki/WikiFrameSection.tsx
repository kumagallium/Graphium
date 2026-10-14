// WikiContextDrawer の折りたたみ節「構造」— 判断・規則・観察の frame を読む欄。
// 書き込みは 2 つだけ（結果の評価、推論で補った frame の確認）。どちらも人の明示操作で、
// 呼び出し側が activityType なしで保存する（版は取らない）。
// 設計: docs/internal/judgment-rule-frames-design-2026-10.md §3 / §4

import { useState } from "react";
import { ChevronDown } from "lucide-react";
import type {
  DecisionFrame,
  FrameComparator,
  FrameValue,
  WikiMeta,
  WikiMetaSummary,
} from "../../lib/document-types";
import { useT } from "../../i18n";
import {
  canWriteRationale,
  formatFrameValue,
  hasInferredFrame,
  resolveFrameClaimLinks,
  type FrameClaimLink,
} from "./frame-view";

type Assessment = NonNullable<DecisionFrame["outcomeAssessment"]> | "none";

const labelStyle = { color: "var(--ink-4)", fontWeight: 500, flexShrink: 0 } as const;
const rowStyle = { display: "flex", gap: 8, alignItems: "baseline", flexWrap: "wrap" } as const;
const quoteStyle = {
  margin: 0,
  paddingLeft: 8,
  borderLeft: "2px solid var(--rule)",
  color: "var(--ink-2)",
} as const;
const smallButtonStyle = {
  padding: "0 8px",
  borderRadius: "var(--pill)",
  border: "1px solid var(--rule)",
  background: "var(--paper)",
  color: "var(--ink-2)",
  font: "inherit",
  fontSize: 12,
  cursor: "pointer",
} as const;

export function WikiFrameSection({
  wikiMeta,
  wikiId,
  allWikiMetas,
  onNavigateNote,
  onWriteRationale,
  onUpdateWikiMeta,
}: {
  wikiMeta: WikiMeta;
  wikiId?: string;
  allWikiMetas?: Map<string, WikiMetaSummary>;
  onNavigateNote?: (noteId: string) => void;
  /** 「理由を書く」— 同じパネルを 1 件で開く */
  onWriteRationale?: (wikiId: string) => void;
  /** 人の明示操作（評価の選択・確認）の保存。activityType なし */
  onUpdateWikiMeta?: (patch: Partial<WikiMeta>) => void;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const inferred = hasInferredFrame(wikiMeta);
  const df = wikiMeta.decisionFrame;
  const rf = wikiMeta.ruleFrame;
  const of = wikiMeta.observationFrame;
  const cmpLabel = (k: `wiki.frame.comparator.${FrameComparator}`) => t(k as never);

  const confirm = (key: "decisionFrame" | "ruleFrame" | "observationFrame") => {
    const f = wikiMeta[key];
    if (!f || !onUpdateWikiMeta) return;
    onUpdateWikiMeta({ [key]: { ...f, reviewState: "confirmed" } } as Partial<WikiMeta>);
  };
  const confirmButton = (key: "decisionFrame" | "ruleFrame" | "observationFrame") =>
    wikiMeta[key]?.reviewState === "inferred" ? (
      <span style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
        <span style={{ fontSize: 12, color: "var(--amber-ink, #b45309)" }}>{t("wiki.frame.inferred")}</span>
        {onUpdateWikiMeta && (
          <button
            type="button"
            style={smallButtonStyle}
            aria-label={`${t("wiki.frame.confirm")}: ${t(`wiki.frame.kind.${key === "decisionFrame" ? "decision" : key === "ruleFrame" ? "rule" : "observation"}` as never)}`}
            onClick={() => confirm(key)}
          >
            {t("wiki.frame.confirm")}
          </button>
        )}
      </span>
    ) : null;

  const links = (items: FrameClaimLink[]) =>
    items.map((l, i) => (
      <span key={l.id + i}>
        {i > 0 && ", "}
        {l.resolved && onNavigateNote ? (
          <button
            type="button"
            onClick={() => onNavigateNote(l.navigateId)}
            style={{
              background: "transparent",
              border: "none",
              padding: 0,
              margin: 0,
              color: "var(--forest-ink, var(--ink-2))",
              font: "inherit",
              textDecoration: "underline",
              textDecorationStyle: "dotted",
              textDecorationColor: "var(--rule)",
              cursor: "pointer",
            }}
          >
            {l.label}
          </button>
        ) : (
          <span style={{ color: "var(--ink-4)" }}>{l.label || t("wiki.frame.unknownClaim")}</span>
        )}
      </span>
    ));

  const valueList = (values: FrameValue[]) => (
    <ul style={{ margin: 0, paddingLeft: 18 }}>
      {values.map((v, i) => (
        <li key={i} title={v.span}>
          {formatFrameValue(v, cmpLabel)}
        </li>
      ))}
    </ul>
  );

  const triggers = df ? resolveFrameClaimLinks(df.triggerClaimIds, allWikiMetas) : [];
  const outcomes = df ? resolveFrameClaimLinks(df.outcomeClaimIds, allWikiMetas) : [];
  const assessment: Assessment = df?.outcomeAssessment ?? "none";

  return (
    <div
      style={{
        marginTop: 6,
        padding: open ? "6px 10px 8px" : "4px 10px",
        borderRadius: "var(--r-2)",
        background: "var(--paper)",
        border: "1px dashed var(--rule)",
        fontSize: 14,
        lineHeight: 1.55,
        color: "var(--ink-2)",
      }}
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 4,
          padding: "1px 4px",
          margin: 0,
          background: "transparent",
          border: "none",
          color: "var(--ink-2)",
          font: "inherit",
          cursor: "pointer",
        }}
      >
        <ChevronDown
          size={11}
          style={{ transform: open ? "rotate(0)" : "rotate(-90deg)", transition: "transform 120ms" }}
        />
        <span style={{ fontWeight: 500 }}>{t("wiki.frame.section")}</span>
        {/* 閉じていても確認待ちが分かるように */}
        {inferred && !open && (
          <span style={{ fontSize: 12, color: "var(--amber-ink, #b45309)" }}>{t("wiki.frame.inferred")}</span>
        )}
      </button>
      {open && (
        <div style={{ marginTop: 4, display: "flex", flexDirection: "column", gap: 8 }}>
          {df && (
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              {confirmButton("decisionFrame")}
              {triggers.length > 0 && (
                <div style={rowStyle}>
                  <span style={labelStyle}>{t("wiki.frame.trigger")}</span>
                  <span>{links(triggers)}</span>
                </div>
              )}
              <div style={rowStyle}>
                <span style={labelStyle}>{t("wiki.frame.action")}</span>
                <blockquote style={quoteStyle}>{df.action}</blockquote>
              </div>
              <div style={rowStyle}>
                <span style={labelStyle}>{t("wiki.frame.rationale")}</span>
                {df.rationale !== null ? (
                  <blockquote style={quoteStyle}>{df.rationale}</blockquote>
                ) : (
                  <>
                    <span style={{ color: "var(--ink-4)" }}>{t("wiki.frame.rationaleMissing")}</span>
                    {onWriteRationale && wikiId && canWriteRationale(wikiMeta) && (
                      <button type="button" style={smallButtonStyle} onClick={() => onWriteRationale(wikiId)}>
                        {t("ingest.writeRationale")}
                      </button>
                    )}
                  </>
                )}
              </div>
              {outcomes.length > 0 && (
                <div style={rowStyle}>
                  <span style={labelStyle}>{t("wiki.frame.outcome")}</span>
                  <span>{links(outcomes)}</span>
                </div>
              )}
              <div style={rowStyle}>
                <span style={labelStyle}>{t("wiki.frame.assessment")}</span>
                <select
                  aria-label={t("wiki.frame.assessment")}
                  value={assessment}
                  disabled={!onUpdateWikiMeta}
                  onChange={(e) => {
                    const v = e.target.value as Assessment;
                    onUpdateWikiMeta?.({
                      decisionFrame: { ...df, outcomeAssessment: v === "none" ? null : v },
                    });
                  }}
                  style={{
                    font: "inherit",
                    fontSize: 13,
                    padding: "0 4px",
                    border: "1px solid var(--rule)",
                    borderRadius: "var(--r-2)",
                    background: "var(--paper)",
                    color: "var(--ink-2)",
                  }}
                >
                  {(["none", "confirmed", "refuted", "inconclusive"] as const).map((a) => (
                    <option key={a} value={a}>
                      {t(`wiki.frame.assessment.${a}` as never)}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          )}
          {rf && (
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              {confirmButton("ruleFrame")}
              <div style={rowStyle}>
                <span style={labelStyle}>{t("wiki.frame.conditions")}</span>
                {valueList(rf.conditions)}
              </div>
              <div style={rowStyle}>
                <span style={labelStyle}>{t("wiki.frame.consequences")}</span>
                {valueList(rf.consequences)}
              </div>
              {rf.mechanism && (
                <div style={rowStyle}>
                  <span style={labelStyle}>{t("wiki.frame.mechanism")}</span>
                  <blockquote style={quoteStyle}>{rf.mechanism}</blockquote>
                </div>
              )}
            </div>
          )}
          {of && (
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              {confirmButton("observationFrame")}
              {of.featureOfInterest && (
                <div style={rowStyle}>
                  <span style={labelStyle}>{t("wiki.frame.featureOfInterest")}</span>
                  <span>{of.featureOfInterest}</span>
                </div>
              )}
              <div style={rowStyle}>
                <span style={labelStyle}>{t("wiki.frame.results")}</span>
                {valueList(of.results)}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
