// 大きな区切りテキストを扱うためのしきい値と、処理を小分けにする譲り方
//
// 155 MB・23 万行の CSV を取り込むと、推定・変換・列の読み取りがどれも画面を描く
// スレッドで同期に走り、数秒〜十数秒アプリが固まった。ここに置くのは、
// 「どこまでを同期で処理してよいか」の線引きと、その先を小分けにするための道具。

/** 推定（区切り・見出し行）に使う先頭の行数。全行で 4 候補を試すと 11 秒かかった */
export const DETECT_SAMPLE_LINES = 5_000;

/** 標本の先までデータが続くとき、終了行を探すために末尾から戻って見る最大行数 */
export const DETECT_TAIL_SCAN_LINES = 1_000;

/** 取り込み画面が全行を同期で変換する上限（データ行数）。これを超えたら標本だけ変換する */
export const SYNC_PARSE_MAX_ROWS = 20_000;

/** SYNC_PARSE_MAX_ROWS を超えたときに、プレビュー用に変換する行数 */
export const PREVIEW_SAMPLE_ROWS = 2_000;

/** データ表ブロックが同期で変換する本文の上限（文字数）。超えたら小分けにして非同期で変換する */
export const SYNC_PARSE_MAX_CHARS = 2_000_000;

/**
 * 描画・入力に順番を譲る。長い処理を小分けにするときに挟む。
 *
 * 優先順は MessageChannel → setTimeout(0)。
 * - setTimeout を第一にしないのは、非表示のタブ（バックグラウンド）ではブラウザが
 *   タイマーを 1 秒に 1 回程度へ絞るため。小分けのたびに 1 秒待たされ、変換が
 *   事実上終わらなくなる。MessageChannel はこの絞りを受けない。
 * - scheduler.yield は使わない。続きが他のタスクより優先して再開されるので、
 *   Chromium で実測すると変換の間じゅう描画フレームが 1 枚も出なかった
 *   （23 万行で約 1.6 秒。小分けにした意味が無くなる）。
 */
export function yieldToEventLoop(): Promise<void> {
  if (typeof MessageChannel !== "undefined") {
    return new Promise<void>((resolve) => {
      const channel = new MessageChannel();
      channel.port1.onmessage = () => {
        channel.port1.close();
        resolve();
      };
      channel.port2.postMessage(null);
    });
  }
  return new Promise<void>((resolve) => setTimeout(resolve, 0));
}
