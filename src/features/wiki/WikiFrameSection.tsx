// WikiContextDrawer の折りたたみ節「構造」— 判断・規則・観察の frame を読む欄。
// 書き込みは 2 つだけ（結果の評価、推論で補った frame の確認）。どちらも人の明示操作で、
// 呼び出し側が activityType なしで保存する（版は取らない）。
// 設計: docs/internal/judgment-rule-frames-design-2026-10.md §3 / §4

import { useEffect, useState } from "react";
import { ChevronDown } from "lucide-react";
import type {
  AsterismLink,
  DecisionFrame,
  FrameComparator,
  FrameValue,
  WikiMeta,
  WikiMetaSummary,
} from "../../lib/document-types";
import { useT } from "../../i18n";
import { loadSettings, type AsterismSettings } from "../settings/store";
import { classifyVocabTerm, normalizeEvidenceIris, resolveAsterismTypeSlug } from "./asterism-link";
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
  asterismSettings,
  defaultOpen = false,
}: {
  wikiMeta: WikiMeta;
  wikiId?: string;
  allWikiMetas?: Map<string, WikiMetaSummary>;
  onNavigateNote?: (noteId: string) => void;
  /** 「理由を書く」— 同じパネルを 1 件で開く */
  onWriteRationale?: (wikiId: string) => void;
  /** 人の明示操作（評価の選択・確認）の保存。activityType なし */
  onUpdateWikiMeta?: (patch: Partial<WikiMeta>) => void;
  /** Asterism 連携の設定。省略時は保存済みの設定を読む（stories 用に差し替え可） */
  asterismSettings?: AsterismSettings;
  /** 「構造」節を最初から開く（stories 用。通常は閉じて始まる） */
  defaultOpen?: boolean;
}) {
  const t = useT();
  const [open, setOpen] = useState(defaultOpen);
  const asterismConf = asterismSettings ?? loadSettings().asterism;
  const asterismLink = wikiMeta.asterism;
  const [evidenceText, setEvidenceText] = useState((asterismLink?.evidenceIris ?? []).join("\n"));
  const [evidenceRejected, setEvidenceRejected] = useState(0);
  // 知見の切替・外部更新（再生成・補完）に追従する。別ページへ根拠を書き込む事故を防ぐ
  const evidenceKey = (asterismLink?.evidenceIris ?? []).join("\n");
  useEffect(() => {
    setEvidenceText(evidenceKey);
  }, [wikiId, evidenceKey]);
  // 採用されなかった件数は知見を切り替えたときだけ消す（保存後の再同期では残して利用者に見せる）
  useEffect(() => {
    setEvidenceRejected(0);
  }, [wikiId]);
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
  // 設定済みの語（空・不正な語は除く）。表示条件: 既に asterism がある、または語が 1 つでもある
  const asterismTerms = Object.values(asterismConf.typeSlugs)
    .map((v) => v.trim())
    .filter((v, i, a) => classifyVocabTerm(v) !== "empty" && a.indexOf(v) === i);
  const showAsterism = !!asterismLink || asterismTerms.length > 0;
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
          {showAsterism && (
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <span style={{ ...labelStyle, fontSize: 12 }}>{t("wiki.frame.asterism")}</span>
              <div style={rowStyle}>
                <span style={labelStyle}>{t("wiki.frame.asterism.type")}</span>
                <select
                  aria-label={t("wiki.frame.asterism.type")}
                  value={asterismLink?.typeSlug ?? ""}
                  disabled={!onUpdateWikiMeta}
                  onChange={(e) => {
                    const v = e.target.value;
                    onUpdateWikiMeta?.({
                      asterism: { ...asterismLink, typeSlug: v || undefined, typeSlugBy: "human" },
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
                  <option value="">{t("wiki.frame.asterism.typeNone")}</option>
                  {asterismTerms.map((term) => (
                    <option key={term} value={term}>
                      {term}
                    </option>
                  ))}
                  {asterismLink?.typeSlug && !asterismTerms.includes(asterismLink.typeSlug) && (
                    <option value={asterismLink.typeSlug}>{asterismLink.typeSlug}</option>
                  )}
                </select>
                {(asterismLink?.typeSlug || asterismLink?.typeSlugBy === "human") && (
                  <span style={{ fontSize: 12, color: "var(--ink-4)" }}>
                    {asterismLink.typeSlugBy === "human" ? t("wiki.frame.asterism.human") : t("wiki.frame.asterism.auto")}
                  </span>
                )}
                {onUpdateWikiMeta && asterismLink?.typeSlugBy === "human" && (
                  <button
                    type="button"
                    style={smallButtonStyle}
                    onClick={() => {
                      const slug = resolveAsterismTypeSlug(wikiMeta, asterismConf);
                      const next: AsterismLink = { ...asterismLink, typeSlug: slug, typeSlugBy: slug ? "auto" : undefined };
                      // 何も残らないなら空の asterism は書かず削除する
                      onUpdateWikiMeta({ asterism: next.typeSlug || next.evidenceIris?.length ? next : undefined });
                    }}
                  >
                    {t("wiki.frame.asterism.reset")}
                  </button>
                )}
              </div>
              <div style={rowStyle}>
                <span style={labelStyle}>{t("wiki.frame.asterism.evidence")}</span>
                <textarea
                  aria-label={t("wiki.frame.asterism.evidence")}
                  placeholder={t("wiki.frame.asterism.evidenceHint")}
                  value={evidenceText}
                  rows={2}
                  readOnly={!onUpdateWikiMeta}
                  spellCheck={false}
                  onChange={(e) => setEvidenceText(e.target.value)}
                  onBlur={() => {
                    if (!onUpdateWikiMeta) return;
                    const { iris, rejected } = normalizeEvidenceIris(evidenceText);
                    setEvidenceRejected(rejected);
                    setEvidenceText(iris.join("\n"));
                    // 変更が無ければ保存しない（閲覧しただけで保存・再読込・空の asterism を残さない）
                    const before = asterismLink?.evidenceIris ?? [];
                    if (before.length === iris.length && before.every((v, i) => v === iris[i])) return;
                    const next: AsterismLink = { ...asterismLink, evidenceIris: iris.length > 0 ? iris : undefined };
                    onUpdateWikiMeta({ asterism: next.typeSlug || next.typeSlugBy || next.evidenceIris ? next : undefined });
                  }}
                  style={{
                    flex: 1,
                    minWidth: 200,
                    font: "inherit",
                    fontSize: 13,
                    padding: "2px 6px",
                    border: "1px solid var(--rule)",
                    borderRadius: "var(--r-2)",
                    background: "var(--paper)",
                    color: "var(--ink-2)",
                    resize: "vertical",
                  }}
                />
                {evidenceRejected > 0 && (
                  <span style={{ fontSize: 12, color: "var(--amber-ink, #b45309)" }}>
                    {t("wiki.frame.asterism.rejected", { n: String(evidenceRejected) })}
                  </span>
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
