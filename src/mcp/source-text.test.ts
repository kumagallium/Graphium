// source-text.ts（get_source_text の本体）の回帰テスト。
// 一時 vault に最小の PDF / docx を置き、ページの対応・窓の送り・断る文を確かめる。

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { resetMediaIndexCache } from "./sources";
import { getSourceText, resetSourceTextCache } from "./source-text";
import { buildMinimalDocx, buildMinimalPdf } from "./test-support";

const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

describe("getSourceText", () => {
  let root: string;

  function writeMediaIndex(media: object[]) {
    mkdirSync(join(root, "appdata"), { recursive: true });
    writeFileSync(join(root, "appdata", "media-index.json"), JSON.stringify({ version: 1, media }));
    resetMediaIndexCache();
  }

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "graphium-mcp-source-text-"));
    mkdirSync(join(root, "notes"), { recursive: true });
    mkdirSync(join(root, "media"), { recursive: true });
    resetSourceTextCache();
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it("PDF はページ番号つきで返し、page 指定でそのページを含む窓を選ぶ", async () => {
    writeFileSync(join(root, "media", "pdf1.pdf"), buildMinimalPdf(["Alpha first page", "Beta second page", "Gamma third page"]));
    writeMediaIndex([{ fileId: "pdf1", name: "論文.pdf", type: "pdf", mimeType: "application/pdf", url: "", uploadedAt: "", usedIn: [] }]);

    const out = await getSourceText({ sourceId: "pdf:pdf1" }, root);
    expect(out).toContain("Alpha first page");
    expect(out).toContain("Gamma third page");
    expect(out).toContain("全 3 ページ");
    expect(out).toContain("ページ 1〜3");

    const page3 = await getSourceText({ sourceId: "pdf:pdf1", page: 3 }, root);
    expect(page3).toContain("Gamma third page");

    const tooFar = await getSourceText({ sourceId: "pdf:pdf1", page: 4 }, root);
    expect(tooFar.startsWith("OUT_OF_RANGE")).toBe(true);
  });

  it("長い PDF は page 指定で、そのページの先頭を含む窓に飛ぶ", async () => {
    const long = (label: string) => `${label} ` + "word ".repeat(300).trim();
    writeFileSync(join(root, "media", "pdf2.pdf"), buildMinimalPdf([long("P1"), long("P2"), long("P3"), long("P4")]));
    writeMediaIndex([{ fileId: "pdf2", name: "長い.pdf", type: "pdf", mimeType: "application/pdf", url: "", uploadedAt: "", usedIn: [] }]);

    const first = await getSourceText({ sourceId: "pdf:pdf2", windowChars: 1000 }, root);
    expect(first).toContain("次の窓: window: 1");
    const p4 = await getSourceText({ sourceId: "pdf:pdf2", page: 4, windowChars: 1000 }, root);
    expect(p4).toContain("P4 word");
    expect(p4).not.toContain("今の窓: 0（");
    expect(p4).toMatch(/ページ (3〜4|4)/);
  });

  it("docx は本文を取り出し、窓を送れる（windowChars の下限は 1,000）", async () => {
    const paragraphs = Array.from({ length: 60 }, (_, i) => `第${i + 1}段落。` + "あ".repeat(50));
    writeFileSync(join(root, "media", "doc1.docx"), buildMinimalDocx(paragraphs));
    writeMediaIndex([{ fileId: "doc1", name: "報告書.docx", type: "document", mimeType: DOCX_MIME, url: "", uploadedAt: "", usedIn: [] }]);

    // 下限より小さい値は 1,000 に切り上がる
    const w0 = await getSourceText({ sourceId: "document:doc1", windowChars: 10 }, root);
    expect(w0).toContain("1 枚 1,000 字");
    expect(w0).toContain("第1段落");
    expect(w0).toContain("次の窓: window: 1");

    const w1 = await getSourceText({ sourceId: "document:doc1", window: 1, windowChars: 10 }, root);
    expect(w1).toContain("今の窓: 1");
    expect(w1).not.toContain("第1段落。");

    const over = await getSourceText({ sourceId: "document:doc1", window: 99 }, root);
    expect(over.startsWith("OUT_OF_RANGE")).toBe(true);
  });

  it("未登録の資料・URL は UNKNOWN_SOURCE で断る", async () => {
    writeMediaIndex([]);
    expect((await getSourceText({ sourceId: "pdf:nope" }, root)).startsWith("UNKNOWN_SOURCE")).toBe(true);
    expect((await getSourceText({ sourceId: "url:https://example.com/" }, root)).startsWith("UNKNOWN_SOURCE")).toBe(true);
    expect((await getSourceText({ sourceId: "no-such-note" }, root)).startsWith("UNKNOWN_SOURCE")).toBe(true);
  });

  it("docx 以外の document は UNSUPPORTED_FORMAT で断る", async () => {
    writeFileSync(join(root, "media", "xls1.xlsx"), "dummy");
    writeMediaIndex([
      { fileId: "xls1", name: "表.xlsx", type: "document", mimeType: "application/vnd.ms-excel", url: "", uploadedAt: "", usedIn: [] },
    ]);
    const out = await getSourceText({ sourceId: "document:xls1" }, root);
    expect(out.startsWith("UNSUPPORTED_FORMAT")).toBe(true);
    expect(out).toContain("この形式（application/vnd.ms-excel）は文字起こしできません");
  });

  it("ノートは本文を返す", async () => {
    writeFileSync(
      join(root, "notes", "n1.json"),
      JSON.stringify({
        version: 2,
        title: "メモ",
        pages: [{ id: "p", blocks: [{ id: "b1", type: "paragraph", content: [{ type: "text", text: "ノートの本文です" }], children: [] }] }],
      }),
    );
    const out = await getSourceText({ sourceId: "n1" }, root);
    expect(out).toContain("# メモ");
    expect(out).toContain("ノートの本文です");
  });
});
