// 会議の文字起こしブロック（ストア・エディタとつなぐ層）
//
// 発言の本文は props に持たない（1 時間分で保存 JSON が肥大するため）。録音中はストアに
// 届く発言を描き、終わったら素材の transcript.json を読み直す。状態も props に持たず導出する。

import { createReactBlockSpec } from "@blocknote/react";
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { isTauri } from "../../lib/platform";
import { getActiveProvider } from "../../lib/storage/registry";
import { t, useLocaleSubscription } from "../../i18n";
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

// 録音素材の blob URL（fileId ごとに 1 回だけ読む。inline-image と同じ流儀）
const blobUrlCache = new Map<string, Promise<string | null>>();
function loadAudioUrl(fileId: string): Promise<string | null> {
  const cached = blobUrlCache.get(fileId);
  if (cached) return cached;
  const p = getActiveProvider()
    .getMediaBlobUrl(fileId)
    .catch(() => {
      blobUrlCache.delete(fileId);
      return null;
    });
  blobUrlCache.set(fileId, p);
  return p;
}

const NO_SEGMENTS: TranscriptSegment[] = [];

function MeetingTranscriptView({ block, editor }: { block: any; editor: any }) {
  useLocaleSubscription();
  const { recordingId, fileId, startedAt, durationMs, collapsed, expanded, showAll } = block.props;
  const rec = useSyncExternalStore(store.subscribe, store.getState, store.getState);
  const tauri = isTauri();
  const editable = !!editor?.isEditable;
  const [saved, setSaved] = useState<{ state: "loaded" | "missing"; segments: TranscriptSegment[] } | null>(null);
  const [expanding, setExpanding] = useState(false);
  const expandingRef = useRef(false);

  const status = deriveBlockStatus({
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

  // 録音が止まったら、確定した長さをブロックに書く（再読込後も長さを出すため）
  const resultDuration = rec.result && rec.result.id === recordingId ? rec.result.durationMs : 0;
  useEffect(() => {
    if (resultDuration > 0 && resultDuration !== durationMs && editable) {
      editor.updateBlock(block, { props: { durationMs: resultDuration } });
    }
  }, [resultDuration, durationMs, editable, editor, block]);

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
      canPlay={tauri && !!fileId && (status === "done" || status === "failed")}
      loadAudio={() => loadAudioUrl(fileId)}
      onToggleCollapsed={() => update({ collapsed: !collapsed })}
      onToggleShowAll={() => update({ showAll: !showAll })}
      onExpand={() => {
        if (!editable || segments.length === 0 || expandingRef.current) return;
        expandingRef.current = true;
        setExpanding(true);
        try {
          editor.insertBlocks(buildTranscriptParagraphs(segments, labels), block, "after");
          update({ expanded: true });
        } finally {
          expandingRef.current = false;
          setExpanding(false);
        }
      }}
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
    },
    content: "none" as const,
  },
  {
    render: (props) => <MeetingTranscriptView block={props.block} editor={props.editor} />,
  },
);
