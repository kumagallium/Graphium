import { describe, it, expect } from "vitest";
import type { GraphiumDocument } from "../../lib/document-types";
import type { StorageProvider } from "../../lib/storage/types";
import type { DocumentProvenance } from "../document-provenance/types";
import { snapshotBeforeAiRewrite, isAiRewriteActivity } from "./ai-rewrite";
import { listSnapshots } from "./snapshot-store";

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

const humanProvenance: DocumentProvenance = {
  revisions: [],
  activities: [
    { id: "edit_001", type: "human_edit", startedAt: "2026-01-01T00:00:00Z", endedAt: "2026-01-01T00:00:00Z", wasAssociatedWith: "agent_human" },
  ],
  agents: [],
};

const aiOnlyProvenance: DocumentProvenance = {
  revisions: [],
  activities: [
    { id: "edit_001", type: "wiki_ingest", startedAt: "2026-01-01T00:00:00Z", endedAt: "2026-01-01T00:00:00Z", wasAssociatedWith: "agent_ai" },
  ],
  agents: [],
};

/** 1 段落だけの wiki doc を作る */
function makeDoc(text: string, provenance?: DocumentProvenance): GraphiumDocument {
  return {
    version: 5,
    title: "話題ページ",
    source: "ai",
    documentProvenance: provenance,
    pages: [
      {
        id: "p1",
        title: "話題ページ",
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

describe("isAiRewriteActivity", () => {
  it("既存ページを書き換える種別だけ true", () => {
    expect(isAiRewriteActivity("wiki_merge")).toBe(true);
    expect(isAiRewriteActivity("wiki_cross_update")).toBe(true);
    expect(isAiRewriteActivity("wiki_dedup_merge")).toBe(true);
    expect(isAiRewriteActivity("wiki_regenerate")).toBe(true);
  });

  it("新規生成・本文を変えない操作・未指定は false", () => {
    expect(isAiRewriteActivity("wiki_ingest")).toBe(false);
    expect(isAiRewriteActivity("wiki_atomize")).toBe(false);
    expect(isAiRewriteActivity("wiki_reinforce")).toBe(false);
    expect(isAiRewriteActivity(undefined)).toBe(false);
  });
});

describe("snapshotBeforeAiRewrite", () => {
  it("人の編集履歴があるページを書き換えるときは版が 1 つ増える", async () => {
    const provider = makeProvider();
    const current = makeDoc("旧本文", humanProvenance);
    await snapshotBeforeAiRewrite(provider, "topic-1", current, "wiki_merge", "AIが書き換える前");

    const metas = await listSnapshots(provider, "topic-1");
    expect(metas).toHaveLength(1);
    expect(metas[0].origin).toBe("ai_rewrite");
    expect(metas[0].label).toBe("AIが書き換える前");
  });

  it("AI が作ったまま人が触っていないページでは版を作らない", async () => {
    const provider = makeProvider();
    const current = makeDoc("旧本文", aiOnlyProvenance);
    await snapshotBeforeAiRewrite(provider, "topic-1", current, "wiki_merge", "AIが書き換える前");

    expect(await listSnapshots(provider, "topic-1")).toHaveLength(0);
  });

  it("新規作成（current が無い）では版を作らない", async () => {
    const provider = makeProvider();
    await snapshotBeforeAiRewrite(provider, "topic-1", undefined, "wiki_merge", "AIが書き換える前");

    expect(await listSnapshots(provider, "topic-1")).toHaveLength(0);
  });

  it("本文を変えない操作（wiki_reinforce）では版を作らない", async () => {
    const provider = makeProvider();
    const current = makeDoc("旧本文", humanProvenance);
    await snapshotBeforeAiRewrite(provider, "topic-1", current, "wiki_reinforce", "AIが書き換える前");

    expect(await listSnapshots(provider, "topic-1")).toHaveLength(0);
  });

  it("直前の版と本文が同じなら増えない（takeSnapshot の unchanged に委ねる）", async () => {
    const provider = makeProvider();
    const current = makeDoc("同じ本文", humanProvenance);
    await snapshotBeforeAiRewrite(provider, "topic-1", current, "wiki_merge", "AIが書き換える前");
    await snapshotBeforeAiRewrite(provider, "topic-1", current, "wiki_cross_update", "AIが書き換える前");

    expect(await listSnapshots(provider, "topic-1")).toHaveLength(1);
  });
});
