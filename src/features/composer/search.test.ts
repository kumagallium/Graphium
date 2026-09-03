import { describe, it, expect } from "vitest";
import {
  parseQuery,
  searchNotes,
  searchMedia,
  searchShared,
  sharedEntryTitle,
  buildOcrSnippet,
  type TextHit,
} from "./search";
import type { NoteIndexEntry } from "../navigation/index-file";
import type { MediaIndexEntry } from "../asset-browser/media-index";
import type { SharedEntry, SharedEntryType } from "../../lib/storage/shared";

function entry(partial: Partial<NoteIndexEntry> & { noteId: string; title: string }): NoteIndexEntry {
  return {
    noteId: partial.noteId,
    title: partial.title,
    modifiedAt: partial.modifiedAt ?? "2026-04-25T00:00:00.000Z",
    createdAt: partial.createdAt ?? "2026-04-01T00:00:00.000Z",
    headings: partial.headings ?? [],
    labels: partial.labels ?? [],
    outgoingLinks: partial.outgoingLinks ?? [],
    source: partial.source,
    wikiKind: partial.wikiKind,
    author: partial.author,
    model: partial.model,
  };
}

describe("parseQuery()", () => {
  it("splits free text from #label and @author tokens", () => {
    const r = parseQuery("XRD #手順 @claude");
    expect(r.text).toBe("XRD");
    expect(r.labelTokens).toEqual(["手順"]);
    expect(r.authorTokens).toEqual(["claude"]);
  });

  it("returns empty arrays when only free text", () => {
    const r = parseQuery("Hello world");
    expect(r.text).toBe("Hello world");
    expect(r.labelTokens).toEqual([]);
    expect(r.authorTokens).toEqual([]);
  });

  it("ignores stand-alone # / @", () => {
    const r = parseQuery("# @ hello");
    expect(r.text).toBe("# @ hello");
    expect(r.labelTokens).toEqual([]);
    expect(r.authorTokens).toEqual([]);
  });
});

describe("searchNotes()", () => {
  const notes: NoteIndexEntry[] = [
    entry({ noteId: "a", title: "XRD analysis standard procedure", modifiedAt: "2026-04-25T00:00:00.000Z", labels: [{ blockId: "1", label: "procedure", preview: "" }] }),
    entry({ noteId: "b", title: "Design notes", modifiedAt: "2026-04-20T00:00:00.000Z" }),
    entry({ noteId: "c", title: "XRD raw log 2026-04", modifiedAt: "2026-04-24T00:00:00.000Z" }),
    entry({ noteId: "d", title: "Claude session", modifiedAt: "2026-04-23T00:00:00.000Z", author: "kumagai", model: "claude-opus-4-7" }),
    entry({ noteId: "e", title: "Wiki page on XRD", modifiedAt: "2026-04-22T00:00:00.000Z", source: "ai", wikiKind: "claim" }),
    entry({ noteId: "f", title: "Misc", modifiedAt: "2026-04-21T00:00:00.000Z",
      headings: [{ blockId: "h1", text: "About XRD measurement", level: 2 }] }),
  ];

  it("returns recent notes for empty query", () => {
    const hits = searchNotes("", notes, { limit: 3 });
    expect(hits).toHaveLength(3);
    expect(hits[0].entry.noteId).toBe("a"); // 2026-04-25 latest
    expect(hits[1].entry.noteId).toBe("c"); // 2026-04-24
    expect(hits[2].entry.noteId).toBe("d"); // 2026-04-23
  });

  it("ranks title-prefix above title-contains", () => {
    const hits = searchNotes("xrd", notes);
    // "XRD analysis..." prefix-matches; others contain
    expect(hits[0].entry.noteId).toBe("a");
    expect(hits.map((h) => h.entry.noteId)).toContain("c");
    expect(hits.map((h) => h.entry.noteId)).toContain("e");
    expect(hits.map((h) => h.entry.noteId)).toContain("f");
  });

  it("supports heading match when title misses", () => {
    const hits = searchNotes("measurement", notes);
    expect(hits.map((h) => h.entry.noteId)).toContain("f");
    expect(hits.find((h) => h.entry.noteId === "f")?.reasons).toContain("heading");
  });

  it("filters by #label using core key", () => {
    const hits = searchNotes("#procedure", notes);
    expect(hits.map((h) => h.entry.noteId)).toEqual(["a"]);
  });

  it("filters by @author / model substring", () => {
    const hits = searchNotes("@claude", notes);
    expect(hits.map((h) => h.entry.noteId)).toEqual(["d"]);
  });

  it("combines free text + #label", () => {
    const hits = searchNotes("xrd #procedure", notes);
    expect(hits.map((h) => h.entry.noteId)).toEqual(["a"]);
  });

  it("excludes by includeSources option", () => {
    const hits = searchNotes("xrd", notes, { includeSources: ["human"] });
    expect(hits.map((h) => h.entry.noteId)).not.toContain("e");
  });

  it("returns empty when query has no matches", () => {
    const hits = searchNotes("zzz-no-match", notes);
    expect(hits).toEqual([]);
  });

  it("records titleMatches ranges for highlighting", () => {
    const hits = searchNotes("xrd", notes);
    const a = hits.find((h) => h.entry.noteId === "a")!;
    expect(a.titleMatches.length).toBeGreaterThan(0);
    expect(a.titleMatches[0]).toEqual({ start: 0, end: 3 });
  });

  // ── 本文（語彙インデックス）ヒットの注入 ──
  const snippet = (text: string) => ({ text, ranges: [{ start: 0, end: 2 }] });

  it("finds a note by body hit alone and carries the snippet + reason", () => {
    const bodyHits = new Map([["b", { score: 3, snippet: snippet("焼結温度は 800℃") }]]);
    const hits = searchNotes("焼結", notes, { bodyHits });
    expect(hits.map((h) => h.entry.noteId)).toEqual(["b"]);
    expect(hits[0].reasons).toEqual(["body"]);
    expect(hits[0].bodySnippet?.text).toBe("焼結温度は 800℃");
  });

  it("ranks title / heading hits above body-only hits, and adds the snippet to title hits too", () => {
    const bodyHits = new Map([
      ["b", { score: 5, snippet: snippet("body only") }],
      ["a", { score: 1, snippet: snippet("also in body") }],
    ]);
    const hits = searchNotes("xrd", notes, { bodyHits });
    const ids = hits.map((h) => h.entry.noteId);
    // タイトル一致（a, c, e）と見出し一致（f）が本文のみ（b）より上
    expect(ids.indexOf("b")).toBeGreaterThan(ids.indexOf("f"));
    const a = hits.find((h) => h.entry.noteId === "a")!;
    expect(a.reasons).toContain("title-prefix");
    expect(a.reasons).toContain("body");
    expect(a.bodySnippet?.text).toBe("also in body");
  });

  it("body hits still respect #label / @author filters and includeSources", () => {
    const bodyHits = new Map([
      ["b", { score: 3, snippet: snippet("x") }],
      ["e", { score: 3, snippet: snippet("x") }],
    ]);
    // b はラベル無し → #procedure で落ちる。e は ai だが includeSources 既定で許可
    expect(searchNotes("xrd #procedure", notes, { bodyHits }).map((h) => h.entry.noteId)).not.toContain("b");
    expect(searchNotes("zzz", notes, { bodyHits, includeSources: ["human"] }).map((h) => h.entry.noteId)).toEqual(["b"]);
  });

  it("scores body hits relatively — a stronger BM25 score ranks higher", () => {
    const bodyHits = new Map([
      ["b", { score: 1, snippet: snippet("weak") }],
      ["d", { score: 9, snippet: snippet("strong") }],
    ]);
    // 更新日は b(4/20) < d(4/23) だが、スコア差の方が大きい
    expect(searchNotes("zzz", notes, { bodyHits }).map((h) => h.entry.noteId)).toEqual(["d", "b"]);
  });
});

// ── 画像検索 ──

function media(
  partial: Partial<MediaIndexEntry> & { fileId: string; name: string },
): MediaIndexEntry {
  return {
    fileId: partial.fileId,
    name: partial.name,
    type: partial.type ?? "image",
    mimeType: partial.mimeType ?? "image/png",
    url: partial.url ?? `local-media://${partial.fileId}`,
    thumbnailUrl: partial.thumbnailUrl ?? `local-media://${partial.fileId}`,
    uploadedAt: partial.uploadedAt ?? "2026-04-20T00:00:00.000Z",
    usedIn: partial.usedIn ?? [],
    ocrText: partial.ocrText,
    archivedAt: partial.archivedAt,
  };
}

describe("buildOcrSnippet()", () => {
  it("returns undefined when the needle is absent", () => {
    expect(buildOcrSnippet("焼結温度 800℃", "XRD")).toBeUndefined();
  });

  it("flattens newlines into a single line", () => {
    const snip = buildOcrSnippet("焼結温度\n800℃\tで 2 時間", "800")!;
    expect(snip.text).toBe("焼結温度 800℃ で 2 時間");
    expect(snip.text.slice(snip.start, snip.end)).toBe("800");
  });

  it("adds ellipses on the trimmed sides and keeps the match range accurate", () => {
    const long = `${"あ".repeat(80)}XRD${"い".repeat(80)}`;
    const snip = buildOcrSnippet(long, "XRD")!;
    expect(snip.text.startsWith("…")).toBe(true);
    expect(snip.text.endsWith("…")).toBe(true);
    expect(snip.text.slice(snip.start, snip.end)).toBe("XRD");
  });

  it("omits the leading ellipsis when the match is at the start", () => {
    const snip = buildOcrSnippet("XRD の測定結果", "XRD")!;
    expect(snip.text.startsWith("…")).toBe(false);
    expect(snip.start).toBe(0);
  });
});

describe("searchMedia()", () => {
  const assets: MediaIndexEntry[] = [
    media({ fileId: "img-1", name: "scan-01.png", ocrText: "焼結温度 800℃ で 2 時間 保持" }),
    media({ fileId: "img-2", name: "XRD-pattern.png", ocrText: "2θ = 28.4°" }),
    media({ fileId: "img-3", name: "photo.jpg" }),
    media({ fileId: "pdf-1", name: "焼結の論文.pdf", type: "pdf", mimeType: "application/pdf" }),
    media({
      fileId: "img-old",
      name: "焼結-old.png",
      ocrText: "焼結温度 700℃",
      archivedAt: "2026-04-01T00:00:00.000Z",
    }),
  ];

  it("finds images by the text inside them", () => {
    const hits = searchMedia("焼結温度", assets);
    expect(hits.map((h) => h.entry.fileId)).toEqual(["img-1"]);
    expect(hits[0].reasons).toContain("ocr");
    expect(hits[0].ocrSnippet?.text).toContain("焼結温度");
  });

  it("finds images by file name", () => {
    const hits = searchMedia("XRD", assets);
    expect(hits.map((h) => h.entry.fileId)).toEqual(["img-2"]);
    expect(hits[0].reasons).toContain("name-prefix");
    expect(hits[0].nameMatches[0]).toEqual({ start: 0, end: 3 });
  });

  it("ranks a file-name hit above an OCR-only hit", () => {
    const nameHit = media({ fileId: "n", name: "焼結.png" });
    const ocrHit = media({ fileId: "o", name: "a.png", ocrText: "焼結温度" });
    const hits = searchMedia("焼結", [ocrHit, nameHit]);
    expect(hits.map((h) => h.entry.fileId)).toEqual(["n", "o"]);
  });

  it("finds non-image assets (PDF / URL / document) by name", () => {
    const hits = searchMedia("焼結", assets);
    expect(hits.map((h) => h.entry.fileId)).toContain("pdf-1");
    expect(hits.find((h) => h.entry.fileId === "pdf-1")?.reasons).toContain("name-prefix");
  });

  it("leaves video / audio / memo out (name-only types are not worth a row)", () => {
    const hits = searchMedia("焼結", [
      media({ fileId: "v", name: "焼結.mp4", type: "video", mimeType: "video/mp4" }),
      media({ fileId: "m", name: "焼結メモ", type: "memo", mimeType: "text/plain" }),
    ]);
    expect(hits).toEqual([]);
  });

  it("finds assets by indexed text (assetHits) and carries the snippet", () => {
    const assetHits = new Map([
      ["pdf-1", { score: 4, snippet: { text: "…焼結温度 800℃ で…", ranges: [{ start: 1, end: 5 }] } }],
    ]);
    const hits = searchMedia("温度", assets, { assetHits });
    const pdf = hits.find((h) => h.entry.fileId === "pdf-1")!;
    expect(pdf.reasons).toContain("text");
    expect(pdf.textSnippet?.text).toContain("焼結温度");
    // 画像 img-1 は OCR 部分一致（40）、pdf はテキストヒット（25 + 相対 ≤ 10）→ 画像が上
    expect(hits.map((h) => h.entry.fileId).indexOf("img-1")).toBeLessThan(hits.map((h) => h.entry.fileId).indexOf("pdf-1"));
  });

  it("does not surface archived assets even when the index has a hit", () => {
    const assetHits = new Map([["img-old", { score: 4, snippet: { text: "x", ranges: [] } }]]);
    expect(searchMedia("温度", assets, { assetHits }).map((h) => h.entry.fileId)).not.toContain("img-old");
  });

  it("hides archived images", () => {
    const hits = searchMedia("焼結", assets);
    expect(hits.map((h) => h.entry.fileId)).not.toContain("img-old");
  });

  it("returns nothing for an empty query", () => {
    expect(searchMedia("", assets)).toEqual([]);
    expect(searchMedia("   ", assets)).toEqual([]);
  });

  it("returns nothing when the query filters notes by #label or @author", () => {
    expect(searchMedia("焼結 #手順", assets)).toEqual([]);
    expect(searchMedia("焼結 @claude", assets)).toEqual([]);
  });

  it("respects the limit option", () => {
    const many = Array.from({ length: 10 }, (_, i) =>
      media({ fileId: `m${i}`, name: `scan-${i}.png`, ocrText: "焼結温度" }),
    );
    expect(searchMedia("焼結", many, { limit: 2 })).toHaveLength(2);
    expect(searchMedia("焼結", many)).toHaveLength(4);
  });

  it("returns empty for a null index", () => {
    expect(searchMedia("焼結", null)).toEqual([]);
  });
});

// ── 共有ライブラリ検索 ──

function shared(
  partial: Partial<SharedEntry> & { id: string; type?: SharedEntryType } & {
    title?: string;
    authorName?: string;
    authorEmail?: string;
  },
): SharedEntry {
  const { title, authorName, authorEmail, id, ...rest } = partial;
  return {
    id,
    type: partial.type ?? "note",
    author: partial.author ?? {
      name: authorName ?? "Tanaka",
      email: authorEmail ?? `${(authorName ?? "Tanaka").toLowerCase()}@example.com`,
    },
    created_at: partial.created_at ?? "2026-04-01T00:00:00.000Z",
    // 直近ボーナス（daysAgoBoost）が乗らない十分昔の日付にして、スコア比較を安定させる
    updated_at: partial.updated_at ?? "2026-04-25T00:00:00.000Z",
    hash: partial.hash ?? `hash-${partial.id}`,
    prov: partial.prov ?? { derived_from: [] },
    ...rest,
    extra: { ...(title !== undefined ? { title } : {}), ...(partial.extra ?? {}) },
  };
}

function textHit(score: number, text: string): TextHit {
  return { score, snippet: { text, ranges: [] } };
}

describe("sharedEntryTitle()", () => {
  it("uses extra.title", () => {
    expect(sharedEntryTitle(shared({ id: "a", title: " 焼結の手順 " }))).toBe("焼結の手順");
  });

  it("falls back to the original file name (assets carry no title)", () => {
    const entry = shared({
      id: "a",
      type: "data-manifest",
      extra: { original_filename: "XRD-pattern.csv" },
    });
    expect(sharedEntryTitle(entry)).toBe("XRD-pattern.csv");
  });
});

describe("searchShared()", () => {
  const entries: SharedEntry[] = [
    shared({ id: "s-note", title: "焼結の手順", authorName: "Tanaka" }),
    shared({ id: "s-knowledge", type: "knowledge", title: "セラミックスの焼結温度", authorName: "Suzuki" }),
    shared({
      id: "s-ref",
      type: "reference",
      title: "Sintering review",
      authorName: "Suzuki",
      extra: { url: "https://example.com/sintering" },
    }),
    shared({ id: "s-other", title: "XRD の測定条件", authorName: "Tanaka" }),
  ];

  it("ranks a title-prefix hit above a title-contains hit", () => {
    const hits = searchShared("焼結", entries);
    expect(hits.map((h) => h.entry.id)).toEqual(["s-note", "s-knowledge"]);
    expect(hits[0].reasons).toContain("title-prefix");
    expect(hits[1].reasons).toContain("title-contains");
  });

  it("records titleMatches ranges for highlighting", () => {
    const [hit] = searchShared("温度", entries);
    expect(hit.entry.id).toBe("s-knowledge");
    expect(hit.titleMatches).toEqual([{ start: 9, end: 11 }]);
  });

  it("filters by @author (display name or email)", () => {
    // 同点なので順序は保証しない（作者フィルタだけのクエリは「誰の共有物か」の一覧）
    expect(searchShared("@suzuki", entries).map((h) => h.entry.id).sort()).toEqual([
      "s-knowledge",
      "s-ref",
    ]);
    expect(searchShared("@example.com", entries)).toHaveLength(4);
  });

  it("combines free text with @author — the filter narrows, the text ranks", () => {
    // searchNotes と同じ扱い: 作者フィルタが効いているときのフリーテキストは
    // 足切りではなく加点（その人の共有物一覧を出しつつ、当たったものを上に出す）
    const hits = searchShared("焼結 @tanaka", entries);
    expect(hits.map((h) => h.entry.id)).toEqual(["s-note", "s-other"]);
    expect(hits[0].reasons).toEqual(expect.arrayContaining(["author", "title-prefix"]));
    expect(hits[1].reasons).toEqual(["author"]);
  });

  it("finds an entry by a body hit alone and carries the snippet + reason", () => {
    const hits = searchShared("焼結", entries, {
      sharedHits: new Map([["s-other", textHit(4, "…焼結体の XRD…")]]),
    });
    const ids = hits.map((h) => h.entry.id);
    expect(ids).toContain("s-other");
    const hit = hits.find((h) => h.entry.id === "s-other")!;
    expect(hit.reasons).toEqual(["body"]);
    expect(hit.bodySnippet?.text).toBe("…焼結体の XRD…");
    // 題名ヒットより下（本文だけのヒットは弱い）
    expect(ids[0]).toBe("s-note");
  });

  it("returns nothing for an empty query", () => {
    expect(searchShared("   ", entries)).toEqual([]);
  });

  it("returns nothing when the query filters notes by #label (shared entries have no labels)", () => {
    expect(searchShared("焼結 #手順", entries)).toEqual([]);
  });

  it("leaves out types that are not indexed (template / report)", () => {
    const withTemplate = [
      ...entries,
      shared({ id: "s-template", type: "template", title: "焼結テンプレート" }),
      shared({ id: "s-report", type: "report", title: "焼結レポート" }),
    ];
    expect(searchShared("焼結", withTemplate).map((h) => h.entry.id)).toEqual([
      "s-note",
      "s-knowledge",
    ]);
  });

  it("leaves out tombstones (unshared entries)", () => {
    const withTombstone = [
      ...entries,
      shared({ id: "s-gone", title: "焼結の下書き", status: "unshared" }),
    ];
    expect(searchShared("焼結", withTombstone).map((h) => h.entry.id)).not.toContain("s-gone");
  });

  it("respects the limit option", () => {
    expect(searchShared("焼結", entries, { limit: 1 })).toHaveLength(1);
  });

  it("returns empty for a missing library", () => {
    expect(searchShared("焼結", null)).toEqual([]);
    expect(searchShared("焼結", [])).toEqual([]);
  });
});
