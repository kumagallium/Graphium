// 会話の中の画面は、ホストの隔離された iframe で開かれる。隔離のされ方によっては localStorage に
// 触れただけで SecurityError になる（本体のコードは言語や表示の設定を localStorage から読む）。
// そのときは、この画面の中だけで使うメモリの保存に差し替える。本体のコードより先に読み込むこと。

function usable(): boolean {
  try {
    const s = window.localStorage;
    const key = "__graphium_probe__";
    s.setItem(key, "1");
    s.removeItem(key);
    return true;
  } catch {
    return false;
  }
}

if (!usable()) {
  const mem = new Map<string, string>();
  const storage: Storage = {
    get length() {
      return mem.size;
    },
    clear: () => mem.clear(),
    getItem: (k) => (mem.has(k) ? mem.get(k)! : null),
    key: (i) => [...mem.keys()][i] ?? null,
    removeItem: (k) => void mem.delete(k),
    setItem: (k, v) => void mem.set(k, String(v)),
  };
  try {
    Object.defineProperty(window, "localStorage", { value: storage, configurable: true });
  } catch {
    // 差し替えられなければ、そのまま（本体のコードは読めないときの既定に倒れる）
  }
}

export {};
