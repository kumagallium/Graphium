// @vitest-environment jsdom
// 「リンクをコピー」のリンクの組み立てと読み取りの回帰ガード
import { describe, expect, it } from "vitest";
import { buildAssetLink, buildKnowledgeLink, buildNoteLink, parseGraphiumLink } from "./graphium-link";

describe("parseGraphiumLink", () => {
  it.each([
    ["https://example.com/Graphium/#note/n-1", { kind: "note", id: "n-1" }],
    ["#note/n-1?peek=n-2", { kind: "note", id: "n-1" }],
    ["#note/%E3%81%82", { kind: "note", id: "あ" }],
    ["#note/wiki:w-1", { kind: "knowledge", id: "w-1" }],
    ["#note/wiki%3Aw-1", { kind: "knowledge", id: "w-1" }],
    ["https://example.com/Graphium/#knowledge/concept/w-1", { kind: "knowledge", id: "w-1" }],
    ["#wiki/summary/w-2", { kind: "knowledge", id: "w-2" }],
    ["https://example.com/Graphium/#assets/pdf/f-1", { kind: "asset", mediaType: "pdf", fileId: "f-1" }],
  ])("%s", (text, expected) => {
    expect(parseGraphiumLink(text)).toEqual(expected);
  });

  it.each([
    "https://example.com/",
    "#knowledge/concept",
    "#assets/pdf",
    "#notes",
    "#shared/0f8fad5b-d9cb-469f-a165-70867728950e",
  ])("Graphium の 1 件を指すリンクでなければ null（%s）", (text) => {
    expect(parseGraphiumLink(text)).toBeNull();
  });

  it("組み立てたリンクは読み取ると同じ行き先に戻る", () => {
    expect(parseGraphiumLink(buildNoteLink("n 1"))).toEqual({ kind: "note", id: "n 1" });
    expect(parseGraphiumLink(buildKnowledgeLink("concept", "w-1"))).toEqual({ kind: "knowledge", id: "w-1" });
    expect(parseGraphiumLink(buildAssetLink("image", "f/1"))).toEqual({
      kind: "asset",
      mediaType: "image",
      fileId: "f/1",
    });
  });
});
