// キーごとの非同期の直列化（同じキーは順番に、別のキーは並行に走る）。
//
// 同じノートへの書き込みが重なると、読み込み → 保存の間に別の書き込みが割り込み、
// 後から終わった方（＝先に頼んだ方であることもある）が勝つ。たとえば一覧で
// 「フォルダ A に追加 → すぐ取り消し」を押すと、取り消しの保存が先に終わり、
// 追加の保存が後から上書きしてノートが A に入ったままになる。
// 頼んだ順に 1 つずつ通せば、最後に頼んだ内容が必ず残る。

export type KeyedSerial = <T>(key: string, fn: () => Promise<T>) => Promise<T>;

/** fn が例外を投げても、同じキーの次の fn は走る */
export function createKeyedSerial(): KeyedSerial {
  const tails = new Map<string, Promise<void>>();
  return async <T>(key: string, fn: () => Promise<T>): Promise<T> => {
    const prev = tails.get(key) ?? Promise.resolve();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const tail = prev.then(() => gate);
    tails.set(key, tail);
    await prev;
    try {
      return await fn();
    } finally {
      release();
      if (tails.get(key) === tail) tails.delete(key);
    }
  };
}
