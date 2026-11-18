// データ表ブロックの表示名（キャプション / 元ファイル名フォールバック）
import { describe, expect, it } from "vitest";
import {
  dataTableDisplayName,
  dataTableDisplayNameOf,
  parseDataTableSource,
  serializeDataTableSource,
} from "./source";
import type { TableSource } from "../../lib/document-types";

const baseSource: TableSource = {
  kind: "delimited-file",
  fileName: "oven-log.csv",
  fileId: "asset-1",
  importedAt: "2026-09-05T00:00:00.000Z",
  options: {
    headerRow: 1,
    endRow: 4,
    delimiter: "comma",
    collapseConsecutive: false,
  },
};

describe("dataTableDisplayName", () => {
  it("キャプションがあればそれを使う", () => {
    expect(dataTableDisplayName("焼成ログ", baseSource)).toBe("焼成ログ");
  });

  it("キャプションが空なら元ファイル名（拡張子なし）を使う", () => {
    expect(dataTableDisplayName("", baseSource)).toBe("oven-log");
    expect(dataTableDisplayName(undefined, baseSource)).toBe("oven-log");
  });

  it("キャプションが空白のみでも空扱いでファイル名にフォールバックする", () => {
    expect(dataTableDisplayName("   ", baseSource)).toBe("oven-log");
  });

  it("source が null でキャプションも空なら空文字", () => {
    expect(dataTableDisplayName("", null)).toBe("");
    expect(dataTableDisplayName(undefined, null)).toBe("");
  });
});

describe("dataTableDisplayNameOf", () => {
  it("dataTable ブロックならキャプション優先で表示名を返す", () => {
    const block = {
      id: "dt1",
      type: "dataTable",
      props: { caption: "焼成ログ", source: serializeDataTableSource(baseSource) },
      children: [],
    };
    expect(dataTableDisplayNameOf(block)).toBe("焼成ログ");
  });

  it("キャプションが空なら source から元ファイル名を出す", () => {
    const block = {
      id: "dt1",
      type: "dataTable",
      props: { caption: "", source: serializeDataTableSource(baseSource) },
      children: [],
    };
    expect(dataTableDisplayNameOf(block)).toBe("oven-log");
  });

  it("dataTable 以外のブロックは空文字", () => {
    expect(dataTableDisplayNameOf({ id: "t1", type: "table" })).toBe("");
    expect(dataTableDisplayNameOf(null)).toBe("");
  });

  it("source が壊れていてもキャプションがあればそれを返す", () => {
    const block = {
      id: "dt1",
      type: "dataTable",
      props: { caption: "焼成ログ", source: "{not json" },
      children: [],
    };
    expect(dataTableDisplayNameOf(block)).toBe("焼成ログ");
  });

  it("source が壊れていてキャプションも無ければ空文字", () => {
    const block = {
      id: "dt1",
      type: "dataTable",
      props: { caption: "", source: "{not json" },
      children: [],
    };
    expect(dataTableDisplayNameOf(block)).toBe("");
  });
});

describe("parseDataTableSource / serializeDataTableSource の derivation", () => {
  const derived: TableSource = {
    ...baseSource,
    fileName: "oven-curves-extract.csv",
    derivation: {
      kind: "filter",
      fromFileId: "asset-0",
      fromFileName: "oven-curves.csv",
      columns: ["time", "temp_c"],
      conditions: [
        { column: "temp_c", op: "ge", value: "200" },
        { column: "note", op: "notEmpty" },
      ],
      sourceRows: 120,
      resultRows: 30,
      createdAt: "2026-11-18T09:00:00.000Z",
    },
  };

  it("derivation を落とさずに往復できる", () => {
    const back = parseDataTableSource(serializeDataTableSource(derived));
    expect(back).toEqual(derived);
    expect(back?.derivation?.fromFileName).toBe("oven-curves.csv");
  });

  it("derivation の無い source は項目が増えない（既存のノートは変わらない）", () => {
    const back = parseDataTableSource(serializeDataTableSource(baseSource));
    expect(back).toEqual(baseSource);
    expect(back && "derivation" in back).toBe(false);
  });
});
