// ウィンドウを閉じる・アプリを終える・リロードするときに、エディタの未保存の編集を書き出す。
//
// エディタは最後の入力から 3 秒待って自動保存する。閉じる・切り替える・アンマウントの経路は
// 各エディタが自分で書き出すが、終了とリロードは React のアンマウントを通らないので、ここで
// 開いているすべてのエディタ（メイン・サイドピーク）に書き出させる。保存の経路は増やさず、
// 既存のノートごとの保存の列に乗せる（lib/peek-save-queue.ts の flushAllEditorSaves）。
//
// デスクトップ（Tauri）: Rust がウィンドウを閉じる要求を止めて 'app-close-requested' を出し、
//   フロントの shutdown_ack を待つ。ACK の前に書き出しを待てるので、取りこぼさない
//   （上限つき。保存先が返らなくても終了できる）。
// Web: ページが消える前に待つ手段が無い。pagehide / visibilitychange(hidden) で書き出しを
//   「始める」ことはできるが、非同期の書き込みが終わる保証は無い:
//   - IndexedDB（local）: 始めたトランザクションは多くの場合そのまま終わるが、仕様上の保証は無い
//   - サーバー保存（fetch）・Drive: ページが消えると打ち切られることがある
//   - 本文の読み取りの後に来歴の計算（非同期）を挟むので、書き込み自体がまだ始まっていない
//     こともある
//   確実に守れるのは、未保存が残っているときに beforeunload の確認を出してページを引き留める
//   場合だけ（確認が出ている間も書き出しは進む）。

import { flushAllEditorSaves, hasUnsavedEditorWork } from "./peek-save-queue";

/** 終了時に書き出しを待つ上限。保存先が返らなくても終了できるように */
export const EXIT_FLUSH_TIMEOUT_MS = 5000;
/** 終了時に sidecar の停止を待つ上限 */
export const EXIT_SIDECAR_TIMEOUT_MS = 2000;
// Rust 側のフェイルセーフ（src-tauri/src/lib.rs の CLOSE_FAILSAFE_SECS）は、この 2 つの合計より
// 長くしておくこと。短いと書き出しの途中で強制終了される

function within(work: Promise<unknown>, ms: number): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    const timer = setTimeout(() => resolve(false), ms);
    work.then(
      () => {
        clearTimeout(timer);
        resolve(true);
      },
      () => {
        clearTimeout(timer);
        resolve(false);
      },
    );
  });
}

/**
 * 開いているすべてのエディタの未保存を書き出し、終わるか上限に達するまで待つ。
 * 上限までに終わった（待つものが無かった場合も）なら true
 */
export async function flushEditorsBeforeExit(timeoutMs = EXIT_FLUSH_TIMEOUT_MS): Promise<boolean> {
  let saves: Promise<void> | null;
  try {
    saves = flushAllEditorSaves();
  } catch (e) {
    console.error("[exit] 未保存の書き出しを始められませんでした", e);
    return false;
  }
  if (!saves) return true;
  const done = await within(saves, timeoutMs);
  if (!done) console.warn("[exit] 未保存の書き出しが上限までに終わりませんでした");
  return done;
}

export type CloseRequestDeps = {
  stopSidecar: () => Promise<unknown>;
  /** Rust へ「終了してよい」と返す */
  ack: () => Promise<unknown>;
  flushTimeoutMs?: number;
  sidecarTimeoutMs?: number;
};

/**
 * デスクトップの終了要求のハンドラを作る。順序は 書き出し → sidecar 停止 → ACK。
 * sidecar を先に止めると、保存先が sidecar 経由のときに書けなくなる。
 * 待っている間にもう一度閉じる操作が来ても、走っている 1 回に合流する（二重に書き出さない）
 */
export function createCloseRequestHandler(deps: CloseRequestDeps): () => Promise<void> {
  let running: Promise<void> | null = null;
  return () => {
    running ??= (async () => {
      try {
        await flushEditorsBeforeExit(deps.flushTimeoutMs ?? EXIT_FLUSH_TIMEOUT_MS);
        try {
          const stopped = await within(
            Promise.resolve().then(deps.stopSidecar),
            deps.sidecarTimeoutMs ?? EXIT_SIDECAR_TIMEOUT_MS,
          );
          if (!stopped) console.warn("[exit] sidecar の停止を待ち切れませんでした");
        } catch (e) {
          console.error("[exit] stopSidecar failed during shutdown", e);
        }
        try {
          await deps.ack();
        } catch (e) {
          console.error("[exit] shutdown_ack invoke failed", e);
        }
      } finally {
        // ACK が届かなかった場合に、次の閉じる操作でやり直せるように
        running = null;
      }
    })();
    return running;
  };
}

export type PageExitFlushOptions = {
  /**
   * 未保存が残っているときに、離れる前の確認（beforeunload）を出すか。
   * デスクトップは終了要求の経路で待てるので出さない
   */
  confirmWhenUnsaved: boolean;
};

/**
 * ページが隠れる・消えるときに書き出しを始める。戻り値で外す。
 * 書き終わりは待てない（上のコメント）。タブを切り替えただけでも書き出すが、3 秒後の自動保存が
 * 早まるだけで、書く内容と順序は変わらない
 */
export function installPageExitFlush(options: PageExitFlushOptions): () => void {
  const start = () => {
    try {
      void flushAllEditorSaves();
    } catch (e) {
      console.error("[exit] 未保存の書き出しを始められませんでした", e);
    }
  };
  const onPageHide = () => start();
  const onVisibilityChange = () => {
    if (document.visibilityState === "hidden") start();
  };
  const onBeforeUnload = (e: BeforeUnloadEvent) => {
    if (!hasUnsavedEditorWork()) return;
    // 確認が出ている間に書き終わるよう、先に始める
    start();
    e.preventDefault();
    // 古いブラウザは returnValue を見る（文言はブラウザが決める）
    e.returnValue = "";
  };
  window.addEventListener("pagehide", onPageHide);
  document.addEventListener("visibilitychange", onVisibilityChange);
  if (options.confirmWhenUnsaved) window.addEventListener("beforeunload", onBeforeUnload);
  return () => {
    window.removeEventListener("pagehide", onPageHide);
    document.removeEventListener("visibilitychange", onVisibilityChange);
    if (options.confirmWhenUnsaved) window.removeEventListener("beforeunload", onBeforeUnload);
  };
}
