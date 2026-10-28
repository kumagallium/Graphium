// bulk-export.ts（一括エクスポート / バックアップの zip 組み立て）のユニットテスト
// downloadBlob をモックして生成された zip の中身を検証する。

import { describe, it, expect, vi, beforeEach } from "vitest";
import { unzipSync, strFromU8 } from "fflate";

// ダウンロードされた zip を捕まえるモック
const downloaded: { blob: Blob; filename: string }[] = [];
vi.mock("../../lib/download-file", () => ({
  downloadBlob: vi.fn(async (blob: Blob, filename: string) => {
    downloaded.push({ blob, filename });
  }),
}));

import { exportBackupZip, exportAllNotesAsMarkdownZip, exportNotesAsMarkdown } from "./bulk-export";
import type { StorageProvider } from "../../lib/storage/types";
import type { GraphiumDocument } from "../../lib/document-types";

// テスト用の最小 GraphiumDocument
function makeDoc(title: string, text = ""): GraphiumDocument {
  const now = "2026-07-03T00:00:00.000Z";
  return {
    version: 5,
    title,
    pages: [{
      id: "p1",
      title,
      blocks: text
        ? [{ id: "b1", type: "paragraph", props: {}, content: [{ type: "text", text, styles: {} }], children: [] }]
        : [],
      labels: {},
      provLinks: [],
      knowledgeLinks: [],
    }],
    createdAt: now,
    modifiedAt: now,
    source: "human",
  } as unknown as GraphiumDocument;
}

// テスト用のフェイクプロバイダ（必要なメソッドだけ実装して cast）
function makeProvider(options: {
  notes: Record<string, GraphiumDocument | Error>;
  wiki?: Record<string, GraphiumDocument>;
}): StorageProvider {
  const meta = (id: string) => ({
    id,
    name: `${id}.json`,
    modifiedTime: "2026-07-03T00:00:00.000Z",
    createdTime: "2026-07-03T00:00:00.000Z",
  });
  const provider: Partial<StorageProvider> = {
    listFiles: async () => Object.keys(options.notes).map(meta),
    loadFile: async (id: string) => {
      const doc = options.notes[id];
      if (doc instanceof Error) throw doc;
      return doc;
    },
  };
  if (options.wiki) {
    provider.listWikiFiles = async () => Object.keys(options.wiki!).map(meta);
    provider.loadWikiFile = async (id: string) => options.wiki![id];
  }
  return provider as StorageProvider;
}

async function lastZipEntries(): Promise<Record<string, string>> {
  const { blob } = downloaded[downloaded.length - 1];
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const unzipped = unzipSync(bytes);
  const out: Record<string, string> = {};
  for (const [name, data] of Object.entries(unzipped)) {
    out[name] = strFromU8(data);
  }
  return out;
}

beforeEach(() => {
  downloaded.length = 0;
});

describe("exportBackupZip", () => {
  it("全ノートを notes/ 配下に doc.title ベースの名前で入れる", async () => {
    const provider = makeProvider({
      notes: { "id-1": makeDoc("Note A"), "id-2": makeDoc("Note B") },
    });
    const result = await exportBackupZip(provider);
    expect(result).toEqual({ exported: 2, failed: 0 });
    const entries = await lastZipEntries();
    expect(Object.keys(entries).sort()).toEqual([
      "notes/Note A.graphium.json",
      "notes/Note B.graphium.json",
    ]);
    // 中身は生 JSON（パースして title が一致する）
    expect(JSON.parse(entries["notes/Note A.graphium.json"]).title).toBe("Note A");
  });

  it("読み込みに失敗したノートはスキップして続行する", async () => {
    const provider = makeProvider({
      notes: {
        "ok-1": makeDoc("Good"),
        "broken": new Error("corrupt"),
        "ok-2": makeDoc("Also good"),
      },
    });
    const result = await exportBackupZip(provider);
    expect(result.exported).toBe(2);
    expect(result.failed).toBe(1);
    const entries = await lastZipEntries();
    expect(Object.keys(entries)).toHaveLength(2);
  });

  it("wiki 対応プロバイダでは wiki/ グループも含める", async () => {
    const provider = makeProvider({
      notes: { "n-1": makeDoc("Note") },
      wiki: { "w-1": makeDoc("Concept X") },
    });
    const result = await exportBackupZip(provider);
    expect(result.exported).toBe(2);
    const entries = await lastZipEntries();
    expect(Object.keys(entries).sort()).toEqual([
      "notes/Note.graphium.json",
      "wiki/Concept X.graphium.json",
    ]);
  });

  it("同名タイトルは id サフィックスで dedupe される", async () => {
    const provider = makeProvider({
      notes: { "id-1": makeDoc("Same"), "id-2": makeDoc("Same") },
    });
    await exportBackupZip(provider);
    const entries = await lastZipEntries();
    expect(Object.keys(entries).sort()).toEqual([
      "notes/Same-id-2.graphium.json",
      "notes/Same.graphium.json",
    ]);
  });

  it("タイトルが空のノートは file.name から拡張子を除いた名前になる", async () => {
    const provider = makeProvider({ notes: { "uuid-42": makeDoc("") } });
    await exportBackupZip(provider);
    const entries = await lastZipEntries();
    expect(Object.keys(entries)).toEqual(["notes/uuid-42.graphium.json"]);
  });

  it("zip ファイル名は日付入りの graphium-backup-*.zip", async () => {
    const provider = makeProvider({ notes: {} });
    await exportBackupZip(provider);
    expect(downloaded[0].filename).toMatch(/^graphium-backup-\d{8}\.zip$/);
  });
});

describe("exportAllNotesAsMarkdownZip", () => {
  it("全ノートを .md でフラットに入れ、タイトル見出しと本文を含む", async () => {
    const provider = makeProvider({
      notes: { "id-1": makeDoc("My Note", "hello body") },
    });
    const result = await exportAllNotesAsMarkdownZip(provider);
    expect(result).toEqual({ exported: 1, failed: 0 });
    const entries = await lastZipEntries();
    expect(Object.keys(entries)).toEqual(["My Note.md"]);
    expect(entries["My Note.md"]).toContain("# My Note");
    expect(entries["My Note.md"]).toContain("hello body");
    expect(downloaded[0].filename).toMatch(/^graphium-notes-markdown-\d{8}\.zip$/);
  });
});

describe("exportNotesAsMarkdown", () => {
  it("選んだノートだけを zip に入れる（選ばれていないノートは読まない）", async () => {
    const provider = makeProvider({
      notes: {
        "id-1": makeDoc("Dough", "flour and water"),
        "id-2": makeDoc("Proofing"),
        "id-3": makeDoc("Not selected"),
      },
    });
    const loadSpy = vi.spyOn(provider, "loadFile");
    const result = await exportNotesAsMarkdown(provider, ["id-1", "id-2"]);
    expect(result).toEqual({ exported: 2, failed: 0 });
    expect(loadSpy.mock.calls.map(([id]) => id).sort()).toEqual(["id-1", "id-2"]);
    const entries = await lastZipEntries();
    expect(Object.keys(entries).sort()).toEqual(["Dough.md", "Proofing.md"]);
    expect(entries["Dough.md"]).toContain("# Dough");
    expect(entries["Dough.md"]).toContain("flour and water");
    expect(downloaded[0].filename).toMatch(/^graphium-notes-markdown-\d{8}\.zip$/);
  });

  it("1 件だけなら zip にせず .md をそのまま落とす", async () => {
    const provider = makeProvider({ notes: { "id-1": makeDoc("Dough", "flour") } });
    const result = await exportNotesAsMarkdown(provider, ["id-1"]);
    expect(result).toEqual({ exported: 1, failed: 0 });
    expect(downloaded).toHaveLength(1);
    expect(downloaded[0].filename).toBe("Dough.md");
    expect(downloaded[0].blob.type).toBe("text/markdown;charset=utf-8");
    const text = await downloaded[0].blob.text();
    expect(text).toContain("# Dough");
    expect(text).toContain("flour");
  });

  it("2 件選んで 1 件が読めなければ、残り 1 件を .md で落として失敗を数える", async () => {
    const provider = makeProvider({
      notes: { "ok": makeDoc("Good"), "broken": new Error("corrupt") },
    });
    const result = await exportNotesAsMarkdown(provider, ["ok", "broken"]);
    expect(result).toEqual({ exported: 1, failed: 1 });
    expect(downloaded.map((d) => d.filename)).toEqual(["Good.md"]);
  });

  it("1 件も書き出せなければ何もダウンロードしない", async () => {
    const provider = makeProvider({ notes: { "broken": new Error("corrupt") } });
    const result = await exportNotesAsMarkdown(provider, ["broken"]);
    expect(result).toEqual({ exported: 0, failed: 1 });
    expect(downloaded).toHaveLength(0);
  });

  it("タイトルが空のノートはノート ID の名前になる", async () => {
    const provider = makeProvider({ notes: { "uuid-42": makeDoc("") } });
    await exportNotesAsMarkdown(provider, ["uuid-42"]);
    expect(downloaded[0].filename).toBe("uuid-42.md");
  });
});
