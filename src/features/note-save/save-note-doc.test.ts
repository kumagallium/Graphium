// ノート保存共有モジュールの単体テスト
//
// リファクタ（メイン / SidePeek の保存経路統合）で守るべき不変条件を検証する:
//   - buildSavedPageFields: labels の object 化 / リンクの layer 振り分け /
//     空 blockAlignments の undefined 化（フィールド省略）
//   - saveNoteDoc: 保存 → onSaved の順序、noteId プレフィックスによる
//     saveFile / saveWikiFile / saveSkillFile の振り分け、保存失敗時に
//     onSaved を呼ばないこと（#514 の不変条件）

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  buildSavedPageFields,
  saveNoteDoc,
  type LinkSource,
  type LabelSnapshotSource,
  type AlignmentSource,
} from "./save-note-doc";
import { registerProvider, setActiveProvider } from "../../lib/storage/registry";
import type { StorageProvider } from "../../lib/storage/types";
import type { GraphiumDocument } from "../../lib/document-types";

// ---------------------------------------------------------------------------
// テスト用スタブ
// ---------------------------------------------------------------------------

function labelStoreOf(entries: [string, string][]): LabelSnapshotSource {
  return { getSnapshot: () => ({ labels: entries }) };
}

function linkStoreOf(links: Array<{ layer?: string; id: string }>): LinkSource {
  return { getAllLinks: () => links };
}

function alignmentStoreOf(
  snapshot: Record<string, "left" | "center" | "right">
): AlignmentSource {
  return { getSnapshot: () => snapshot };
}

function mockDoc(title = "テストノート"): GraphiumDocument {
  return {
    version: 2,
    title,
    pages: [{ id: "main", title, blocks: [], labels: {}, provLinks: [], knowledgeLinks: [] }],
    createdAt: "2026-01-01T00:00:00Z",
    modifiedAt: "2026-01-02T00:00:00Z",
  };
}

/**
 * saveFile / saveWikiFile / saveSkillFile の呼び出しを記録するスタブ provider。
 * failOn を指定するとその save メソッドで throw する（保存失敗の再現）。
 */
function createStubProvider(opts: { failOn?: "note" | "wiki" | "skill" } = {}) {
  const calls = {
    saveFile: [] as Array<{ id: string; doc: GraphiumDocument }>,
    saveWikiFile: [] as Array<{ id: string; doc: GraphiumDocument }>,
    saveSkillFile: [] as Array<{ id: string; doc: GraphiumDocument }>,
  };
  const provider = {
    id: "note-save-test",
    displayName: "Note Save Test",
    async init() {},
    signIn() {},
    signOut() {},
    getAuthState: () => ({ isSignedIn: true, userEmail: "test@example.com" }),
    onAuthChange: () => () => {},
    async listFiles() {
      return [];
    },
    async loadFile() {
      throw new Error("not needed");
    },
    async createFile() {
      return "created-1";
    },
    async saveFile(id: string, doc: GraphiumDocument) {
      if (opts.failOn === "note") throw new Error("saveFile failed");
      calls.saveFile.push({ id, doc });
    },
    async deleteFile() {},
    async saveWikiFile(id: string, doc: GraphiumDocument) {
      if (opts.failOn === "wiki") throw new Error("saveWikiFile failed");
      calls.saveWikiFile.push({ id, doc });
    },
    async saveSkillFile(id: string, doc: GraphiumDocument) {
      if (opts.failOn === "skill") throw new Error("saveSkillFile failed");
      calls.saveSkillFile.push({ id, doc });
    },
    async uploadMedia() {
      throw new Error("not needed");
    },
    async getMediaBlobUrl() {
      throw new Error("not needed");
    },
    extractFileId: () => null,
    getUserEmail: async () => "test@example.com",
  } as unknown as StorageProvider;
  registerProvider(provider);
  setActiveProvider("note-save-test");
  return { provider, calls };
}

beforeEach(() => {
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// buildSavedPageFields
// ---------------------------------------------------------------------------

describe("buildSavedPageFields", () => {
  it("labels をエントリ配列から plain object に変換する", () => {
    const { labels } = buildSavedPageFields({
      labelStore: labelStoreOf([
        ["b1", "procedure"],
        ["b2", "result"],
      ]),
      linkStore: linkStoreOf([]),
      blockAlignmentStore: alignmentStoreOf({}),
    });
    expect(labels).toEqual({ b1: "procedure", b2: "result" });
  });

  it("リンクを layer で prov / knowledge に振り分ける（layer 未設定は両方から除外）", () => {
    const { provLinks, knowledgeLinks } = buildSavedPageFields({
      labelStore: labelStoreOf([]),
      linkStore: linkStoreOf([
        { layer: "prov", id: "p1" },
        { layer: "knowledge", id: "k1" },
        { layer: "prov", id: "p2" },
        { id: "no-layer" }, // layer 未設定はどちらにも入らない（元の filter と同じ）
      ]),
      blockAlignmentStore: alignmentStoreOf({}),
    });
    expect(provLinks).toEqual([
      { layer: "prov", id: "p1" },
      { layer: "prov", id: "p2" },
    ]);
    expect(knowledgeLinks).toEqual([{ layer: "knowledge", id: "k1" }]);
  });

  it("blockAlignments が空なら undefined（フィールド省略）", () => {
    const { blockAlignments } = buildSavedPageFields({
      labelStore: labelStoreOf([]),
      linkStore: linkStoreOf([]),
      blockAlignmentStore: alignmentStoreOf({}),
    });
    expect(blockAlignments).toBeUndefined();
  });

  it("blockAlignments が非空ならそのまま保持する", () => {
    const snapshot = { b1: "center" as const, b2: "right" as const };
    const { blockAlignments } = buildSavedPageFields({
      labelStore: labelStoreOf([]),
      linkStore: linkStoreOf([]),
      blockAlignmentStore: alignmentStoreOf(snapshot),
    });
    expect(blockAlignments).toEqual(snapshot);
  });
});

// ---------------------------------------------------------------------------
// saveNoteDoc
// ---------------------------------------------------------------------------

describe("saveNoteDoc", () => {
  it("通常ノート ID は saveFile へ、保存済み doc で onSaved を呼ぶ", async () => {
    const { calls } = createStubProvider();
    const doc = mockDoc();
    const onSaved = vi.fn();

    await saveNoteDoc({ noteId: "note-1", doc, onSaved });

    expect(calls.saveFile).toEqual([{ id: "note-1", doc }]);
    expect(calls.saveWikiFile).toEqual([]);
    expect(calls.saveSkillFile).toEqual([]);
    // onSaved にはフルキー（プレフィックス付きのまま）と保存済み doc が渡る
    expect(onSaved).toHaveBeenCalledTimes(1);
    expect(onSaved).toHaveBeenCalledWith("note-1", doc);
  });

  it("wiki: プレフィックスは saveWikiFile へ raw id で振り分ける", async () => {
    const { calls } = createStubProvider();
    const doc = mockDoc();
    const onSaved = vi.fn();

    await saveNoteDoc({ noteId: "wiki:abc123", doc, onSaved });

    expect(calls.saveWikiFile).toEqual([{ id: "abc123", doc }]);
    expect(calls.saveFile).toEqual([]);
    // onSaved にはプレフィックス付きのフルキーが渡る（doc キャッシュのキーと揃える）
    expect(onSaved).toHaveBeenCalledWith("wiki:abc123", doc);
  });

  it("skill: プレフィックスは saveSkillFile へ raw id で振り分ける", async () => {
    const { calls } = createStubProvider();
    const doc = mockDoc();
    const onSaved = vi.fn();

    await saveNoteDoc({ noteId: "skill:xyz789", doc, onSaved });

    expect(calls.saveSkillFile).toEqual([{ id: "xyz789", doc }]);
    expect(onSaved).toHaveBeenCalledWith("skill:xyz789", doc);
  });

  it("保存が失敗したら onSaved を呼ばず、エラーを呼び出し側へ伝播する（#514 不変条件）", async () => {
    createStubProvider({ failOn: "note" });
    const onSaved = vi.fn();

    await expect(
      saveNoteDoc({ noteId: "note-1", doc: mockDoc(), onSaved })
    ).rejects.toThrow("saveFile failed");

    // 保存に失敗した以上、reindex（onSaved）は絶対に走らせない
    expect(onSaved).not.toHaveBeenCalled();
  });

  it("wiki 保存の失敗でも onSaved は呼ばれない", async () => {
    createStubProvider({ failOn: "wiki" });
    const onSaved = vi.fn();

    await expect(
      saveNoteDoc({ noteId: "wiki:abc", doc: mockDoc(), onSaved })
    ).rejects.toThrow("saveWikiFile failed");
    expect(onSaved).not.toHaveBeenCalled();
  });

  it("保存 → onSaved の順序が保証される（onSaved 時点で save は完了済み）", async () => {
    const { calls } = createStubProvider();
    const order: string[] = [];
    const onSaved = vi.fn(() => {
      // onSaved が呼ばれる時点で saveFile は既に記録されていること
      order.push(`onSaved(saveFile.len=${calls.saveFile.length})`);
    });

    await saveNoteDoc({ noteId: "note-1", doc: mockDoc(), onSaved });

    expect(order).toEqual(["onSaved(saveFile.len=1)"]);
  });

  it("onSaved 未指定でも保存は成功する", async () => {
    const { calls } = createStubProvider();
    await expect(
      saveNoteDoc({ noteId: "note-1", doc: mockDoc() })
    ).resolves.toBeUndefined();
    expect(calls.saveFile).toHaveLength(1);
  });
});
