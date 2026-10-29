import { describe, expect, it } from "vitest";
import { columnBehaviorMenuState, freeColumnName } from "./column-behavior";
import type { TableMeta } from "./types";

const headers = ["実験名", "日時", "収率"];
const noteLinkOnFirst: TableMeta = { columns: { 実験名: ["note-link"] } };
const dateTimeOnSecond: TableMeta = { columns: { 日時: ["datetime-auto"] } };
const dateTimeOnFirst: TableMeta = { columns: { 実験名: ["datetime-auto"] } };

describe("columnBehaviorMenuState", () => {
  it("何も付いていない先頭列は、どちらも付けられる", () => {
    expect(columnBehaviorMenuState(headers, undefined, 0)).toEqual({ dateTime: "enable", noteLink: "enable" });
  });

  it("先頭列以外には行ごとのノートの項目を出さない", () => {
    expect(columnBehaviorMenuState(headers, undefined, 1)).toEqual({ dateTime: "enable", noteLink: null });
  });

  it("1 列目が行ごとのノート・別の列が日時、は併用できる", () => {
    const meta: TableMeta = { columns: { 実験名: ["note-link"], 日時: ["datetime-auto"] } };
    expect(columnBehaviorMenuState(headers, meta, 0)).toEqual({ dateTime: null, noteLink: "disable" });
    expect(columnBehaviorMenuState(headers, meta, 1)).toEqual({ dateTime: "disable", noteLink: null });
  });

  it("先頭列で行ごとのノートがオンなら、日時を入れる入口は出さない", () => {
    expect(columnBehaviorMenuState(headers, noteLinkOnFirst, 0)).toEqual({ dateTime: null, noteLink: "disable" });
    // 別の列には出る
    expect(columnBehaviorMenuState(headers, noteLinkOnFirst, 1).dateTime).toBe("enable");
  });

  it("日時が先頭列に付いていれば、行ごとのノートを作る入口は出さない", () => {
    expect(columnBehaviorMenuState(headers, dateTimeOnFirst, 0)).toEqual({ dateTime: "disable", noteLink: null });
  });

  it("日時が別の列なら、先頭列から行ごとのノートを作れる", () => {
    expect(columnBehaviorMenuState(headers, dateTimeOnSecond, 0)).toEqual({ dateTime: "enable", noteLink: "enable" });
  });

  it("旧データで同じ先頭列に両方付いていれば、外す入口はどちらも出す", () => {
    const meta: TableMeta = { columns: { 実験名: ["note-link", "datetime-auto"] } };
    expect(columnBehaviorMenuState(headers, meta, 0)).toEqual({ dateTime: "disable", noteLink: "disable" });
  });

  it("見出しが重複する列には日時を出さない。空の列には出す（押したときに名前を入れる）", () => {
    expect(columnBehaviorMenuState(["", "日時"], undefined, 0)).toEqual({ dateTime: "enable", noteLink: "enable" });
    expect(columnBehaviorMenuState(["", "", ""], undefined, 1).dateTime).toBe("enable");
    expect(columnBehaviorMenuState(["値", "値"], undefined, 1).dateTime).toBeNull();
  });
});

describe("freeColumnName", () => {
  it("空いていればそのまま、使われていれば番号を付ける", () => {
    expect(freeColumnName(["", "値"], "日時")).toBe("日時");
    expect(freeColumnName(["日時", ""], "日時")).toBe("日時 2");
    expect(freeColumnName(["日時", "日時 2", ""], "日時")).toBe("日時 3");
  });
});
