// 会議の文字起こしブロックの見た目（状態と発言を受け取って描くだけ。ストア・エディタは知らない）
//
// 話者は色分けせず、行頭のラベル（相手 / 自分）だけで区別する（dyslexia 配慮・強い色を使わない）。

import { useEffect, useId, useRef, useState } from "react";
import { ChevronDown, ChevronRight, ListPlus, Mic, NotebookPen, Play, Sparkles } from "lucide-react";
import { t, useLocaleSubscription, type Locale } from "../../i18n";
import { useMixedDownPlayback } from "../../features/meeting-recorder/mixdown-playback";
import { formatElapsed } from "../../features/meeting-recorder/MeetingRecorderBar";
import { mmss, type TranscriptSegment } from "../../features/meeting-recorder/transcript-format";
import { pickVisibleSegments, RECENT_SEGMENT_LIMIT, type MeetingBlockStatus } from "./status";
import type { CleanupDoc, SummaryDoc } from "../../features/meeting-recorder/artifacts";
import {
  ArtifactTabs,
  TimeChip,
  CleanupPanel,
  SummaryPanel,
  WriteOutMenu,
  panelId,
  tabId,
  type ArtifactTab,
  type WriteOutKind,
} from "./artifact-panels";
import { writeOutState, type WriteOutBlock } from "./mask";
import { SEARCH_SCOPE_ATTR } from "../../features/document-search/block-text-search";

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
  /** 録音前（ready）の操作。「相手の声も録る」と「録音を始める」 */
  captureSystem?: boolean;
  onCaptureSystemChange?: (value: boolean) => void;
  /** 別の録音が進行中（または開始処理中）で、この「録音を始める」は押せない */
  recordingBusy?: boolean;
  onStartRecording?: () => void;
  /** 「要約」ボタン（AI が使えるときだけ summaryEnabled）。summarized なら「もう一度要約」 */
  summaryEnabled?: boolean;
  summarized?: boolean;
  summarizing?: boolean;
  summaryError?: string | null;
  onSummarize?: () => void;
  /** 編集済みの要約を置き換える確認を出すか */
  confirmReplace?: boolean;
  onConfirmReplace?: () => void;
  onCancelReplace?: () => void;
  onToggleCollapsed: () => void;
  onToggleShowAll: () => void;
  /** 「段落に展開」（以前のブロック用。いまは「ノートに書き出す」の「文字起こし（原本）」） */
  onExpand: () => void;
  /**
   * 清書・要約（ブロックの中で読む AI の派生物）。録音を終えたブロックでは
   * 「文字起こし / 清書 / 要約」のタブと「ノートに書き出す」を出す。要約の実行・失敗は
   * summarizing / summaryError / onSummarize、AI が使えるかは summaryEnabled を使う
   */
  cleanup?: CleanupDoc | null;
  summaryDoc?: SummaryDoc | null;
  /** 清書の実行中（分けて送った回数の進み具合） */
  cleaning?: { done: number; total: number; etaMs?: number } | null;
  cleanupError?: string | null;
  onCleanup?: () => void;
  onWriteOut?: (kind: WriteOutKind) => void;
  /**
   * 名前などを伏せる（ブロックごとのチェック）。オンなら清書・要約で人名などを印に置き換え、
   * 書き出せるのは伏せて作った清書・要約だけ。onToggleMask が無ければチェックは押せない
   */
  maskSensitive?: boolean;
  onToggleMask?: () => void;
  /**
   * 清書・要約のモデル（このパソコンの LM Studio）のコンテキスト長が足りなそうなときの確認。
   * 「このまま実行」で送り、「やめる」で閉じる
   */
  contextWarning?: { text: string; onProceed: () => void; onCancel: () => void } | null;
  /** 「メモを取る」（メモのノートを作って横に開く）。メインエディタの中のブロックだけ */
  onTakeMemo?: () => void;
  /** メモのノートがもうある（ボタンを「メモを開く」にする） */
  memoExists?: boolean;
  /** 清書・要約をまとめてコピーする（できたら true） */
  onCopyArtifact?: (kind: "cleanup" | "summary") => Promise<boolean>;
  /** 伏せた清書・要約に残っている、人名らしい語の候補 */
  nameCandidates?: { cleanup: string[]; summary: string[] };
  /** 候補を「必ず伏せる語」に足して伏せ直す */
  onHideNames?: (names: string[]) => void;
  /** このブロックから前にノートへ書き出した文が残っているか（伏せるにしても、それは変わらないと伝える） */
  writtenBefore?: boolean;
  /** 最初に開くタブ（Storybook 用）。無ければ 要約 → 清書 → 文字起こし の順で、あるものを開く */
  initialTab?: ArtifactTab;
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
    case "ready": return t("meetingBlock.readyTitle");
    case "readyUnavailable": return t("meetingBlock.readyTitle");
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
  // 選んだタブ（null = まだ選んでいない。あるものの中から自動で選ぶ）
  const [pickedTab, setPickedTab] = useState<ArtifactTab | null>(p.initialTab ?? null);
  const idBase = `meeting-${useId().replace(/:/g, "")}`;

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
  const canPlay = !!p.canPlay && !!p.loadAudio;
  const playable = canPlay && !audioFailed;
  // 左右別に録った相手 / 自分を、再生のときだけ両耳に混ぜる
  useMixedDownPlayback(audioRef, playable && !!audioUrl, `${audioUrl}|${p.expanded}`);

  const lineRow = (s: TranscriptSegment, i: number) => (
    <div key={`${s.startMs}-${s.track}-${i}`} className="whitespace-pre-wrap leading-relaxed">
      {/* 清書・要約と同じ時刻の印（再生できるときは ▶ 付きのボタン） */}
      <TimeChip startMs={s.startMs} onSeek={playable ? requestPlay : null} />{" "}
      {s.track && <span className="font-medium">{labels[s.track]}: </span>}
      {s.text}
    </div>
  );
  const player = canPlay && audioFailed ? (
    <span className="text-xs text-muted-foreground" role="status">{t("meetingBlock.audioFailed")}</span>
  ) : playable ? (
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

  const canSummarize =
    !!p.summaryEnabled && !!p.onSummarize && p.editable && p.status === "done" && (p.expanded || p.segments.length > 0);
  const summaryButton = canSummarize ? (
    <button
      type="button"
      className={btn}
      disabled={p.summarizing}
      data-tooltip={t("meetingBlock.summarizeTooltip")}
      onClick={p.onSummarize}
    >
      <Sparkles size={12} />
      {p.summarizing
        ? t("meetingBlock.summarizing")
        : p.summarized
          ? t("meetingBlock.summarizeAgain")
          : t("meetingBlock.summarize")}
    </button>
  ) : null;
  const memoButton = p.onTakeMemo ? (
    <button type="button" className={btn} data-tooltip={t("meetingBlock.takeMemoTooltip")} onClick={p.onTakeMemo}>
      <NotebookPen size={12} />
      {p.memoExists ? t("meetingBlock.openMemo") : t("meetingBlock.takeMemo")}
    </button>
  ) : null;

  const summaryErrorLine = p.confirmReplace ? (
    <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-foreground" role="status">
      <span>{t("meetingBlock.summaryReplaceConfirm")}</span>
      <button type="button" className={btn} onClick={p.onConfirmReplace}>{t("meetingBlock.summaryReplace")}</button>
      <button type="button" className={btn} onClick={p.onCancelReplace}>{t("meetingBlock.summaryKeep")}</button>
    </div>
  ) : p.summaryError ? (
    <div className="mt-1 text-xs text-muted-foreground" role="status">{p.summaryError}</div>
  ) : null;

  // 録音前: 同意の一文・相手の声のチェック・「録音を始める」。ここで押すまで録音は始まらない
  if (p.status === "ready" || p.status === "readyUnavailable") {
    return (
      <div className={`${shell} px-3 py-2 text-sm`} contentEditable={false}>
        <div className="flex items-center gap-2 text-xs font-semibold text-foreground">
          <Mic size={13} className="text-muted-foreground" />
          {stateLabelOf(p.status)}
          <span className="flex-1" />
          {p.status === "ready" && <span className="font-normal">{memoButton}</span>}
        </div>
        {p.status === "readyUnavailable" ? (
          <div className="mt-1 text-xs text-muted-foreground">{t("meetingBlock.readyUnavailable")}</div>
        ) : (
          <div className="mt-2 space-y-2">
            <p className="text-sm text-foreground">{t("meeting.consent")}</p>
            <label className="flex cursor-pointer items-center gap-2 text-sm text-foreground">
              <input
                type="checkbox"
                checked={p.captureSystem ?? true}
                disabled={!p.editable || !p.onCaptureSystemChange}
                onChange={(e) => p.onCaptureSystemChange?.(e.target.checked)}
              />
              {t("meeting.captureSystemLabel")}
            </label>
            <p className="text-xs text-muted-foreground">
              {(p.captureSystem ?? true) ? t("meeting.headphonesHint") : t("meeting.selfOnlyHint")}
            </p>
            {/* 会議中のメモはノートそのものに書く（専用のメモ欄は作らない）。清書と要約の手がかりになる */}
            {p.summaryEnabled && <p className="text-xs text-muted-foreground">{t("meetingBlock.readyNotesHint")}</p>}
            <button
              type="button"
              className="flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50 transition-opacity"
              disabled={!p.editable || !!p.recordingBusy}
              onClick={p.onStartRecording}
            >
              {p.recordingBusy ? (
                <>
                  <span className="h-2 w-2 animate-pulse rounded-full bg-red-500" />
                  {t("meeting.recording")}
                </>
              ) : (
                <>
                  <Mic size={13} />
                  {t("meetingBlock.readyStart")}
                </>
              )}
            </button>
          </div>
        )}
      </div>
    );
  }

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
          {summaryButton}
          {p.segments.length > 0 && (
            <button type="button" className={btn} aria-expanded={showOriginal} onClick={() => setShowOriginal((v) => !v)}>
              {showOriginal ? t("meetingBlock.originalClose") : t("meetingBlock.original")}
            </button>
          )}
        </div>
        {summaryErrorLine}
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
  // 録音を終えたブロック: 文字起こし / 清書 / 要約 のタブで読み、ノートに入れるものは書き出しで選ぶ。
  // AI を使わない人（モデル未登録など）にはタブを出さない。ただし以前作った清書・要約があれば
  // 読めるようにタブは残す（作り直しのボタンは出さない）
  const finished = p.status === "done" && p.segments.length > 0;
  // 伏せるにしているブロックも、チェックを外せるようにタブの形で出す
  const tabbed = finished && (!!p.summaryEnabled || !!p.cleanup || !!p.summaryDoc || !!p.maskSensitive);
  const tab: ArtifactTab = pickedTab ?? (p.summaryDoc ? "summary" : p.cleanup ? "cleanup" : "transcript");
  const seek = playable ? requestPlay : null;
  const aiEnabled = !!p.summaryEnabled;
  const mask = !!p.maskSensitive;
  const writeState = writeOutState(mask, p.cleanup ?? null, p.summaryDoc ?? null);
  const reasonText = (r: WriteOutBlock | null): string | undefined =>
    r === "notMasked" ? t("meetingBlock.writeOutNotMasked") : r === "masking" ? t("meetingBlock.writeOutMasking") : undefined;
  const transcriptList = (
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
      {/* ノート内検索（Cmd+F）の対象。ボタンや案内の文は含めない */}
      <div {...{ [SEARCH_SCOPE_ATTR]: "" }} className="space-y-1">
        {visible.map(lineRow)}
      </div>
    </div>
  );

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
          {/* タブで切り替える形では「文字起こし」がタブ名と重なるので、ブロックの名前を出す */}
          {tabbed ? t("meetingBlock.readyTitle") : stateLabelOf(p.status)}
        </span>
        {meta.length > 0 && <span className="text-muted-foreground tabular-nums">{meta.join(" · ")}</span>}
        <span className="flex-1" />
        {memoButton}
        {player}
        {finished && p.editable && p.onWriteOut ? (
          // AI を使わないときは、要約・清書の項目を出さない（文字起こしとファイルだけ）
          <WriteOutMenu
            canSummary={writeState.summary === null}
            canCleanup={writeState.cleanup === null}
            canTranscript={writeState.transcript === null}
            canFile={writeState.file === null}
            aiItems={tabbed}
            reasons={{
              summary: reasonText(writeState.summary),
              cleanup: reasonText(writeState.cleanup),
              transcript: reasonText(writeState.transcript),
            }}
            onPick={p.onWriteOut}
          />
        ) : (
          <>
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
            {summaryButton}
          </>
        )}
      </div>
      {/* タブの形では要約の失敗は要約タブに出すので、ここは置き換えの確認だけ */}
      {finished && p.onWriteOut ? (p.confirmReplace ? summaryErrorLine : null) : summaryErrorLine}
      {p.status === "failed" && (
        <div className="mt-1 text-xs text-muted-foreground">{t("meetingBlock.failedHint")}</div>
      )}
      {showBody && !tabbed && transcriptList}
      {showBody && tabbed && (
        <>
          {/* 名前などを伏せる。AI を使うとき（または既にオンのとき）だけ出す */}
          {(aiEnabled || mask) && (
            <label
              className={`mt-2 flex w-fit items-center gap-2 text-xs text-foreground ${p.editable && p.onToggleMask ? "cursor-pointer" : ""}`}
              data-tooltip={t("meetingBlock.maskTooltip")}
            >
              <input
                type="checkbox"
                checked={mask}
                disabled={!p.editable || !p.onToggleMask}
                onChange={() => p.onToggleMask?.()}
              />
              {t("meetingBlock.maskLabel")}
            </label>
          )}
          {p.contextWarning && (
            <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-foreground" role="status">
              <span>{p.contextWarning.text}</span>
              <button type="button" className={btn} onClick={p.contextWarning.onProceed}>
                {t("meetingBlock.contextProceed")}
              </button>
              <button type="button" className={btn} onClick={p.contextWarning.onCancel}>
                {t("meetingBlock.contextCancel")}
              </button>
            </div>
          )}
          {mask && p.writtenBefore && (
            <div className="mt-1 text-xs text-muted-foreground" role="status">
              {t("meetingBlock.maskWrittenBefore")}
            </div>
          )}
          <ArtifactTabs tab={tab} onChange={setPickedTab} idBase={idBase} />
          <div role="tabpanel" id={panelId(idBase)} aria-labelledby={tabId(idBase, tab)}>
          {tab === "transcript" && transcriptList}
          {tab === "cleanup" && (
            <div className="mt-1">
              <CleanupPanel
                cleanup={p.cleanup ?? null}
                mask={mask}
                onCopy={p.onCopyArtifact ? () => p.onCopyArtifact!("cleanup") : undefined}
                nameCandidates={p.nameCandidates?.cleanup}
                onHideNames={p.onHideNames}
                aiEnabled={aiEnabled}
                editable={p.editable}
                running={p.cleaning ?? null}
                error={p.cleanupError ?? null}
                onRun={p.onCleanup}
                onSeek={seek}
                labels={labels}
              />
            </div>
          )}
          {tab === "summary" && (
            <div className="mt-1">
              <SummaryPanel
                summary={p.summaryDoc ?? null}
                mask={mask}
                onCopy={p.onCopyArtifact ? () => p.onCopyArtifact!("summary") : undefined}
                nameCandidates={p.nameCandidates?.summary}
                onHideNames={p.onHideNames}
                aiEnabled={aiEnabled}
                editable={p.editable}
                running={!!p.summarizing}
                error={p.summaryError ?? null}
                hasCleanup={!!p.cleanup}
                onRun={p.onSummarize}
                onSeek={seek}
              />
            </div>
          )}
          </div>
        </>
      )}
    </div>
  );
}
