import { describe, expect, it } from "vitest";
import { selectInboxOcrTargets } from "./ocr-targets";

const imp = (fileId: string, kind?: "memo" | "url") => ({ name: `${fileId}.x`, fileId, checksum: `c-${fileId}`, ...(kind ? { kind } : {}) });
const img = (fileId: string, ocrText?: string) => ({ fileId, type: "image" as const, url: `u/${fileId}`, name: `${fileId}.jpg`, ...(ocrText ? { ocrText } : {}) });

describe("selectInboxOcrTargets", () => {
  it("文字が未読の画像だけを選ぶ", () => {
    const media = [img("a"), img("b", "読み済み"), { fileId: "c", type: "audio" as const, url: "u/c", name: "c.m4a" }];
    expect(selectInboxOcrTargets([imp("a"), imp("b"), imp("c")], media)).toEqual([
      { fileId: "a", url: "u/a", name: "a.jpg" },
    ]);
  });

  it("メモ・URL は対象外", () => {
    const media = [img("m"), img("u")];
    expect(selectInboxOcrTargets([imp("m", "memo"), imp("u", "url")], media)).toEqual([]);
  });

  it("索引に無いもの・索引が無いときは対象外、同じ fileId は 1 回", () => {
    expect(selectInboxOcrTargets([imp("a")], undefined)).toEqual([]);
    expect(selectInboxOcrTargets([imp("zzz")], [img("a")])).toEqual([]);
    expect(selectInboxOcrTargets([imp("a"), imp("a")], [img("a")])).toHaveLength(1);
  });
});
