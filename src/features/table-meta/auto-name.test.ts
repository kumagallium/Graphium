// テーブル表示名（キャプション + 自動名）の採番
import { describe, expect, it } from "vitest";
import { computeTableDisplayNames } from "./auto-name";
import { t } from "../../i18n";
import { serializeDataTableSource } from "../../blocks/data-table/source";
import type { TableSource } from "../../lib/document-types";

const table = (id: string) => ({ id, type: "table" });
const auto = (n: number) => t("tableMeta.autoName", { n: String(n) });

const dtSource: TableSource = {
  kind: "delimited-file",
  fileName: "oven-log.csv",
  fileId: "asset-1",
  importedAt: "2026-09-05T00:00:00.000Z",
  options: { headerRow: 1, endRow: 4, delimiter: "comma", collapseConsecutive: false },
};
const dataTable = (id: string, caption: string) => ({
  id,
  type: "dataTable",
  props: { caption, source: serializeDataTableSource(dtSource) },
  children: [],
});

describe("computeTableDisplayNames", () => {
  it("すべての表に文書順で自動名を振り、キャプションが勝つ", () => {
    const names = computeTableDisplayNames(
      [table("a"), table("b"), { id: "s", type: "step", children: [table("c")] }],
      (id) => (id === "b" ? "秤量表" : "")
    );
    expect(names.get("a")).toBe(auto(1));
    expect(names.get("b")).toBe("秤量表");
    expect(names.get("c")).toBe(auto(2));
  });

  it("キャプションに固定済みの自動名は採番から飛ばす（参照の乗っ取り防止）", () => {
    // 「表 1」で参照された表が名前を固定した後、上に新しい表を追加したケース。
    // 新しい表へ同じ「表 1」を振ると既存の参照が別の表を指してしまう
    const names = computeTableDisplayNames(
      [table("new"), table("fixed")],
      (id) => (id === "fixed" ? auto(1) : "")
    );
    expect(names.get("fixed")).toBe(auto(1));
    expect(names.get("new")).toBe(auto(2));
  });

  it("データ表は常にキャプション/元ファイル名を表示名に持ち、自動名を消費しない", () => {
    const names = computeTableDisplayNames(
      [table("a"), dataTable("dt", "oven-log"), table("b")],
      () => ""
    );
    expect(names.get("dt")).toBe("oven-log");
    expect(names.get("a")).toBe(auto(1));
    expect(names.get("b")).toBe(auto(2));
  });

  it("データ表のキャプションが「表 1」のとき、無名の表は「表 2」から採番される（名前の乗っ取り防止）", () => {
    const names = computeTableDisplayNames(
      [dataTable("dt", auto(1)), table("a")],
      () => ""
    );
    expect(names.get("dt")).toBe(auto(1));
    expect(names.get("a")).toBe(auto(2));
  });
});
