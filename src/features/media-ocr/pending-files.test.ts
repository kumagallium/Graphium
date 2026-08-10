// @vitest-environment jsdom
// pending-files（貼付直後の File を OCR に渡す短命レジストリ）のテスト。
//
// 対象の不変条件:
// - 預けた File は同じ URL で 1 回だけ取り出せる（取り出したら消える）
// - 画像以外の File は預からない（OCR 対象外）
// - 上限を超えたら古いものから捨てる（拾われなかった分を溜め込まない）

import { describe, it, expect } from "vitest";
import { registerPendingOcrFile, takePendingOcrFile } from "./pending-files";

const img = (name: string) => new File(["x"], name, { type: "image/png" });

describe("pending-files", () => {
  it("預けた File は 1 回だけ取り出せる", () => {
    const f = img("a.png");
    registerPendingOcrFile("file-media://take-once", f);
    expect(takePendingOcrFile("file-media://take-once")).toBe(f);
    expect(takePendingOcrFile("file-media://take-once")).toBeUndefined();
  });

  it("画像以外は預からない", () => {
    const pdf = new File(["x"], "a.pdf", { type: "application/pdf" });
    registerPendingOcrFile("file-media://not-image", pdf);
    expect(takePendingOcrFile("file-media://not-image")).toBeUndefined();
  });

  it("上限を超えたら古いものから捨てる", () => {
    for (let i = 0; i < 9; i++) {
      registerPendingOcrFile(`file-media://cap-${i}`, img(`${i}.png`));
    }
    // 最古の cap-0 は追い出され、新しい 8 件は残る
    expect(takePendingOcrFile("file-media://cap-0")).toBeUndefined();
    for (let i = 1; i < 9; i++) {
      expect(takePendingOcrFile(`file-media://cap-${i}`)).toBeDefined();
    }
  });
});
