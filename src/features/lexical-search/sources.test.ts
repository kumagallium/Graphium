// 望ましいソース一覧の導出テスト
// - ノート: ゴミ箱・アーカイブ・skill を除外し、ai エントリは wiki 扱い
// - 素材: 画像は OCR あり、URL は抜粋/説明あり、PDF は全部。アーカイブ除外
// - fingerprint はテキストが変われば変わる

import { describe, expect, it } from "vitest";
import type { NoteIndexEntry } from "../navigation/index-file";
import type { MediaIndexEntry } from "../asset-browser/media-index";
import type { SharedEntry } from "../../lib/storage/shared";
import { desiredAssetSources, desiredNoteSources, desiredSharedSources, fnv1a } from "./sources";

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

describe("desiredSharedSources", () => {
  const shared = (over: Partial<SharedEntry>): SharedEntry =>
    ({
      id: "s1",
      type: "note",
      author: { name: "Ada", email: "a@b.co" },
      created_at: "2026-01-01",
      updated_at: "2026-01-02",
      hash: "sha256:1",
      prov: { derived_from: [] },
      ...over,
    }) as SharedEntry;

  it("note / knowledge / reference / data-manifest が対象。template・report は外す", () => {
    const out = desiredSharedSources([
      shared({ id: "n", type: "note" }),
      shared({ id: "k", type: "knowledge" }),
      shared({ id: "r", type: "reference" }),
      shared({ id: "d", type: "data-manifest" }),
      shared({ id: "t", type: "template" }),
      shared({ id: "p", type: "report" }),
    ]);
    expect(out.map((d) => d.sourceId)).toEqual(["n", "k", "r", "d"]);
    expect(out.every((d) => d.kind === "shared")).toBe(true);
  });

  it("fingerprint は hash と type（hash が変われば索引し直す）", () => {
    const [a] = desiredSharedSources([shared({ hash: "sha256:1", type: "note" })]);
    const [b] = desiredSharedSources([shared({ hash: "sha256:2", type: "note" })]);
    const [c] = desiredSharedSources([shared({ hash: "sha256:1", type: "knowledge" })]);
    expect(a.fingerprint).toBe("sha256:1|note");
    expect(a.fingerprint).not.toBe(b.fingerprint);
    expect(a.fingerprint).not.toBe(c.fingerprint);
  });

  it("空一覧は空（スイッチ OFF / ルート未設定のときの掃除に使う）", () => {
    expect(desiredSharedSources([])).toEqual([]);
  });
});
