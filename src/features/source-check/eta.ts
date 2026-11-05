// 照合の残り時間の目安（純関数）。
// 1 件あたりの所要は資料の長さと提供先で大きく変わるので、終えた件数が少ないうちは出さない。
// 「待つか止めるか」を決めるためのもので、精度は求めない（分単位・切り上げ）。

/** 目安を出し始める最小の完了件数（少ないと 1〜2 件の遅い資料に引きずられる） */
export const ETA_MIN_DONE = 3;

/**
 * 残りの目安（ミリ秒）。startedAt からの経過を終えた件数で割って残りに掛ける。
 * 完了が ETA_MIN_DONE 未満・総数 0・経過 0 のときは null（表示しない）
 */
export function estimateRemainingMs(startedAt: number, done: number, total: number, now: number = Date.now()): number | null {
  if (total <= 0 || done < ETA_MIN_DONE || done >= total) return null;
  const elapsed = now - startedAt;
  if (elapsed <= 0) return null;
  return Math.round((elapsed / done) * (total - done));
}

/** 表示用の分（切り上げ。1 分未満は 0） */
export function remainingMinutes(ms: number): number {
  return Math.ceil(ms / 60_000);
}
