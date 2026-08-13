import { describe, expect, it } from "vitest";
import {
  findColumnNameByType,
  hasColumnType,
  isTableMetaEmpty,
  withColumnType,
  withoutColumnType,
  type ColumnType,
} from "./types";

type Columns = Record<string, ColumnType[]>;

describe("hasColumnType", () => {
  it("どこかの列にそのはたらきがあれば true", () => {
    expect(hasColumnType({ columns: { 日時: ["datetime-auto"] } }, "datetime-auto")).toBe(true);
    expect(hasColumnType({ columns: { 名前: ["note-link"] } }, "datetime-auto")).toBe(false);
  });

  it("1 列に複数のはたらきが付いていても両方 true になる", () => {
    const meta = { columns: { 日時: ["datetime-auto", "note-link"] } as Columns };
    expect(hasColumnType(meta, "datetime-auto")).toBe(true);
    expect(hasColumnType(meta, "note-link")).toBe(true);
  });

  it("undefined / columns 無しは false", () => {
    expect(hasColumnType(undefined, "datetime-auto")).toBe(false);
    expect(hasColumnType({ caption: "名前だけ" }, "datetime-auto")).toBe(false);
  });
});

describe("findColumnNameByType", () => {
  it("そのはたらきが付いた列名を返す", () => {
    const meta = { columns: { 日時: ["datetime-auto"], 名前: ["note-link"] } as Columns };
    expect(findColumnNameByType(meta, "note-link")).toBe("名前");
  });

  it("無ければ undefined", () => {
    expect(findColumnNameByType({ columns: { 日時: ["datetime-auto"] } }, "note-link")).toBeUndefined();
    expect(findColumnNameByType(undefined, "note-link")).toBeUndefined();
  });
});

describe("withColumnType", () => {
  it("列にはたらきを足す", () => {
    expect(withColumnType(undefined, "日時", "datetime-auto")).toEqual({ 日時: ["datetime-auto"] });
  });

  it("同じ列に別のはたらきを足すと並ぶ（既存を消さない）", () => {
    const first = withColumnType(undefined, "日時", "datetime-auto");
    expect(withColumnType(first, "日時", "note-link")).toEqual({
      日時: ["datetime-auto", "note-link"],
    });
  });

  it("すでに付いていれば増やさない", () => {
    const columns: Columns = { 日時: ["datetime-auto"] };
    expect(withColumnType(columns, "日時", "datetime-auto")).toEqual({ 日時: ["datetime-auto"] });
  });

  it("別の列は保つ", () => {
    const columns: Columns = { 名前: ["note-link"] };
    expect(withColumnType(columns, "日時", "datetime-auto")).toEqual({
      名前: ["note-link"],
      日時: ["datetime-auto"],
    });
  });
});

describe("withoutColumnType", () => {
  it("そのはたらきを全列から外す", () => {
    const columns: Columns = { 日時: ["datetime-auto"], 名前: ["note-link"] };
    expect(withoutColumnType(columns, "datetime-auto")).toEqual({ 名前: ["note-link"] });
  });

  it("同居する別のはたらきは残す", () => {
    const columns: Columns = { 日時: ["datetime-auto", "note-link"] };
    expect(withoutColumnType(columns, "note-link")).toEqual({ 日時: ["datetime-auto"] });
  });

  it("空になった列は落とす", () => {
    const columns: Columns = { 日時: ["datetime-auto"] };
    expect(withoutColumnType(columns, "datetime-auto")).toEqual({});
    expect(withoutColumnType(undefined, "datetime-auto")).toEqual({});
  });
});

describe("isTableMetaEmpty", () => {
  it("名前・はたらき・紐付けが全て無ければ空", () => {
    expect(isTableMetaEmpty(undefined)).toBe(true);
    expect(isTableMetaEmpty({})).toBe(true);
    expect(isTableMetaEmpty({ caption: "", columns: {}, noteLinks: {} })).toBe(true);
  });

  it("どれか 1 つでもあれば空ではない", () => {
    expect(isTableMetaEmpty({ caption: "試料の一覧" })).toBe(false);
    expect(isTableMetaEmpty({ columns: { 日時: ["datetime-auto"] } })).toBe(false);
    expect(isTableMetaEmpty({ noteLinks: { "A-1": "note-x" } })).toBe(false);
  });
});
