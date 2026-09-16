import { describe, expect, it, vi } from "vitest";
import { runSourceCheck } from "./run";
import { planSourceCheck, type PlanSourceCheckStatement } from "./plan";
import {
  SourceCheckDegradedError,
  type CheckSourcesApiClaim,
  type CheckSourcesApiResult,
  type CheckSourcesApiSource,
} from "./api";
import type { ResolveSourceTextDeps } from "./resolve-source-text";
import type { GraphiumDocument } from "../../lib/document-types";

function noteDoc(title: string, text: string): GraphiumDocument {
  return {
    version: 2,
    title,
    pages: [
      {
        id: "p1", title: "Main",
        blocks: [{ id: "b1", type: "paragraph", content: [{ type: "text", text }] }],
        labels: {}, provLinks: [], knowledgeLinks: [],
      },
    ],
    createdAt: "2026-01-01T00:00:00Z",
    modifiedAt: "2026-01-01T00:00:00Z",
  } as GraphiumDocument;
}

/**
 * note-a / note-b は解決できる通常ノート、memo:missing-cap は解決できない出典。
 * memo:missing-cap は findCaptureText が undefined を返す = deleted。
 */
function makeDeps(): ResolveSourceTextDeps {
  return {
    findNote: (id) => (id.startsWith("note-") ? {} : undefined),
    loadNoteDoc: async (id) => {
      if (id === "note-a") return noteDoc("ノートA", "実験結果として融点は800℃だった。");
      if (id === "note-b") return noteDoc("ノートB", "この物質は水に溶けにくい。");
      return null;
    },
    loadMediaBytes: async () => undefined,
    findCaptureText: () => undefined,
  };
}

/** 知見 1 件 = 文 1 つ（v1 と同じ形）のヘルパー */
function claim(id: string, derivedFromNotes: string[]): PlanSourceCheckStatement {
  return {
    id,
    docId: id,
    title: `知見${id}`,
    body: `本文${id}`,
    hashBody: `本文${id}`,
    sourceIds: derivedFromNotes,
  };
}

// wiki-log（IndexedDB）は node 環境のテストでは使えないため、既定の logger（wikiLog.append）
// を使わないテストではすべてこの no-op に差し替える。
const noopLogger = async (_wikiIds: string[], _summary: string, _detail?: Record<string, unknown>) => {};

describe("runSourceCheck", () => {
  it("LLM 判定・source-missing 混在を正しく集約し、quote を一意なブロックへ紐付ける", async () => {
    const c1 = claim("c1", ["note-a"]);
    const c2 = claim("c2", ["note-a", "note-b"]);
    const c3 = claim("c3", ["memo:missing-cap"]);
    const c4 = claim("c4", ["note-a", "memo:missing-cap"]);
    const plan = planSourceCheck([c1, c2, c3, c4]);
    const statementsById = new Map([c1, c2, c3, c4].map((c) => [c.id, c]));

    const callApi = vi.fn(async (source: CheckSourcesApiSource, claims: CheckSourcesApiClaim[]): Promise<CheckSourcesApiResult> => {
      if (source.id === "note-a") {
        return {
          model: "mock-model",
          results: claims.map((c) =>
            c.id === "c4"
              ? { claimId: c.id, verdict: "not-in-source" as const, rationale: "note-a には無い" }
              : {
                  claimId: c.id,
                  verdict: "supported" as const,
                  rationale: "融点が一致する",
                  quote: "融点は800℃だった",
                },
          ),
        };
      }
      if (source.id === "note-b") {
        return {
          model: "mock-model",
          results: claims.map((c) => ({ claimId: c.id, verdict: "unclear" as const, rationale: "判断つかない" })),
        };
      }
      throw new Error(`unexpected source: ${source.id}`);
    });

    const logger = vi.fn(async (_wikiIds: string[], _summary: string, _detail?: Record<string, unknown>) => {});
    const result = await runSourceCheck(plan, {
      statementsById,
      deps: makeDeps(),
      language: "ja",
      callApi,
      now: () => "2026-03-01T00:00:00.000Z",
      logger,
    });

    expect(result.interrupted).toBe(false);
    expect(result.profiles.size).toBe(4);

    const p1 = result.profiles.get("c1")!;
    expect(p1.verdict).toBe("supported");
    expect(p1.checkedBy).toBe("mock-model");
    expect(p1.checkedAt).toBe("2026-03-01T00:00:00.000Z");
    expect(p1.entries).toHaveLength(1);
    expect(p1.entries[0].blockId).toBe("b1"); // quote が note-a の唯一のブロックに一致

    const p2 = result.profiles.get("c2")!;
    // supported（note-a）と unclear（note-b）が混在 → supported が優先
    expect(p2.verdict).toBe("supported");
    expect(p2.entries).toHaveLength(2);

    const p3 = result.profiles.get("c3")!;
    expect(p3.verdict).toBe("source-missing");
    expect(p3.entries).toEqual([
      {
        sourceId: "memo:missing-cap",
        sourceKind: "memo",
        verdict: "source-missing",
        rationale: expect.any(String),
        missingReason: "deleted",
      },
    ]);
    // どの出典も LLM に到達しなかった知見は checkedBy: "local"
    expect(p3.checkedBy).toBe("local");

    const p4 = result.profiles.get("c4")!;
    // not-in-source（note-a）と source-missing（memo）が混在 → not-in-source が優先
    expect(p4.verdict).toBe("not-in-source");
    // note-a 経由で LLM が呼ばれているので "local" にはならない
    expect(p4.checkedBy).toBe("mock-model");

    // wiki-log には全 4 件の docId が渡る
    expect(logger).toHaveBeenCalledTimes(1);
    const [wikiIds, , detail] = logger.mock.calls[0];
    expect(new Set(wikiIds)).toEqual(new Set(["c1", "c2", "c3", "c4"]));
    expect(detail?.interrupted).toBe(false);
  });

  it("claimHash は title/hashBody から計算され、本文が変われば変わる", async () => {
    const c1 = claim("c1", ["note-a"]);
    const plan = planSourceCheck([c1]);
    const callApi = vi.fn(async (_source: CheckSourcesApiSource, claims: CheckSourcesApiClaim[]): Promise<CheckSourcesApiResult> => ({
      model: "m",
      results: claims.map((c) => ({ claimId: c.id, verdict: "supported" as const, rationale: "x" })),
    }));

    const statementsById1 = new Map([[c1.id, c1]]);
    const r1 = await runSourceCheck(plan, { statementsById: statementsById1, deps: makeDeps(), language: "ja", callApi, logger: noopLogger });
    const hash1 = r1.profiles.get("c1")!.claimHash;

    const c1Changed = { ...c1, body: "変更後の本文", hashBody: "変更後の本文" };
    const statementsById2 = new Map([[c1Changed.id, c1Changed]]);
    const r2 = await runSourceCheck(plan, { statementsById: statementsById2, deps: makeDeps(), language: "ja", callApi, logger: noopLogger });
    const hash2 = r2.profiles.get("c1")!.claimHash;

    expect(hash1).not.toBe(hash2);
  });

  it("AbortSignal による中断: 未処理の出典に依存する知見は書き込まれない", async () => {
    const c1 = claim("c1", ["note-a"]); // group 0 のみに依存 → 書き込まれる
    const c2 = claim("c2", ["note-b"]); // group 1 のみに依存 → 中断で書き込まれない
    const plan = planSourceCheck([c1, c2]);
    const statementsById = new Map([c1, c2].map((c) => [c.id, c]));

    const controller = new AbortController();
    const callApi = vi.fn(async (_source: CheckSourcesApiSource, claims: CheckSourcesApiClaim[]): Promise<CheckSourcesApiResult> => ({
      model: "m",
      results: claims.map((c) => ({ claimId: c.id, verdict: "supported" as const, rationale: "x" })),
    }));

    const result = await runSourceCheck(plan, {
      statementsById,
      deps: makeDeps(),
      language: "ja",
      callApi,
      logger: noopLogger,
      signal: controller.signal,
      onProgress: ({ index }) => {
        // group 0（note-a）の処理に入った直後に中断要求を出す。
        // ループ先頭の signal チェックは「次の」反復で効くので、group 0 自体は最後まで処理される。
        if (index === 0) controller.abort();
      },
    });

    expect(result.interrupted).toBe(true);
    expect(result.profiles.has("c1")).toBe(true);
    expect(result.profiles.has("c2")).toBe(false);
  });

  it("API の degrade（モデル未登録等）で中断: 誤った verdict を書き込まず、処理済みの知見だけ残す", async () => {
    const c1 = claim("c1", ["note-a"]);
    const c2 = claim("c2", ["note-b"]);
    const c3 = claim("c3", ["note-a", "note-b"]); // 2 出典依存 → note-b が degrade するので書き込まれない
    const plan = planSourceCheck([c1, c2, c3]);
    const statementsById = new Map([c1, c2, c3].map((c) => [c.id, c]));

    const callApi = vi.fn(async (source: CheckSourcesApiSource, claims: CheckSourcesApiClaim[]): Promise<CheckSourcesApiResult> => {
      if (source.id === "note-a") {
        return {
          model: "m",
          results: claims.map((c) => ({ claimId: c.id, verdict: "supported" as const, rationale: "x" })),
        };
      }
      throw new SourceCheckDegradedError("no model registered", "NO_MODEL_REGISTERED");
    });

    const result = await runSourceCheck(plan, { statementsById, deps: makeDeps(), language: "ja", callApi, logger: noopLogger });

    expect(result.interrupted).toBe(true);
    expect(result.profiles.has("c1")).toBe(true); // note-a だけに依存 → 完了
    expect(result.profiles.has("c2")).toBe(false); // note-b（degrade）に依存 → 未完了
    expect(result.profiles.has("c3")).toBe(false); // note-b にも依存 → 未完了
  });

  it("statementsById に無い statement id は API 呼び出しの対象からも書き込み対象からも除外される", async () => {
    const c1 = claim("c1", ["note-a"]);
    const ghost = claim("ghost", ["note-a"]); // plan には出るが statementsById には無い
    const plan = planSourceCheck([c1, ghost]);
    const statementsById = new Map([[c1.id, c1]]);

    const callApi = vi.fn(async (_source: CheckSourcesApiSource, claims: CheckSourcesApiClaim[]): Promise<CheckSourcesApiResult> => {
      // ghost は statementsById に無いので API に渡す claims にも含まれない
      expect(claims.map((c) => c.id)).toEqual(["c1"]);
      return { model: "m", results: claims.map((c) => ({ claimId: c.id, verdict: "supported" as const, rationale: "x" })) };
    });

    const result = await runSourceCheck(plan, { statementsById, deps: makeDeps(), language: "ja", callApi, logger: noopLogger });
    expect(result.profiles.has("c1")).toBe(true);
    expect(result.profiles.has("ghost")).toBe(false);
  });

  it("knownMissing（ai-answer）は LLM を呼ばずに出典ごとに source-missing を記録する", async () => {
    const c1: PlanSourceCheckStatement = {
      id: "c1", docId: "c1", title: "知見c1", body: "本文c1", hashBody: "本文c1",
      sourceIds: ["note-a", "note-b"], knownMissingReason: "ai-answer",
    };
    const plan = planSourceCheck([c1]);
    const statementsById = new Map([[c1.id, c1]]);
    const callApi = vi.fn();

    const result = await runSourceCheck(plan, { statementsById, deps: makeDeps(), language: "ja", callApi, logger: noopLogger });

    expect(callApi).not.toHaveBeenCalled();
    const p1 = result.profiles.get("c1")!;
    expect(p1.verdict).toBe("source-missing");
    expect(p1.entries).toEqual([
      { sourceId: "note-a", sourceKind: "note", verdict: "source-missing", rationale: expect.any(String), missingReason: "ai-answer" },
      { sourceId: "note-b", sourceKind: "note", verdict: "source-missing", rationale: expect.any(String), missingReason: "ai-answer" },
    ]);
    expect(p1.checkedBy).toBe("local");
  });

  it("knownMissing（not-recorded, sourceIds 空）は docId を指す 1 エントリだけを記録する", async () => {
    const c1: PlanSourceCheckStatement = {
      id: "c1", docId: "c1", title: "知見c1", body: "本文c1", hashBody: "本文c1", sourceIds: [],
    };
    const plan = planSourceCheck([c1]);
    const statementsById = new Map([[c1.id, c1]]);

    const result = await runSourceCheck(plan, { statementsById, deps: makeDeps(), language: "ja", logger: noopLogger });

    const p1 = result.profiles.get("c1")!;
    expect(p1.verdict).toBe("source-missing");
    expect(p1.entries).toEqual([
      { sourceId: "c1", sourceKind: "unknown", verdict: "source-missing", rationale: expect.any(String), missingReason: "not-recorded" },
    ]);
  });

  it("トピック: 同じドキュメントの複数の文がまとまり、statement/statementBlockId が entries に付く", async () => {
    const t1a: PlanSourceCheckStatement = {
      id: "topic-1#b1", docId: "topic-1", title: "トピック1", body: "要点1", hashBody: "トピック全文",
      sourceIds: ["claim:c1"], statement: "要点1", statementBlockId: "b1",
    };
    const t1b: PlanSourceCheckStatement = {
      id: "topic-1#b2", docId: "topic-1", title: "トピック1", body: "要点2", hashBody: "トピック全文",
      sourceIds: ["claim:c1"], statement: "要点2", statementBlockId: "b2",
    };
    const plan = planSourceCheck([t1a, t1b]);
    const statementsById = new Map([t1a, t1b].map((s) => [s.id, s]));

    const callApi = vi.fn(async (_source: CheckSourcesApiSource, claims: CheckSourcesApiClaim[]): Promise<CheckSourcesApiResult> => ({
      model: "m",
      results: claims.map((c) => ({ claimId: c.id, verdict: "supported" as const, rationale: "x" })),
    }));

    const depsWithClaim: ResolveSourceTextDeps = {
      ...makeDeps(),
      findClaim: (id) => (id === "c1" ? {} : undefined),
      loadClaimDoc: async (id) => (id === "c1" ? noteDoc("知見c1", "知見の本文") : null),
    };

    const result = await runSourceCheck(plan, { statementsById, deps: depsWithClaim, language: "ja", callApi, logger: noopLogger });

    // 出典（claim:c1）は 1 回だけ呼ばれ、2 つの文をまとめて判定する
    expect(callApi).toHaveBeenCalledTimes(1);
    expect(callApi.mock.calls[0][1].map((c: CheckSourcesApiClaim) => c.id)).toEqual(["topic-1#b1", "topic-1#b2"]);

    // 集約は topic-1 という 1 つのドキュメントにまとまる
    expect(result.profiles.size).toBe(1);
    const profile = result.profiles.get("topic-1")!;
    expect(profile.entries).toHaveLength(2);
    expect(profile.entries.map((e) => e.statement).sort()).toEqual(["要点1", "要点2"]);
    expect(profile.entries.map((e) => e.statementBlockId).sort()).toEqual(["b1", "b2"]);
  });
});
