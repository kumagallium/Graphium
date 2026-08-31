import { describe, it, expect } from "vitest";
import { getAssetSuggestions, getNoteSuggestions, resolveMentionTargetFromLinks } from "./mention-menu";
import type { GraphiumIndex, NoteIndexEntry } from "../navigation/index-file";

function note(
  noteId: string,
  title: string,
  modifiedAt: string,
  source: "human" | "ai" = "human",
): NoteIndexEntry {
  return {
    noteId,
    title,
    modifiedAt,
    createdAt: modifiedAt,
    headings: [],
    labels: [],
    outgoingLinks: [],
    source,
    ...(source === "ai" ? { wikiKind: "concept" as const } : {}),
  } as NoteIndexEntry;
}

function index(notes: NoteIndexEntry[]): GraphiumIndex {
  return { notes } as GraphiumIndex;
}

describe("getNoteSuggestions — 同名ノートの subtext", () => {
  it("同名ノートが複数あるときだけ更新日の subtext を付ける", () => {
    const idx = index([
      note("a", "新しいノート", "2026-06-30T12:00:00.000Z"),
      note("b", "新しいノート", "2026-06-28T12:00:00.000Z"),
      note("c", "会議メモ", "2026-06-29T12:00:00.000Z"),
    ]);

    const suggestions = getNoteSuggestions([], undefined, idx);

    const dups = suggestions.filter((s) => s.label === "新しいノート");
    expect(dups).toHaveLength(2);
    for (const s of dups) {
      expect(s.subtext).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);
    }

    const unique = suggestions.find((s) => s.label === "会議メモ");
    expect(unique?.subtext).toBeUndefined();
  });

  it("一意なタイトルには subtext を付けない", () => {
    const idx = index([
      note("a", "アイデア", "2026-06-30T12:00:00.000Z"),
      note("b", "実験計画", "2026-06-28T12:00:00.000Z"),
    ]);
    const suggestions = getNoteSuggestions([], undefined, idx);
    expect(suggestions.every((s) => s.subtext === undefined)).toBe(true);
  });

  it("files フォールバック経路でも同名を検出して subtext を付ける", () => {
    const files = [
      { id: "f1", name: "下書き.graphium.json", modifiedTime: "2026-06-30T12:00:00.000Z" },
      { id: "f2", name: "下書き.graphium.json", modifiedTime: "2026-06-20T12:00:00.000Z" },
      { id: "f3", name: "本番.graphium.json", modifiedTime: "2026-06-25T12:00:00.000Z" },
    ] as any;

    const suggestions = getNoteSuggestions(files, undefined, null);
    const dups = suggestions.filter((s) => s.label === "下書き");
    expect(dups).toHaveLength(2);
    expect(dups.every((s) => /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(s.subtext ?? ""))).toBe(true);
    expect(suggestions.find((s) => s.label === "本番")?.subtext).toBeUndefined();
  });
});

describe("getAssetSuggestions", () => {
  const media = (over: Partial<{ fileId: string; name: string; type: string; uploadedAt: string }>) => ({
    fileId: "f1",
    name: "a.pdf",
    type: "pdf",
    uploadedAt: "2026-08-01T00:00:00.000Z",
    url: "media-server://f1",
    ...over,
  });

  it("pdf / document / data / image を候補にし、それ以外は含めない", () => {
    const idx = {
      media: [
        media({ fileId: "p1", name: "論文.pdf", type: "pdf" }),
        media({ fileId: "d1", name: "報告.docx", type: "document" }),
        media({ fileId: "c1", name: "測定.csv", type: "data" }),
        media({ fileId: "i1", name: "写真.png", type: "image" }),
        media({ fileId: "v1", name: "動画.mp4", type: "video" }),
      ],
    } as any;
    const suggestions = getAssetSuggestions(idx);
    expect(suggestions.map((s) => s.id).sort()).toEqual(["c1", "d1", "i1", "p1"]);
  });

  it("画像素材は 🖼 のラベルで assetType を持つ（選ぶとインライン画像として埋まる）", () => {
    const idx = { media: [media({ fileId: "i1", name: "写真.png", type: "image" })] } as any;
    const sug = getAssetSuggestions(idx)[0];
    expect(sug.label).toBe("🖼 写真.png");
    expect(sug.assetType).toBe("image");
  });

  it("データ素材は 🧾、それ以外は 📄 のラベルで、assetType を持つ", () => {
    const idx = {
      media: [
        media({ fileId: "p1", name: "論文.pdf", type: "pdf" }),
        media({ fileId: "c1", name: "測定.csv", type: "data" }),
      ],
    } as any;
    const suggestions = getAssetSuggestions(idx);
    const pdf = suggestions.find((s) => s.id === "p1")!;
    const data = suggestions.find((s) => s.id === "c1")!;
    expect(pdf.label).toBe("📄 論文.pdf");
    expect(pdf.assetType).toBe("pdf");
    expect(data.label).toBe("🧾 測定.csv");
    expect(data.assetType).toBe("data");
  });
});

describe("resolveMentionTargetFromLinks（素材メンションの照合）", () => {
  const noteEntry = (noteId: string, title: string) =>
    ({ noteId, title, modifiedAt: "t", createdAt: "t", headings: [], labels: [], outgoingLinks: [] }) as any;
  const idx = { version: 1, updatedAt: "t", notes: [noteEntry("n1", "実験ノート")] } as any;
  // 同一ブロックにノートメンションと素材メンションが両方ある状態
  const links = [
    { sourceBlockId: "b1", targetNoteId: "n1", type: "reference" },
    { sourceBlockId: "b1", targetNoteId: "data:f9", type: "reference" },
  ];
  const resolveAssetId = (name: string) => (name === "測定.csv" ? "data:f9" : null);

  it("素材名のメンションは、先頭候補ではなく外部ソース ID のリンクに解決する", () => {
    const r = resolveMentionTargetFromLinks("b1", "測定.csv", links, idx, resolveAssetId);
    expect(r).toEqual({ noteId: "data:f9", isWiki: false });
  });

  it("ノート名のメンションは従来どおりタイトル一致で解決する", () => {
    const r = resolveMentionTargetFromLinks("b1", "実験ノート", links, idx, resolveAssetId);
    expect(r).toEqual({ noteId: "n1", isWiki: false });
  });

  it("素材名だがリンク記録が無いブロックでは null（呼び出し側の逆引きに委ねる）", () => {
    const onlyNote = [{ sourceBlockId: "b1", targetNoteId: "n1", type: "reference" }];
    const r = resolveMentionTargetFromLinks("b1", "測定.csv", onlyNote, idx, resolveAssetId);
    expect(r).toBeNull();
  });

  it("素材名でもノート名でもないときは従来の先頭候補フォールバック", () => {
    const r = resolveMentionTargetFromLinks("b1", "改名済みノート", links, idx, resolveAssetId);
    expect(r).toEqual({ noteId: "n1", isWiki: false });
  });
});
