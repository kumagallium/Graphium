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
import { useOptionalAiAvailable } from "../../features/ai-assistant/store";
import { localizeAiError } from "../../lib/ai-error";
import { summarizeMeeting, SummaryMessageError } from "../../features/meeting-recorder/summary-service";
import {
  chunkUtterances,
  cleanupMeeting,
  CleanupMessageError,
  fetchMeetingModelContext,
} from "../../features/meeting-recorder/cleanup-service";
import { buildMeetingSummaryLines } from "./context-check";
import { estimateTokens, requiredContext } from "../../lib/context-estimate";
import {
  parseCleanupDoc,
  parseSummaryDoc,
  readArtifact,
  saveArtifact,
  type CleanupDoc,
  type SummaryDoc,
} from "../../features/meeting-recorder/artifacts";
import { getMeetingSettings, setMeetingSettings } from "../../features/settings/store";
import {
  buildCleanupDoc,
  buildCleanupWriteOut,
  collectNoteMemo,
  buildSummaryDoc,
  buildTranscriptWriteOut,
  cleanupToText,
  cleanupToUtterances,
  summaryToText,
  segmentsToUtterances,
  writeOutBlocks,
  writeOutSummary,
  type WriteOutLabels,
} from "./artifact-actions";
import type { WriteOutKind } from "./artifact-panels";
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
import { remaskCleanup, remaskSummary, writeOutState } from "./mask";
import { startRun, useRun, type RunKind } from "./runs";
import { appendMaskTerms, findNameCandidates, parseMaskTerms } from "../../lib/meeting-mask";
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

/** 清書・要約で、結果が無かったときなど、そのまま 1 行で出す文 */
class RunMessage extends Error {}

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

export function MeetingTranscriptView({ block, editor }: { block: any; editor: any }) {
  const locale = useLocaleSubscription();
  const linkStore = useOptionalLinkStore();
  const { recordingId, fileId, startedAt, durationMs, collapsed, expanded, showAll, maskSensitive } = block.props;
  const [summarizing, setSummarizing] = useState(false);
  const [summaryError, setSummaryError] = useState<string | null>(null);
  const summarizingRef = useRef(false);
  const [confirmReplace, setConfirmReplace] = useState(false);
  const rec = useSyncExternalStore(store.subscribe, store.getState, store.getState);
  // AI の入口（清書・要約）を出してよいか。AI を使わない人には出さない（aiUiEnabled と同じ判定）
  const aiEnabled = useOptionalAiAvailable(isAgentConfigured);
  const tauri = isTauri();
  const editable = !!editor?.isEditable;
  const [saved, setSaved] = useState<{ state: "loaded" | "missing"; segments: TranscriptSegment[] } | null>(null);
  const [expanding, setExpanding] = useState(false);
  const expandingRef = useRef(false);
  // 清書・要約（素材のそばの cleanup.json / summary.json）
  const [cleanup, setCleanup] = useState<CleanupDoc | null>(null);
  const [summaryDoc, setSummaryDoc] = useState<SummaryDoc | null>(null);
  // 清書・要約（ブロックの中）の実行は録音ごとに 1 か所で覚える（開き直した画面から二重に送らない）
  const cleanRun = useRun<CleanupDoc>(fileId, "cleanup");
  const sumRun = useRun<SummaryDoc>(fileId, "summary");
  // このパソコンの LM Studio のコンテキスト長が足りなそうなときの確認（このまま実行 / やめる）
  const [contextWarn, setContextWarn] = useState<{ kind: RunKind; loaded: number; needed: number; run: () => void } | null>(null);
  // 要約の書き出しを、手で直した前回の要約に重ねる前に確かめているか
  const [pendingSummaryWrite, setPendingSummaryWrite] = useState(false);

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

  // いま見ている録音（await のあいだにブロックが別の録音に替わったら、古い結果を入れない）
  const fileIdRef = useRef(fileId);
  fileIdRef.current = fileId;
  // 録音が替わったら、前の録音の清書・要約を出さない
  useEffect(() => {
    setCleanup(null);
    setSummaryDoc(null);
  }, [fileId]);
  // 実行が終わったら結果を取り込む（実行中に開き直した画面にも、できた清書・要約が届く）
  useEffect(() => {
    if (cleanRun.result) setCleanup(cleanRun.result.value);
  }, [cleanRun.result]);
  useEffect(() => {
    if (sumRun.result) setSummaryDoc(sumRun.result.value);
  }, [sumRun.result]);
  // 清書・要約を読む（録音を替えたら読み直す。録音中・文字起こし中はまだ無い）
  useEffect(() => {
    if (!tauri || !fileId || busy) return;
    let cancelled = false;
    void (async () => {
      const [c, s] = await Promise.all([
        readArtifact(fileId, "cleanup").catch(() => null),
        readArtifact(fileId, "summary").catch(() => null),
      ]);
      if (cancelled) return;
      setCleanup(parseCleanupDoc(c));
      setSummaryDoc(parseSummaryDoc(s));
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
    // 以前のブロック（段落に展開済み）だけ、要約をノートに直接差し込む
    if (!expanded) {
      onSummarizeInBlock();
      return;
    }
    // 前回の要約を人が書き換えていたら、置き換える前に確かめる
    const cur = editor.getBlock?.(block.id) ?? block;
    if (isSummaryEdited(editor, cur.props)) setConfirmReplace(true);
    else void onSummarize();
  };

  const errorText = (e: unknown, failedKey: "meetingBlock.summarizeFailed" | "meetingBlock.cleanupFailed") =>
    e instanceof SummaryMessageError || e instanceof CleanupMessageError
      ? e.message
      : t(failedKey, { reason: localizeAiError(e) });

  /**
   * 送る前に、清書・要約のモデルがこのパソコンの LM Studio なら、読み込み中のコンテキスト長と
   * 1 回に要りそうな長さを比べる。足りなそうなら確かめてから実行する（確かめられなければそのまま実行）
   */
  const runWithContextCheck = async (kind: RunKind, longestInput: string, run: () => void) => {
    setContextWarn(null);
    const loaded = await fetchMeetingModelContext();
    const needed = requiredContext(kind, estimateTokens(longestInput));
    if (loaded !== null && loaded < needed) setContextWarn({ kind, loaded, needed, run });
    else run();
  };

  // 清書する: 文字起こしを AI に渡し、結果を素材のそばに保存する（ノートには入れない）
  const onCleanup = () => {
    if (!editable || !tauri || !fileId || segments.length === 0) return;
    // 清書は分けて送るので、いちばん長い 1 回分で比べる
    const chunks = chunkUtterances(segmentsToUtterances(segments));
    const longest = chunks
      .map((c) => buildMeetingSummaryLines(c))
      .reduce((a, b) => (estimateTokens(b) > estimateTokens(a) ? b : a), "");
    void runWithContextCheck("cleanup", longest, runCleanup);
  };

  const runCleanup = () => {
    if (!editable || !tauri || !fileId || segments.length === 0) return;
    const target = fileId;
    const utterances = segmentsToUtterances(segments);
    const ms = getMeetingSettings();
    const vocabulary = store.buildVocabulary(store.currentNoteTitleForHint(), ms.vocabulary);
    const notes = collectNoteMemo(editor, block);
    startRun<CleanupDoc>(
      target,
      "cleanup",
      async (onProgress) => {
        const result = await cleanupMeeting({
          utterances,
          language: locale,
          vocabulary,
          notes,
          ...(maskSensitive ? { mask: { terms: ms.maskTerms } } : {}),
          onProgress,
        });
        const doc = buildCleanupDoc(result.paragraphs, utterances, result.model, new Date(), result.fixes, result.masked);
        if (!doc) throw new RunMessage(t("meetingBlock.cleanupNothing"));
        // 保存に失敗しても、作った清書は画面では見せる（AI の呼び出しは済んでいる）
        const saved = await saveArtifact(target, "cleanup", JSON.stringify(doc)).then(
          () => true,
          (e) => {
            console.warn("清書の保存に失敗:", e);
            return false;
          },
        );
        return { value: doc, ...(saved ? {} : { warning: t("meetingBlock.artifactSaveFailed") }) };
      },
      (e) => (e instanceof RunMessage ? e.message : errorText(e, "meetingBlock.cleanupFailed")),
    );
  };

  // 要約する（ブロックの中）: 清書があれば清書から、無ければ文字起こしから。要約は 1 回で全部を送る
  const onSummarizeInBlock = () => {
    if (!editable || !tauri || !fileId || segments.length === 0) return;
    const input = cleanup ? cleanupToUtterances(cleanup) : segmentsToUtterances(segments);
    void runWithContextCheck("summary", buildMeetingSummaryLines(input), runSummaryInBlock);
  };

  const runSummaryInBlock = () => {
    if (!editable || !tauri || !fileId || segments.length === 0) return;
    const target = fileId;
    const base = cleanup;
    const utterances = base ? cleanupToUtterances(base) : segmentsToUtterances(segments);
    const notes = collectNoteMemo(editor, block);
    startRun<SummaryDoc>(
      target,
      "summary",
      async () => {
        const result = await summarizeMeeting({
          utterances,
          language: locale,
          notes,
          ...(maskSensitive ? { mask: { terms: getMeetingSettings().maskTerms } } : {}),
        });
        const doc = buildSummaryDoc(result, utterances, base);
        if (!doc) throw new RunMessage(t("meetingBlock.summaryNothingFound"));
        const saved = await saveArtifact(target, "summary", JSON.stringify(doc)).then(
          () => true,
          (e) => {
            console.warn("要約の保存に失敗:", e);
            return false;
          },
        );
        return { value: doc, ...(saved ? {} : { warning: t("meetingBlock.artifactSaveFailed") }) };
      },
      (e) => (e instanceof RunMessage ? e.message : errorText(e, "meetingBlock.summarizeFailed")),
    );
  };

  const writeLabels = (): WriteOutLabels => ({
    ...summaryLabels(),
    other: labels.other,
    self: labels.self,
    cleanupHeading: t("meetingBlock.cleanupHeading"),
    cleanupAiNote: t("meetingBlock.cleanupAiNote"),
  });

  // 伏せるブロックでは、書き出す直前にその時点の「必ず伏せる語」でもう一度伏せる（後から足した語にも効く）
  const maskTermsNow = () => parseMaskTerms(getMeetingSettings().maskTerms);

  // 清書・要約をまとめてコピーする（ノートに書き出すのと同じ形。伏せるブロックでは伏せた文で）
  const onCopyArtifact = async (kind: "cleanup" | "summary"): Promise<boolean> => {
    let text = "";
    if (kind === "cleanup" && cleanup) {
      text = cleanupToText(maskSensitive ? remaskCleanup(cleanup, maskTermsNow(), locale) : cleanup, labels);
    } else if (kind === "summary" && summaryDoc) {
      text = summaryToText(maskSensitive ? remaskSummary(summaryDoc, maskTermsNow(), locale) : summaryDoc, summaryLabels());
    }
    if (!text) return false;
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      return false;
    }
  };

  // 伏せた清書・要約に残っている、人名らしい語の候補（AI の見逃し）。押すと「必ず伏せる語」に足して伏せ直す
  const nameCandidates = useMemo(() => {
    if (!maskSensitive) return { cleanup: [] as string[], summary: [] as string[] };
    const cleanupText = cleanup?.masked ? cleanup.paragraphs.map((p) => p.text).join("\n") : "";
    const summaryText = summaryDoc?.masked
      ? [...summaryDoc.decisions, ...summaryDoc.todos, ...summaryDoc.issues]
          .flatMap((x) => [x.text, (x as { owner?: string }).owner ?? ""])
          .join("\n")
      : "";
    return { cleanup: findNameCandidates(cleanupText), summary: findNameCandidates(summaryText) };
  }, [maskSensitive, cleanup, summaryDoc]);

  const onHideNames = (names: string[]) => {
    if (!editable || names.length === 0) return;
    const terms = appendMaskTerms(getMeetingSettings().maskTerms, names);
    setMeetingSettings({ meetingMaskTerms: terms });
    const list = parseMaskTerms(terms);
    if (cleanup) {
      const doc = remaskCleanup(cleanup, list, locale);
      setCleanup(doc);
      void saveArtifact(fileId, "cleanup", JSON.stringify(doc)).catch((e) => console.warn("清書の保存に失敗:", e));
    }
    if (summaryDoc) {
      const doc = remaskSummary(summaryDoc, list, locale);
      setSummaryDoc(doc);
      void saveArtifact(fileId, "summary", JSON.stringify(doc)).catch((e) => console.warn("要約の保存に失敗:", e));
    }
  };

  const writeSummaryNow = () => {
    setPendingSummaryWrite(false);
    setConfirmReplace(false);
    if (!summaryDoc) return;
    const doc = maskSensitive ? remaskSummary(summaryDoc, maskTermsNow(), locale) : summaryDoc;
    // ノートに書き出した要約には、ブロックの中から作った要約向けの注記を付ける
    // （項目からノートの段落へのリンクは無く、根拠は末尾の時刻で示す）
    writeOutSummary(editor, linkStore, block, doc, { ...summaryLabels(), aiNote: t("meetingBlock.summaryAiNoteTimes") });
  };

  // ノートに書き出す: 選んだものを、前に書き出したものの後ろに段落として足す
  const onWriteOut = (kind: WriteOutKind) => {
    if (!editable) return;
    // 伏せるにしたブロックは、伏せて作った清書・要約しか書き出さない（メニューでも選べなくしてある）
    if (writeOutState(!!maskSensitive, cleanup, summaryDoc)[kind] !== null) return;
    if (kind === "summary") {
      const cur = editor.getBlock?.(block.id) ?? block;
      // 前回書き出した要約を人が直していたら、差し替える前に確かめる
      // （書き出した要約をまるごと消していたら、直したのではないので確かめない）
      if (existingIds(editor, cur.props.summaryBlockIds).length > 0 && isSummaryEdited(editor, cur.props)) {
        setPendingSummaryWrite(true);
        setConfirmReplace(true);
      } else writeSummaryNow();
    } else if (kind === "cleanup") {
      if (cleanup) {
        const doc = maskSensitive ? remaskCleanup(cleanup, maskTermsNow(), locale) : cleanup;
        writeOutBlocks(editor, linkStore, block, buildCleanupWriteOut(doc, writeLabels()), "ai");
      }
    } else if (segments.length > 0) {
      writeOutBlocks(editor, linkStore, block, buildTranscriptWriteOut(segments, writeLabels()), "system");
    }
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
        void store.startFromBlock(block.id, store.currentNoteTitleForHint()).catch((e) => console.warn("録音の開始に失敗:", e));
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
      summaryEnabled={aiEnabled}
      summarized={parseIdList(block.props.summaryBlockIds).length > 0}
      summarizing={summarizing || sumRun.progress !== null}
      summaryError={sumRun.error ?? summaryError}
      onSummarize={onSummarizeClick}
      confirmReplace={confirmReplace}
      onConfirmReplace={() => (pendingSummaryWrite ? writeSummaryNow() : void onSummarize())}
      onCancelReplace={() => {
        setConfirmReplace(false);
        setPendingSummaryWrite(false);
      }}
      cleanup={cleanup}
      summaryDoc={summaryDoc}
      cleaning={cleanRun.progress}
      cleanupError={cleanRun.error}
      onCleanup={tauri && fileId ? onCleanup : undefined}
      contextWarning={
        contextWarn
          ? {
              text: t("meetingBlock.contextShort", {
                loaded: contextWarn.loaded.toLocaleString(),
                needed: contextWarn.needed.toLocaleString(),
                action: t(contextWarn.kind === "cleanup" ? "meetingBlock.contextShortCleanup" : "meetingBlock.contextShortSummary"),
              }),
              onProceed: () => {
                const run = contextWarn.run;
                setContextWarn(null);
                run();
              },
              onCancel: () => setContextWarn(null),
            }
          : null
      }
      onWriteOut={onWriteOut}
      maskSensitive={!!maskSensitive}
      onCopyArtifact={onCopyArtifact}
      nameCandidates={nameCandidates}
      onHideNames={editable ? onHideNames : undefined}
      writtenBefore={
        existingIds(editor, block.props.writtenBlockIds).length > 0 ||
        existingIds(editor, block.props.expandedBlockIds).length > 0
      }
      onToggleMask={editable ? () => update({ maskSensitive: !maskSensitive }) : undefined}
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
      // 「ノートに書き出す」で足したブロックの id（JSON 文字列の配列）。次の書き出しはこの後ろに足す
      writtenBlockIds: { default: "" },
      // 名前などを伏せる。清書・要約で人名・組織名・連絡先を印に置き換え、伏せたものだけを書き出せる。
      // チャットなどに渡す Markdown にも生の発言を出さない
      maskSensitive: { default: false },
    },
    content: "none" as const,
  },
  {
    render: (props) => <MeetingTranscriptView block={props.block} editor={props.editor} />,
  },
);
