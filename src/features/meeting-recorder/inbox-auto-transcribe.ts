// 受信箱から届いた音声の自動文字起こし（デスクトップのみ）
//
// 写真の自動読み取りと同じ考え方で、取り込みのあと裏で文字起こしする。
// - まだ文字が無い音声だけ（保存済みの文字起こしがあれば何もしない）
// - 1 本ずつ順に処理する（前の本が終わってから次を始める）。取り込みが続けて来ても前の列に連ねる。
//   1 本が失敗・時間切れ・例外でも、必ず次へ進む
// - モデルが無ければ自動で取得して待つ（取り消し・削除した人、この起動で試し済みなら取得しない）。
//   取得の進み具合と結果は reporter で知らせる。取得できなければ残りは諦め、音声はそのまま残る
//   （音声を開いて「文字起こし」ボタンで後から押せる）
// - 文字にできなかった音声は、まとめて 1 回だけ reporter で知らせる。ほかの処理は止めない

import { isTauri } from "../../lib/platform";
import { getMeetingSettings } from "../settings/store";
import * as api from "./api";
import {
  bytesToMb,
  downloadPercent,
  ensureTranscribeModel,
  getModelDownloadState,
  subscribeModelDownload,
} from "./model-auto-download";
import { startExternalTranscribe, waitExternalTranscribeFinished } from "./transcribe-external";

/** 1 回の取り込みで、文字起こしを諦めた音声の数（種類ごと） */
export type InboxTranscribeSkipped = {
  /** 形式を読めなかった・受け渡しに失敗した */
  failed: number;
  /** 2 時間を超えていた */
  tooLong: number;
  /** 文字起こしモデルが使えず、始められなかった */
  noModel: number;
};

/** 画面への知らせ。どれも省略できる（例外は握りつぶす。知らせの失敗で処理を止めない） */
export type InboxTranscribeReporter = {
  /** モデルを取得している間、進み具合が変わるたびに（percent が変わったときだけ） */
  modelDownloading?: (p: { mb: number; percent: number }) => void;
  /** 取得が終わった（ok = モデルが使えるようになった）。modelDownloading を出したときだけ呼ぶ */
  modelDownloadEnded?: (ok: boolean) => void;
  /** 1 回の取り込みの最後に、諦めた音声があれば 1 回 */
  skipped?: (s: InboxTranscribeSkipped) => void;
};

let chain: Promise<void> = Promise.resolve();

/** mimeOf: 素材の MIME 型を引く（省略可。長さの読み取りに使う） */
export function enqueueInboxTranscribe(
  fileIds: readonly string[],
  reporter: InboxTranscribeReporter = {},
  mimeOf?: (fileId: string) => string | undefined,
): void {
  if (!isTauri() || fileIds.length === 0) return;
  chain = chain
    .then(() => runAll(fileIds, reporter, mimeOf))
    .catch((e) => console.error("[inbox] auto transcribe failed", e));
}

const safe = (fn: () => void) => {
  try {
    fn();
  } catch (e) {
    console.error("[inbox] reporter failed", e);
  }
};

/** モデルを確かめ（無ければ自動で取得し）、進み具合を reporter に流す。使えるようになったら true */
async function ensureModelReported(reporter: InboxTranscribeReporter): Promise<boolean> {
  const size = getMeetingSettings().modelSize;
  let shown = false;
  let lastPercent = -1;
  const push = () => {
    const s = getModelDownloadState(size);
    if (s.status !== "downloading") return;
    const percent = downloadPercent(s);
    if (shown && percent === lastPercent) return;
    shown = true;
    lastPercent = percent;
    safe(() => reporter.modelDownloading?.({ mb: bytesToMb(s.expectedBytes), percent }));
  };
  const unsub = subscribeModelDownload(push);
  let ok = false;
  try {
    ok = await ensureTranscribeModel(size, { auto: true });
  } finally {
    unsub();
    if (shown) safe(() => reporter.modelDownloadEnded?.(ok));
  }
  return ok;
}

async function runAll(
  fileIds: readonly string[],
  reporter: InboxTranscribeReporter,
  mimeOf?: (fileId: string) => string | undefined,
): Promise<void> {
  // 文字がまだ無い音声だけ
  const todo: string[] = [];
  for (const fileId of fileIds) {
    const existing = await api.readTranscript(fileId).catch(() => null);
    if (!existing) todo.push(fileId);
  }
  const skipped: InboxTranscribeSkipped = { failed: 0, tooLong: 0, noModel: 0 };
  for (let i = 0; i < todo.length; i++) {
    const fileId = todo[i];
    try {
      if (!(await ensureModelReported(reporter))) {
        // 取得できない・取り消された・自動では取らない: 残りはまとめて諦める（音声はそのまま残る）
        skipped.noModel = todo.length - i;
        break;
      }
      const r = await startExternalTranscribe(fileId, mimeOf?.(fileId));
      if (r.result === "started") await waitExternalTranscribeFinished(r); // 時間切れでも次へ進む
      else if (r.result === "unreadable" || r.result === "too-large" || r.result === "failed") skipped.failed++;
      else if (r.result === "too-long") skipped.tooLong++;
      // busy: すでに別の処理が進めているので何もしない
    } catch (e) {
      // 1 本の例外で鎖を止めない
      console.error("[inbox] auto transcribe failed", fileId, e);
      skipped.failed++;
    }
  }
  if (skipped.failed + skipped.tooLong + skipped.noModel > 0) safe(() => reporter.skipped?.(skipped));
}

/** テスト用: 今まで連ねた処理がすべて終わるまで待つ */
export function whenInboxTranscribeIdleForTest(): Promise<void> {
  return chain;
}
