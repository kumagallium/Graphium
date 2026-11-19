import { describe, it, expect } from "vitest";
import {
  addLinkedOrigin,
  canHaveLinkedOrigin,
  changeLinkedOrigins,
  linkedOriginPlace,
  linkedOriginsOf,
  listOriginCandidates,
  removeLinkedOrigin,
} from "./link-origin";
import { buildPlaceUrl } from "./link-url";
import { canExpandOffice, canExtractEmbeddedImages, hasExpandedOffice, hasExtractedImages, type MediaIndex, type MediaIndexEntry } from "../asset-browser/media-index";

const base = { thumbnailUrl: "", uploadedAt: "2026-11-01T00:00:00.000Z", usedIn: [] };

function linked(fileId: string, over: Partial<MediaIndexEntry> = {}): MediaIndexEntry {
  const relPath = `raw/${fileId}.csv`;
  return {
    ...base,
    fileId,
    name: `${fileId}.csv`,
    type: "url",
    mimeType: "text/x-uri",
    url: buildPlaceUrl("p1", relPath),
    urlMeta: { domain: "共有ドライブ", description: relPath },
    link: { placeId: "p1", relPath, size: 1, mtimeMs: 1, recordedAt: "2026-11-01T00:00:00.000Z" },
    ...over,
  };
}
function plain(fileId: string, type: MediaIndexEntry["type"], over: Partial<MediaIndexEntry> = {}): MediaIndexEntry {
  return { ...base, fileId, name: fileId, type, mimeType: "x/y", url: `/m/${fileId}`, ...over };
}
const idx = (...media: MediaIndexEntry[]): MediaIndex => ({ version: 5, updatedAt: "2026-11-01T00:00:00.000Z", media }) as MediaIndex;

describe("canHaveLinkedOrigin", () => {
  it.each(["image", "pdf", "document", "data", "video", "audio"] as const)("%s は指定できる", (t) => {
    expect(canHaveLinkedOrigin(plain("a", t))).toBe(true);
  });
  it.each(["memo", "conversation", "other", "url"] as const)("%s は指定できない", (t) => {
    expect(canHaveLinkedOrigin(plain("a", t))).toBe(false);
  });
  it("リンクした素材は指定できない", () => {
    expect(canHaveLinkedOrigin(linked("l1"))).toBe(false);
  });
});

describe("listOriginCandidates / linkedOriginsOf", () => {
  it("候補はリンクした素材だけ。アーカイブ済みは出さない", () => {
    const index = idx(linked("l1"), linked("l2", { archivedAt: "2026-11-02T00:00:00.000Z" }), plain("d1", "data"), plain("b1", "url", { url: "https://x" }));
    expect(listOriginCandidates(index).map((m) => m.fileId)).toEqual(["l1"]);
  });
  it("指定済みは、リンクした素材の親だけ。索引に無い id・ほかの親は出さない", () => {
    const child = plain("d1", "data", { derivedFromAssets: ["l1", "gone", "pdf1"] });
    const index = idx(linked("l1"), plain("pdf1", "pdf"), child);
    expect(linkedOriginsOf(index, child).map((m) => m.fileId)).toEqual(["l1"]);
  });
  it("置き場の名前と場所を返す", () => {
    expect(linkedOriginPlace(linked("l1"))).toEqual({ placeName: "共有ドライブ", relPath: "raw/l1.csv" });
  });
});

describe("changeLinkedOrigins", () => {
  it("リンクした素材を足せて、索引の版や他の欄は変わらない", () => {
    const index = idx(linked("l1"), plain("d1", "data"));
    const r = addLinkedOrigin(index, "d1", "l1");
    expect(r.changed).toBe(true);
    expect(r.index.media.find((m) => m.fileId === "d1")!.derivedFromAssets).toEqual(["l1"]);
    expect(r.index.version).toBe(index.version);
    expect(index.media[1].derivedFromAssets).toBeUndefined();
  });
  it("同じ親を重ねて足さない（変化なしは同じ索引）", () => {
    const index = idx(linked("l1"), plain("d1", "data", { derivedFromAssets: ["l1"] }));
    const r = addLinkedOrigin(index, "d1", "l1");
    expect(r.changed).toBe(false);
    expect(r.index).toBe(index);
  });
  it("リンクした素材でない親・索引に無い親は足さない", () => {
    const index = idx(plain("pdf1", "pdf"), plain("d1", "data"));
    expect(addLinkedOrigin(index, "d1", "pdf1").changed).toBe(false);
    expect(addLinkedOrigin(index, "d1", "none").changed).toBe(false);
  });
  it("対象外の子（メモ・リンクした素材）には足さない", () => {
    const index = idx(linked("l1"), linked("l2"), plain("m1", "memo"));
    expect(addLinkedOrigin(index, "l2", "l1").changed).toBe(false);
    expect(addLinkedOrigin(index, "m1", "l1").changed).toBe(false);
  });
  it("外せるのはリンクした素材の親だけ。ほかの派生元は残る", () => {
    const index = idx(linked("l1"), plain("pdf1", "pdf"), plain("img", "image", { derivedFromAssets: ["pdf1", "l1"] }));
    expect(removeLinkedOrigin(index, "img", "pdf1").changed).toBe(false);
    const r = removeLinkedOrigin(index, "img", "l1");
    expect(r.index.media.find((m) => m.fileId === "img")!.derivedFromAssets).toEqual(["pdf1"]);
  });
  it("最後の 1 件を外すと欄ごと消える", () => {
    const index = idx(linked("l1"), plain("d1", "data", { derivedFromAssets: ["l1"] }));
    const r = changeLinkedOrigins(index, "d1", { remove: ["l1"] });
    expect("derivedFromAssets" in r.index.media.find((m) => m.fileId === "d1")!).toBe(false);
  });
  it("リンクした素材を親にしても、PDF・Office の抽出済み判定には掛からない", () => {
    const pdf = plain("pdf1", "pdf", { mimeType: "application/pdf" });
    const doc = plain("doc1", "document");
    const index = idx(linked("l1"), pdf, doc);
    const r = addLinkedOrigin(index, "pdf1", "l1");
    // PDF・Office を親にする素材は生まれない。親になるのは url（リンクした素材）だけで、抽出の対象でもない
    expect(hasExtractedImages(pdf, r.index)).toBe(false);
    expect(hasExpandedOffice(doc, r.index)).toBe(false);
    const parent = r.index.media.find((m) => m.fileId === "l1")!;
    expect(canExtractEmbeddedImages(parent)).toBe(false);
    expect(canExpandOffice(parent)).toBe(false);
  });
});
