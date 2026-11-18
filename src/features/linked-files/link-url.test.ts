import { describe, it, expect } from "vitest";
import { buildPlaceUrl, parsePlaceUrl, isPlaceUrl, isLinkedEntry, isValidMediaLink, sanitizeMediaLink, PLACE_URL_SCHEME } from "./link-url";
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

describe("isLinkedEntry（細工した控えを通さない）", () => {
  const good = { placeId: "p", relPath: "a.txt", size: 1, mtimeMs: 1, recordedAt: "x" };
  const mk = (link: unknown, url = "graphium-place://p/a.txt") =>
    ({ fileId: "u", name: "a", type: "url", mimeType: "text/x-uri", url, thumbnailUrl: "", uploadedAt: "", usedIn: [], link }) as unknown as MediaIndexEntry;
  it("正しい控えは true", () => expect(isLinkedEntry(mk(good))).toBe(true));
  it("link が {} なら false", () => expect(isLinkedEntry(mk({}))).toBe(false));
  it("relPath が数値なら false", () => expect(isLinkedEntry(mk({ ...good, relPath: 5 }))).toBe(false));
  it("size が NaN なら false", () => expect(isLinkedEntry(mk({ ...good, size: NaN }))).toBe(false));
  it("URL と控えの relPath が食い違えば false", () =>
    expect(isLinkedEntry(mk({ ...good, relPath: "b.txt" }))).toBe(false));
  it("URL と控えの placeId が食い違えば false", () =>
    expect(isLinkedEntry(mk({ ...good, placeId: "q" }))).toBe(false));
  it("履歴の要素が壊れていれば false", () =>
    expect(isLinkedEntry(mk({ ...good, history: [{ size: "x" }] }))).toBe(false));
  it("isPlaceUrl は控えを見ない（Web として扱わない判定は変えない）", () =>
    expect(isPlaceUrl("graphium-place://p/a.txt")).toBe(true));
});

describe("isValidMediaLink / sanitizeMediaLink", () => {
  const good = { placeId: "p", relPath: "a.txt", size: 1, mtimeMs: 1, recordedAt: "x" };
  const snap = (i: number) => ({ size: i, mtimeMs: i, recordedAt: String(i) });
  it("履歴が配列でなければ無効", () => expect(isValidMediaLink({ ...good, history: "x" })).toBe(false));
  it("placeId が空なら無効・null にする", () => {
    expect(isValidMediaLink({ ...good, placeId: "" })).toBe(false);
    expect(sanitizeMediaLink({ ...good, placeId: "" })).toBeNull();
  });
  it("壊れた履歴を落とし、20 件で切る", () => {
    const history = [...Array.from({ length: 25 }, (_, i) => snap(i)), { size: "x" }, null];
    const out = sanitizeMediaLink({ ...good, history })!;
    expect(out.history).toHaveLength(20);
    expect(out.history![0]).toEqual(snap(0));
    const mixed = sanitizeMediaLink({ ...good, history: [{ bad: 1 }, snap(1)] })!;
    expect(mixed.history).toEqual([snap(1)]);
  });
  it("履歴が無ければ付けない", () => expect(sanitizeMediaLink(good)).toEqual(good));
});
