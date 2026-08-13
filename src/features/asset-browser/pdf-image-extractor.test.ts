// embeddedImageToFile のユニットテスト。
// extractEmbeddedPdfImages 本体は pdfjs / canvas に依存するためここでは扱わない。

import { describe, it, expect } from "vitest";
import {
  displayAreaFromMatrix,
  embeddedImageToFile,
  getImageObject,
  imageOrientationFromMatrix,
  isEffectivelySolidColor,
  type ExtractedEmbeddedImage,
} from "./pdf-image-extractor";

function makeImage(pageNumber: number, imageIndex: number): ExtractedEmbeddedImage {
  return {
    pageNumber,
    imageIndex,
    blob: new Blob([new Uint8Array([0])], { type: "image/png" }),
    width: 100,
    height: 200,
  };
}

describe("embeddedImageToFile", () => {
  it(".pdf 拡張子を除いてページ番号と画像番号付きの PNG ファイル名を作る", () => {
    const file = embeddedImageToFile(makeImage(3, 2), "paper.pdf");
    expect(file.name).toBe("paper - p3 image 2.png");
    expect(file.type).toBe("image/png");
  });

  it("大文字拡張子 .PDF も除去する", () => {
    const file = embeddedImageToFile(makeImage(1, 1), "REPORT.PDF");
    expect(file.name).toBe("REPORT - p1 image 1.png");
  });

  it(".pdf 以外の拡張子はそのまま残す（誤削除を防ぐ）", () => {
    const file = embeddedImageToFile(makeImage(7, 4), "notes.pdf.bak");
    expect(file.name).toBe("notes.pdf.bak - p7 image 4.png");
  });
});

// 向き補正の符号をここで固定する。値は実 PDF 2 種から実測した CTM。
// この回帰テストが「今まで正しく出ていた画像を壊していないこと」を恒久的に守る。
// 符号を取り違えると、正常画像と反転画像のちょうど逆を補正してしまうため、
// 両ケースを必ず併記する。
describe("imageOrientationFromMatrix", () => {
  it("標準形（d>0, 軸並行）は no-op — 正立画像は不変", () => {
    // PSSb（正しい向き）で実測した CTM の代表値
    expect(imageOrientationFromMatrix([192.2, 0, 0, 148.4, 0, 0])).toEqual({
      flipX: false,
      flipY: false,
    });
    expect(imageOrientationFromMatrix([444.9, 0, 0, 487.7, 0, 0])).toEqual({
      flipX: false,
      flipY: false,
    });
  });

  it("d<0（軸並行）は縦反転で補正 — 反転画像だけ戻す", () => {
    // 79_JA201502（反転）で実測した CTM の代表値
    expect(imageOrientationFromMatrix([199.0, 0, 0, -253.0, 0, 0])).toEqual({
      flipX: false,
      flipY: true,
    });
    expect(imageOrientationFromMatrix([312.0, 0, 0, -120.0, 0, 0])).toEqual({
      flipX: false,
      flipY: true,
    });
  });

  it("a<0 は横反転で補正する", () => {
    expect(imageOrientationFromMatrix([-100, 0, 0, 100, 0, 0])).toEqual({
      flipX: true,
      flipY: false,
    });
  });

  it("回転・スキュー（b≠0 or c≠0）は判定せず no-op（過補正を避ける）", () => {
    expect(imageOrientationFromMatrix([0, 100, -100, 0, 0, 0])).toEqual({
      flipX: false,
      flipY: false,
    });
    // d<0 でも回転成分があれば触らない
    expect(imageOrientationFromMatrix([100, 5, 5, -100, 0, 0])).toEqual({
      flipX: false,
      flipY: false,
    });
  });
});

// 表示面積は |det| = |a·d − b·c|。回転・反転を通して不変であることをここで固定する。
// 軸並行の値は imageOrientationFromMatrix と同じ実測 CTM を流用している。
describe("displayAreaFromMatrix", () => {
  it("軸並行スケールは幅×高さ（pt²）", () => {
    expect(displayAreaFromMatrix([192.2, 0, 0, 148.4, 0, 0])).toBeCloseTo(28522.48, 1);
  });

  it("d<0（縦反転）でも面積は正", () => {
    expect(displayAreaFromMatrix([199.0, 0, 0, -253.0, 0, 0])).toBe(50347);
  });

  it("90 度回転でも面積は保存される", () => {
    expect(displayAreaFromMatrix([0, 100, -100, 0, 0, 0])).toBe(10000);
  });

  it("潰れた変換（det=0）は 0", () => {
    expect(displayAreaFromMatrix([100, 0, 0, 0, 0, 0])).toBe(0);
  });

  it("矢印・罫線パーツ相当（8pt 角）は図版と桁が分かれる", () => {
    expect(displayAreaFromMatrix([8, 0, 0, 8, 0, 0])).toBe(64);
  });
});

// 実測（MatPath_NCS.pdf）: 図がすべてベクターの論文では、埋め込み「画像」は
// 背景パネル・帯などの単色矩形だけだった。単色判定がそれらを漏れなく弾き、
// かつ実内容のある画像を巻き込まないことをここで固定する。
describe("isEffectivelySolidColor", () => {
  const rgba = (w: number, h: number, fill: [number, number, number]) => {
    const d = new Uint8ClampedArray(w * h * 4);
    for (let i = 0; i < w * h; i++) {
      d[i * 4] = fill[0];
      d[i * 4 + 1] = fill[1];
      d[i * 4 + 2] = fill[2];
      d[i * 4 + 3] = 255;
    }
    return d;
  };
  const setPx = (d: Uint8ClampedArray, w: number, x: number, y: number, v: number) => {
    const q = (y * w + x) * 4;
    d[q] = d[q + 1] = d[q + 2] = v;
  };

  it("完全な単色は true", () => {
    expect(isEffectivelySolidColor(rgba(100, 100, [170, 170, 170]), 100, 100)).toBe(true);
  });

  it("角丸パネル相当（縁だけ別色）は true — 内側 5% だけを見る", () => {
    const d = rgba(100, 100, [170, 170, 170]);
    // 外周 3px を白にする（角丸・アンチエイリアスの近似）
    for (let y = 0; y < 100; y++) {
      for (let x = 0; x < 100; x++) {
        if (x < 3 || x >= 97 || y < 3 || y >= 97) setPx(d, 100, x, y, 255);
      }
    }
    expect(isEffectivelySolidColor(d, 100, 100)).toBe(true);
  });

  it("内部に線があれば false — 実内容のある図は残す", () => {
    const d = rgba(100, 100, [255, 255, 255]);
    for (let x = 10; x < 90; x++) setPx(d, 100, x, 50, 0); // 水平線
    expect(isEffectivelySolidColor(d, 100, 100)).toBe(false);
  });

  it("±3/チャンネル以内の圧縮ノイズは単色扱い", () => {
    const d = rgba(64, 64, [170, 170, 170]);
    setPx(d, 64, 32, 32, 172);
    expect(isEffectivelySolidColor(d, 64, 64)).toBe(true);
  });

  it("それを超える色差は false", () => {
    const d = rgba(64, 64, [170, 170, 170]);
    setPx(d, 64, 32, 32, 120);
    expect(isEffectivelySolidColor(d, 64, 64)).toBe(false);
  });

  it("縮退サイズ（2×2 以下）は情報なしとして true", () => {
    expect(isEffectivelySolidColor(rgba(2, 2, [0, 0, 0]), 2, 2)).toBe(true);
  });
});

// pdfjs は複数ページで共有される画像を `g_` プレフィックス名で document 全体の
// commonObjs に置く。page.objs だけを見ると g_ 名のコールバックが永遠に呼ばれず
// 抽出全体がハングする（TE_PlotBench.pdf で実測）。ストア振り分けの回帰テスト。
describe("getImageObject", () => {
  type Cb = (obj: unknown) => void;
  function makeStore(obj: unknown) {
    const calls: string[] = [];
    return {
      calls,
      get(name: string, cb: Cb) {
        calls.push(name);
        cb(obj);
      },
    };
  }

  it("通常名は page.objs から取得する", async () => {
    const objs = makeStore({ width: 10, height: 20 });
    const commonObjs = makeStore(null);
    const result = await getImageObject({ objs, commonObjs }, "img_p0_1");
    expect(result).toEqual({ width: 10, height: 20 });
    expect(objs.calls).toEqual(["img_p0_1"]);
    expect(commonObjs.calls).toEqual([]);
  });

  it("g_ プレフィックス名は commonObjs から取得する", async () => {
    const objs = makeStore(null);
    const commonObjs = makeStore({ width: 30, height: 40 });
    const result = await getImageObject({ objs, commonObjs }, "g_d0_img_p1_2");
    expect(result).toEqual({ width: 30, height: 40 });
    expect(commonObjs.calls).toEqual(["g_d0_img_p1_2"]);
    expect(objs.calls).toEqual([]);
  });

  it("コールバックが呼ばれない場合はタイムアウトで null を返す（ハングしない）", async () => {
    const never = { get: () => {} };
    const result = await getImageObject({ objs: never, commonObjs: never }, "img_p0_1", 50);
    expect(result).toBeNull();
  });

  it("store.get が throw しても null で継続する", async () => {
    const throwing = {
      get: () => {
        throw new Error("boom");
      },
    };
    const result = await getImageObject({ objs: throwing, commonObjs: throwing }, "img_p0_1", 50);
    expect(result).toBeNull();
  });
});
