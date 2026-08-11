// 保存 diff からの shared:// 引用検出（collectNewSharedCitationSources）のテスト。
// EditActivity.used（prov:used）に渡す sources の生成が正しいことを保証する。

import { describe, it, expect } from "vitest";
import {
  collectSharedCitationIds,
  collectNewSharedCitationSources,
} from "./collect";

const citation = (sharedId: string) => ({
  type: "sharedCitation",
  props: { sharedId },
  children: [],
});

const paragraph = (text: string) => ({
  type: "paragraph",
  props: {},
  content: [{ type: "text", text, styles: {} }],
  children: [],
});

describe("collectSharedCitationIds", () => {
  it("トップレベルとネストの引用を両方拾う", () => {
    const blocks = [
      paragraph("before"),
      citation("id-a"),
      {
        type: "step",
        props: {},
        children: [citation("id-b"), paragraph("inside")],
      },
    ];
    expect(collectSharedCitationIds(blocks)).toEqual(new Set(["id-a", "id-b"]));
  });

  it("sharedId が空・欠損のブロックは無視する", () => {
    const blocks = [
      { type: "sharedCitation", props: { sharedId: "" } },
      { type: "sharedCitation", props: {} },
      citation("id-a"),
    ];
    expect(collectSharedCitationIds(blocks)).toEqual(new Set(["id-a"]));
  });

  it("blocks が配列でなければ空集合", () => {
    expect(collectSharedCitationIds(undefined)).toEqual(new Set());
    expect(collectSharedCitationIds(null)).toEqual(new Set());
  });
});

describe("collectNewSharedCitationSources", () => {
  it("新規に現れた引用だけを shared: プレフィックス付きで返す", () => {
    const prev = [citation("id-a"), paragraph("x")];
    const current = [citation("id-a"), citation("id-b")];
    expect(collectNewSharedCitationSources(prev, current)).toEqual([
      "shared:id-b",
    ]);
  });

  it("初回保存（prev なし）は全引用が新規扱い", () => {
    const current = [citation("id-a")];
    expect(collectNewSharedCitationSources(undefined, current)).toEqual([
      "shared:id-a",
    ]);
  });

  it("削除された引用は sources に影響しない（変化なしで空）", () => {
    const prev = [citation("id-a"), citation("id-b")];
    const current = [citation("id-a")];
    expect(collectNewSharedCitationSources(prev, current)).toEqual([]);
  });
});
