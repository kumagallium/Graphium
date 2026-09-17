// @vitest-environment jsdom
// useSourceCheck のフック振る舞いテスト（仕様 2-e）。
// - runOne: 1 ドキュメントだけ実行して保存する（出典が通常ノートのケース）
// - planForLint: 対象・範囲（unchecked/stale/all）で対象を絞り込む
// - resolveSourceCheckTitles: sourceId → 表示名の解決

import { describe, expect, it, vi } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import {
  useSourceCheck,
  resolveSourceCheckTitles,
  type UseSourceCheckDeps,
} from "./use-source-check";
import type { GraphiumDocument, SourceCheckEntry, WikiMetaSummary } from "../../lib/document-types";
import type { GraphiumIndex } from "../navigation/index-file";

function claimDoc(title: string, derivedFromNotes: string[]): GraphiumDocument {
  return {
    version: 2,
    title,
    pages: [
      {
        id: "p1",
        title: "Main",
        blocks: [{ id: "b1", type: "paragraph", content: [{ type: "text", text: "本文" }] }],
        labels: {},
        provLinks: [],
        knowledgeLinks: [],
      },
    ],
    wikiMeta: {
      kind: "claim",
      derivedFromNotes,
      derivedFromChats: [],
      generatedAt: "2026-01-01T00:00:00Z",
      generatedBy: { model: "m", version: "1.0.0" },
    },
    createdAt: "2026-01-01T00:00:00Z",
    modifiedAt: "2026-01-01T00:00:00Z",
  } as GraphiumDocument;
}

function noteDoc(text: string): GraphiumDocument {
  return {
    version: 2,
    title: "出典ノート",
    pages: [
      {
        id: "p1",
        title: "Main",
        blocks: [{ id: "b1", type: "paragraph", content: [{ type: "text", text }] }],
        labels: {},
        provLinks: [],
        knowledgeLinks: [],
      },
    ],
    createdAt: "2026-01-01T00:00:00Z",
    modifiedAt: "2026-01-01T00:00:00Z",
  } as GraphiumDocument;
}

function makeDeps(overrides: Partial<UseSourceCheckDeps> = {}): UseSourceCheckDeps {
  const docs = new Map<string, GraphiumDocument>();
  return {
    noteIndex: null,
    rawNoteIndex: { schemaVersion: 1, notes: [] } as unknown as GraphiumIndex,
    mediaIndex: null,
    captureIndex: null,
    wikiFiles: [],
    wikiMetas: new Map<string, WikiMetaSummary>(),
    getCachedDoc: (id: string) => docs.get(id),
    loadDoc: async (id: string) => docs.get(id) ?? null,
    saveWikiFile: vi.fn(async () => undefined),
    activeFileId: null,
    reopenActiveWikiFile: vi.fn(),
    // wiki-log（IndexedDB）は jsdom テスト環境では使えないため既定ロガーを差し替える
    // （run.test.ts と同じ流儀）。
    logger: vi.fn(async () => undefined),
    ...overrides,
  };
}

describe("useSourceCheck.runOne", () => {
  // sourceIds が空の知見は 1-c の "not-recorded" で LLM を呼ばず即座に source-missing に
  // なる（plan.ts / run.ts の既存挙動）。LLM ネットワーク呼び出しをモックせずに
  // 「実行 → 保存」の配線だけを検証できる、この経路をフックのテストに使う。
  it("出典の記録が無い知見は LLM を呼ばず source-missing として保存する", async () => {
    const claim = claimDoc("知見1", []);
    const docs = new Map<string, GraphiumDocument>([["wiki:c1", claim]]);
    const saveWikiFile = vi.fn(async (_id: string, _doc: GraphiumDocument) => undefined);
    const deps = makeDeps({
      getCachedDoc: (id) => docs.get(id),
      loadDoc: async (id) => docs.get(id) ?? null,
      saveWikiFile,
    });

    const { result } = renderHook(() => useSourceCheck(deps));

    await act(async () => {
      await result.current.runOne("c1");
    });

    expect(saveWikiFile).toHaveBeenCalledTimes(1);
    const [savedId, savedDoc] = saveWikiFile.mock.calls[0];
    expect(savedId).toBe("c1");
    expect(savedDoc.wikiMeta?.sourceCheck?.verdict).toBe("source-missing");
    expect(savedDoc.wikiMeta?.sourceCheck?.entries[0].missingReason).toBe("not-recorded");
    expect(result.current.runningDocId).toBeNull();
  });

  it("実行中は runningDocId にドキュメント ID が入り、完了後に null に戻る", async () => {
    const claim = claimDoc("知見1", []);
    const docs = new Map<string, GraphiumDocument>([["wiki:c1", claim]]);
    const deps = makeDeps({
      getCachedDoc: (id) => docs.get(id),
      loadDoc: async (id) => docs.get(id) ?? null,
    });
    const { result } = renderHook(() => useSourceCheck(deps));

    let running!: Promise<void>;
    act(() => {
      running = result.current.runOne("c1");
    });
    expect(result.current.runningDocId).toBe("c1");

    await act(async () => {
      await running;
    });
    await waitFor(() => expect(result.current.runningDocId).toBeNull());
  });

  it("同じドキュメントの 2 回目の呼び出しは実行中なら無視される", async () => {
    const claim = claimDoc("知見1", []);
    const docs = new Map<string, GraphiumDocument>([["wiki:c1", claim]]);
    const saveWikiFile = vi.fn(async () => undefined);
    const deps = makeDeps({
      getCachedDoc: (id) => docs.get(id),
      loadDoc: async (id) => docs.get(id) ?? null,
      saveWikiFile,
    });
    const { result } = renderHook(() => useSourceCheck(deps));

    let p1!: Promise<void>;
    let p2!: Promise<void>;
    act(() => {
      p1 = result.current.runOne("c1");
      p2 = result.current.runOne("c1");
    });
    await act(async () => {
      await Promise.all([p1, p2]);
    });
    // 2 回目は runningDocId が塞がっているため二重実行にならない
    expect(saveWikiFile).toHaveBeenCalledTimes(1);
  });
});

describe("useSourceCheck 相互排他（runOne と runLintPlan は同じ ref を共有する）", () => {
  it("runOne 実行中に runLintPlan を呼んでも何もしない", async () => {
    const claim = claimDoc("知見1", []);
    const docs = new Map<string, GraphiumDocument>([["wiki:c1", claim]]);
    const saveWikiFile = vi.fn(async () => undefined);
    const wikiMetas = new Map<string, WikiMetaSummary>([["c1", { title: "知見1", kind: "claim" }]]);
    const deps = makeDeps({
      wikiFiles: [{ id: "c1" }],
      wikiMetas,
      getCachedDoc: (id) => docs.get(id),
      loadDoc: async (id) => docs.get(id) ?? null,
      saveWikiFile,
    });
    const { result } = renderHook(() => useSourceCheck(deps));

    let runOnePromise!: Promise<void>;
    let lintResult!: Awaited<ReturnType<typeof result.current.runLintPlan>>;
    act(() => {
      runOnePromise = result.current.runOne("c1");
    });
    expect(result.current.runningDocId).toBe("c1");

    const plan = await result.current.planForLint("claim", "unchecked");
    await act(async () => {
      lintResult = await result.current.runLintPlan(plan);
    });

    // runLintPlan は何もせず空の結果を返す。バッチ実行フラグも立たない
    expect(lintResult.profiles.size).toBe(0);
    expect(result.current.batchRunning).toBe(false);

    await act(async () => {
      await runOnePromise;
    });
    // runOne 自体は 1 回だけ保存している
    expect(saveWikiFile).toHaveBeenCalledTimes(1);
  });

  it("runLintPlan 実行中に runOne を呼んでも何もしない", async () => {
    const claim = claimDoc("知見1", []);
    const docs = new Map<string, GraphiumDocument>([["wiki:c1", claim]]);
    const saveWikiFile = vi.fn(async () => undefined);
    const wikiMetas = new Map<string, WikiMetaSummary>([["c1", { title: "知見1", kind: "claim" }]]);
    const deps = makeDeps({
      wikiFiles: [{ id: "c1" }],
      wikiMetas,
      getCachedDoc: (id) => docs.get(id),
      loadDoc: async (id) => docs.get(id) ?? null,
      saveWikiFile,
    });
    const { result } = renderHook(() => useSourceCheck(deps));

    const plan = await result.current.planForLint("claim", "unchecked");

    let lintPromise!: Promise<unknown>;
    act(() => {
      lintPromise = result.current.runLintPlan(plan);
    });
    expect(result.current.batchRunning).toBe(true);

    await act(async () => {
      await result.current.runOne("c1");
    });
    // runOne 側では何も保存していない（弾かれた）
    expect(result.current.runningDocId).toBeNull();

    await act(async () => {
      await lintPromise;
    });
    // 一括実行のほうは 1 件を保存し終えている
    expect(saveWikiFile).toHaveBeenCalledTimes(1);
  });
});

describe("useSourceCheck.planForLint", () => {
  it("scope: unchecked は sourceCheck 済みのドキュメントを除外する", async () => {
    const checked: GraphiumDocument = {
      ...claimDoc("済み", []),
      wikiMeta: {
        ...claimDoc("済み", []).wikiMeta!,
        sourceCheck: {
          verdict: "supported",
          entries: [],
          checkedAt: "2026-01-01T00:00:00Z",
          checkedBy: "m",
          claimHash: "sha256:whatever",
        },
      },
    };
    const unchecked = claimDoc("未照合", []);
    const docs = new Map<string, GraphiumDocument>([
      ["wiki:c1", checked],
      ["wiki:c2", unchecked],
    ]);
    const wikiMetas = new Map<string, WikiMetaSummary>([
      ["c1", { title: "済み", kind: "claim" }],
      ["c2", { title: "未照合", kind: "claim" }],
    ]);
    const deps = makeDeps({
      wikiFiles: [{ id: "c1" }, { id: "c2" }],
      wikiMetas,
      getCachedDoc: (id) => docs.get(id),
      loadDoc: async (id) => docs.get(id) ?? null,
    });
    const { result } = renderHook(() => useSourceCheck(deps));

    let plan!: Awaited<ReturnType<typeof result.current.planForLint>>;
    await act(async () => {
      plan = await result.current.planForLint("claim", "unchecked");
    });

    expect(plan.targetCount).toBe(1);
    expect(plan.plan.docCount).toBe(1);
  });

  it("target: topic は claim を対象に含めない", async () => {
    const claim = claimDoc("知見", []);
    const docs = new Map<string, GraphiumDocument>([["wiki:c1", claim]]);
    const wikiMetas = new Map<string, WikiMetaSummary>([["c1", { title: "知見", kind: "claim" }]]);
    const deps = makeDeps({
      wikiFiles: [{ id: "c1" }],
      wikiMetas,
      getCachedDoc: (id) => docs.get(id),
      loadDoc: async (id) => docs.get(id) ?? null,
    });
    const { result } = renderHook(() => useSourceCheck(deps));

    let plan!: Awaited<ReturnType<typeof result.current.planForLint>>;
    await act(async () => {
      plan = await result.current.planForLint("topic", "unchecked");
    });

    expect(plan.targetCount).toBe(0);
  });
});

describe("resolveSourceCheckTitles", () => {
  it("claim: 出典は wikiMetas から解決する", () => {
    const entries: SourceCheckEntry[] = [
      { sourceId: "claim:c2", sourceKind: "claim", verdict: "supported", rationale: "" },
    ];
    const titles = resolveSourceCheckTitles(entries, {
      noteIndex: null,
      mediaIndex: null,
      wikiMetas: new Map([["c2", { title: "引かれた知見", kind: "claim" } as WikiMetaSummary]]),
    });
    expect(titles["claim:c2"]).toBe("引かれた知見");
  });

  it("通常ノート出典は noteIndex から解決する", () => {
    const entries: SourceCheckEntry[] = [
      { sourceId: "note-a", sourceKind: "note", verdict: "supported", rationale: "" },
    ];
    const titles = resolveSourceCheckTitles(entries, {
      noteIndex: { schemaVersion: 1, notes: [{ noteId: "note-a", title: "ノートA" } as never] } as unknown as GraphiumIndex,
      mediaIndex: null,
      wikiMetas: new Map(),
    });
    expect(titles["note-a"]).toBe("ノートA");
  });

  it("解決できない出典はキーを持たない（呼び出し側で sourceId フォールバック）", () => {
    const entries: SourceCheckEntry[] = [
      { sourceId: "note-missing", sourceKind: "note", verdict: "supported", rationale: "" },
    ];
    const titles = resolveSourceCheckTitles(entries, { noteIndex: null, mediaIndex: null, wikiMetas: new Map() });
    expect(titles["note-missing"]).toBeUndefined();
  });
});
