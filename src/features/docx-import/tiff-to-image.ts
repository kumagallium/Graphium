// TIFF をブラウザで表示可能な PNG File に変換する。
// 研究文書では顕微鏡画像・スキャン図面などが TIFF で埋め込まれることがあるが、
// ブラウザの <img> は TIFF を表示できないため PNG に変換する。
// デコードは UTIF.js (utif2) に委ねる。マルチページ TIFF は先頭ページのみ。
// utif2 は TIFF に遭遇したときだけ dynamic import で遅延ロードする。

/** TIFF の MIME か */
export function isTiffMime(mime: string): boolean {
  const m = mime.toLowerCase();
  return m === "image/tiff" || m === "image/tif" || m === "image/x-tiff";
}

// utif2 は IFD の連鎖・タグ数・画像の大きさを信じて回るので、細工した TIFF（16 バイトで
// 自分自身を指す IFD など）でメインスレッドが固まる。呼ぶ前にここで構造を検査して弾く。
const MAX_IFDS = 4096; // サブ IFD を含む IFD の総数（utif2 の decode は IFD 数に線形）
const MAX_IFD_DEPTH = 4;
const MAX_PIXELS = 40_000_000; // 展開後 RGBA で約 160MB まで
const MAX_BITS_PER_PIXEL = 128;
const MAX_STRIP_VALUES = 1_000_000; // ストリップ・タイルの表を読む上限
const MAX_VALUE_BUDGET = 4_000_000; // ファイル全体で utif2 に配列へ積ませる値の総数の絶対上限
const MAX_ALLOC_BYTES = 256 * 1024 * 1024; // 展開後バッファの大きさの上限
const MAX_TILE_BYTES = 64 * 1024 * 1024; // タイル 1 枚のバッファの大きさの上限
const TIFF_TYPE_SIZE: Record<number, number> = {
  1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 6: 1, 7: 1, 8: 2, 9: 4, 10: 8, 11: 4, 12: 8, 13: 4,
};
// utif2 が IFD として辿るタグ（SubIFD / Exif / GPS / DNG private / Fuji）
const SUB_IFD_TAGS = new Set([330, 34665, 34853, 50740, 61440]);
// 寸法・形式のタグ（先頭の値を utif2 と同じ位置から読んで検査に使う）
const DIM_TAGS = new Set([256, 257, 258, 259, 277, 278, 322, 323]);
// 読める圧縮方式: 1 無圧縮 / 5 LZW / 7 JPEG / 8・32946 Deflate / 32773 PackBits（CCITT 2・3・4 などは通さない）
const ALLOWED_COMPRESSION = new Set([1, 5, 7, 8, 32946, 32773]);
const MAX_COMPRESSED_BYTES = 64 * 1024 * 1024; // 圧縮ストリップの合計の上限（展開爆弾の入口を絞る）
const DECODE_TIMEOUT_MS = 15_000; // デコードの打ち切り時間（Worker の起動とモジュール読み込みも含む）
// 整数として値を読める型（BYTE / SHORT / LONG / UNDEFINED / SSHORT / SLONG / IFD）
const INT_TYPES = new Set([1, 3, 4, 7, 8, 9, 13]);

/** TIFF の構造を検査する。循環・範囲外・巨大な寸法があれば false。 */
export function isSafeTiff(buf: ArrayBuffer): boolean {
  const len = buf.byteLength;
  if (len < 8) return false;
  const dv = new DataView(buf);
  const id = String.fromCharCode(dv.getUint8(0), dv.getUint8(1));
  if (id !== "II" && id !== "MM") return false;
  const le = id === "II";
  const u16 = (o: number) => dv.getUint16(o, le);
  const u32 = (o: number) => dv.getUint32(o, le);
  if (u16(2) !== 42) return false;

  /**
   * タグの値を utif2 と同じ置き場所・同じ型の読み方で取り出す（最大 max 個）。
   * 値が 4 バイトに収まるかの境目は型ごとに utif2 の判定（BYTE は 5 個未満・SHORT は 3 個未満・
   * LONG は 2 個未満）に合わせる。読めない型・範囲外は null。
   */
  const readValues = (e: number, type: number, num: number, max: number): number[] | null => {
    if (!INT_TYPES.has(type)) return null;
    const size = TIFF_TYPE_SIZE[type];
    const inlineLimit = type === 1 || type === 7 ? 5 : type === 3 || type === 8 ? 3 : 2;
    const base = num < inlineLimit ? e + 8 : u32(e + 8);
    const count = Math.min(num, max);
    if (base + count * size > len) return null;
    const out: number[] = [];
    for (let j = 0; j < count; j++) {
      const o = base + j * size;
      if (type === 1 || type === 7) out.push(dv.getUint8(o));
      else if (type === 3) out.push(u16(o));
      else if (type === 8) out.push(dv.getInt16(o, le));
      else if (type === 9) out.push(dv.getInt32(o, le));
      else out.push(u32(o));
    }
    return out;
  };

  const visited = new Set<number>();
  // タグの値の置き場が重なっていても、読まされる値の総数はファイル長に比例する範囲に収める
  // （正常な TIFF では値が互いに重ならないので総数はファイル長を超えない）
  let budget = Math.min(len * 2 + 1024, MAX_VALUE_BUDGET);

  // 1 つの IFD を検査する。次の IFD のオフセット（無ければ 0）を返す。不正なら -1。
  const walk = (offset: number, depth: number, isFirst: boolean): number => {
    if (depth > MAX_IFD_DEPTH) return -1;
    if (offset < 8 || offset + 2 > len) return -1;
    if (visited.has(offset) || visited.size >= MAX_IFDS) return -1;
    visited.add(offset);
    const cnt = u16(offset);
    if (offset + 2 + cnt * 12 + 4 > len) return -1;
    const tags = new Map<number, { num: number; value: number }>();
    // ストリップ・タイルの表（先頭ページの検査用）
    let stripCountsEntry = -1;
    let tileCountsEntry = -1;
    let stripOffsetsEntry = -1;
    let tileOffsetsEntry = -1;
    for (let i = 0; i < cnt; i++) {
      const e = offset + 2 + i * 12;
      const tag = u16(e);
      const type = u16(e + 2);
      const num = u32(e + 4);
      budget -= 1 + Math.min(num, len);
      if (budget < 0) return -1;
      const size = (TIFF_TYPE_SIZE[type] ?? 1) * num;
      // 1・7・2 は utif2 が範囲に切り詰めるので除外。ほかは値の置き場が収まるか確かめる
      if (type !== 1 && type !== 7 && type !== 2 && size > 4) {
        if (u32(e + 8) + size > len) return -1;
      }
      if (tag === 279) stripCountsEntry = e;
      else if (tag === 325) tileCountsEntry = e;
      else if (tag === 273) stripOffsetsEntry = e;
      else if (tag === 324) tileOffsetsEntry = e;
      if (DIM_TAGS.has(tag)) {
        // 型を問わず utif2 が数値として読む位置と揃える。読めない型・負の値は弾く
        const v = readValues(e, type, num, 1);
        if (!v || v.length === 0 || v[0] < 0) return -1;
        tags.set(tag, { num, value: v[0] });
      } else {
        tags.set(tag, { num, value: 0 });
      }
      if (SUB_IFD_TAGS.has(tag)) {
        // 指す先の IFD も検査する。utif2 は型に関わらず値をオフセットとして辿る
        const ptrs: number[] = [];
        if (tag === 50740) {
          // DNG private: BYTE 列の先頭 4 バイトが指す先が IFD らしいときだけ辿られる
          if (type !== 1 && type !== 7) return -1;
          if (num >= 4) {
            const base = num < 5 ? e + 8 : u32(e + 8);
            if (base + 4 > len) return -1;
            const p = u32(base);
            if (p + 2 <= len && u16(p) < 300) ptrs.push(p);
          }
        } else {
          if (num > MAX_IFDS) return -1;
          const vals = readValues(e, type, num, MAX_IFDS);
          if (!vals) return -1;
          for (const p of vals) {
            if (p < 0) return -1;
            ptrs.push(p);
          }
        }
        // サブ IFD の連鎖は utif2 が辿らないので、各ポインタ先の 1 つだけ検査する
        for (const p of ptrs) if (walk(p, depth + 1, false) < 0) return -1;
      }
    }
    if (isFirst) {
      // utif2 が実際にデコードする先頭ページの寸法・タイル数を検査する
      const w = tags.get(256)?.value ?? 0;
      const h = tags.get(257)?.value ?? 0;
      if (w * h > MAX_PIXELS) return -1;
      const spp = tags.get(277)?.value || 1;
      const bps = tags.get(258)?.value || 1;
      if (bps * spp > MAX_BITS_PER_PIXEL) return -1;
      // utif2 は 1 画素のビット数を BitsPerSample の先頭値×個数でも数えるので、大きいほうで確保量を見積もる
      const bipp = Math.max(bps * spp, Math.min(32, bps) * (tags.get(258)?.num ?? 1));
      if (w * Math.ceil(bipp / 8) * h > MAX_ALLOC_BYTES) return -1;
      const tiled = tags.has(322);
      if (tiled) {
        const tw = tags.get(322)?.value ?? 0;
        const th = tags.get(323)?.value ?? 0;
        if (tw <= 0 || th <= 0) return -1;
        const tiles = Math.ceil(w / tw) * Math.ceil(h / th);
        if (tiles > (tags.get(324)?.num ?? 0)) return -1;
        // タイル 1 枚ぶんのバッファは画素数の上限と無関係に確保されるので別に抑える
        if ((tw * th * bipp) / 8 > MAX_TILE_BYTES) return -1;
      } else {
        // ストリップ 1 本ごとに幅×行数の処理が走る（空のストリップでも）ので、
        // 個数は ceil(高さ / RowsPerStrip) を超えられない
        const rps = Math.max(1, Math.min(tags.get(278)?.value || h, h));
        const maxStrips = h > 0 ? Math.ceil(h / rps) : 1;
        if ((tags.get(273)?.num ?? 0) > maxStrips) return -1;
        if ((tags.get(279)?.num ?? 0) > maxStrips) return -1;
      }
      // 圧縮方式は読めるものだけ通す（CCITT などは細工で固まりやすい）。無指定は無圧縮
      const comp = tags.get(259)?.value ?? 1;
      if (!ALLOWED_COMPRESSION.has(comp)) return -1;
      // ストリップ・タイルのオフセットとバイト数の各組がファイル内に収まること。
      // バイト数の合計がファイルより大きいものは、無圧縮のコピーで数十億回まわるので弾く
      const countsEntry = tiled ? tileCountsEntry : stripCountsEntry;
      const offsetsEntry = tiled ? tileOffsetsEntry : stripOffsetsEntry;
      // 無圧縮・単一ストリップなら StripByteCounts(279) の欠落を許す（古い書き出しにある）。
      // その場合は「1 行のバイト数 ceil(幅×1 画素のビット数/8) × 高さ」がオフセットからファイル内に収まることだけ確かめる
      // （1 ビット画像を 1 画素 1 バイトとは数えない）
      if (!tiled && countsEntry < 0 && offsetsEntry >= 0) {
        if (comp !== 1 || u32(offsetsEntry + 4) !== 1) return -1;
        const offs = readValues(offsetsEntry, u16(offsetsEntry + 2), 1, 1);
        if (!offs || offs.length !== 1 || offs[0] < 0) return -1;
        if (offs[0] + Math.ceil((w * bipp) / 8) * h > len) return -1;
      } else if (countsEntry >= 0 || offsetsEntry >= 0) {
        if (countsEntry < 0 || offsetsEntry < 0) return -1;
        const readAll = (en: number): number[] | null => {
          const n = u32(en + 4);
          if (n > MAX_STRIP_VALUES) return null;
          return readValues(en, u16(en + 2), n, MAX_STRIP_VALUES);
        };
        const counts = readAll(countsEntry);
        const offs = readAll(offsetsEntry);
        if (!counts || !offs || counts.length !== offs.length) return -1;
        let sum = 0;
        for (let k = 0; k < counts.length; k++) {
          if (counts[k] < 0 || offs[k] < 0 || offs[k] + counts[k] > len) return -1;
          sum += counts[k];
        }
        if (sum > len) return -1;
        if (comp !== 1 && sum > MAX_COMPRESSED_BYTES) return -1;
      }
    }
    return u32(offset + 2 + cnt * 12);
  };

  let next = u32(4);
  let first = true;
  while (next !== 0) {
    const n = walk(next, 0, first);
    if (n < 0) return false;
    first = false;
    next = n;
  }
  return true;
}

/** デコード結果（RGBA 8bit） */
export interface TiffDecoded {
  rgba: Uint8Array | Uint8ClampedArray;
  width: number;
  height: number;
}

/** デコード関数。abort されたら結果は捨てられる。 */
export type TiffDecoder = (buf: ArrayBuffer, signal: AbortSignal) => Promise<TiffDecoded | null>;

/** Web Worker でデコードする本番用の関数。abort（時間切れ）で Worker を terminate する。 */
export const workerTiffDecoder: TiffDecoder = (buf, signal) =>
  new Promise((resolve) => {
    if (typeof Worker === "undefined") {
      resolve(null);
      return;
    }
    const worker = new Worker(new URL("./tiff-decode.worker.ts", import.meta.url), { type: "module" });
    const onAbort = () => done(null);
    const done = (v: TiffDecoded | null) => {
      signal.removeEventListener("abort", onAbort);
      worker.terminate();
      resolve(v);
    };
    signal.addEventListener("abort", onAbort);
    worker.onmessage = (ev: MessageEvent<TiffDecoded | null>) => done(ev.data);
    worker.onerror = () => done(null);
    // 元のバッファは呼び出し側で使わないのでコピーせず渡す
    worker.postMessage(buf, [buf]);
  });

/**
 * TIFF を PNG File に変換する。デコード不能・時間切れなら null。ブラウザ専用（canvas 使用）。
 * decoder / timeoutMs はテスト用の差し替え口。本番は必ず Worker を通る。
 */
export async function convertTiffToImageFile(
  buf: ArrayBuffer,
  baseName: string,
  decoder: TiffDecoder = workerTiffDecoder,
  timeoutMs: number = DECODE_TIMEOUT_MS,
): Promise<File | null> {
  try {
    if (!isSafeTiff(buf)) {
      console.warn("[tiff-to-image] 構造が不正または大きすぎる TIFF のため読み込みません");
      return null;
    }
    const ac = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<null>((resolve) => {
      timer = setTimeout(() => {
        ac.abort();
        resolve(null);
      }, timeoutMs);
    });
    let decoded: TiffDecoded | null;
    try {
      decoded = await Promise.race([decoder(buf, ac.signal), timeout]);
    } finally {
      clearTimeout(timer);
    }
    if (!decoded) {
      console.warn("[tiff-to-image] TIFF をデコードできませんでした（時間切れを含む）");
      return null;
    }
    const { rgba, width, height } = decoded;
    if (!rgba || width <= 0 || height <= 0) return null;

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    const imageData = ctx.createImageData(width, height);
    imageData.data.set(rgba);
    ctx.putImageData(imageData, 0, 0);

    const png = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
    if (!png) return null;
    return new File([png], `${baseName}.png`, { type: "image/png" });
  } catch (err) {
    console.warn("[tiff-to-image] TIFF 変換失敗:", err);
    return null;
  }
}
