import { describe, it, expect } from "vitest";
import {
  linkState,
  buildLinkedEntry,
  acceptLinkChange,
  addLinkedEntry,
  withPlaceName,
  withPlaceNameInIndex,
  LINK_HISTORY_MAX,
} from "./linked-entry";
import { createEmptyIndex, type MediaLink } from "../asset-browser/media-index";
import { isLinkedEntry } from "./link-url";

const link: MediaLink = { placeId: "p", relPath: "a/b.xlsx", size: 100, mtimeMs: 1000, recordedAt: "2026-11-01T00:00:00.000Z" };
const picked = { placeId: "p", relPath: "a/b.xlsx", name: "b.xlsx", size: 100, mtimeMs: 1000 };
const place = { id: "p", name: "共有ドライブ" };
const NOW = "2026-11-18T00:00:00.000Z";

describe("linkState", () => {
  it("同じ値なら ok", () => expect(linkState(link, { state: "ok", size: 100, mtimeMs: 1000 })).toBe("ok"));
  it("大きさが違えば changed", () => expect(linkState(link, { state: "ok", size: 101, mtimeMs: 1000 })).toBe("changed"));
  it("更新日時が違えば changed", () => expect(linkState(link, { state: "ok", size: 100, mtimeMs: 2000 })).toBe("changed"));
  it("missing / unreachable / unregistered はそのまま", () => {
    expect(linkState(link, { state: "missing" })).toBe("missing");
    expect(linkState(link, { state: "unreachable" })).toBe("unreachable");
    expect(linkState(link, { state: "unregistered" })).toBe("unregistered");
  });
});

describe("buildLinkedEntry", () => {
  it("索引では url の素材で、置き場の名前と場所を持つ", () => {
    const e = buildLinkedEntry({ picked, place, now: NOW, fileId: "url_1" });
    expect(e.type).toBe("url");
    expect(e.mimeType).toBe("text/x-uri");
    expect(e.thumbnailUrl).toBe("");
    expect(e.url).toBe("graphium-place://p/a/b.xlsx");
    expect(e.name).toBe("b.xlsx");
    expect(e.urlMeta).toEqual({ domain: "共有ドライブ", description: "a/b.xlsx" });
    expect(e.link).toEqual({ ...link, recordedAt: NOW });
    expect(isLinkedEntry(e)).toBe(true);
  });
  it("置き場の外のファイルは例外", () => {
    expect(() => buildLinkedEntry({ picked: { ...picked, placeId: null, relPath: null }, place, now: NOW, fileId: "x" })).toThrow();
  });
});

describe("acceptLinkChange", () => {
  it("いまの値を控え直し、前の値を履歴の先頭に積む", () => {
    const next = acceptLinkChange(link, { state: "ok", size: 200, mtimeMs: 2000 }, NOW);
    expect(next).toMatchObject({ size: 200, mtimeMs: 2000, recordedAt: NOW });
    expect(next.history).toEqual([{ size: 100, mtimeMs: 1000, recordedAt: link.recordedAt }]);
    const again = acceptLinkChange(next, { state: "ok", size: 300, mtimeMs: 3000 }, "2026-11-19T00:00:00.000Z");
    expect(again.history![0]).toEqual({ size: 200, mtimeMs: 2000, recordedAt: NOW });
    expect(again.history).toHaveLength(2);
  });
  it("履歴は 20 件で切れる", () => {
    let cur = link;
    for (let i = 1; i <= 25; i++) cur = acceptLinkChange(cur, { state: "ok", size: 100 + i, mtimeMs: 1000 + i }, NOW);
    expect(cur.history).toHaveLength(LINK_HISTORY_MAX);
    expect(cur.history![0].size).toBe(124);
  });
  it("ok でない・値が無いときは元の link を返す", () => {
    expect(acceptLinkChange(link, { state: "missing" }, NOW)).toBe(link);
    expect(acceptLinkChange(link, { state: "ok" }, NOW)).toBe(link);
  });
});

describe("addLinkedEntry", () => {
  it("同じ URL は二重に登録しない", () => {
    const e1 = buildLinkedEntry({ picked, place, now: NOW, fileId: "url_1" });
    const r1 = addLinkedEntry(createEmptyIndex(), e1);
    expect(r1.added).toBe(true);
    expect(r1.index.media).toHaveLength(1);
    const e2 = buildLinkedEntry({ picked, place, now: NOW, fileId: "url_2" });
    const r2 = addLinkedEntry(r1.index, e2);
    expect(r2.added).toBe(false);
    expect(r2.entry.fileId).toBe("url_1");
    expect(r2.index.media).toHaveLength(1);
  });
});

describe("withPlaceName", () => {
  it("urlMeta.domain だけ差し替える", () => {
    const e = buildLinkedEntry({ picked, place, now: NOW, fileId: "url_1" });
    const r = withPlaceName(e, "新しい名前");
    expect(r.urlMeta).toEqual({ domain: "新しい名前", description: "a/b.xlsx" });
    expect(e.urlMeta?.domain).toBe("共有ドライブ");
  });
});

describe("withPlaceNameInIndex", () => {
  it("その置き場のリンクした素材だけ置き場の名前を合わせる", () => {
    const a = buildLinkedEntry({ picked, place, now: NOW, fileId: "url_1" });
    const b = buildLinkedEntry({ picked: { ...picked, placeId: "q", relPath: "c.xlsx", name: "c.xlsx" }, place: { id: "q", name: "別の置き場" }, now: NOW, fileId: "url_2" });
    const index = { ...createEmptyIndex(), media: [a, b] };
    const { index: next, changed } = withPlaceNameInIndex(index, "p", "新しい名前");
    expect(changed).toBe(1);
    expect(next.media[0].urlMeta?.domain).toBe("新しい名前");
    expect(next.media[0].urlMeta?.description).toBe("a/b.xlsx");
    expect(next.media[1].urlMeta?.domain).toBe("別の置き場");
  });

  it("名前が同じなら何も変えない", () => {
    const a = buildLinkedEntry({ picked, place, now: NOW, fileId: "url_1" });
    const index = { ...createEmptyIndex(), media: [a] };
    const r = withPlaceNameInIndex(index, "p", "共有ドライブ");
    expect(r.changed).toBe(0);
    expect(r.index).toBe(index);
  });
});
