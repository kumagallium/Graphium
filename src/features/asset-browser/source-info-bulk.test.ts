// 一括「DOI から補完」: 対象の選び方・人の入力を残す重ね方・まとめて保存・通信できないときの打ち切り

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { MediaIndexEntry, SourceInfo } from "./media-index";
import { applyCrossrefResult, isSourceLookupTarget, runBulkSourceLookup } from "./source-info-bulk";

const persisted = vi.hoisted(() => ({ calls: [] as Map<string, SourceInfo | undefined>[] }));
const pdfSource = vi.hoisted(() => ({ value: undefined as SourceInfo | undefined }));

vi.mock("./media-index", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./media-index")>();
  return {
    ...actual,
    persistSourceInfoPatches: vi.fn(async (patches: Map<string, SourceInfo | undefined>) => {
      persisted.calls.push(new Map(patches));
    }),
  };
});
vi.mock("./source-info", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./source-info")>();
  return { ...actual, extractPdfSourceInfo: vi.fn(async () => pdfSource.value) };
});

function entry(over: Partial<MediaIndexEntry> & { fileId: string }): MediaIndexEntry {
  return {
    name: `${over.fileId}.pdf`,
    type: "pdf",
    mimeType: "application/pdf",
    url: `local-media://${over.fileId}`,
    thumbnailUrl: "",
    uploadedAt: "2026-08-01T00:00:00.000Z",
    usedIn: [],
    ...over,
  };
}

/** DOI ごとに応答を決める fetch（404 は Crossref に無い・"down" は通信できない） */
function crossref(byDoi: Record<string, { family: string; year: number } | 404 | "down">) {
  return vi.fn(async (url: string) => {
    const doi = decodeURIComponent(String(url).split("/works/")[1]);
    const r = byDoi[doi];
    if (r === "down" || r === undefined) throw new TypeError("Failed to fetch");
    if (r === 404) return new Response("", { status: 404 });
    return new Response(
      JSON.stringify({
        message: {
          author: [{ given: "A", family: r.family }],
          "container-title": ["Journal"],
          issued: { "date-parts": [[r.year]] },
        },
      }),
      { status: 200 },
    );
  }) as unknown as typeof fetch;
}

const readBytes = async () => new Uint8Array([1]);

beforeEach(() => {
  persisted.calls = [];
  pdfSource.value = undefined;
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

describe("isSourceLookupTarget", () => {
  it.each<[string, Partial<MediaIndexEntry>, boolean]>([
    ["DOI があり未補完", { sourceInfo: { doi: "10.1000/aaa", origin: "file" } }, true],
    ["手入力の DOI", { sourceInfo: { doi: "10.1000/aaa", origin: "manual" } }, true],
    ["Crossref で補完済み", { sourceInfo: { doi: "10.1000/aaa", origin: "crossref" } }, false],
    ["中をまだ読んでいない PDF", {}, true],
    ["中を読んで DOI が無かった PDF", { sourceInfoScanned: true }, false],
    ["DOI の無い URL", { type: "url", mimeType: "text/html" }, false],
    ["DOI のある URL", { type: "url", mimeType: "text/html", sourceInfo: { doi: "10.1000/aaa" } }, true],
    ["画像", { type: "image", mimeType: "image/png", sourceInfo: { doi: "10.1000/aaa" } }, false],
  ])("%s -> %s", (_label, over, expected) => {
    expect(isSourceLookupTarget(entry({ fileId: "x", ...over }))).toBe(expected);
  });
});

describe("applyCrossrefResult", () => {
  const fetched: SourceInfo = { authors: ["From Crossref"], year: 2020, venue: "J", doi: "10.1000/aaa", origin: "crossref" };

  it("ファイル由来は Crossref で置き換える", () => {
    expect(applyCrossrefResult({ authors: ["Meta Author"], doi: "10.1000/aaa", origin: "file" }, fetched)).toEqual(fetched);
  });

  it("手入力は残し、空いている項目だけ埋める", () => {
    expect(applyCrossrefResult({ authors: ["Typed"], doi: "10.1000/aaa", origin: "manual" }, fetched)).toEqual({
      authors: ["Typed"],
      year: 2020,
      venue: "J",
      doi: "10.1000/aaa",
      origin: "manual",
    });
  });
});

describe("runBulkSourceLookup", () => {
  it("DOI ごとに補完し、DOI 無し・該当無しを数える", async () => {
    const entries = [
      entry({ fileId: "ok", sourceInfo: { doi: "10.1000/ok", origin: "file" } }),
      entry({ fileId: "missing", sourceInfo: { doi: "10.1000/missing", origin: "file" } }),
      entry({ fileId: "nodoi" }),
    ];
    const result = await runBulkSourceLookup(entries, {
      readBytes,
      fetchImpl: crossref({ "10.1000/ok": { family: "Okada", year: 2026 }, "10.1000/missing": 404 }),
    });
    expect(result).toEqual({ total: 3, done: 3, filled: 1, noDoi: 1, notFound: 1, failed: 0 });
    const saved = persisted.calls.flatMap((m) => [...m.entries()]);
    expect(saved).toEqual([
      ["ok", { authors: ["A Okada"], year: 2026, venue: "Journal", doi: "10.1000/ok", origin: "crossref" }],
    ]);
  });

  it("DOI の無い PDF は、先にファイルの中で DOI を探してから問い合わせる", async () => {
    pdfSource.value = { authors: ["Meta"], doi: "10.1000/infile", origin: "file" };
    const fetchImpl = crossref({ "10.1000/infile": { family: "Lee", year: 2019 } });
    const result = await runBulkSourceLookup([entry({ fileId: "p" })], { readBytes, fetchImpl });
    expect(result.filled).toBe(1);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(persisted.calls.flatMap((m) => [...m.values()])).toEqual([
      { authors: ["A Lee"], year: 2019, venue: "Journal", doi: "10.1000/infile", origin: "crossref" },
    ]);
  });

  it("ファイルの中に著者だけあれば、問い合わせなくてもそれは残す", async () => {
    pdfSource.value = { authors: ["Only Author"], origin: "file" };
    const fetchImpl = crossref({});
    const result = await runBulkSourceLookup([entry({ fileId: "p" })], { readBytes, fetchImpl });
    expect(result.noDoi).toBe(1);
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(persisted.calls.flatMap((m) => [...m.values()])).toEqual([{ authors: ["Only Author"], origin: "file" }]);
  });

  it("保存はまとめて行う", async () => {
    const entries = Array.from({ length: 5 }, (_, i) =>
      entry({ fileId: `e${i}`, sourceInfo: { doi: `10.1000/e${i}`, origin: "file" } }),
    );
    const byDoi = Object.fromEntries(entries.map((e, i) => [`10.1000/e${i}`, { family: `F${i}`, year: 2000 + i }]));
    await runBulkSourceLookup(entries, { readBytes, fetchImpl: crossref(byDoi), flushEvery: 2 });
    expect(persisted.calls.map((m) => m.size)).toEqual([2, 2, 1]);
  });

  it("続けて届かなければ、残りを 1 件ずつ待たずにやめる", async () => {
    const entries = Array.from({ length: 6 }, (_, i) =>
      entry({ fileId: `e${i}`, sourceInfo: { doi: `10.1000/e${i}`, origin: "file" } }),
    );
    const fetchImpl = crossref({});
    const result = await runBulkSourceLookup(entries, { readBytes, fetchImpl });
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(result).toMatchObject({ total: 6, done: 6, filled: 0, failed: 6 });
  });

  it("進み具合を 1 件ごとに知らせる", async () => {
    const seen: number[] = [];
    await runBulkSourceLookup([entry({ fileId: "a" }), entry({ fileId: "b" })], {
      readBytes,
      fetchImpl: crossref({}),
      onProgress: (p) => seen.push(p.done),
    });
    expect(seen).toEqual([1, 2, 2]);
  });
});
