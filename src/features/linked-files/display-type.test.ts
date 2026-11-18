import { describe, it, expect } from "vitest";
import { displayTypeOf, displayMimeOf, isInMediaList, resolvePickerDisplayMode } from "./display-type";
import { buildLinkedEntry } from "./linked-entry";
import { buildPlaceUrl } from "./link-url";
import { countByType, createEmptyIndex, type MediaIndexEntry } from "../asset-browser/media-index";

const NOW = "2026-11-18T00:00:00.000Z";

function linked(name: string, id = name): MediaIndexEntry {
  return buildLinkedEntry({
    picked: { placeId: "p", relPath: `dir/${name}`, name, size: 1, mtimeMs: 1 },
    place: { id: "p", name: "共有" },
    now: NOW,
    fileId: `url_${id}`,
  });
}

function plain(type: MediaIndexEntry["type"], name = "x"): MediaIndexEntry {
  return { fileId: `f_${name}`, name, type, mimeType: "", url: "u", thumbnailUrl: "", uploadedAt: NOW, usedIn: [] };
}

describe("displayTypeOf", () => {
  it.each([
    ["a.pdf", "pdf"],
    ["a.docx", "document"],
    ["a.xlsx", "document"],
    ["a.pptx", "document"],
    ["a.csv", "data"],
    ["a.tsv", "data"],
    ["a.png", "image"],
    ["a.jpg", "image"],
    ["a.mp4", "video"],
    ["a.mp3", "audio"],
    ["A.PDF", "pdf"],
    ["B.CSV", "data"],
    ["C.JPG", "image"],
    ["noext", "url"],
    ["a.unknownext", "url"],
    ["a.zip", "url"],
  ])("リンクした %s は %s の一覧", (name, expected) => {
    expect(displayTypeOf(linked(name))).toBe(expected);
  });

  it("リンクでない素材は type のまま", () => {
    expect(displayTypeOf(plain("url", "a.pdf"))).toBe("url");
    expect(displayTypeOf(plain("pdf", "b"))).toBe("pdf");
    expect(displayTypeOf(plain("data", "b"))).toBe("data");
  });

  it("控えが壊れた置き場の URL のエントリは url", () => {
    const e = { ...linked("a.pdf"), link: undefined };
    expect(displayTypeOf(e)).toBe("url");
    const mismatch = { ...linked("a.pdf"), url: buildPlaceUrl("other", "dir/a.pdf") };
    expect(displayTypeOf(mismatch)).toBe("url");
  });

  it("MIME は拡張子から補う（Word 絞り込み用）", () => {
    expect(displayMimeOf(linked("a.docx"))).toContain("wordprocessingml");
    expect(displayMimeOf(plain("pdf", "z"))).toBe("");
  });
});

describe("件数（countByType に displayTypeOf を渡す）", () => {
  it("リンクした PDF はドキュメント側（pdf）に数え、URL 側に数えない", () => {
    const index = { ...createEmptyIndex(), media: [linked("a.pdf"), linked("b.csv"), linked("c.zip"), plain("url", "web")] };
    const counts = countByType(index, displayTypeOf);
    expect(counts.pdf).toBe(1);
    expect(counts.data).toBe(1);
    expect(counts.url).toBe(2);
    // 既定（type のまま）では全部 URL
    expect(countByType(index).url).toBe(4);
  });
});

describe("isInMediaList（一覧の絞り込み）", () => {
  it("ドキュメントの一覧にリンクした PDF・Word が出て、URL の一覧には出ない", () => {
    const pdf = linked("a.pdf");
    const docx = linked("a.docx");
    expect(isInMediaList(pdf, "document")).toBe(true);
    expect(isInMediaList(docx, "document")).toBe(true);
    expect(isInMediaList(pdf, "url")).toBe(false);
    expect(isInMediaList(docx, "url")).toBe(false);
    expect(isInMediaList(pdf, "image")).toBe(false);
  });

  it("種類が決まらないリンクは URL の一覧に残る", () => {
    expect(isInMediaList(linked("a.zip"), "url")).toBe(true);
    expect(isInMediaList(linked("a.zip"), "document")).toBe(false);
  });

  it("ふつうの素材は従来どおり", () => {
    expect(isInMediaList(plain("pdf"), "document")).toBe(true);
    expect(isInMediaList(plain("url"), "url")).toBe(true);
    expect(isInMediaList(plain("image"), "image")).toBe(true);
  });
});

describe("resolvePickerDisplayMode（ピッカーの挿入の形）", () => {
  it("リンクした CSV は embed を求められても link（中身を読む取り込みに入らない）", () => {
    expect(resolvePickerDisplayMode(linked("a.csv"), "embed")).toBe("link");
    expect(resolvePickerDisplayMode(linked("a.png"), "embed")).toBe("link");
  });
  it("控えが壊れた置き場の URL も link", () => {
    expect(resolvePickerDisplayMode({ ...linked("a.csv"), link: undefined }, "embed")).toBe("link");
  });
  it("ふつうの素材は求められた形のまま", () => {
    expect(resolvePickerDisplayMode(plain("data", "a.csv"), "embed")).toBe("embed");
    expect(resolvePickerDisplayMode(plain("data", "a.csv"), "link")).toBe("link");
  });
});
