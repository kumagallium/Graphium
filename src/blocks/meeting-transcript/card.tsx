// 会議の文字起こしブロックの見た目（状態と発言を受け取って描くだけ。ストア・エディタは知らない）
//
// 話者は色分けせず、行頭のラベル（相手 / 自分）だけで区別する（dyslexia 配慮・強い色を使わない）。

import { ChevronDown, ChevronRight, ListPlus } from "lucide-react";
import { t, useLocaleSubscription, type Locale } from "../../i18n";
import { formatElapsed } from "../../features/meeting-recorder/MeetingRecorderBar";
import { mmss, type TranscriptSegment } from "../../features/meeting-recorder/transcript-format";
import { pickVisibleSegments, RECENT_SEGMENT_LIMIT, type MeetingBlockStatus } from "./status";

export type MeetingTranscriptCardProps = {
  status: MeetingBlockStatus;
  segments: TranscriptSegment[];
  startedAt: string;
  /** 長さ（録音中は経過時間、完了後はブロックに保存された値） */
  durationMs: number;
  /** durationMs が発言からの目安のとき true（「約 mm:ss」と出す） */
  durationApprox?: boolean;
  /** 「段落に展開」の実行中（二重に押せないようにする） */
  expanding?: boolean;
  collapsed: boolean;
  expanded: boolean;
  showAll: boolean;
  /** 編集できるエディタか（読み取り専用では操作ボタンを出さない） */
  editable: boolean;
  onToggleCollapsed: () => void;
  onToggleShowAll: () => void;
  onExpand: () => void;
};

function startedLabel(startedAt: string, locale: Locale): string | null {
  const d = new Date(startedAt);
  if (Number.isNaN(d.getTime())) return null;
  return t("meetingBlock.startedAt", {
    time: d.toLocaleTimeString(locale === "ja" ? "ja-JP" : "en-US", { hour: "2-digit", minute: "2-digit" }),
  });
}

const btn =
  "flex items-center gap-1 rounded-lg border border-border px-2 py-0.5 text-xs text-foreground hover:bg-accent disabled:opacity-50 transition-colors";
const shell = "my-1 w-full rounded-xl border border-border bg-card shadow-sm";

function stateLabelOf(status: MeetingBlockStatus): string {
  switch (status) {
    case "recording": return t("meetingBlock.recording");
    case "transcribing": return t("meetingBlock.transcribing");
    case "failed": return t("meetingBlock.failed");
    case "loading": return t("meetingBlock.loading");
    case "done": return t("meetingBlock.done");
    case "empty": return t("meetingBlock.empty");
    case "unavailable": return t("meetingBlock.unavailable");
  }
}

export function MeetingTranscriptCard(p: MeetingTranscriptCardProps) {
  const locale = useLocaleSubscription();
  const labels = { system: t("meeting.trackOther"), mic: t("meeting.trackSelf") };

  // 展開済み: 発言は隣の段落になっているので、1 行ヘッダーだけ残す
  if (p.expanded) {
    return (
      <div className={`${shell} px-3 py-1.5 text-xs text-muted-foreground`} contentEditable={false}>
        {p.segments.length > 0
          ? t("meetingBlock.expanded", { count: String(p.segments.length) })
          : t("meetingBlock.expandedNoCount")}
      </div>
    );
  }

  const readable =
    p.status === "recording" || p.status === "transcribing" || p.status === "done" || p.status === "failed";
  const meta = [
    startedLabel(p.startedAt, locale),
    p.durationMs > 0
      ? p.durationApprox
        ? t("meetingBlock.approx", { time: mmss(p.durationMs) })
        : formatElapsed(p.durationMs)
      : null,
    readable && p.segments.length > 0 ? t("meetingBlock.count", { count: String(p.segments.length) }) : null,
  ].filter(Boolean);
  const { visible, hidden } = pickVisibleSegments(p.segments, p.showAll);
  const live = p.status === "recording" || p.status === "transcribing";
  // 読み取り専用では畳む操作ができないので、畳まれていても本文を出す
  const showBody = readable && (!p.collapsed || !p.editable);

  return (
    <div className={`${shell} px-3 py-2 text-sm`} contentEditable={false}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
        {readable && p.editable && (
          <button
            type="button"
            className="text-muted-foreground hover:text-foreground"
            aria-expanded={!p.collapsed}
            data-tooltip={p.collapsed ? t("meetingBlock.open") : t("meetingBlock.fold")}
            onClick={p.onToggleCollapsed}
          >
            {p.collapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
          </button>
        )}
        <span className="flex items-center gap-1.5 font-semibold text-foreground" role="status">
          {p.status === "recording" && <span className="h-2 w-2 animate-pulse rounded-full bg-red-500" />}
          {stateLabelOf(p.status)}
        </span>
        {meta.length > 0 && <span className="text-muted-foreground tabular-nums">{meta.join(" · ")}</span>}
        <span className="flex-1" />
        {p.status === "done" && p.editable && p.segments.length > 0 && (
          <button
            type="button"
            className={btn}
            disabled={p.expanding}
            data-tooltip={t("meetingBlock.expandTooltip")}
            onClick={p.onExpand}
          >
            <ListPlus size={12} />
            {t("meetingBlock.expand")}
          </button>
        )}
      </div>
      {p.status === "failed" && (
        <div className="mt-1 text-xs text-muted-foreground">{t("meetingBlock.failedHint")}</div>
      )}
      {showBody && (
        <div className="mt-2 space-y-1">
          {hidden > 0 && p.editable && (
            <button type="button" className={btn} onClick={p.onToggleShowAll}>
              {t("meetingBlock.showAll", { count: String(hidden) })}
            </button>
          )}
          {p.showAll && p.editable && p.segments.length > RECENT_SEGMENT_LIMIT && (
            <button type="button" className={btn} onClick={p.onToggleShowAll}>
              {t("meetingBlock.showRecent")}
            </button>
          )}
          {visible.length === 0 && live && (
            <div className="text-xs text-muted-foreground">{t("meetingBlock.waiting")}</div>
          )}
          {visible.map((s, i) => (
            <div key={`${s.startMs}-${s.track}-${i}`} className="whitespace-pre-wrap leading-relaxed">
              <span className="tabular-nums text-muted-foreground">[{mmss(s.startMs)}]</span>{" "}
              {s.track && <span className="font-medium">{labels[s.track]}: </span>}
              {s.text}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
