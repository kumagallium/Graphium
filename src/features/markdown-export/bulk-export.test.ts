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

import { exportBackupZip, exportAllNotesAsMarkdownZip } from "./bulk-export";
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
