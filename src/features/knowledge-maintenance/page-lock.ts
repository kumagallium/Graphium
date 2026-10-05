// ページ id ごとの非同期の排他（同じ wikiId は直列、別の wikiId は並行）

const tails = new Map<string, Promise<void>>();

/** 同じ wikiId の fn は順番に走る。fn が例外を投げても次へ進む */
export async function withPageLock<T>(wikiId: string, fn: () => Promise<T>): Promise<T> {
  const prev = tails.get(wikiId) ?? Promise.resolve();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const tail = prev.then(() => gate);
  tails.set(wikiId, tail);
  await prev;
  try {
    return await fn();
  } finally {
    release();
    if (tails.get(wikiId) === tail) tails.delete(wikiId);
  }
}
