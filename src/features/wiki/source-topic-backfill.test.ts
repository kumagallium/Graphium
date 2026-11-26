// トピックがまだ無い資料にトピックの段だけを回す処理のテスト（AI は差し替える）

import { describe, expect, it, vi } from "vitest";
import {
  emptySourceTopicBackfillCheckpoint,
  parseSourceTopicBackfillCheckpoint,
  planSourceTopicBackfill,
  runSourceTopicBackfill,
  type SourceTopicBackfillCheckpoint,
  type SourceTopicBackfillDeps,
  type SourceTopicBackfillEntry,
} from "./source-topic-backfill";
import type { SourceTopicStageResult } from "./topic-stage";

const claim = (id: string, ...sources: string[]): SourceTopicBackfillEntry => ({ id, kind: "claim", derivedFromNotes: sources });
const topic = (id: string, sources: string[], claims: string[] = []): SourceTopicBackfillEntry => ({
  id, kind: "topic", derivedFromNotes: sources, derivedFromClaims: claims,
});

function stage(patch: Partial<SourceTopicStageResult> = {}): SourceTopicStageResult {
  return {
    created: 0, updated: 0, migrated: 0, migratedSourcesSkipped: 0, failed: 0,
    reroutedToExisting: 0, createdTopics: [], touchedTopicIds: [], ...patch,
  };
}

function makeDeps(over: Partial<SourceTopicBackfillDeps> = {}): SourceTopicBackfillDeps & { saved: SourceTopicBackfillCheckpoint[] } {
  let current = emptySourceTopicBackfillCheckpoint();
  const saved: SourceTopicBackfillCheckpoint[] = [];
  return {
    resolveSource: async (id) => ({ title: `題 ${id}`, text: `本文 ${id}` }),
    runTopicStage: async () => stage({ created: 1, touchedTopicIds: ["t-new"] }),
    readCheckpoint: async () => current,
    saveCheckpoint: async (next) => {
      current = next;
      saved.push(next);
    },
    claimsOf: () => 2,
    saved,
    ...over,
  };
}

describe("planSourceTopicBackfill", () => {
  it("知見があり、その資料を由来に持つトピックが無い資料だけを、知見の多い順に選ぶ", () => {
    const entries = [
      claim("c1", "conversation:a"),
      claim("c2", "conversation:b"), claim("c3", "conversation:b"),
      claim("c4", "pdf-1"),
      topic("t1", ["pdf-1"]),
    ];
    expect(planSourceTopicBackfill(entries, emptySourceTopicBackfillCheckpoint())).toEqual({
      sourceIds: ["conversation:b", "conversation:a"],
      alreadySettled: 0,
    });
  });

  it("旧形式のトピック（メンバー知見から辿る）に入っている資料は選ばない", () => {
    const entries = [claim("c1", "note-1"), topic("t-old", [], ["c1"])];
    expect(planSourceTopicBackfill(entries, emptySourceTopicBackfillCheckpoint()).sourceIds).toEqual([]);
  });

  it("控えに「何も作らなかった」とある資料は飛ばし、知見が増えたら対象に戻す", () => {
    const checkpoint: SourceTopicBackfillCheckpoint = { version: 1, settled: { "conversation:a": { claims: 1, reason: "no-topic" } } };
    expect(planSourceTopicBackfill([claim("c1", "conversation:a")], checkpoint)).toEqual({ sourceIds: [], alreadySettled: 1 });
    expect(planSourceTopicBackfill([claim("c1", "conversation:a"), claim("c2", "conversation:a")], checkpoint).sourceIds)
      .toEqual(["conversation:a"]);
  });

  it("isTarget で選んだ資料だけに絞れる", () => {
    const entries = [claim("c1", "conversation:a"), claim("c2", "conversation:b")];
    expect(planSourceTopicBackfill(entries, emptySourceTopicBackfillCheckpoint(), (id) => id === "conversation:b").sourceIds)
      .toEqual(["conversation:b"]);
  });

  it("トピックの無い資料が無ければ空", () => {
    expect(planSourceTopicBackfill([topic("t1", ["x"])], emptySourceTopicBackfillCheckpoint()).sourceIds).toEqual([]);
  });
});

describe("parseSourceTopicBackfillCheckpoint", () => {
  it("形の違う控えは空から始める", () => {
    expect(parseSourceTopicBackfillCheckpoint(null)).toEqual(emptySourceTopicBackfillCheckpoint());
    expect(parseSourceTopicBackfillCheckpoint({ version: 2, settled: {} })).toEqual(emptySourceTopicBackfillCheckpoint());
  });

  it("壊れた行だけ捨てる", () => {
    expect(parseSourceTopicBackfillCheckpoint({
      version: 1,
      settled: { a: { claims: 3, reason: "no-topic" }, b: { claims: "x", reason: "no-topic" }, c: { claims: 1, reason: "other" } },
    })).toEqual({ version: 1, settled: { a: { claims: 3, reason: "no-topic" } } });
  });
});

describe("runSourceTopicBackfill", () => {
  it("資料ごとに本文を読んでトピックの段を回し、作ったトピックを数える", async () => {
    const runTopicStage = vi.fn(async () => stage({ created: 1, updated: 1 }));
    const deps = makeDeps({ runTopicStage });
    const progress: number[] = [];
    const result = await runSourceTopicBackfill(
      { sourceIds: ["conversation:a", "conversation:b"], alreadySettled: 0 },
      // 資料の境目の知らせ（current 無し）だけを拾う
      { ...deps, onProgress: (p) => { if (!p.current) progress.push(p.done); } },
    );
    expect(runTopicStage).toHaveBeenCalledTimes(2);
    expect(runTopicStage.mock.calls[0]).toEqual([{ id: "conversation:a", title: "題 conversation:a", text: "本文 conversation:a" }, undefined, expect.any(Function)]);
    expect(result).toMatchObject({ done: 2, total: 2, topicsTouched: 4, created: 2, noTopic: 0, failedSources: 0, aborted: false });
    expect(progress).toEqual([1, 2]);
    // トピックができた資料は控えに残さない（次の計画ではトピックがあるので選ばれない）
    expect(deps.saved).toEqual([]);
  });

  it("何も作らなかった資料と読めなかった資料は控えに残す", async () => {
    const deps = makeDeps({
      resolveSource: async (id) => (id === "gone" ? undefined : { title: id, text: "本文" }),
      runTopicStage: async () => stage(),
      claimsOf: (id) => (id === "gone" ? 1 : 4),
    });
    const result = await runSourceTopicBackfill({ sourceIds: ["quiet", "gone"], alreadySettled: 0 }, deps);
    expect(result).toMatchObject({ done: 2, noTopic: 1, unreadable: 1 });
    expect(deps.saved[deps.saved.length - 1]).toEqual({
      version: 1,
      settled: { quiet: { claims: 4, reason: "no-topic" }, gone: { claims: 1, reason: "unreadable" } },
    });
  });

  it("控えは書く直前に読み直す（取り込み側が書いた分を消さない）", async () => {
    let current: SourceTopicBackfillCheckpoint = { version: 1, settled: { other: { claims: 9, reason: "no-topic" } } };
    const deps = makeDeps({
      runTopicStage: async () => stage(),
      readCheckpoint: async () => current,
      saveCheckpoint: async (next) => { current = next; },
    });
    await runSourceTopicBackfill({ sourceIds: ["quiet"], alreadySettled: 0 }, deps);
    expect(Object.keys(current.settled).sort()).toEqual(["other", "quiet"]);
  });

  it("失敗した資料は控えに残さず、3 回続いたら止める", async () => {
    const boom = new Error("model down");
    const runTopicStage = vi.fn(async () => stage({ failed: 1, failureError: boom }));
    const deps = makeDeps({ runTopicStage });
    const result = await runSourceTopicBackfill({ sourceIds: ["a", "b", "c", "d"], alreadySettled: 0 }, deps);
    expect(runTopicStage).toHaveBeenCalledTimes(3);
    expect(result).toMatchObject({ failedSources: 3, stoppedByFailures: true, failureError: boom });
    expect(deps.saved).toEqual([]);
  });

  it("投げた失敗も数え、間に成功があれば数え直す", async () => {
    let n = 0;
    const deps = makeDeps({
      runTopicStage: async () => {
        n++;
        if (n === 2) return stage({ created: 1 });
        throw new Error("flaky");
      },
    });
    const result = await runSourceTopicBackfill({ sourceIds: ["a", "b", "c", "d"], alreadySettled: 0 }, deps);
    expect(result).toMatchObject({ done: 4, failedSources: 3, stoppedByFailures: false, created: 1 });
  });

  it("止めたら次の資料へ進まず、途中の資料を控えに残さない", async () => {
    const controller = new AbortController();
    const runTopicStage = vi.fn(async () => {
      controller.abort();
      return stage();
    });
    const deps = makeDeps({ runTopicStage, signal: controller.signal });
    const result = await runSourceTopicBackfill({ sourceIds: ["a", "b"], alreadySettled: 0 }, deps);
    expect(runTopicStage).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ aborted: true, done: 0, noTopic: 0 });
    expect(deps.saved).toEqual([]);
  });
  it("いま手を付けている資料の何本目・題・資料の中の書き進みを知らせる", async () => {
    const seen: unknown[] = [];
    const deps = makeDeps({
      runTopicStage: async (_source, _signal, onStageProgress) => {
        onStageProgress?.({ phase: "writing", written: 1, planned: 4, windowIndex: 0, windowTotal: 2 });
        return stage({ created: 1, touchedTopicIds: ["t"] });
      },
      onProgress: (p) => seen.push(p),
    });
    await runSourceTopicBackfill({ sourceIds: ["a", "b"], alreadySettled: 0 }, deps);
    expect(seen).toEqual([
      { done: 0, total: 2, topicsTouched: 0, current: { index: 1, title: "題 a", phase: "reading", written: 0, planned: 0, windowIndex: 0, windowTotal: 1 } },
      { done: 0, total: 2, topicsTouched: 0, current: { index: 1, title: "題 a", phase: "writing", written: 1, planned: 4, windowIndex: 0, windowTotal: 2 } },
      { done: 1, total: 2, topicsTouched: 1 },
      { done: 1, total: 2, topicsTouched: 1, current: { index: 2, title: "題 b", phase: "reading", written: 0, planned: 0, windowIndex: 0, windowTotal: 1 } },
      { done: 1, total: 2, topicsTouched: 1, current: { index: 2, title: "題 b", phase: "writing", written: 1, planned: 4, windowIndex: 0, windowTotal: 2 } },
      { done: 2, total: 2, topicsTouched: 2 },
    ]);
  });
});
