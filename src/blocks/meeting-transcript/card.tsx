// 会議の文字起こしブロックの見た目（状態と発言を受け取って描くだけ。ストア・エディタは知らない）
//
// 話者は色分けせず、行頭のラベル（相手 / 自分）だけで区別する（dyslexia 配慮・強い色を使わない）。

import { useEffect, useRef, useState } from "react";
import { ChevronDown, ChevronRight, ListPlus, Play } from "lucide-react";
import { t, useLocaleSubscription, type Locale } from "../../i18n";
import { useMixedDownPlayback } from "../../features/meeting-recorder/mixdown-playback";
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
  /** 再生できるか（デスクトップで、完了した録音素材があるとき）。false ならプレーヤーも時刻ボタンも出さない */
  canPlay?: boolean;
  /** 音声の blob URL を用意する（初回の再生要求で呼ぶ。失敗時は null）。長い録音は大きいので押されるまで読まない */
  loadAudio?: () => Promise<string | null>;
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

  // ── 再生（初めて押されたときに音声を読み、読めたらその位置から再生する） ──
  const audioRef = useRef<HTMLAudioElement>(null);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [audioLoading, setAudioLoading] = useState(false);
  const [audioFailed, setAudioFailed] = useState(false);
  const pendingSeekRef = useRef<number | null>(null);
  const [showOriginal, setShowOriginal] = useState(false);

  // 読めたら、押された位置へ飛んで再生する
  useEffect(() => {
    const el = audioRef.current;
    if (!audioUrl || !el || pendingSeekRef.current === null) return;
    const sec = pendingSeekRef.current;
    pendingSeekRef.current = null;
    const go = () => {
      el.currentTime = sec;
      void el.play().catch(() => {});
    };
    if (el.readyState >= 1) go();
    else el.addEventListener("loadedmetadata", go, { once: true });
  }, [audioUrl]);

  const requestPlay = (startMs: number | null) => {
    if (startMs !== null) pendingSeekRef.current = startMs / 1000;
    const el = audioRef.current;
    if (audioUrl && el) {
      if (pendingSeekRef.current !== null) {
        el.currentTime = pendingSeekRef.current;
        pendingSeekRef.current = null;
      }
      void el.play().catch(() => {});
      return;
    }
    if (audioLoading || !p.loadAudio) return;
    setAudioLoading(true);
    setAudioFailed(false);
    void p.loadAudio().then((url) => {
      setAudioLoading(false);
      if (url) setAudioUrl(url);
      else setAudioFailed(true);
    });
  };
  const playable = !!p.canPlay && !!p.loadAudio && !audioFailed;
  // 左右別に録った相手 / 自分を、再生のときだけ両耳に混ぜる
  useMixedDownPlayback(audioRef, playable && !!audioUrl, `${audioUrl}|${p.expanded}`);

  const lineRow = (s: TranscriptSegment, i: number) => (
    <div key={`${s.startMs}-${s.track}-${i}`} className="whitespace-pre-wrap leading-relaxed">
      {playable ? (
        <button
          type="button"
          className="tabular-nums text-muted-foreground hover:text-foreground hover:underline"
          data-tooltip={t("meetingBlock.seekTooltip")}
          onClick={() => requestPlay(s.startMs)}
        >
          [{mmss(s.startMs)}]
        </button>
      ) : (
        <span className="tabular-nums text-muted-foreground">[{mmss(s.startMs)}]</span>
      )}{" "}
      {s.track && <span className="font-medium">{labels[s.track]}: </span>}
      {s.text}
    </div>
  );
  const player = playable ? (
    audioUrl ? (
      // eslint-disable-next-line jsx-a11y/media-has-caption
      <audio ref={audioRef} src={audioUrl} controls preload="metadata" className="h-8 max-w-full" />
    ) : (
      <button type="button" className={btn} disabled={audioLoading} onClick={() => requestPlay(null)}>
        <Play size={12} />
        {audioLoading ? t("meetingBlock.playerLoading") : t("meetingBlock.play")}
      </button>
    )
  ) : null;

  // 展開済み: 発言は隣の段落になっているので、1 行ヘッダーを残す。原本（全文）は折りたたみで見られる
  if (p.expanded) {
    return (
      <div className={`${shell} px-3 py-1.5 text-xs`} contentEditable={false}>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-muted-foreground">
          <span>
            {p.segments.length > 0
              ? t("meetingBlock.expanded", { count: String(p.segments.length) })
              : t("meetingBlock.expandedNoCount")}
          </span>
          <span className="flex-1" />
          {player}
          {p.segments.length > 0 && (
            <button type="button" className={btn} aria-expanded={showOriginal} onClick={() => setShowOriginal((v) => !v)}>
              {showOriginal ? t("meetingBlock.originalClose") : t("meetingBlock.original")}
            </button>
          )}
        </div>
        {showOriginal && <div className="mt-2 space-y-1 text-sm">{p.segments.map(lineRow)}</div>}
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
        {player}
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
          {visible.map(lineRow)}
        </div>
      )}
    </div>
  );
}
