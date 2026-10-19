// 「最大 limit 本まで同時に走らせて、結果は入力順で返す」だけの小さなヘルパー。
//
// PDF の全文翻訳（ページ単位の並列翻訳）と話題の段（1 つの窓が触る話題ごとの改訂）が
// 同じ形で使う。並列の上限は呼び出し側が決める（AI の提供元が同時に受けられる本数は
// 提供元ごとに違い、ローカルモデルは 1 本ずつしか処理しないので上限を上げても速くならない）。
//
// fn が投げた例外はそのまま呼び出し側へ伝わる（Promise.all と同じ）。1 件ごとに握りつぶして
// 続けたいなら fn の中で try/catch すること。

/** items を最大 limit 本まで同時に fn にかけ、結果を入力順で返す */
export async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  async function worker() {
    while (true) {
      const i = next++;
      if (i >= items.length) return;
      results[i] = await fn(items[i], i);
    }
  }
  const workers = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, () => worker());
  await Promise.all(workers);
  return results;
}
