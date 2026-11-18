import { describe, it, expect } from "vitest";
import { buildPlaceUrl, parsePlaceUrl, isPlaceUrl, isLinkedEntry, PLACE_URL_SCHEME } from "./link-url";
import type { MediaIndexEntry } from "../asset-browser/media-index";

describe("buildPlaceUrl / parsePlaceUrl", () => {
  it.each([
    "a.txt",
    "測定/2026 年/データ 1.xlsx",
    "dir/a#b.csv",
    "dir/100%.csv",
    "x y/%41/#/?.md",
  ])("往復で元に戻る: %s", (rel) => {
    const url = buildPlaceUrl("p-1", rel);
    expect(url.startsWith(PLACE_URL_SCHEME)).toBe(true);
    expect(parsePlaceUrl(url)).toEqual({ placeId: "p-1", relPath: rel });
  });

  it("区切りの / は残し、各区切りだけエンコードする", () => {
    expect(buildPlaceUrl("p", "a b/c#d")).toBe("graphium-place://p/a%20b/c%23d");
  });

  it.each([
    ["スキーム違い", "https://p/a.txt"],
    ["placeId が空", "graphium-place:///a.txt"],
    ["relPath が空", "graphium-place://p/"],
    ["relPath が無い", "graphium-place://p"],
    ["デコード失敗", "graphium-place://p/%E0%A4%A"],
    [".. を含む", "graphium-place://p/a/../b"],
    ["エンコードされた ..", "graphium-place://p/a/%2e%2e/b"],
    ["空の区切り", "graphium-place://p/a//b"],
    ["エンコードされた区切り", "graphium-place://p/a%2Fb"],
  ])("null になる: %s", (_n, url) => {
    expect(parsePlaceUrl(url)).toBeNull();
    expect(isPlaceUrl(url)).toBe(false);
  });
});

describe("isLinkedEntry", () => {
  const base = {
    fileId: "u", name: "a", type: "url", mimeType: "text/x-uri", url: "graphium-place://p/a.txt",
    thumbnailUrl: "", uploadedAt: "", usedIn: [],
    link: { placeId: "p", relPath: "a.txt", size: 1, mtimeMs: 1, recordedAt: "" },
  } as MediaIndexEntry;
  it("type・link・URL がそろうと true", () => expect(isLinkedEntry(base)).toBe(true));
  it("link が無ければ false", () => expect(isLinkedEntry({ ...base, link: undefined })).toBe(false));
  it("Web の URL なら false", () => expect(isLinkedEntry({ ...base, url: "https://example.com/" })).toBe(false));
  it("type が url でなければ false", () => expect(isLinkedEntry({ ...base, type: "pdf" })).toBe(false));
});
