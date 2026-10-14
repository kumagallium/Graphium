/**
 * 配列の各要素に非同期処理を掛け、同時に走る数を limit までに抑える。
 * 結果の並びは入力どおり（Promise.allSettled と同じ形で返す）。
 *
 * Web 版で数千の wiki ファイルを一斉に fetch すると、ブラウザが
 * ERR_INSUFFICIENT_RESOURCES で読み込みを落とし、索引からエントリが
 * 静かに欠ける。起動時の全件読み込みはこれを通す。
 */
export async function allSettledWithLimit<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<PromiseSettledResult<R>[]> {
  const results: PromiseSettledResult<R>[] = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      try {
        results[i] = { status: "fulfilled", value: await fn(items[i], i) };
      } catch (reason) {
        results[i] = { status: "rejected", reason };
      }
    }
  };
  const workers = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, worker);
  await Promise.all(workers);
  return results;
}

/** 起動時の一斉読み込みに使う同時数。fetch の同時接続数（6 前後）より少し多めにして待ちを詰める */
export const FILE_LOAD_CONCURRENCY = 16;
