import { describe, it, expect, beforeEach } from "vitest";
import { dataTableToMarkdown, DATA_TABLE_EXPORT_ROW_LIMIT } from "./to-markdown";
import { serializeDataTableSource } from "./model";
import { clearDataTableCache } from "./data";
import { primeAssetText, clearAssetTextCache } from "../../features/data-import/asset-text";
import type { TableSource } from "../../lib/document-types";
import type { MarkdownBlockContext } from "../markdown-block";

const ctx: MarkdownBlockContext = { children: [], inlines: [] };

const source: TableSource = {
  kind: "delimited-file",
  fileName: "oven-log.csv",
  fileId: "asset-1",
  importedAt: "2026-09-05T00:00:00.000Z",
  options: {
    headerRow: 1,
    endRow: 999,
    delimiter: "comma",
    collapseConsecutive: false,
  },
};

function block(props: Record<string, unknown> = {}) {
  return { type: "dataTable", props: { source: serializeDataTableSource(source), ...props }, children: [] };
}

function csvWithRows(n: number): string {
  const lines = ["time,temp_c"];
  for (let i = 0; i < n; i++) lines.push(`08:${String(i).padStart(2, "0")},${180 + i}`);
  return lines.join("\n");
}

beforeEach(() => {
  clearAssetTextCache();
  clearDataTableCache();
});

describe("dataTableToMarkdown", () => {
  it("source が壊れていれば ctx.children だけを返す", () => {
    const b = { type: "dataTable", props: { source: "{not json" }, children: [] };
    const c: MarkdownBlockContext = { children: [{ type: "paragraph" }], inlines: [] };
    expect(dataTableToMarkdown(b as any, c)).toEqual(c.children);
  });

  it("本文が読めていない（prime されていない）場合は斜体の見出し + 斜体の要約のみ", () => {
    const out = dataTableToMarkdown(block() as any, ctx);
    expect(out).toHaveLength(2);
    expect(out[0].type).toBe("paragraph");
    expect(out[0].content[0].styles.italic).toBe(true);
    expect(out[1].type).toBe("paragraph");
    expect(out[1].content[0].styles.italic).toBe(true);
  });

  it("読めている（10 行）場合は見出し + table（全行）で、続き行の注記は出ない", () => {
    primeAssetText("asset-1", csvWithRows(10));
    const out = dataTableToMarkdown(block() as any, ctx);
    // 見出し paragraph + table のみ（続き注記なし）
    expect(out).toHaveLength(2);
    expect(out[0].type).toBe("paragraph");
    expect(out[0].content[0].styles.italic).toBe(true);
    const table = out[1];
    expect(table.type).toBe("table");
    // ヘッダ行 + データ 10 行
    expect(table.content.rows).toHaveLength(11);
  });

  it("読めている（80 行）場合は先頭 50 行だけを table にし、続きの注記 paragraph が付く", () => {
    primeAssetText("asset-1", csvWithRows(80));
    const out = dataTableToMarkdown(block() as any, ctx);
    expect(out).toHaveLength(3);
    const table = out[1];
    expect(table.type).toBe("table");
    // ヘッダ行 + 上限 50 行
    expect(table.content.rows).toHaveLength(1 + DATA_TABLE_EXPORT_ROW_LIMIT);
    const more = out[2];
    expect(more.type).toBe("paragraph");
    expect(more.content[0].styles.italic).toBe(true);
  });

  it("ctx.children は末尾にそのまま引き継がれる", () => {
    const childBlock = { type: "paragraph", content: [] };
    const c: MarkdownBlockContext = { children: [childBlock], inlines: [] };
    const out = dataTableToMarkdown(block() as any, c);
    expect(out[out.length - 1]).toBe(childBlock);
  });
});
