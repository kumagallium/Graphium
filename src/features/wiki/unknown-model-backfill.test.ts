import { describe, expect, it, vi } from "vitest";
import type { GraphiumDocument, WikiMeta } from "../../lib/document-types";
import {
  isUnknownModelTopic,
  resolveTopicModelFromUsage,
  runUnknownModelBackfill,
  withRecoveredModel,
  type UsageEventLite,
} from "./unknown-model-backfill";

function topicDoc(meta: Partial<WikiMeta> = {}, model = "unknown"): GraphiumDocument {
  return {
    version: 2,
    title: "焼き色",
    pages: [{ id: "main", title: "焼き色", blocks: [], labels: {}, provLinks: [], knowledgeLinks: [] }],
    source: "ai",
    generatedBy: { agent: "ai", sessionId: "s", model: undefined } as never,
    wikiMeta: {
      kind: "topic",
      derivedFromNotes: ["note-1"],
      derivedFromChats: [],
      derivedFromClaims: [],
      topicMarkdown: "## 定義\n本文",
      generatedAt: "2026-11-27T00:03:00.000Z",
      lastIngestedAt: "2026-11-27T00:03:00.000Z",
      generatedBy: { model, version: "1.0.0" },
      ...meta,
    } as WikiMeta,
    createdAt: "2026-11-27T00:03:00.000Z",
    modifiedAt: "2026-11-27T00:03:00.000Z",
  };
}

const ev = (ts: string, modelId: string, feature = "wiki.revise-topic"): UsageEventLite => ({ ts, feature, modelId });

describe("isUnknownModelTopic", () => {
  it("資料から書いたトピック（topicMarkdown あり）でモデルが unknown のものだけ対象", () => {
    expect(isUnknownModelTopic(topicDoc())).toBe(true);
    expect(isUnknownModelTopic(topicDoc({}, "gemma"))).toBe(false);
    expect(isUnknownModelTopic(topicDoc({ topicMarkdown: undefined }))).toBe(false);
    expect(isUnknownModelTopic(null)).toBe(false);
  });
});

describe("resolveTopicModelFromUsage", () => {
  it("最後の書き込みの直前の改訂 API のモデルを返す", () => {
    const events = [ev("2026-11-27T00:02:30.000Z", "preview/gemma-4-31B-it")];
    expect(resolveTopicModelFromUsage(topicDoc(), events)).toBe("preview/gemma-4-31B-it");
  });

  it("改訂で進んだ lastIngestedAt を手がかりにする（作成時刻ではない）", () => {
    const doc = topicDoc({ generatedAt: "2026-11-20T00:00:00.000Z", lastIngestedAt: "2026-11-27T00:03:00.000Z" });
    const events = [ev("2026-11-20T00:00:00.000Z", "old-model"), ev("2026-11-27T00:02:00.000Z", "new-model")];
    expect(resolveTopicModelFromUsage(doc, events)).toBe("new-model");
  });

  it("最後の書き込みの窓に呼び出しが無ければ、作成時刻の窓で見る", () => {
    const doc = topicDoc({ generatedAt: "2026-11-26T09:44:44.000Z", lastIngestedAt: "2026-11-26T13:39:26.000Z" });
    const events = [ev("2026-11-26T09:43:00.000Z", "gemma"), ev("2026-11-26T13:45:30.000Z", "later")];
    expect(resolveTopicModelFromUsage(doc, events)).toBe("gemma");
  });

  it("最後の書き込みの窓でモデルが混ざるときは、作成時刻の窓に逃げずに決めない", () => {
    const doc = topicDoc({ generatedAt: "2026-11-26T09:44:44.000Z", lastIngestedAt: "2026-11-27T00:03:00.000Z" });
    const events = [
      ev("2026-11-26T09:43:00.000Z", "gemma"),
      ev("2026-11-27T00:01:00.000Z", "a"),
      ev("2026-11-27T00:02:00.000Z", "b"),
    ];
    expect(resolveTopicModelFromUsage(doc, events)).toBeNull();
  });

  it("時間窓の中に複数のモデルが混ざると決めない", () => {
    const events = [ev("2026-11-27T00:01:00.000Z", "a"), ev("2026-11-27T00:02:00.000Z", "b")];
    expect(resolveTopicModelFromUsage(topicDoc(), events)).toBeNull();
  });

  it("窓の外・別の機能の呼び出ししか無ければ決めない", () => {
    const events = [
      ev("2026-11-26T23:00:00.000Z", "far-before"),
      ev("2026-11-27T00:10:00.000Z", "far-after"),
      ev("2026-11-27T00:02:00.000Z", "router", "wiki.route-topics"),
    ];
    expect(resolveTopicModelFromUsage(topicDoc(), events)).toBeNull();
  });

  it("統合（merge-topics）の呼び出しも本文を書いた呼び出しとして数える", () => {
    const events = [ev("2026-11-27T00:02:00.000Z", "m", "wiki.merge-topics")];
    expect(resolveTopicModelFromUsage(topicDoc(), events)).toBe("m");
  });
});

describe("withRecoveredModel", () => {
  it("モデル名だけを書き換え、本文・modifiedAt・時刻は変えない", () => {
    const doc = topicDoc();
    const next = withRecoveredModel(doc, "m");
    expect(next.wikiMeta?.generatedBy.model).toBe("m");
    expect(next.generatedBy?.model).toBe("m");
    expect(next.modifiedAt).toBe(doc.modifiedAt);
    expect(next.wikiMeta?.lastIngestedAt).toBe(doc.wikiMeta?.lastIngestedAt);
    expect(next.wikiMeta?.topicMarkdown).toBe(doc.wikiMeta?.topicMarkdown);
    expect(next.pages).toBe(doc.pages);
  });
});

describe("runUnknownModelBackfill", () => {
  it("決まったものは保存し、決まらないものは unknown のまま知らせる", async () => {
    const docs = new Map<string, GraphiumDocument>([
      ["ok", topicDoc()],
      ["mixed", topicDoc({ lastIngestedAt: "2026-11-26T00:00:00.000Z" })],
      ["already", topicDoc({}, "gemma")],
    ]);
    const saveDoc = vi.fn(async (_id: string, _doc: GraphiumDocument) => true);
    const onUnresolved = vi.fn();
    const result = await runUnknownModelBackfill({
      candidateIds: ["ok", "mixed", "already", "missing"],
      loadDoc: async (id) => docs.get(id) ?? null,
      saveDoc,
      onUnresolved,
      events: [
        ev("2026-11-27T00:02:00.000Z", "gemma"),
        ev("2026-11-25T23:59:00.000Z", "a"),
        ev("2026-11-25T23:58:00.000Z", "b"),
      ],
    });

    expect(result).toEqual({ fixed: 1, unresolved: 1, saveFailed: 0 });
    expect(saveDoc).toHaveBeenCalledTimes(1);
    expect(saveDoc.mock.calls[0][0]).toBe("ok");
    expect(onUnresolved).toHaveBeenCalledWith("mixed");
  });

  it("保存できなかったものは数えて、次の起動でやり直せるよう unresolved にしない", async () => {
    const onUnresolved = vi.fn();
    const result = await runUnknownModelBackfill({
      candidateIds: ["ok"],
      loadDoc: async () => topicDoc(),
      saveDoc: async () => false,
      onUnresolved,
      events: [ev("2026-11-27T00:02:00.000Z", "gemma")],
    });
    expect(result).toEqual({ fixed: 0, unresolved: 0, saveFailed: 1 });
    expect(onUnresolved).not.toHaveBeenCalled();
  });
});
