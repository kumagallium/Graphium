import { describe, expect, it } from "vitest";
import { strToU8, zipSync } from "fflate";
import * as mammoth from "mammoth";
import { docxElementToText, extractDocxText, joinAdjacentScriptTags } from "./docx-text";

// 最小の .docx を組み立てる（本文の <w:p> 群だけ差し替える）
function buildDocx(bodyXml: string): Uint8Array {
  const W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
  return zipSync({
    "[Content_Types].xml": strToU8(
      `<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
        `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
        `<Default Extension="xml" ContentType="application/xml"/>` +
        `<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>` +
        `</Types>`,
    ),
    "_rels/.rels": strToU8(
      `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
        `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>` +
        `</Relationships>`,
    ),
    "word/document.xml": strToU8(
      `<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="${W}"><w:body>${bodyXml}</w:body></w:document>`,
    ),
  });
}

const run = (text: string, vertAlign?: "superscript" | "subscript") =>
  `<w:r>${vertAlign ? `<w:rPr><w:vertAlign w:val="${vertAlign}"/></w:rPr>` : ""}<w:t xml:space="preserve">${text}</w:t></w:r>`;
const para = (...runs: string[]) => `<w:p>${runs.join("")}</w:p>`;

function toInput(bytes: Uint8Array) {
  return { buffer: bytes };
}

describe("extractDocxText", () => {
  it("上付き・下付きを <sup> / <sub> で残す（「1×10⁵」が「1×105」にならない）", async () => {
    const docx = buildDocx(
      para(run("収束条件は1×10"), run("-5", "superscript"), run("[eV]とした。")) + para(run("H"), run("2", "subscript"), run("O")),
    );
    const { value } = await extractDocxText(mammoth, toInput(docx));
    expect(value).toBe("収束条件は1×10<sup>-5</sup>[eV]とした。\n\nH<sub>2</sub>O\n\n");
  });

  it("上付き・下付きの無い文書は mammoth.extractRawText と 1 文字も変わらない", async () => {
    const docx = buildDocx(para(run("一段落目"), "<w:r><w:tab/></w:r>", run("タブの後")) + para(run("二段落目")));
    const ours = await extractDocxText(mammoth, toInput(docx));
    const raw = await mammoth.extractRawText(toInput(docx) as any);
    expect(ours.value).toBe(raw.value);
  });

  it("割れた run の上付きは 1 つのタグにまとめる", async () => {
    const docx = buildDocx(para(run("10"), run("-", "superscript"), run("5", "superscript")));
    const { value } = await extractDocxText(mammoth, toInput(docx));
    expect(value).toBe("10<sup>-5</sup>\n\n");
  });

  it("CJS の default 越しのモジュールでも読める（MCP サーバーの動的 import）", async () => {
    const docx = buildDocx(para(run("x"), run("2", "superscript")));
    const { value } = await extractDocxText({ default: mammoth as any }, toInput(docx));
    expect(value).toBe("x<sup>2</sup>\n\n");
  });

  it("壊れたファイルは投げる（呼び出し側が unreadable にする）", async () => {
    await expect(extractDocxText(mammoth, toInput(new Uint8Array([1, 2, 3])))).rejects.toBeTruthy();
  });
});

describe("docxElementToText", () => {
  it("中身の無い上付きの run はタグを出さない", () => {
    expect(
      docxElementToText({
        type: "paragraph",
        children: [{ type: "run", verticalAlignment: "superscript", children: [] }, { type: "run", children: [{ type: "text", value: "a" }] }],
      }),
    ).toBe("a\n\n");
  });
});

describe("joinAdjacentScriptTags", () => {
  it("違う種類のタグはまとめない", () => {
    expect(joinAdjacentScriptTags("a<sup>1</sup><sub>2</sub>")).toBe("a<sup>1</sup><sub>2</sub>");
  });
});
