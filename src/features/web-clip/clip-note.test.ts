import { describe, it, expect } from "vitest";
import {
  appendClipQuote,
  buildClipMemoText,
  buildClipNoteDocument,
  clipTitle,
  findClipUrlEntry,
  normalizeClipUrl,
} from "./clip-note";
import type { MediaIndexEntry } from "../asset-browser/media-index";
import type { CaptureEntry } from "../mobile-capture/capture-store";

function urlEntry(fileId: string, url: string, extra: Partial<MediaIndexEntry> = {}): MediaIndexEntry {
  return {
    fileId,
    name: fileId,
    type: "url",
    mimeType: "text/x-uri",
    url,
    thumbnailUrl: "",
    uploadedAt: "2026-11-01T00:00:00Z",
    usedIn: [],
    ...extra,
  };
}

const memo: CaptureEntry = { id: "m1", text: "Yeast likes 30 °C.\n\n— Bread science", createdAt: "2026-11-03T10:00:00Z" };

describe("normalizeClipUrl", () => {
  it("# と追跡用クエリを外し、ホストを小文字に、末尾の / を落とす", () => {
    expect(normalizeClipUrl("https://Example.com/a/b/?utm_source=x&id=3&fbclid=y#sec")).toBe("https://example.com/a/b?id=3");
    expect(normalizeClipUrl("https://example.com/")).toBe("https://example.com");
  });

  it("意味のあるクエリは残す（別ページとみなす）", () => {
    expect(normalizeClipUrl("https://example.com/p?id=1")).not.toBe(normalizeClipUrl("https://example.com/p?id=2"));
  });

  it("URL として読めなければそのまま", () => {
    expect(normalizeClipUrl(" not a url ")).toBe("not a url");
  });
});

describe("findClipUrlEntry", () => {
  const index = {
    media: [
      urlEntry("a", "https://example.com/article?utm_medium=mail"),
      urlEntry("b", "https://journal.example/doi-page", { webClip: { noteId: "n1", doi: "10.1000/XYZ" } }),
      { ...urlEntry("c", "https://example.com/pdf"), type: "pdf" as const },
    ],
  };

  it("追跡用クエリ違い・# 違いの URL を同じ素材とみなす", () => {
    expect(findClipUrlEntry(index, { url: "https://example.com/article#intro" })?.fileId).toBe("a");
  });

  it("DOI が同じなら別 URL でも同じ素材（大文字小文字は見ない）", () => {
    expect(findClipUrlEntry(index, { url: "https://mirror.example/x", doi: "10.1000/xyz" })?.fileId).toBe("b");
  });

  it("URL 素材以外とは照合しない", () => {
    expect(findClipUrlEntry(index, { url: "https://example.com/pdf" })).toBeUndefined();
  });
});

describe("メモの本文と題", () => {
  it("既存の出典付きメモの書式（本文\\n\\n— 出典）にする", () => {
    expect(buildClipMemoText({ url: "https://e.com", title: " Page ", text: " sel " })).toBe("sel\n\n— Page");
  });

  it("題が無ければホストで呼ぶ", () => {
    expect(clipTitle({ url: "https://www.example.com/x", title: "  " })).toBe("www.example.com");
  });
});

describe("buildClipNoteDocument", () => {
  it("先頭にブックマーク、次に最初の引用。引用とメモの紐づけを memoQuotes に書き、フォルダに入れる", () => {
    const doc = buildClipNoteDocument({
      clip: { url: "https://example.com/a", title: "A page" },
      domain: "example.com",
      folder: "Web clips",
      memo,
      now: "2026-11-03T10:00:01Z",
    });
    expect(doc.title).toBe("A page");
    expect(doc.noteContexts).toEqual(["Web clips"]);
    const [bookmark, quote] = doc.pages[0].blocks;
    expect(bookmark.type).toBe("bookmark");
    expect(bookmark.props.url).toBe("https://example.com/a");
    expect(quote.type).toBe("quote");
    expect(doc.pages[0].memoQuotes?.[quote.id]).toEqual({
      captureId: "m1",
      quotedAt: "2026-11-03T10:00:01Z",
      quotedText: memo.text,
    });
  });

  it("範囲を選ばずにクリップしたときはブックマークだけ", () => {
    const doc = buildClipNoteDocument({ clip: { url: "https://e.com", title: "E" }, domain: "e.com", folder: "F" });
    expect(doc.pages[0].blocks).toHaveLength(1);
    expect(doc.pages[0].memoQuotes).toBeUndefined();
  });
});

describe("appendClipQuote", () => {
  const base = buildClipNoteDocument({ clip: { url: "https://e.com", title: "E" }, domain: "e.com", folder: "F" });

  it("末尾に引用を足し、元の文書は変えない", () => {
    const next = appendClipQuote(base, memo, "2026-11-03T11:00:00Z")!;
    expect(next.pages[0].blocks.map((b: any) => b.type)).toEqual(["bookmark", "quote"]);
    expect(base.pages[0].blocks).toHaveLength(1);
    expect(Object.values(next.pages[0].memoQuotes ?? {})[0].captureId).toBe("m1");
  });

  it("末尾が空の段落なら、その手前に入れる", () => {
    const withEmpty = {
      ...base,
      pages: [{ ...base.pages[0], blocks: [...base.pages[0].blocks, { id: "p", type: "paragraph", content: [], children: [] }] }],
    };
    const next = appendClipQuote(withEmpty, memo)!;
    expect(next.pages[0].blocks.map((b: any) => b.type)).toEqual(["bookmark", "quote", "paragraph"]);
  });

  it("前の引用の紐づけは残す", () => {
    const once = appendClipQuote(base, memo)!;
    const twice = appendClipQuote(once, { ...memo, id: "m2" })!;
    expect(Object.values(twice.pages[0].memoQuotes ?? {}).map((r) => r.captureId).sort()).toEqual(["m1", "m2"]);
  });

  it("空のメモなら null", () => {
    expect(appendClipQuote(base, { ...memo, text: "  " })).toBeNull();
  });
});
