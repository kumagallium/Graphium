import { describe, it, expect } from "vitest";
import type { GraphiumDocument } from "../../lib/document-types";
import type { StorageProvider } from "../../lib/storage/types";
import {
  listSnapshots,
  loadSnapshot,
  takeSnapshot,
  renameSnapshot,
  deleteSnapshot,
  buildRestoredDocument,
} from "./snapshot-store";

/** readAppData / writeAppData だけを in-memory で実装した最小プロバイダ */
function makeProvider(): StorageProvider {
  const store = new Map<string, unknown>();
  return {
    readAppData: async (k: string) => (store.has(k) ? store.get(k) : null),
    writeAppData: async (k: string, v: unknown) => {
      store.set(k, v);
    },
  } as unknown as StorageProvider;
}

/** 1 段落だけのノート doc を作る */
function makeDoc(text: string): GraphiumDocument {
  return {
    version: 5,
    title: "予算申請書",
    pages: [
      {
        id: "p1",
        title: "予算申請書",
        blocks: [{ id: "b1", type: "paragraph", content: [{ type: "text", text }] }],
        labels: {},
        provLinks: [],
        knowledgeLinks: [],
      },
    ],
    createdAt: "2026-01-01T00:00:00Z",
    modifiedAt: "2026-01-01T00:00:00Z",
  };
}

describe("snapshot-store", () => {
  it("版を残すと v1 から採番され、全文が読み戻せる", async () => {
    const provider = makeProvider();
    const res = await takeSnapshot(provider, "note-1", makeDoc("初期案"));
    expect(res.status).toBe("created");
    expect(res.meta.version).toBe(1);

    const metas = await listSnapshots(provider, "note-1");
    expect(metas).toHaveLength(1);

    const doc = await loadSnapshot(provider, res.meta.id);
    expect(doc?.pages[0].blocks[0].content[0].text).toBe("初期案");
  });

  it("内容を変えて残すと version が増える", async () => {
    const provider = makeProvider();
    await takeSnapshot(provider, "note-1", makeDoc("初期案"));
    const res2 = await takeSnapshot(provider, "note-1", makeDoc("予算増額版"));
    expect(res2.status).toBe("created");
    expect(res2.meta.version).toBe(2);
    expect(await listSnapshots(provider, "note-1")).toHaveLength(2);
  });

  it("直近と同一内容なら新しい版を作らない（unchanged）", async () => {
    const provider = makeProvider();
    const doc = makeDoc("同じ本文");
    await takeSnapshot(provider, "note-1", doc);
    const again = await takeSnapshot(provider, "note-1", doc);
    expect(again.status).toBe("unchanged");
    expect(again.meta.version).toBe(1);
    expect(await listSnapshots(provider, "note-1")).toHaveLength(1);
  });

  it("ノートごとに採番が独立する", async () => {
    const provider = makeProvider();
    await takeSnapshot(provider, "note-1", makeDoc("A"));
    const other = await takeSnapshot(provider, "note-2", makeDoc("B"));
    expect(other.meta.version).toBe(1);
  });

  it("ラベルを付け外しできる", async () => {
    const provider = makeProvider();
    const res = await takeSnapshot(provider, "note-1", makeDoc("初期案"));
    expect(res.meta.label).toBeUndefined();

    await renameSnapshot(provider, "note-1", res.meta.id, "予算増額版");
    expect((await listSnapshots(provider, "note-1"))[0].label).toBe("予算増額版");

    await renameSnapshot(provider, "note-1", res.meta.id, "   ");
    expect((await listSnapshots(provider, "note-1"))[0].label).toBeUndefined();
  });

  it("版を削除するとメタも全文も消える", async () => {
    const provider = makeProvider();
    const res = await takeSnapshot(provider, "note-1", makeDoc("初期案"));
    await deleteSnapshot(provider, "note-1", res.meta.id);
    expect(await listSnapshots(provider, "note-1")).toHaveLength(0);
    expect(await loadSnapshot(provider, res.meta.id)).toBeNull();
  });

  it("takeSnapshot に渡したラベルが保存される", async () => {
    const provider = makeProvider();
    const res = await takeSnapshot(provider, "note-1", makeDoc("初期案"), "たたき台");
    expect(res.meta.label).toBe("たたき台");
  });
});

describe("buildRestoredDocument", () => {
  it("内容は版から、作成日時と編集履歴チェーンは現在から引き継ぐ", () => {
    const snapshot = { ...makeDoc("初期案"), title: "旧タイトル" };
    const current: GraphiumDocument = {
      ...makeDoc("編集後の内容"),
      title: "新タイトル",
      createdAt: "2026-02-02T00:00:00Z",
      documentProvenance: { revisions: [], activities: [], agents: [{ id: "agent_human", type: "human", label: "user" }] },
    };
    const restored = buildRestoredDocument(current, snapshot);
    expect(restored.pages[0].blocks[0].content[0].text).toBe("初期案");
    expect(restored.title).toBe("旧タイトル");
    expect(restored.createdAt).toBe("2026-02-02T00:00:00Z");
    expect(restored.documentProvenance).toBe(current.documentProvenance);
    expect(new Date(restored.modifiedAt).getTime()).toBeGreaterThan(new Date(snapshot.modifiedAt).getTime());
  });

  it("スキルの版同期情報（version / defaultPromptHash）は現在を維持し、説明は版に戻す", () => {
    const snapshot: GraphiumDocument = {
      ...makeDoc("旧プロンプト"),
      source: "skill",
      skillMeta: { description: "旧説明", availableForIngest: true, createdAt: "2026-01-01T00:00:00Z", systemSkillId: "default-voice-ja", systemSkillVersion: 1, defaultPromptHash: "old-hash" },
    };
    const current: GraphiumDocument = {
      ...makeDoc("現プロンプト"),
      source: "skill",
      skillMeta: { description: "現説明", availableForIngest: false, createdAt: "2026-01-05T00:00:00Z", systemSkillId: "default-voice-ja", systemSkillVersion: 3, defaultPromptHash: "new-hash" },
    };
    const restored = buildRestoredDocument(current, snapshot);
    expect(restored.skillMeta?.description).toBe("旧説明");
    expect(restored.skillMeta?.createdAt).toBe("2026-01-05T00:00:00Z");
    expect(restored.skillMeta?.systemSkillVersion).toBe(3);
    expect(restored.skillMeta?.defaultPromptHash).toBe("new-hash");
  });
});
