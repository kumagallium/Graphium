// 出典照合（Source check, v1）の verdict バッジ。
//
// 世界照合（wikiBanner.worldVerdict.*・WikiBanner.tsx の WorldVerdictBadge）と型を揃える
// ピル UI。見た目は同じ高さ・余白・フォントサイズ（12px / fontWeight 500）だが、
// アイコンに FileSearch を使うことで Globe2（世界照合）と並んだときに区別できるようにする。
//
// 色の対応（意味を世界照合と揃える）:
//   supported      ＝ 世界照合の supported/established と同じ（forest 系）
//   contradicted   ＝ rose（薄い塗り＋枠）。5 つの中でいちばん注意が要る判定なので最も目立たせる
//                    （2026-09-16 決定。世界照合の contested は --ember のままで今回は変えない）
//   not-in-source  ＝ 世界照合の weak と同じ（amber）
//   unclear        ＝ ニュートラル（ink の弱い階調）
//   source-missing ＝ ニュートラル＋破線の枠（色だけに頼らず unclear と区別する）

import { FileSearch, Check } from "lucide-react";
import type { SourceCheckProfile, SourceCheckVerdict } from "../../../lib/document-types";
import { useT } from "../../../i18n";

export type SourceCheckPalette = { color: string; bg: string; border: string };

// unclear と同じニュートラル色。dismissed 時・source-missing のベースにも使う。
const NEUTRAL: SourceCheckPalette = {
  color: "var(--ink-3)",
  bg: "var(--paper)",
  border: "var(--rule)",
};

/** verdict → 色。SourceCheckDetailSection の出典ごと小バッジとも共有する。 */
export const sourceCheckVerdictPalette: Record<SourceCheckVerdict, SourceCheckPalette> = {
  supported: {
    color: "var(--forest-ink)",
    bg: "var(--paper)",
    border: "var(--forest, var(--rule))",
  },
  contradicted: {
    color: "var(--rose-ink)",
    bg: "var(--rose-soft)",
    border: "var(--rose)",
  },
  "not-in-source": {
    color: "var(--amber-ink, #b45309)",
    bg: "var(--amber-soft, var(--paper))",
    border: "var(--amber, var(--rule))",
  },
  unclear: NEUTRAL,
  "source-missing": NEUTRAL,
};

// dismissed（確認済み）は色を 1 段落ち着かせる — verdict の色相ではなく
// ニュートラルな ink 階調に統一し、代わりに Check アイコンで「確認済み」を示す。
const DISMISSED_PALETTE: SourceCheckPalette = {
  color: "var(--ink-3)",
  bg: "var(--paper)",
  border: "var(--rule)",
};

// 集約 verdict の内訳（出典ごとの件数）をツールチップ用に整形する。
// 優先順位は aggregate.ts の PRIORITY に合わせる。
const VERDICT_ORDER: SourceCheckVerdict[] = [
  "contradicted",
  "supported",
  "not-in-source",
  "unclear",
  "source-missing",
];

export function SourceCheckBadge({
  profile,
  stale = false,
}: {
  profile: SourceCheckProfile;
  /** 照合後に知見の本文が変わった（呼び出し側で claimHash を比較して渡す） */
  stale?: boolean;
}) {
  const t = useT();
  const dismissed = Boolean(profile.dismissed);
  const verdict = profile.verdict;
  const label = t(`sourceCheck.verdict.${verdict}` as never);
  const p = dismissed ? DISMISSED_PALETTE : sourceCheckVerdictPalette[verdict];
  const dashed = verdict === "source-missing";

  const checkedAt = profile.checkedAt ? new Date(profile.checkedAt).toLocaleString() : "";

  // ツールチップ: 判定ラベル → 出典ごとの内訳の件数 → 照合に使ったモデル → 時刻
  const breakdown = VERDICT_ORDER.map((v) => ({
    verdict: v,
    count: profile.entries.filter((e) => e.verdict === v).length,
  })).filter((b) => b.count > 0);

  const titleParts: string[] = [`${t("sourceCheck.title")}: ${label}`];
  if (breakdown.length > 0) {
    titleParts.push(
      breakdown.map((b) => `${t(`sourceCheck.verdict.${b.verdict}` as never)} ${b.count}`).join(" / "),
    );
  }
  if (profile.checkedBy) titleParts.push(`${t("sourceCheck.checkedBy")}: ${profile.checkedBy}`);
  if (checkedAt) titleParts.push(`${t("sourceCheck.checkedAt")}: ${checkedAt}`);
  if (dismissed) titleParts.push(t("sourceCheck.dismissedHint"));
  if (stale) titleParts.push(t("sourceCheck.staleHint"));

  return (
    <span
      title={titleParts.join("\n")}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
        padding: "1px 8px",
        borderRadius: "var(--pill)",
        border: `1px ${dashed ? "dashed" : "solid"} ${p.border}`,
        background: p.bg,
        color: p.color,
        fontSize: 12,
        lineHeight: 1.4,
        fontWeight: 500,
      }}
    >
      <FileSearch size={11} />
      {label}
      {stale && (
        <span style={{ color: "var(--ink-3)", fontWeight: 400 }}>
          · {t("sourceCheck.staleNote")}
        </span>
      )}
      {dismissed && <Check size={11} aria-label={t("sourceCheck.dismissed")} />}
    </span>
  );
}
