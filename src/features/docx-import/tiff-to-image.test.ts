import { describe, expect, it } from "vitest";
import { convertTiffToImageFile, isSafeTiff } from "./tiff-to-image";
import { decodeTiffSync } from "./tiff-decode";

/** 単一 IFD の最小 TIFF（LE）。entries は [tag, type, num, value] */
function tiff(entries: [number, number, number, number][], next = 0): ArrayBuffer {
  const b = new ArrayBuffer(8 + 2 + entries.length * 12 + 4);
  const dv = new DataView(b);
  dv.setUint8(0, 0x49);
  dv.setUint8(1, 0x49);
  dv.setUint16(2, 42, true);
  dv.setUint32(4, 8, true);
  dv.setUint16(8, entries.length, true);
  entries.forEach(([tag, type, num, value], i) => {
    const o = 10 + i * 12;
    dv.setUint16(o, tag, true);
    dv.setUint16(o + 2, type, true);
    dv.setUint32(o + 4, num, true);
    dv.setUint32(o + 8, value, true);
  });
  dv.setUint32(10 + entries.length * 12, next, true);
  return b;
}

describe("isSafeTiff", () => {
  it("自分自身を指す IFD（16 バイト）を弾く", () => {
    const b = tiff([], 8);
    expect(b.byteLength).toBeLessThan(32);
    expect(isSafeTiff(b)).toBe(false);
  });

  it("2 つの IFD が互いを指す循環を弾く", () => {
    const b = new ArrayBuffer(8 + 6 + 6);
    const dv = new DataView(b);
    dv.setUint16(0, 0x4949, true);
    dv.setUint16(2, 42, true);
    dv.setUint32(4, 8, true);
    dv.setUint32(10, 14, true); // 1 つ目の next
    dv.setUint32(16, 8, true); // 2 つ目の next
    expect(isSafeTiff(b)).toBe(false);
  });

  it("範囲外の IFD オフセットを弾く", () => {
    const b = tiff([]);
    new DataView(b).setUint32(4, 100000, true);
    expect(isSafeTiff(b)).toBe(false);
  });

  it("巨大なタグ数（40 億）を弾く", () => {
    expect(isSafeTiff(tiff([[273, 4, 0xffffffff, 100]]))).toBe(false);
  });

  it("巨大な幅×高さを弾く", () => {
    expect(isSafeTiff(tiff([[256, 4, 1, 100000], [257, 4, 1, 100000]]))).toBe(false);
  });

  it("タイル数が巨大なものを弾く", () => {
    expect(
      isSafeTiff(tiff([[256, 4, 1, 30000], [257, 4, 1, 1000], [322, 4, 1, 1], [323, 4, 1, 1]])),
    ).toBe(false);
  });

  it("まともな小さい TIFF は通す", () => {
    expect(isSafeTiff(tiff([[256, 3, 1, 10], [257, 3, 1, 10]]))).toBe(true);
  });

  it("変換は固まらず null を返す", async () => {
    const t = Date.now();
    expect(await convertTiffToImageFile(tiff([], 8), "x")).toBeNull();
    expect(Date.now() - t).toBeLessThan(1000);
  });
});

const TYPE_SIZE: Record<number, number> = { 1: 1, 3: 2, 4: 4, 8: 2, 9: 4 };

/** 値を外出しできる TIFF を組む（LE / BE 切り替え）。entries は [tag, type, values] */
function buildTiff(
  entries: [number, number, number[]][],
  le: boolean,
  opts: { extraBytes?: number } = {},
): ArrayBuffer {
  const ifdLen = 2 + entries.length * 12 + 4;
  let extLen = 0;
  for (const [, t, v] of entries) {
    const sz = TYPE_SIZE[t] * v.length;
    if (sz > 4) extLen += sz + (sz % 2);
  }
  const b = new ArrayBuffer(8 + ifdLen + extLen + (opts.extraBytes ?? 0));
  const dv = new DataView(b);
  dv.setUint8(0, le ? 0x49 : 0x4d);
  dv.setUint8(1, le ? 0x49 : 0x4d);
  dv.setUint16(2, 42, le);
  dv.setUint32(4, 8, le);
  dv.setUint16(8, entries.length, le);
  let ext = 8 + ifdLen;
  const put = (o: number, t: number, x: number) => {
    if (t === 1) dv.setUint8(o, x);
    else if (t === 3) dv.setUint16(o, x, le);
    else if (t === 8) dv.setInt16(o, x, le);
    else if (t === 9) dv.setInt32(o, x, le);
    else dv.setUint32(o, x, le);
  };
  entries.forEach(([tag, t, v], i) => {
    const o = 10 + i * 12;
    dv.setUint16(o, tag, le);
    dv.setUint16(o + 2, t, le);
    dv.setUint32(o + 4, v.length, le);
    const sz = TYPE_SIZE[t] * v.length;
    let at = o + 8;
    if (sz > 4) {
      dv.setUint32(o + 8, ext, le);
      at = ext;
      ext += sz + (sz % 2);
    }
    v.forEach((x, j) => put(at + j * TYPE_SIZE[t], t, x));
  });
  return b;
}

describe("isSafeTiff 正常な TIFF は通す", () => {
  for (const le of [true, false]) {
    const name = le ? "LE" : "BE";
    it(`RGB 8,8,8 を外出しした ${name} の TIFF`, () => {
      const b = buildTiff(
        [[256, 3, [64]], [257, 3, [64]], [258, 3, [8, 8, 8]], [277, 3, [3]]],
        le,
      );
      expect(isSafeTiff(b)).toBe(true);
    });
    it(`16bit グレーの ${name} の TIFF`, () => {
      expect(isSafeTiff(buildTiff([[256, 4, [64]], [257, 4, [64]], [258, 3, [16]]], le))).toBe(true);
    });
    it(`ストリップ型の ${name} の TIFF`, () => {
      const b = buildTiff(
        [[256, 3, [8]], [257, 3, [8]], [273, 4, [100]], [278, 3, [8]], [279, 4, [32]]],
        le,
        { extraBytes: 64 },
      );
      expect(isSafeTiff(b)).toBe(true);
    });
    it(`タイル型の ${name} の TIFF`, () => {
      const b = buildTiff(
        [[256, 3, [32]], [257, 3, [32]], [322, 3, [16]], [323, 3, [16]],
         [324, 4, [100, 100, 100, 100]], [325, 4, [16, 16, 16, 16]]],
        le,
        { extraBytes: 64 },
      );
      expect(isSafeTiff(b)).toBe(true);
    });
  }
});

describe("isSafeTiff 型を変えた細工", () => {
  it("幅・高さを SLONG(9) で宣言した巨大寸法を弾く", () => {
    expect(isSafeTiff(buildTiff([[256, 9, [30000]], [257, 9, [30000]]], true))).toBe(false);
  });

  it("幅を SHORT 4 値で外出しして上位をずらした巨大寸法を弾く", () => {
    // 外出し先の先頭値（utif2 が読む幅）が 60000
    const b = buildTiff([[256, 3, [60000, 1, 1, 1]], [257, 3, [60000, 1, 1, 1]]], true);
    expect(isSafeTiff(b)).toBe(false);
  });

  it("SHORT 型の SubIFD ポインタを大量に並べた分岐（数 KB）を弾く", () => {
    // 各 IFD が 30 個の tag 330(SHORT) で次の IFD を指す。型を見ない utif2 では指数時間
    const n = 30;
    const depth = 10;
    const ifdLen = 2 + n * 12 + 4;
    const b = new ArrayBuffer(8 + ifdLen * depth);
    const dv = new DataView(b);
    dv.setUint16(0, 0x4949, true);
    dv.setUint16(2, 42, true);
    dv.setUint32(4, 8, true);
    for (let d = 0; d < depth; d++) {
      const base = 8 + d * ifdLen;
      dv.setUint16(base, n, true);
      for (let i = 0; i < n; i++) {
        const o = base + 2 + i * 12;
        dv.setUint16(o, 330, true);
        dv.setUint16(o + 2, 3, true);
        dv.setUint32(o + 4, 1, true);
        dv.setUint16(o + 8, base + ifdLen, true);
      }
    }
    expect(b.byteLength).toBeLessThan(5000);
    const t = Date.now();
    expect(isSafeTiff(b)).toBe(false);
    expect(Date.now() - t).toBeLessThan(1000);
  });

  it("ストリップのバイト数が巨大なものを弾く", () => {
    const b = buildTiff(
      [[256, 3, [8]], [257, 3, [8]], [273, 4, [100, 200]], [279, 4, [0xfffffff0, 1]]],
      true,
    );
    expect(isSafeTiff(b)).toBe(false);
  });
});

describe("isSafeTiff 多ページ", () => {
  it("IFD が 300 ページ続く TIFF（先頭ページが使える）は通す", () => {
    const pages = 300;
    const ifdLen = 2 + 12 + 4;
    const b = new ArrayBuffer(8 + ifdLen * pages);
    const dv = new DataView(b);
    dv.setUint16(0, 0x4949, true);
    dv.setUint16(2, 42, true);
    dv.setUint32(4, 8, true);
    for (let p = 0; p < pages; p++) {
      const base = 8 + p * ifdLen;
      dv.setUint16(base, 1, true);
      dv.setUint16(base + 2, 256, true);
      dv.setUint16(base + 4, 3, true);
      dv.setUint32(base + 6, 1, true);
      dv.setUint16(base + 10, 8, true);
      dv.setUint32(base + 14, p === pages - 1 ? 0 : base + ifdLen, true);
    }
    expect(isSafeTiff(b)).toBe(true);
  });
});

describe("isSafeTiff 値の重なり・ストリップ数・タイルの大きさ", () => {
  it("全タグが同じ領域を指す増幅（約 80KB）を短い時間で弾く", () => {
    const L = 80_000;
    const b = new ArrayBuffer(L);
    const dv = new DataView(b);
    dv.setUint16(0, 0x4949, true);
    dv.setUint16(2, 42, true);
    dv.setUint32(4, 8, true);
    const cnt = Math.floor((L - 14) / 12);
    dv.setUint16(8, cnt, true);
    for (let i = 0; i < cnt; i++) {
      const o = 10 + i * 12;
      dv.setUint16(o, 1000 + i, true);
      dv.setUint16(o + 2, 3, true);
      dv.setUint32(o + 4, (L - 8) / 2, true);
      dv.setUint32(o + 8, 8, true);
    }
    const t = Date.now();
    expect(isSafeTiff(b)).toBe(false);
    expect(Date.now() - t).toBeLessThan(1000);
  });

  it("空のストリップを大量に並べた TIFF を弾く", () => {
    const n = 1000;
    const b = buildTiff(
      [[256, 4, [1000]], [257, 4, [1000]], [258, 3, [16]], [273, 4, new Array(n).fill(0)],
       [278, 4, [1000]], [279, 4, new Array(n).fill(0)]],
      false,
    );
    expect(isSafeTiff(b)).toBe(false);
  });

  it("巨大なタイル（約 140 バイト）を弾く", () => {
    const b = buildTiff(
      [[256, 3, [1]], [257, 3, [1]], [258, 3, [8]], [322, 3, [30000]], [323, 3, [30000]],
       [324, 4, [100]], [325, 4, [1]]],
      true,
    );
    expect(b.byteLength).toBeLessThan(300);
    expect(isSafeTiff(b)).toBe(false);
  });

  it("展開後が巨大になる高ビット深度（約 100 バイト）を弾く", () => {
    const b = buildTiff(
      [[256, 3, [6300]], [257, 3, [6300]], [258, 3, [16]], [277, 3, [8]]],
      true,
    );
    expect(isSafeTiff(b)).toBe(false);
  });
});

describe("isSafeTiff 279 が無い無圧縮・単一ストリップの収まり", () => {
  // 画像データの開始位置は ヘッダ 8 + IFD（2 + 5 タグ × 12 + 4）= 74
  const oneBit = (w: number, h: number, extra: number) =>
    buildTiff(
      [[256, 3, [w]], [257, 3, [h]], [258, 3, [1]], [259, 3, [1]], [273, 4, [74]]],
      true,
      { extraBytes: extra },
    );
  it("1 ビット画像は 1 行 ceil(幅/8) バイトで見積もり、ちょうど収まれば通す", () => {
    // 80 画素 × 10 行 = 10 バイト × 10 行 = 100 バイト
    expect(isSafeTiff(oneBit(80, 10, 100))).toBe(true);
  });
  it("1 ビット画像でも 1 バイト足りなければ弾く", () => {
    expect(isSafeTiff(oneBit(80, 10, 99))).toBe(false);
  });
  it("幅が 8 の倍数でないときは行ごとに切り上げる（9 画素 × 3 行 = 6 バイト）", () => {
    expect(isSafeTiff(oneBit(9, 3, 6))).toBe(true);
    expect(isSafeTiff(oneBit(9, 3, 5))).toBe(false);
  });
});

describe("isSafeTiff 圧縮方式とストリップの範囲", () => {
  const strip = (comp: number, off: number, cnt: number) =>
    buildTiff(
      [[256, 3, [8]], [257, 3, [8]], [259, 3, [comp]], [273, 4, [off]], [278, 3, [8]], [279, 4, [cnt]]],
      true,
      { extraBytes: 64 },
    );
  it("CCITT G2・G3・G4（2・3・4）を弾く", () => {
    for (const c of [2, 3, 4]) expect(isSafeTiff(strip(c, 100, 16))).toBe(false);
  });
  it("未知の圧縮方式を弾く", () => {
    expect(isSafeTiff(strip(99, 100, 16))).toBe(false);
  });
  it("無圧縮・LZW・JPEG・Deflate・PackBits は通す", () => {
    for (const c of [1, 5, 7, 8, 32946, 32773]) expect(isSafeTiff(strip(c, 100, 16))).toBe(true);
  });
  it("ストリップのオフセットがファイル外なら弾く", () => {
    expect(isSafeTiff(strip(5, 100000, 16))).toBe(false);
  });
  it("オフセット+バイト数がファイル末尾を超えるなら弾く", () => {
    const b = strip(5, 100, 16);
    expect(isSafeTiff(strip(5, b.byteLength - 8, 16))).toBe(false);
  });
});

describe("正当な TIFF の変換", () => {
  it("無圧縮の小さな TIFF を同期デコーダで読める", () => {
    // 2x1 グレー 8bit
    const b = buildTiff(
      [[256, 3, [2]], [257, 3, [1]], [258, 3, [8]], [259, 3, [1]], [262, 3, [1]],
       [273, 4, [150]], [277, 3, [1]], [278, 3, [1]], [279, 4, [2]]],
      true,
      { extraBytes: 64 },
    );
    const dv = new DataView(b);
    dv.setUint8(150, 0);
    dv.setUint8(151, 255);
    expect(isSafeTiff(b)).toBe(true);
    const out = decodeTiffSync(b);
    expect(out?.width).toBe(2);
    expect(out?.height).toBe(1);
  });
});

describe("変換の時間切れ", () => {
  it("デコーダが返らなければ時間切れで null を返す", async () => {
    const b = buildTiff([[256, 3, [8]], [257, 3, [8]]], true);
    let aborted = false;
    const never = (_b: ArrayBuffer, signal: AbortSignal) => {
      signal.addEventListener("abort", () => (aborted = true));
      return new Promise<never>(() => {});
    };
    const t = Date.now();
    expect(await convertTiffToImageFile(b, "x", never, 50)).toBeNull();
    expect(Date.now() - t).toBeLessThan(1000);
    expect(aborted).toBe(true);
  });
});

describe("isSafeTiff StripByteCounts(279) の欠落", () => {
  // 8x8・8bit グレー = 64 バイト。ファイルは 64 バイト以上ある
  const noCounts = (extra: [number, number, number[]][], off = 8) =>
    buildTiff(
      [[256, 3, [8]], [257, 3, [8]], [258, 3, [8]], [273, 4, [off]], ...extra],
      true,
      { extraBytes: 64 },
    );
  it("無圧縮・単一ストリップなら 279 が無くても通す", () => {
    expect(isSafeTiff(noCounts([]))).toBe(true);
    expect(isSafeTiff(noCounts([[259, 3, [1]]]))).toBe(true);
  });
  it("画素のバイト数がファイル内に収まらないなら弾く", () => {
    expect(isSafeTiff(noCounts([], 100000))).toBe(false);
    const b = noCounts([]);
    expect(isSafeTiff(noCounts([], b.byteLength - 8))).toBe(false);
  });
  it("圧縮ありで 279 が無いものは弾く", () => {
    expect(isSafeTiff(noCounts([[259, 3, [5]]]))).toBe(false);
  });
  it("複数ストリップで 279 が無いものは弾く", () => {
    const b = buildTiff(
      [[256, 3, [8]], [257, 3, [8]], [258, 3, [8]], [273, 4, [8, 8]], [278, 3, [4]]],
      true,
      { extraBytes: 64 },
    );
    expect(isSafeTiff(b)).toBe(false);
  });
});
