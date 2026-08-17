// 望ましいソース一覧の導出テスト
// - ノート: ゴミ箱・アーカイブ・skill を除外し、ai エントリは wiki 扱い
// - 素材: 画像は OCR あり、URL は抜粋/説明あり、PDF は全部。アーカイブ除外
// - fingerprint はテキストが変われば変わる

import { describe, expect, it } from "vitest";
import type { NoteIndexEntry } from "../navigation/index-file";
import type { MediaIndexEntry } from "../asset-browser/media-index";
import { desiredAssetSources, desiredNoteSources, fnv1a } from "./sources";

const note = (over: Partial<NoteIndexEntry>): NoteIndexEntry =>
  ({ noteId: "n", title: "t", modifiedAt: "2026-01-01", headings: [], labels: [], outgoingLinks: [], ...over }) as NoteIndexEntry;
const media = (over: Partial<MediaIndexEntry>): MediaIndexEntry =>
  ({ fileId: "f", name: "file", type: "image", mimeType: "image/png", url: "u", uploadedAt: "2026-01-01", usedIn: [], ...over }) as MediaIndexEntry;

describe("desiredNoteSources", () => {
  it("ゴミ箱・アーカイブ・skill を除外し、ai は wiki になる", () => {
    const out = desiredNoteSources([
      note({ noteId: "a" }),
      note({ noteId: "b", deletedAt: "x" }),
      note({ noteId: "c", archivedAt: "x" }),
      note({ noteId: "d", source: "skill" }),
      note({ noteId: "e", source: "ai" }),
    ]);
    expect(out.map((d) => `${d.kind}:${d.sourceId}`)).toEqual(["note:a", "wiki:e"]);
  });
  it("fingerprint は modifiedAt とタイトルで変わる", () => {
    const [a] = desiredNoteSources([note({ noteId: "a", modifiedAt: "1", title: "x" })]);
    const [b] = desiredNoteSources([note({ noteId: "a", modifiedAt: "2", title: "x" })]);
    const [c] = desiredNoteSources([note({ noteId: "a", modifiedAt: "1", title: "y" })]);
    expect(a.fingerprint).not.toBe(b.fingerprint);
    expect(a.fingerprint).not.toBe(c.fingerprint);
  });
});

describe("desiredAssetSources", () => {
  it("画像は OCR あり、URL は抜粋/説明あり、PDF は全部。アーカイブは除外", () => {
    const { desired, plans, names } = desiredAssetSources([
      media({ fileId: "img1", ocrText: "温度 300K" }),
      media({ fileId: "img2" }),
      media({ fileId: "img3", ocrText: "x", archivedAt: "a" }),
      media({ fileId: "url1", type: "url", name: "example.com", urlMeta: { domain: "example.com", excerpt: "本文抜粋", description: "説明" } }),
      media({ fileId: "url2", type: "url", urlMeta: { domain: "example.com" } }),
      media({ fileId: "pdf1", type: "pdf", name: "paper.pdf", uploadedAt: "2026-02-02" }),
      media({ fileId: "vid", type: "video" }),
    ]);
    expect(desired.map((d) => d.sourceId)).toEqual(["img1", "url1", "pdf1"]);
    expect(plans.get("img1")).toEqual({ mode: "inline", text: "温度 300K" });
    expect(plans.get("url1")).toEqual({ mode: "inline", text: "本文抜粋\n\n説明" });
    expect(plans.get("pdf1")).toEqual({ mode: "pdf" });
    expect(names.get("pdf1")).toBe("paper.pdf");
    expect(desired.find((d) => d.sourceId === "pdf1")?.fingerprint).toBe("pdf:2026-02-02");
  });
  it("includePdf=false で PDF を外せる", () => {
    const { desired } = desiredAssetSources([media({ fileId: "pdf1", type: "pdf" })], { includePdf: false });
    expect(desired).toEqual([]);
  });
  it("fnv1a はテキストが変われば変わる", () => {
    expect(fnv1a("abc")).not.toBe(fnv1a("abd"));
    expect(fnv1a("abc")).toBe(fnv1a("abc"));
    expect(fnv1a("")).toMatch(/^[0-9a-f]{8}$/);
  });
});
