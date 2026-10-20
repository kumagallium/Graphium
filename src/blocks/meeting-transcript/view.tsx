// 会議の文字起こしブロック（ストア・エディタとつなぐ層）
//
// 発言の本文は props に持たない（1 時間分で保存 JSON が肥大するため）。録音中はストアに
// 届く発言を描き、終わったら素材の transcript.json を読み直す。状態も props に持たず導出する。

import { createReactBlockSpec } from "@blocknote/react";
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { isTauri } from "../../lib/platform";
import { getActiveProvider } from "../../lib/storage/registry";
import { t, useLocaleSubscription } from "../../i18n";
import { useLinkStore, type LinkStore } from "../../features/block-link/store";
import { isAgentConfigured } from "../../features/settings/store";
import { localizeAiError } from "../../lib/ai-error";
import { summarizeMeeting, SummaryMessageError } from "../../features/meeting-recorder/summary-service";
import * as api from "../../features/meeting-recorder/api";
import * as store from "../../features/meeting-recorder/store";
import {
  parseTranscriptSegments,
  type TranscriptSegment,
} from "../../features/meeting-recorder/transcript-format";
import { MeetingTranscriptCard } from "./card";
import { buildTranscriptParagraphs } from "./expand";
import { approxDurationMs, deriveBlockStatus, mergeSegments } from "./status";
import { rememberTranscript } from "./transcript-cache";
import {
  collectExpandedParagraphs,
  existingIds,
  insertSummary,
  isSummaryEdited,
  linkParagraphsToBlock,
  paragraphToUtterance,
  parseIdList,
  type SummaryLabels,
} from "./summary";

// 録音素材の blob URL（fileId ごとに 1 回だけ読む。inline-image と同じ流儀）。
// 録音は大きいので直近 3 本まで持ち、キャッシュから外すときだけ URL を revoke する
// （マウントされたプレーヤーが使っている間は外れない）
const AUDIO_CACHE_LIMIT = 3;
const blobUrlCache = new Map<string, { promise: Promise<string | null>; url?: string }>();
function loadAudioUrl(fileId: string): Promise<string | null> {
  const cached = blobUrlCache.get(fileId);
  if (cached) return cached.promise;
  const entry: { promise: Promise<string | null>; url?: string } = {
    promise: getActiveProvider()
      .getMediaBlobUrl(fileId)
      .then((url) => {
        entry.url = url;
        return url;
      })
      .catch(() => {
        blobUrlCache.delete(fileId);
        return null;
      }),
  };
  blobUrlCache.set(fileId, entry);
  while (blobUrlCache.size > AUDIO_CACHE_LIMIT) {
    const oldest = blobUrlCache.keys().next().value as string;
    const gone = blobUrlCache.get(oldest);
    blobUrlCache.delete(oldest);
    if (gone?.url) URL.revokeObjectURL(gone.url);
  }
  return entry.promise;
}

const NO_SEGMENTS: TranscriptSegment[] = [];

// LinkStoreProvider の外（Storybook 等）では null。useLinkStore は外だと throw する
function useOptionalLinkStore(): LinkStore | null {
  try {
    return useLinkStore();
  } catch {
    return null;
  }
}

function summaryLabels(): SummaryLabels {
  return {
    summaryHeading: t("meetingBlock.summaryHeading"),
    aiNote: t("meetingBlock.summaryAiNote"),
    decisions: t("meetingBlock.summaryDecisions"),
    todos: t("meetingBlock.summaryTodos"),
    issues: t("meetingBlock.summaryIssues"),
    transcriptHeading: t("meetingBlock.summaryTranscriptHeading"),
    owner: t("meetingBlock.summaryOwner"),
    due: t("meetingBlock.summaryDue"),
  };
}

/** ノート先頭の見出し（取れなければ undefined）。文字起こしのヒントに使う */
function firstHeadingText(editor: any): string | undefined {
  try {
    const h = (editor?.document ?? []).find((b: any) => b?.type === "heading" && Array.isArray(b.content));
    const text = (h?.content ?? []).map((c: any) => (typeof c?.text === "string" ? c.text : "")).join("").trim();
    return text || undefined;
  } catch {
    return undefined;
  }
}

function MeetingTranscriptView({ block, editor }: { block: any; editor: any }) {
  const locale = useLocaleSubscription();
  const linkStore = useOptionalLinkStore();
  const { recordingId, fileId, startedAt, durationMs, collapsed, expanded, showAll } = block.props;
  const [summarizing, setSummarizing] = useState(false);
  const [summaryError, setSummaryError] = useState<string | null>(null);
  const summarizingRef = useRef(false);
  const [confirmReplace, setConfirmReplace] = useState(false);
  const rec = useSyncExternalStore(store.subscribe, store.getState, store.getState);
  const tauri = isTauri();
  const editable = !!editor?.isEditable;
  const [saved, setSaved] = useState<{ state: "loaded" | "missing"; segments: TranscriptSegment[] } | null>(null);
  const [expanding, setExpanding] = useState(false);
  const expandingRef = useRef(false);

  // ストアに残っている、このブロック宛ての録音情報（開始 / 停止）
  const startWrite = !recordingId && !fileId
    ? Object.values(rec.pendingBlockWrites).find((w) => w.blockId === block.id && w.start)
    : undefined;
  const stopWrite = recordingId ? rec.pendingBlockWrites[recordingId] : undefined;

  const status = deriveBlockStatus({
    pendingStart: !!startWrite,
    tauri,
    phase: rec.phase,
    activeRecordingId: rec.id,
    recordingId,
    fileId,
    transcribes: rec.transcribes,
    transcript: saved?.state ?? null,
    lastJob: rec.lastJobByFile[fileId],
  });
  // 録音中・文字起こし中かどうか（読み直しの合図。saved には依存しない）
  const busy = status === "recording" || status === "transcribing";

  // 素材の transcript.json を読む。進行中が終わった瞬間にも読み直す。
  // 読めている発言は消さず、新しい読み込みが返ってから置き換える（完了時のちらつき防止）
  useEffect(() => {
    if (!tauri || !fileId) return;
    let cancelled = false;
    // 読めていない（missing）状態の古い結果だけ捨てる。「ない」を出し続けないため
    if (!busy) setSaved((prev) => (prev?.state === "loaded" ? prev : null));
    void (async () => {
      let segments: TranscriptSegment[] | null = null;
      try {
        segments = parseTranscriptSegments(await api.readTranscript(fileId));
      } catch {
        segments = null;
      }
      if (cancelled) return;
      if (segments && segments.length > 0) setSaved({ state: "loaded", segments });
      else setSaved({ state: "missing", segments: NO_SEGMENTS });
    })();
    return () => {
      cancelled = true;
    };
  }, [tauri, fileId, busy]);

  // ストアに残った録音情報を、このブロックの props へ適用して消す。
  // ブロックがマウントされていない間に始まった・止まった録音も、描画されたときにここで追いつく
  useEffect(() => {
    if (!editable) return;
    if (startWrite?.start) {
      editor.updateBlock(block, {
        props: { recordingId: startWrite.recordingId, fileId: startWrite.start.fileId, startedAt: startWrite.start.startedAt },
      });
      store.consumeBlockWrite(startWrite.recordingId, "start");
    } else if (stopWrite?.reset) {
      // 何も録れなかった録音: ブロックを消さず「録音を始める」状態に戻す
      editor.updateBlock(block, { props: { recordingId: "", fileId: "", startedAt: "", durationMs: 0 } });
      store.consumeBlockWrite(stopWrite.recordingId, "stop");
    } else if (stopWrite?.durationMs !== undefined) {
      // 録音が止まったら、確定した長さをブロックに書く（再読込後も長さを出すため）
      if (stopWrite.durationMs !== durationMs) editor.updateBlock(block, { props: { durationMs: stopWrite.durationMs } });
      store.consumeBlockWrite(stopWrite.recordingId, "stop");
    }
  }, [editable, editor, block, startWrite, stopWrite, durationMs]);

  // 素材から読んだ発言と、録音中に届いた発言を重複を除いて合わせる
  const live = rec.liveSegments[fileId];
  const savedSegments = saved?.segments ?? NO_SEGMENTS;
  const segments = useMemo(() => mergeSegments(savedSegments, live), [savedSegments, live]);
  // Markdown 書き出しのキャッシュを最新に保つ（録音中に届く分も含める）
  useEffect(() => {
    if (segments.length > 0) rememberTranscript(fileId, segments);
  }, [fileId, segments]);

  // 長さが未確定（0）のまま終わっているときは、発言の最大 endMs から目安を出す（props は書かない）
  const approx = status === "recording" ? 0 : durationMs > 0 ? 0 : approxDurationMs(segments);
  const shownDuration = status === "recording" ? rec.elapsedMs : durationMs > 0 ? durationMs : approx;

  const update = (props: Record<string, unknown>) => {
    if (!editable) return;
    editor.updateBlock(block, { props });
  };
  const labels = { other: t("meeting.trackOther"), self: t("meeting.trackSelf") };

  // 発言を段落にして挿入し、段落 id を記録、各段落から本ブロックへ derived_from（system）を張る
  const expandNow = (): string[] => {
    const inserted: any[] = editor.insertBlocks(buildTranscriptParagraphs(segments, labels), block, "after") ?? [];
    const ids = inserted.map((b) => b.id as string);
    linkParagraphsToBlock(linkStore, ids, block.id);
    update({ expanded: true, expandedBlockIds: JSON.stringify(ids) });
    return ids;
  };

  const onSummarizeClick = () => {
    // 前回の要約を人が書き換えていたら、置き換える前に確かめる
    const cur = editor.getBlock?.(block.id) ?? block;
    if (isSummaryEdited(editor, cur.props)) setConfirmReplace(true);
    else void onSummarize();
  };

  const onSummarize = async () => {
    setConfirmReplace(false);
    if (!editable || summarizingRef.current) return;
    summarizingRef.current = true;
    setSummarizing(true);
    setSummaryError(null);
    try {
      const cur = editor.getBlock?.(block.id) ?? block;
      let ids = existingIds(editor, cur.props.expandedBlockIds);
      if (!cur.props.expanded) {
        if (segments.length === 0) return;
        ids = expandNow();
      } else if (ids.length === 0) {
        // 記録が無い・古い id だけ（複製など）なら、直後の段落を走査する
        // この版より前に展開したブロック: 直後の [mm:ss] 段落を集めて記録する
        ids = collectExpandedParagraphs(editor, cur).map((b) => b.id as string);
        if (ids.length > 0) {
          linkParagraphsToBlock(linkStore, ids, block.id);
          update({ expandedBlockIds: JSON.stringify(ids) });
        }
      }
      const utterances = ids
        .map((id) => editor.getBlock(id))
        .map((b) => (b ? paragraphToUtterance(b, labels) : null))
        .filter((u): u is NonNullable<typeof u> => u !== null);
      if (utterances.length === 0) {
        setSummaryError(t("meetingBlock.summaryNoUtterances"));
        return;
      }
      const result = await summarizeMeeting({ utterances, language: locale });
      if (insertSummary(editor, linkStore, block, result, summaryLabels()) === null) {
        setSummaryError(t("meetingBlock.summaryNothingFound"));
      }
    } catch (e) {
      // 固定文言のエラーはそのまま、それ以外は「要約できませんでした」で包む
      setSummaryError(
        e instanceof SummaryMessageError
          ? e.message
          : t("meetingBlock.summarizeFailed", { reason: localizeAiError(e) }),
      );
    } finally {
      summarizingRef.current = false;
      setSummarizing(false);
    }
  };

  return (
    <MeetingTranscriptCard
      status={status}
      segments={segments}
      startedAt={startedAt}
      durationMs={shownDuration}
      durationApprox={status !== "recording" && durationMs <= 0 && approx > 0}
      expanding={expanding}
      collapsed={collapsed}
      expanded={expanded}
      showAll={showAll}
      editable={editable}
      captureSystem={rec.captureSystem}
      onCaptureSystemChange={store.setCaptureSystem}
      recordingBusy={rec.phase !== "idle" && rec.phase !== "error"}
      onStartRecording={() => {
        if (!editable) return;
        // 始まったら、このブロック自身が録音の情報を props に埋める
        // 録音情報の書き込みはストア経由（pendingBlockWrites）。上の effect が props に適用する
        void store.startFromBlock(block.id, firstHeadingText(editor)).catch((e) => console.warn("録音の開始に失敗:", e));
      }}
      canPlay={tauri && !!fileId && (status === "done" || status === "failed")}
      loadAudio={() => loadAudioUrl(fileId)}
      onToggleCollapsed={() => update({ collapsed: !collapsed })}
      onToggleShowAll={() => update({ showAll: !showAll })}
      onExpand={() => {
        if (!editable || segments.length === 0 || expandingRef.current) return;
        expandingRef.current = true;
        setExpanding(true);
        try {
          expandNow();
        } finally {
          expandingRef.current = false;
          setExpanding(false);
        }
      }}
      summaryEnabled={isAgentConfigured()}
      summarized={parseIdList(block.props.summaryBlockIds).length > 0}
      summarizing={summarizing}
      summaryError={summaryError}
      onSummarize={onSummarizeClick}
      confirmReplace={confirmReplace}
      onConfirmReplace={() => void onSummarize()}
      onCancelReplace={() => setConfirmReplace(false)}
    />
  );
}

export const MeetingTranscriptBlockSpec = createReactBlockSpec(
  {
    type: "meetingTranscript" as const,
    propSchema: {
      // 録音の ID（録音中かどうかをストアと突き合わせるキー）
      recordingId: { default: "" },
      // 録音素材（stereo WAV）の ID。文字起こしはここから引く
      fileId: { default: "" },
      // 録音を始めた日時（ISO）
      startedAt: { default: "" },
      // 録音の長さ（停止時に確定）
      durationMs: { default: 0 },
      collapsed: { default: false },
      // 段落に展開済みか
      expanded: { default: false },
      // 直近 20 発言でなく全部出すか
      showAll: { default: false },
      // 展開で作った段落の id（JSON 文字列の配列）。要約の入力と derived_from の元
      expandedBlockIds: { default: "" },
      // 要約として差し込んだブロックの id（JSON 文字列の配列）。2 回目は消して差し直す
      summaryBlockIds: { default: "" },
      // 差し込んだ要約のテキストのハッシュ。人が書き換えたかの判定に使う
      summaryHash: { default: "" },
    },
    content: "none" as const,
  },
  {
    render: (props) => <MeetingTranscriptView block={props.block} editor={props.editor} />,
  },
);
