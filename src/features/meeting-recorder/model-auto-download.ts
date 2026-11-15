// 文字起こしモデルの自動取得
//
// 文字起こしが必要になった時点でモデルが無ければ、設定で選ばれている大きさの取得を始める
// （検索用の埋め込みモデルを最初に必要になったとき自動で取得するのと同じ考え方）。
// - 取得済みなら何もしない
// - 同じ大きさがすでに取得中なら重ねて始めない（この中で始めたものは同じ Promise を返す。
//   設定画面など別の場所で始めたものは Rust が "already downloading" を返すので、イベントで終わりを待つ）
// - 進み具合は購読 / フックで読める（設定画面の表示は同じイベントを別に聞くだけなので食い違わない）
//
// 取得の始め方は 2 通り:
// - 利用者が自分で押した操作（音声の「文字起こし」ボタンなど）: 取得して、取り消し・削除の印も外す
// - 自動（受信箱に音声が届いた・録音を始めた）: 1 回の起動につき 1 回だけ試す（失敗しても同じ起動中は繰り返さない）。
//   利用者が設定画面で取得を取り消した・モデルを削除したときは、その印を覚えて（設定に保存）自動では取り直さない

import { useSyncExternalStore } from "react";
import {
  getMeetingSettings,
  isMeetingModelAutoDownloadDeclined,
  setMeetingModelAutoDownloadDeclined,
} from "../settings/store";
import * as api from "./api";
import type { MeetingModelSize } from "./types";

export type ModelDownloadState = {
  /** idle: 何もしていない（取り消し含む） / downloading: 取得中 / failed: 失敗 */
  status: "idle" | "downloading" | "failed";
  received: number;
  total: number;
  /** モデルの実サイズ（バイト）。getModelStatus の値。まだ読めていなければ 0 */
  expectedBytes: number;
  error?: string;
};

const IDLE: ModelDownloadState = { status: "idle", received: 0, total: 0, expectedBytes: 0 };

const states = new Map<MeetingModelSize, ModelDownloadState>();
const inflight = new Map<MeetingModelSize, Promise<boolean>>();
/** この起動で、自動の取得をすでに試した大きさ（成功・失敗を問わない） */
const autoAttempted = new Set<MeetingModelSize>();
const listeners = new Set<() => void>();

const setState = (size: MeetingModelSize, next: ModelDownloadState) => {
  states.set(size, next);
  listeners.forEach((l) => l());
};

export const getModelDownloadState = (size: MeetingModelSize): ModelDownloadState => states.get(size) ?? IDLE;

export const subscribeModelDownload = (cb: () => void): (() => void) => {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
};

/** 画面から取得の状態を読むフック（進み具合は received / total） */
export function useModelDownloadState(size: MeetingModelSize): ModelDownloadState {
  return useSyncExternalStore(
    subscribeModelDownload,
    () => getModelDownloadState(size),
    () => IDLE,
  );
}

/** 画面に出す大きさの目安（MB）。実サイズから取る */
export const bytesToMb = (bytes: number): number => Math.max(1, Math.round(bytes / 1_000_000));

/** 取得の進み具合（0〜100）。合計が分からないうちは 0 */
export const downloadPercent = (s: ModelDownloadState): number =>
  s.total > 0 ? Math.min(100, Math.floor((s.received / s.total) * 100)) : 0;

const isPresent = async (size: MeetingModelSize): Promise<{ present: boolean; expectedBytes: number } | null> => {
  const list = await api.getModelStatus();
  const m = list.find((x) => x.size === size);
  return m ? { present: m.present, expectedBytes: m.expectedBytes } : null;
};

/** 別の場所で始まった取得を待つとき、状態を読み直す間隔 */
export const EXTERNAL_POLL_MS = 3_000;
/**
 * 別の場所で始まった取得を待つとき、進み具合のイベントも完了も届かないまま経つと諦める時間。
 * 取得中は進み具合のイベントが続けて届くので、届かなくなったのは取り消し・失敗のイベントを取り逃したとき
 * （購読を張る前に終わった場合など）。取得済みかどうかは読み直しで分かるが、取り消しは読み直しでは分からない
 */
export const EXTERNAL_IDLE_MS = 5 * 60_000;

/** 別の場所（設定画面など）で始まった取得が終わるのを待つ。失敗したときだけ message を返す */
/** 失敗したときだけ error。無通信で諦めたときは idle（待っただけで、取得の成否は分からない） */
async function waitForExternalDownload(size: MeetingModelSize): Promise<{ error?: string; idle?: boolean }> {
  return new Promise((resolve) => {
    const stops: Array<() => void> = [];
    let settled = false;
    let lastActivity = Date.now();
    let poll: ReturnType<typeof setInterval> | null = null;
    const finish = (r: { error?: string; idle?: boolean }) => {
      if (settled) return;
      settled = true;
      if (poll) clearInterval(poll);
      stops.forEach((u) => u());
      resolve(r);
    };
    const keep = (p: Promise<() => void>) => {
      p.then((u) => (settled ? u() : stops.push(u))).catch(() => {});
    };
    keep(api.onModelDone((e) => e.size === size && finish({})));
    keep(api.onModelCancelled((e) => e.size === size && finish({})));
    keep(api.onModelError((e) => e.size === size && finish({ error: e.message })));
    keep(
      api.onModelProgress((e) => {
        if (e.size === size) lastActivity = Date.now();
      }),
    );
    // 購読する前に終わっていた場合や、イベントを取り逃した場合に固着しないよう、数秒おきに読み直す。
    // 進み具合も届かないまま EXTERNAL_IDLE_MS 経ったら、取り消されたものとして待つのをやめる
    // （そのあとの present 判定で、揃っていなければ取り消し扱いになる）
    const check = () => {
      if (settled) return;
      isPresent(size)
        .then((st) => {
          if (st?.present) finish({});
          else if (Date.now() - lastActivity >= EXTERNAL_IDLE_MS) finish({ idle: true });
        })
        .catch(() => {
          if (Date.now() - lastActivity >= EXTERNAL_IDLE_MS) finish({ idle: true });
        });
    };
    check();
    poll = setInterval(check, EXTERNAL_POLL_MS);
  });
}

async function run(size: MeetingModelSize, auto: boolean): Promise<boolean> {
  let spec: { present: boolean; expectedBytes: number } | null;
  try {
    spec = await isPresent(size);
  } catch (err) {
    setState(size, { ...IDLE, status: "failed", error: String(err) });
    return false;
  }
  if (!spec) {
    setState(size, { ...IDLE, status: "failed", error: "unknown model size" });
    return false;
  }
  if (spec.present) {
    setState(size, { ...IDLE, expectedBytes: spec.expectedBytes });
    return true;
  }
  const expectedBytes = spec.expectedBytes;
  if (auto) {
    // 自動では取り直さない: 利用者が取り消した・削除した / この起動で試し済み
    if (isMeetingModelAutoDownloadDeclined(size) || autoAttempted.has(size)) return false;
    autoAttempted.add(size);
  } else {
    // 利用者が自分で押した操作。取り消し・削除の印は外す
    setMeetingModelAutoDownloadDeclined(size, false);
  }
  setState(size, { status: "downloading", received: 0, total: expectedBytes, expectedBytes });

  const stop: { fn: (() => void) | null } = { fn: null };
  let disposed = false;
  api
    .onModelProgress((e) => {
      if (e.size !== size) return;
      setState(size, { status: "downloading", received: e.received, total: e.total || expectedBytes, expectedBytes });
    })
    .then((u) => (disposed ? u() : (stop.fn = u)))
    .catch(() => {});

  let failure: string | undefined;
  try {
    await api.downloadModel(size);
  } catch (err) {
    if (/already downloading/i.test(String(err))) {
      const waited = await waitForExternalDownload(size);
      failure = waited.error;
      // 無通信で諦めたのは「自動取得を試した」に数えない（あとで届いた音声でもう一度待てるように）
      if (waited.idle && auto) autoAttempted.delete(size);
    } else {
      failure = String(err);
    }
  } finally {
    disposed = true;
    stop.fn?.();
  }

  if (failure) {
    setState(size, { ...IDLE, expectedBytes, status: "failed", error: failure });
    return false;
  }
  // 完了・取り消しはどちらも例外にならないので、実際に揃ったかで決める
  let present = false;
  try {
    present = (await isPresent(size))?.present ?? false;
  } catch {
    present = false;
  }
  setState(size, { ...IDLE, expectedBytes });
  return present;
}

/**
 * 文字起こしモデルを確かめて、無ければ取得して、使えるようになったら true を返す。
 * 失敗・取り消しは false（失敗の理由は getModelDownloadState(size).error）。
 * 既定は設定で選ばれている大きさ。取得中に重ねて呼んでも取得は 1 本だけ。
 *
 * `auto: true` は自動の取得（受信箱・録音の開始）。取得済みなら true を返すが、未取得のときは
 * 利用者が取り消した・削除した大きさ、またはこの起動で試し済みの大きさなら、取得せず false を返す。
 * 指定しない（既定）は利用者が自分で押した操作で、取得し、取り消し・削除の印も外す
 */
export function ensureTranscribeModel(
  size: MeetingModelSize = getMeetingSettings().modelSize,
  opts: { auto?: boolean } = {},
): Promise<boolean> {
  const existing = inflight.get(size);
  if (existing) return existing;
  const p = run(size, opts.auto === true).finally(() => {
    inflight.delete(size);
  });
  inflight.set(size, p);
  return p;
}

/**
 * 自動の取得をこれから試せるか（取り消し・削除の印が無く、この起動でまだ試していない）。
 * 画面が「始めると取得します」と案内してよいかの判定に使う
 */
export function canAutoDownload(size: MeetingModelSize = getMeetingSettings().modelSize): boolean {
  return !isMeetingModelAutoDownloadDeclined(size) && !autoAttempted.has(size);
}

/** 利用者が設定画面で取得を取り消した・モデルを削除した: 以後、自動では取り直さない */
export function declineAutoDownload(size: MeetingModelSize): void {
  setMeetingModelAutoDownloadDeclined(size, true);
  listeners.forEach((l) => l());
}

/** 利用者が自分で取得を始めた（設定の「取得」）: 取り消し・削除の印を外す */
export function acceptAutoDownload(size: MeetingModelSize): void {
  setMeetingModelAutoDownloadDeclined(size, false);
  listeners.forEach((l) => l());
}

/** テスト用: 内部状態を空にする */
export function resetModelAutoDownloadForTest() {
  states.clear();
  inflight.clear();
  autoAttempted.clear();
  listeners.clear();
}
