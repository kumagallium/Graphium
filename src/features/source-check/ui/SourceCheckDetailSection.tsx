// 出典照合（Source check, v1）の詳細セクション。
//
// WikiBanner.tsx の WorldGroundingDetailSection と同じ折り畳みトーン
// （dashed border・既定は閉）。出典ごとに 1 行ずつ、判定・理由・引用を並べる。

import { useState } from "react";
import {
  ChevronDown,
  ExternalLink,
  FileText,
  Files,
  Link as LinkIcon,
  StickyNote,
  MessageCircle,
  Pilcrow,
  Paperclip,
  Bot,
  RefreshCw,
  Check,
  Trash2,
  AlertTriangle,
} from "lucide-react";
import type {
  SourceCheckEntry,
  SourceCheckProfile,
  SourceCheckSourceKind,
  SourceQuoteLocation,
} from "../../../lib/document-types";
import { useT } from "../../../i18n";
import { sourceCheckVerdictPalette } from "./SourceCheckBadge";

// quoteLocation → 表示文言。位置が解けていない（undefined）ときは何も返さない。
// quote が無いのに位置だけある状態は起きない想定だが、呼び出し側は quote の有無を見ずに
// quoteLocation の有無だけで出し分けるので、ここも quote には依存しない。
function formatQuoteLocation(
  t: ReturnType<typeof useT>,
  loc: SourceQuoteLocation | undefined,
): string | undefined {
  if (!loc) return undefined;
  if (loc.page !== undefined) {
    return loc.pageEnd !== undefined && loc.pageEnd !== loc.page
      ? t("sourceCheck.quoteLocation.pageRange", {
          page: String(loc.page),
          pageEnd: String(loc.pageEnd),
        })
      : t("sourceCheck.quoteLocation.page", { page: String(loc.page) });
  }
  if (loc.paragraph !== undefined) {
    return t("sourceCheck.quoteLocation.paragraph", { paragraph: String(loc.paragraph) });
  }
  return undefined;
}

// 出典の種類 → アイコン。素材一覧（MaterialListItem.tsx）の TypeIcon と役割は近いが、
// note / memo / chat は素材ではなくノート・引用元なので独自にマップする。
function SourceKindIcon({ kind, size = 12 }: { kind: SourceCheckSourceKind; size?: number }) {
  const t = useT();
  const label = t(`sourceCheck.sourceKind.${kind}` as never);
  // アイコンだけだと出典の種類が読み上げられないので、ラベルを添える
  return (
    <span role="img" aria-label={label} title={label} style={{ display: "inline-flex" }}>
      <SourceKindGlyph kind={kind} size={size} />
    </span>
  );
}

function SourceKindGlyph({ kind, size }: { kind: SourceCheckSourceKind; size: number }) {
  switch (kind) {
    case "note":
      return <Pilcrow size={size} />;
    case "pdf":
      return <FileText size={size} />;
    case "document":
      return <Files size={size} />;
    case "url":
      return <LinkIcon size={size} />;
    case "memo":
      return <StickyNote size={size} />;
    case "chat":
      return <MessageCircle size={size} />;
    case "claim":
      // 知見（AI が作ったナレッジ）。一覧・サイドバーと同じ Bot アイコン
      return <Bot size={size} />;
    default:
      return <Paperclip size={size} />;
  }
}

// 出典ごとの小さな verdict バッジ（詳細行のインライン表示用。SourceCheckBadge より簡素）。
function EntryVerdictChip({ verdict }: { verdict: SourceCheckEntry["verdict"] }) {
  const t = useT();
  const p = sourceCheckVerdictPalette[verdict];
  const dashed = verdict === "source-missing";
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        padding: "0 6px",
        borderRadius: "var(--pill)",
        border: `1px ${dashed ? "dashed" : "solid"} ${p.border}`,
        background: p.bg,
        color: p.color,
        fontSize: 11,
        lineHeight: 1.6,
        whiteSpace: "nowrap",
        flexShrink: 0,
      }}
    >
      {t(`sourceCheck.verdict.${verdict}` as never)}
    </span>
  );
}

// この理由の source-missing は原文どころか「開ける場所」自体が無い
// （記録が無い／AI 回答由来で元発言が残らない／チャットは参照キーを持たない）。
// リンクを出すと「開けるはず」という誤った期待を与えるため、出典名をリンクにしない。
const UNOPENABLE_MISSING_REASONS = new Set(["not-recorded", "ai-answer", "no-reference"]);

function EntryRow({
  entry,
  sourceTitles,
  onOpenSource,
}: {
  entry: SourceCheckEntry;
  sourceTitles?: Record<string, string>;
  onOpenSource?: (sourceId: string, blockId?: string) => void;
}) {
  const t = useT();
  const sourceLabel = sourceTitles?.[entry.sourceId] ?? entry.sourceId;
  const locationText = formatQuoteLocation(t, entry.quoteLocation);
  // source-missing は保存済み rationale（照合当時の言語のまま焼き付いている可能性がある）より、
  // 現在の UI 言語で出せる missingReason ラベルを優先する。
  const reasonText =
    entry.verdict === "source-missing" && entry.missingReason
      ? t(`sourceCheck.missingReason.${entry.missingReason}` as never)
      : entry.rationale;

  const isUnopenable =
    entry.verdict === "source-missing" &&
    Boolean(entry.missingReason) &&
    UNOPENABLE_MISSING_REASONS.has(entry.missingReason as string);
  const canNavigate = Boolean(onOpenSource) && !isUnopenable;

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 3,
        padding: "6px 0",
        borderTop: "1px solid var(--rule)",
      }}
    >
      {/* トピックの照合対象（entry.statement）— 知見では付かないため knowlege では出ない。
          statementBlockId への遷移は既存にブロック単体へスクロールする仕組みが無いため
          対応しない（テキスト表示のみ）。 */}
      {entry.statement && (
        <div
          style={{
            color: "var(--ink-3)",
            fontSize: 12,
            paddingLeft: 6,
            borderLeft: "2px solid var(--rule)",
          }}
        >
          {entry.statement}
        </div>
      )}
      <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
        <span style={{ color: "var(--ink-3)", display: "inline-flex", flexShrink: 0 }}>
          <SourceKindIcon kind={entry.sourceKind} />
        </span>
        {canNavigate ? (
          <button
            type="button"
            onClick={() => onOpenSource?.(entry.sourceId, entry.blockId)}
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
            title={entry.sourceId}
          >
            {sourceLabel}
          </button>
        ) : (
          <span title={entry.sourceId}>{sourceLabel}</span>
        )}
        <EntryVerdictChip verdict={entry.verdict} />
      </div>
      {reasonText && (
        <div style={{ color: "var(--ink-2)", fontSize: 13 }}>{reasonText}</div>
      )}
      {entry.quote && (
        <blockquote
          style={{
            margin: "2px 0 0",
            padding: "4px 8px",
            borderLeft: "2px solid var(--rule)",
            color: "var(--ink-2)",
            fontSize: 13,
          }}
        >
          {entry.quote}
        </blockquote>
      )}
      {locationText && (
        // 「4 ページ」だけ読み上げると何の位置か伝わらないので、読み上げ専用の前置きを添える
        // （役割の無い div への aria-label は読まれないことが多い）。
        <div style={{ color: "var(--ink-3)", fontSize: 12 }}>
          <span className="sr-only">{t("sourceCheck.quoteLocation.srPrefix")} </span>
          {locationText}
        </div>
      )}
      {entry.blockId && onOpenSource && (
        <button
          type="button"
          onClick={() => onOpenSource(entry.sourceId, entry.blockId)}
          style={{
            alignSelf: "flex-start",
            display: "inline-flex",
            alignItems: "center",
            gap: 3,
            marginTop: 2,
            padding: 0,
            background: "transparent",
            border: "none",
            color: "var(--ink-3)",
            font: "inherit",
            fontSize: 12,
            cursor: "pointer",
          }}
        >
          <ExternalLink size={10} />
          {t("sourceCheck.openSource")}
        </button>
      )}
    </div>
  );
}

export function SourceCheckDetailSection({
  profile,
  stale = false,
  sourceTitles,
  onOpenSource,
  onRecheck,
  onDismiss,
  onClear,
  running = false,
}: {
  profile: SourceCheckProfile;
  /** 照合後に知見の本文が変わった（呼び出し側で claimHash を比較して渡す） */
  stale?: boolean;
  /** sourceId → 表示名。無ければ sourceId をそのまま出す */
  sourceTitles?: Record<string, string>;
  /** 出典を開く（ノート・素材を SidePeek 等で表示する想定）。blockId は該当箇所 */
  onOpenSource?: (sourceId: string, blockId?: string) => void;
  onRecheck?: () => void;
  onDismiss?: () => void;
  onClear?: () => void;
  /** 出典照合が実行中（このドキュメント単体、または点検欄の一括実行）。「もう一度照合」を無効化する。 */
  running?: boolean;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const dismissed = Boolean(profile.dismissed);
  const checkedAt = profile.checkedAt ? new Date(profile.checkedAt).toLocaleString() : "";

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
        aria-expanded={open}
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
          style={{
            transform: open ? "rotate(0)" : "rotate(-90deg)",
            transition: "transform 120ms",
          }}
        />
        <span style={{ fontWeight: 500 }}>{t("sourceCheck.detailTitle")}</span>
        <span style={{ color: "var(--ink-3)", fontWeight: 400 }}>
          · {t("sourceCheck.entryCount", { count: String(profile.entries.length) })}
        </span>
      </button>
      {open && (
        <div style={{ marginTop: 4 }}>
          {stale && (
            <div
              style={{
                display: "flex",
                alignItems: "flex-start",
                gap: 4,
                padding: "4px 6px",
                marginBottom: 4,
                borderRadius: "var(--r-1)",
                background: "var(--amber-soft, var(--paper))",
                color: "var(--amber-ink, #b45309)",
                fontSize: 13,
              }}
            >
              <AlertTriangle size={12} style={{ marginTop: 2, flexShrink: 0 }} />
              {t("sourceCheck.staleHint")}
            </div>
          )}
          <div>
            {profile.entries.map((entry, i) => (
              <EntryRow
                key={entry.sourceId + i}
                entry={entry}
                sourceTitles={sourceTitles}
                onOpenSource={onOpenSource}
              />
            ))}
          </div>
          <div
            style={{
              marginTop: 6,
              paddingTop: 6,
              borderTop: "1px solid var(--rule)",
              display: "flex",
              alignItems: "center",
              flexWrap: "wrap",
              gap: 8,
            }}
          >
            <span style={{ color: "var(--ink-3)" }}>
              {t("sourceCheck.checkedBy")}: {profile.checkedBy}
              {checkedAt && <> · {t("sourceCheck.checkedAt")}: {checkedAt}</>}
            </span>
            <div style={{ flex: 1 }} />
            {onRecheck && (
              <button
                type="button"
                onClick={onRecheck}
                disabled={running}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 4,
                  padding: "2px 8px",
                  background: "transparent",
                  border: "1px solid var(--rule)",
                  borderRadius: "var(--r-1)",
                  color: "var(--ink-3)",
                  font: "inherit",
                  fontSize: 12,
                  cursor: running ? "default" : "pointer",
                  opacity: running ? 0.5 : 1,
                }}
              >
                <RefreshCw size={11} />
                {t("sourceCheck.recheck")}
              </button>
            )}
            {onDismiss && (
              <button
                type="button"
                onClick={onDismiss}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 4,
                  padding: "2px 8px",
                  background: "transparent",
                  border: "1px solid var(--rule)",
                  borderRadius: "var(--r-1)",
                  color: "var(--ink-3)",
                  font: "inherit",
                  fontSize: 12,
                  cursor: "pointer",
                }}
              >
                <Check size={11} />
                {dismissed ? t("sourceCheck.undismiss") : t("sourceCheck.dismiss")}
              </button>
            )}
            {onClear && (
              <button
                type="button"
                onClick={onClear}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 4,
                  padding: "2px 8px",
                  background: "transparent",
                  border: "1px solid var(--rule)",
                  borderRadius: "var(--r-1)",
                  color: "var(--ink-3)",
                  font: "inherit",
                  fontSize: 12,
                  cursor: "pointer",
                }}
              >
                <Trash2 size={11} />
                {t("sourceCheck.clear")}
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
