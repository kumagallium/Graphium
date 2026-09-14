// 長い処理の間、ウィンドウが隠れても WebView を止めさせない（デスクトップ版のみ）
//
// macOS の WKWebView は、ウィンドウが別のスペースや他のアプリの裏に隠れると
// ページを減速させ、約 10 分後には WebContent プロセスごと一時停止させる。
// 取り込みや OCR のループは WebView の中で回っているので、フォルダを選んで
// 別の作業に移ると、1 件に数十秒かかるようになり、最後は止まる（表示し直すと
// 続きから再開する）。
//
// 処理中だけ Rust の `set_background_work_active` で覆い隠しの判定を切り、
// 終わったら戻す。常に切りっぱなしにしないのは、隠れている間もアニメーション
// やタイマーが全速で回り続けて電池を食うため。
//
// 複数の処理が重なる（取り込みの直後に OCR キューが続く等）ので参照カウントで
// 持ち、最初の 1 つでオン、最後の 1 つが終わったらオフにする。
// 最小化されたウィンドウは覆い隠しとは別扱いで、これでは止められない。

import { invoke } from "@tauri-apps/api/core";
import { isTauri } from "./platform";

let holders = 0;
// オン/オフの invoke は順番どおりに届けたいので、前の呼び出しの後ろにつなぐ
let queue: Promise<void> = Promise.resolve();

function setActive(active: boolean): void {
  queue = queue.then(async () => {
    try {
      await invoke("set_background_work_active", { active });
    } catch (e) {
      // 切り替えに失敗しても処理自体は続ける（遅くなるだけで壊れはしない）
      console.warn("[background-work] 切り替えに失敗しました:", e);
    }
  });
}

/**
 * 長い処理を始めるときに呼ぶ。戻り値の関数を処理の終わりに必ず呼ぶこと
 * （try/finally で）。2 回呼んでも 1 回分しか数えない。Web 版では何もしない。
 */
export function holdBackgroundWork(): () => void {
  if (!isTauri()) return () => {};
  holders += 1;
  if (holders === 1) setActive(true);
  let released = false;
  return () => {
    if (released) return;
    released = true;
    holders -= 1;
    if (holders === 0) setActive(false);
  };
}

/** テスト用: カウントと待ち行列を初期状態に戻す */
export function resetBackgroundWorkForTest(): void {
  holders = 0;
  queue = Promise.resolve();
}

/** テスト用: 積まれた invoke がすべて終わるのを待つ */
export function flushBackgroundWorkForTest(): Promise<void> {
  return queue;
}
