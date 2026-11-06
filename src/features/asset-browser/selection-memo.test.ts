// selection-memo のテスト: 選んだ文のメモの出典に、文（quote）が本文とは別に残ること。

import { describe, expect, it } from "vitest";
import { buildSelectionSourceAsset, resolveSelectionQuote } from "./selection-memo";
import type { CitationSource } from "./SelectionPill";

const PDF: CitationSource["entry"] = { fileId: "pdf-1", name: "proofing.pdf", type: "pdf", url: "" };

describe("resolveSelectionQuote", () => {
  it("PDF は text-layer から取った文と前後を使う", () => {
    const quote = resolveSelectionQuote({
      entry: PDF,
      selectionText: "Let the dough rest",
      resolveQuote: () => ({ exact: "Let the dough rest", prefix: "notes ", suffix: " for" }),
    });
    expect(quote).toEqual({ exact: "Let the dough rest", prefix: "notes ", suffix: " for" });
  });

  it("取り出せない・取り出しが投げるときは、選んだ文（空白を畳む）だけを持つ", () => {
    expect(resolveSelectionQuote({ entry: PDF, selectionText: "a\n  b", resolveQuote: () => null })).toEqual({
      exact: "a b",
    });
    expect(
      resolveSelectionQuote({
        entry: PDF,
        selectionText: "c",
        resolveQuote: () => {
          throw new Error("detached");
        },
      }),
    ).toEqual({ exact: "c" });
  });

  it("空の選択なら null", () => {
    expect(resolveSelectionQuote({ entry: PDF, selectionText: "  " })).toBeNull();
  });
});

describe("buildSelectionSourceAsset", () => {
  it("素材・ページ・文をまとめる", () => {
    expect(
      buildSelectionSourceAsset({ entry: PDF, selectionText: "Bake at 220 C", pageNumber: 3 }),
    ).toEqual({ fileId: "pdf-1", type: "pdf", pageNumber: 3, quote: { exact: "Bake at 220 C" } });
  });

  it("ページの無い素材（URL）はページを付けない", () => {
    const asset = buildSelectionSourceAsset({
      entry: { fileId: "url-1", name: "example.org", type: "url", url: "https://example.org" },
      selectionText: "Knead for 10 minutes",
    });
    expect(asset).toEqual({ fileId: "url-1", type: "url", quote: { exact: "Knead for 10 minutes" } });
  });
});
