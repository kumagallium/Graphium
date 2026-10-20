// 停止結果から録音 1 本を素材インデックスに登録する。
// ファイル本体は Rust が media/<fileId>.wav に書き済みなので、ここは索引への追加だけ。

import {
  addMediaEntry,
  createEmptyIndex,
  MEDIA_INDEX_CHANGED_EVENT,
  mimeToMediaType,
  readMediaIndex,
  saveMediaIndex,
  type MediaIndexEntry,
} from "../asset-browser/media-index";
import { t } from "../../i18n";
import type { MeetingRecStopResult } from "./types";

const MIME = "audio/wav";

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

/** 例: "2026-10-19 14:05" */
export function formatMeetingStamp(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** 純関数: 登録する entry を作る（stereo WAV 1 件。fileId が null なら作らない） */
export function buildRecordingEntries(
  result: MeetingRecStopResult,
  startedAt: Date,
  now: Date = new Date(),
): MediaIndexEntry[] {
  if (!result.fileId) return [];
  const name = t("meeting.fileName", { stamp: formatMeetingStamp(startedAt) });
  const url = `file-media://${result.fileId}`;
  return [
    {
      fileId: result.fileId,
      name,
      type: mimeToMediaType(MIME, name),
      mimeType: MIME,
      url,
      thumbnailUrl: url,
      uploadedAt: now.toISOString(),
      usedIn: [],
    },
  ];
}

/**
 * 素材インデックスに追加して保存し、素材一覧へ変更を通知する。
 * 登録した件数を返す。
 */
const inflight = new Map<string, Promise<number>>();

export function registerRecording(
  result: MeetingRecStopResult,
  startedAt: Date = new Date(Date.now() - result.durationMs),
): Promise<number> {
  // 終了時の登録と Mount の登録が重なっても、同じ録音は 1 回だけ読み書きする
  const running = inflight.get(result.id);
  if (running) return running;
  const p = registerRecordingOnce(result, startedAt).finally(() => inflight.delete(result.id));
  inflight.set(result.id, p);
  return p;
}

async function registerRecordingOnce(result: MeetingRecStopResult, startedAt: Date): Promise<number> {
  const entries = buildRecordingEntries(result, startedAt);
  if (entries.length === 0) return 0;
  let index = (await readMediaIndex()) ?? createEmptyIndex();
  for (const entry of entries) {
    // 同じ fileId が既にあれば二重登録しない
    if (index.media.some((m) => m.fileId === entry.fileId)) continue;
    index = addMediaEntry(index, entry);
  }
  await saveMediaIndex(index);
  // use-file-manager が購読していて、in-memory の素材一覧を読み直す
  if (typeof window !== "undefined") {
    window.dispatchEvent(
      new CustomEvent(MEDIA_INDEX_CHANGED_EVENT, { detail: { reason: "meeting-recording" } }),
    );
  }
  return entries.length;
}
