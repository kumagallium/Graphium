// @vitest-environment jsdom
// use-knowledge-maintenance のテスト
// fm・各 deps は vi.fn と Map の偽物（test-helpers の makeHost を土台にする）

import { StrictMode, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import type { useFileManager } from "../../hooks/use-file-manager";
import type { ConsolidateExistingTopicsDeps } from "../wiki/topic-stage";
import { isMaintenanceSaveBusy, MaintenanceSaveBusyError, SAVE_MAX_ATTEMPTS } from "./recorder";
import { makeRunKey } from "./run-format";
import type { UndoImpact } from "./undo";
import {
  buildUndoConfirmMessage,
  buildUndoDoneNotice,
  buildUndoRefusalMessage,
  MAINTENANCE_LIST_PAGE_SIZE,
  MAINTENANCE_PURGE_DELAY_MS,
  operationsTouchingPage,
  useKnowledgeMaintenance,
  type KnowledgeMaintenanceDeps,
  type MaintenanceFileManager,
  type TopicMergeGroupScope,
} from "./use-knowledge-maintenance";
import { makeDoc, makeHost, makeOp, makeRun } from "./test-helpers";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// 実際の useFileManager の戻り値が、構造的な型に収まることをコンパイル時に確かめる
export const _fmShapeCheck = (fm: ReturnType<typeof useFileManager>): MaintenanceFileManager => fm;

// topicMergeScope の戻りが applyTopicMerges の groupScope に代入できることをコンパイル時に確かめる
export const _groupScopeCheck = (
  g: TopicMergeGroupScope,
): NonNullable<ConsolidateExistingTopicsDeps["groupScope"]> => g;

/** キーと引数をそのまま文字列にする t（文言ではなくキーを確かめる） */
const t = (key: string, params?: Record<string, string>) =>
  params ? `${key}${JSON.stringify(params)}` : key;

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

function setup(over: Partial<KnowledgeMaintenanceDeps> = {}, opts: { strict?: boolean; spy?: boolean } = {}) {
  const h = makeHost();
  if (opts.spy) vi.spyOn(h.storage, "listAppDataKeys");
  h.addPage("t1", makeDoc("話題A", "元の本文A"));
  h.addPage("t2", makeDoc("話題B", "元の本文B"));
  const makeFm = (): MaintenanceFileManager => ({
    wikiMetas: new Map([
      ["t1", { title: "話題A" }],
      ["t2", { title: "話題B" }],
    ]),
    activeFileId: null,
    loadWikiDocFresh: h.host.loadWikiDocFresh,
    getWikiIndexFlags: h.host.getIndexFlags,
    restoreWikiIndexFlag: h.host.restoreWikiFlag,
    handleSaveWikiFile: h.host.saveWikiFile,
    handleDeleteWikiFile: h.host.trashWiki,
    handleArchiveWikiFile: h.host.archiveWiki,
    handleOpenWikiFile: vi.fn(async () => {}),
  });
  const order: string[] = [];
  const deps: KnowledgeMaintenanceDeps = {
    fm: makeFm(),
    getProvider: () => h.host.provider(),
    storageReady: true,
    providerId: "p1",
    flushEditors: vi.fn(() => null),
    applyLiveDoc: vi.fn(() => ({ applied: 1, refused: 0 })),
    embed: vi.fn(async (id: string) => {
      order.push(`embed:${id}`);
    }),
    appendLog: vi.fn(async () => {}),
    getAuthor: vi.fn(async () => ({})),
    confirm: vi.fn(() => true),
    notify: vi.fn(),
    t,
    ...over,
  };
  vi.mocked(deps.applyLiveDoc).mockImplementation((id: string) => {
    order.push(`apply:${id}`);
    return { applied: 1, refused: 0 };
  });
  const wrapper = opts.strict
    ? ({ children }: { children: ReactNode }) => <StrictMode>{children}</StrictMode>
    : undefined;
  const hook = renderHook((p: KnowledgeMaintenanceDeps) => useKnowledgeMaintenance(p), {
    initialProps: deps,
    wrapper,
  });
  return { h, deps, makeFm, order, ...hook };
}

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

/** 話題 t1 に t2 を統合した 1 実行を作って閉じる */
async function mergeOnce(s: ReturnType<typeof setup>) {
  const { result, h } = s;
  const run = await result.current.beginRun("merge_topics");
  const scope = await result.current.topicMergeScope(run)("t1", ["t2"]);
  await scope.handleSaveWikiFile("t1", makeDoc("話題A", "統合後の本文"));
  await scope.handleDeleteWikiFile("t2");
  await scope.end();
  await run.end();
  return { run, h };
}

describe("buildUndoConfirmMessage", () => {
  const base: UndoImpact = {
    canUndo: true,
    pages: [
      { wikiId: "a", title: "A", deleted: false, unchanged: false, editsAfter: 0, untrackedChange: false, checksAlsoRevert: false },
    ],
    flags: [],
  };

  it("影響が無ければ確認の 1 行だけ", () => {
    expect(buildUndoConfirmMessage(base, "話題A", t)).toBe('maintenance.undo.confirm{"title":"話題A"}');
  });

  it("該当するものだけを並べる（編集の合計・記録に残らない変更・照合・完全削除・索引に無い）", () => {
    const impact: UndoImpact = {
      canUndo: true,
      pages: [
        { wikiId: "a", title: "A", deleted: false, unchanged: false, editsAfter: 2, untrackedChange: false, checksAlsoRevert: true },
        { wikiId: "b", title: "B", deleted: false, unchanged: false, editsAfter: 1, untrackedChange: true, checksAlsoRevert: false },
        { wikiId: "c", title: "C", deleted: true, unchanged: false, editsAfter: 0, untrackedChange: false, checksAlsoRevert: false },
      ],
      flags: [
        { wikiId: "d", flag: "deletedAt", title: "D", restorable: false },
        { wikiId: "d", flag: "archivedAt", title: "D", restorable: false },
        { wikiId: "e", flag: "deletedAt", title: "E", restorable: true },
      ],
    };
    const lines = buildUndoConfirmMessage(impact, "話題A", t).split("\n");
    expect(lines).toEqual([
      'maintenance.undo.confirm{"title":"話題A"}',
      'maintenance.undo.confirmEdits{"count":"3"}',
      "maintenance.undo.confirmUntracked",
      "maintenance.undo.confirmChecks",
      'maintenance.undo.confirmMissingPage{"title":"C"}',
      'maintenance.undo.confirmMissingFlag{"title":"D"}',
    ]);
  });
});

describe("buildUndoRefusalMessage / buildUndoDoneNotice", () => {
  it("断る理由ごとのキーを返し、妨げは最も新しい操作を名指しする", () => {
    const b = (id: string, title: string) => ({
      runId: "r",
      operationId: id,
      op: makeOp({ id, subject: { wikiId: "x", title } }),
    });
    expect(buildUndoRefusalMessage({ code: "blocked", blockers: [b("1", "古い"), b("2", "新しい")] }, t)).toBe(
      'maintenance.undo.refused.blocked{"title":"新しい"}',
    );
    expect(buildUndoRefusalMessage({ code: "in_progress" }, t)).toBe("maintenance.undo.refused.inProgress");
    expect(buildUndoRefusalMessage({ code: "already_undone" }, t)).toBe("maintenance.undo.refused.alreadyUndone");
    expect(buildUndoRefusalMessage({ code: "not_found" }, t)).toBe("maintenance.undo.refused.notFound");
    expect(buildUndoRefusalMessage({ code: "copy_unreadable", copyKeys: [] }, t)).toBe(
      "maintenance.undo.refused.copyUnreadable",
    );
    expect(buildUndoRefusalMessage({ code: "unsupported" }, t)).toBe("maintenance.undo.refused.unsupported");
  });

  it("失敗が 1 件でもあれば一部だけのトースト", () => {
    const done = {
      status: "done" as const,
      undoRunId: "r",
      undoOperationId: "o",
      restoredPages: [],
      unchangedPages: [],
      failedPages: [{ wikiId: "a", title: "A", reason: "x" }],
      restoredFlags: [],
      failedFlags: [{ wikiId: "b", flag: "deletedAt" as const, reason: "y" }],
    };
    expect(buildUndoDoneNotice(done, t)).toEqual({
      kind: "error",
      message: 'maintenance.undo.donePartial{"count":"2"}',
    });
    expect(buildUndoDoneNotice({ ...done, failedPages: [], failedFlags: [] }, t)).toEqual({
      kind: "success",
      message: "maintenance.undo.done",
    });
  });
});

describe("operationsTouchingPage / MaintenanceSaveBusyError", () => {
  it("pages / flags / related / subject のどれかに関わる操作だけ", () => {
    const opSubject = makeOp({ id: "1", subject: { wikiId: "a", title: "A" } });
    const opRelated = makeOp({ id: "2", related: [{ wikiId: "a", title: "A", role: "absorbed" }] });
    const opFlag = makeOp({ id: "3", flags: [{ wikiId: "a", flag: "deletedAt", before: null, after: "x" }] });
    const opPage = makeOp({ id: "4", pages: [{ wikiId: "a", title: "A", copyKey: "k" }] });
    const other = makeOp({ id: "5", subject: { wikiId: "z", title: "Z" } });
    const runs = [makeRun("maint-run-a", [opSubject, other]), makeRun("maint-run-b", [opRelated, opFlag, opPage])];
    expect(operationsTouchingPage(runs, "a").map((x) => x.op.id)).toEqual(["1", "2", "3", "4"]);
    expect(operationsTouchingPage(runs, "q")).toEqual([]);
  });

  it("保存中で諦めたエラーは code を持ち isMaintenanceSaveBusy で判定できる", () => {
    const e = new MaintenanceSaveBusyError("w", SAVE_MAX_ATTEMPTS);
    expect(e.code).toBe("save_busy");
    expect(isMaintenanceSaveBusy(e)).toBe(true);
    expect(isMaintenanceSaveBusy(new Error("x"))).toBe(false);
    expect(isMaintenanceSaveBusy("save_busy")).toBe(false);
  });
});

describe("beginRun と host", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-05T00:00:00Z"));
  });

  it("host は呼び出し時の fm の最新を引く（実行の途中で fm が替わっても）", async () => {
    const s = setup();
    const run = await s.result.current.beginRun("regenerate");
    const op = await run.beginOperation({ kind: "regenerate", subject: { wikiId: "t1", title: "話題A" } });

    // 実行の途中で fm が再レンダーで替わる
    const fm2 = s.makeFm();
    const save2 = vi.fn(async () => true);
    fm2.handleSaveWikiFile = save2;
    s.rerender({ ...s.deps, fm: fm2 });

    await op.save("t1", makeDoc("話題A", "新しい本文"));
    expect(save2).toHaveBeenCalledTimes(1);
    expect(s.deps.fm.handleSaveWikiFile).not.toHaveBeenCalled();
    await op.end();
    await run.end();
  });

  it("flushEditors は wiki:<id> で呼ぶ。null を返しても何も待たない", async () => {
    const s = setup();
    const run = await s.result.current.beginRun("regenerate");
    const op = await run.beginOperation({ kind: "regenerate" });
    await op.save("t1", makeDoc("話題A", "新しい本文"));
    expect(s.deps.flushEditors).toHaveBeenCalledWith("wiki:t1");
    await op.end();
    await run.end();
  });

  it("run.end のあと一覧に反映される", async () => {
    const s = setup();
    await mergeOnce(s);
    await waitFor(() => expect(s.result.current.runs).toHaveLength(1));
    expect(s.result.current.runs[0].trigger).toBe("merge_topics");
  });
});

describe("topicMergeScope", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-05T00:00:00Z"));
  });

  it("組ごとに merge_topics の操作を作り、残す側が subject・吸収側が related になる", async () => {
    const s = setup();
    const { run } = await mergeOnce(s);
    const key = [...s.h.storage.store.keys()].find((k) => k.startsWith("maint-run-"))!;
    const meta = s.h.storage.store.get(key) as {
      operations: { kind: string; subject: { wikiId: string; title: string }; related: unknown[]; pages: unknown[]; flags: unknown[] }[];
    };
    expect(meta.operations).toHaveLength(1);
    const op = meta.operations[0];
    expect(op.kind).toBe("merge_topics");
    expect(op.subject).toEqual({ wikiId: "t1", title: "話題A" });
    expect(op.related).toEqual([{ wikiId: "t2", title: "話題B", role: "absorbed" }]);
    // 写し（t1）と、ゴミ箱のフラグの変化（t2）が記録される
    expect(op.pages).toHaveLength(1);
    expect(op.flags).toHaveLength(1);
    expect(s.result.current.recordedOperationsOf(run)).toEqual([{ runId: run.id, operationId: expect.any(String) }]);
  });

  it("2 組なら 2 操作。何も変わらなかった組は記録されない", async () => {
    const s = setup();
    s.h.addPage("t3", makeDoc("話題C", "C"));
    s.h.addPage("t4", makeDoc("話題D", "D"));
    const run = await s.result.current.beginRun("organize_topics");
    const scope = s.result.current.topicMergeScope(run);
    const g1 = await scope("t1", ["t2"]);
    await g1.handleSaveWikiFile("t1", makeDoc("話題A", "統合後"));
    await g1.handleDeleteWikiFile("t2");
    await g1.end();
    // 2 組目は何も動かさずに閉じる
    const g2 = await scope("t3", ["t4"]);
    await g2.end();
    await run.end();
    expect(s.result.current.recordedOperationsOf(run)).toHaveLength(1);
  });

  it("保存中で諦めると保存は例外になり、吸収側は動かない（偽成功にしない）", async () => {
    const s = setup();
    s.h.saveResults.push(...Array(SAVE_MAX_ATTEMPTS).fill(false));
    const run = await s.result.current.beginRun("merge_topics");
    const g = await s.result.current.topicMergeScope(run)("t1", ["t2"]);
    await expect(g.handleSaveWikiFile("t1", makeDoc("話題A", "統合後"))).rejects.toSatisfy(isMaintenanceSaveBusy);
    await g.end();
    await run.end();
    expect(s.h.calls).not.toContain("trash:t2");
  });
});

describe("requestUndo", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-05T00:00:00Z"));
  });

  it("確認 → 取り消し → 成功のトースト → 一覧の読み直し。ページとフラグが戻る", async () => {
    const s = setup();
    const { run } = await mergeOnce(s);
    const [target] = s.result.current.recordedOperationsOf(run);
    expect(s.h.flags.get("t2")!.deletedAt).not.toBeNull();

    let res: unknown;
    await act(async () => {
      res = await s.result.current.requestUndo(target);
    });
    expect((res as { status: string }).status).toBe("done");
    expect(s.deps.confirm).toHaveBeenCalledTimes(1);
    expect(vi.mocked(s.deps.confirm).mock.calls[0][0]).toBe('maintenance.undo.confirm{"title":"話題A"}');
    expect(s.deps.notify).toHaveBeenCalledWith("success", "maintenance.undo.done");
    expect(s.h.flags.get("t2")!.deletedAt).toBeNull();
    expect(s.h.pages.get("t1")!.pages[0].blocks[0]).toMatchObject({ content: [{ text: "元の本文A" }] });

    // 一覧には取り消しの実行も入り、元の操作は「取り消し済み」になる
    await waitFor(() => expect(s.result.current.runs).toHaveLength(2));
    const state = s.result.current.states.get(`${target.runId}\u0000${target.operationId}`);
    expect(state?.state).toBe("undone");

    // wiki-log に undo が 1 件。detail に runId / operationId
    expect(s.deps.appendLog).toHaveBeenCalledTimes(1);
    const [type, ids, summary, detail] = vi.mocked(s.deps.appendLog).mock.calls[0];
    expect(type).toBe("undo");
    expect(ids).toEqual(expect.arrayContaining(["t1"]));
    expect(summary).toContain("maintenance.op.undo");
    expect(detail).toMatchObject({ runId: target.runId, operationId: target.operationId });
  });

  it("confirm が false なら何もしない（トーストも書き込みも無い）", async () => {
    const s = setup({ confirm: vi.fn(() => false) });
    const { run } = await mergeOnce(s);
    const [target] = s.result.current.recordedOperationsOf(run);
    const before = s.h.calls.length;
    let res: unknown;
    await act(async () => {
      res = await s.result.current.requestUndo(target);
    });
    expect(res).toEqual({ status: "cancelled" });
    expect(s.deps.notify).not.toHaveBeenCalled();
    expect(s.h.calls.length).toBe(before);
    expect(s.h.flags.get("t2")!.deletedAt).not.toBeNull();
  });

  it("対象が無ければ、確認せずに理由を notify して終わる", async () => {
    const s = setup();
    let res: unknown;
    await act(async () => {
      res = await s.result.current.requestUndo({ runId: makeRunKey(new Date(), uuid(9)), operationId: "nope" });
    });
    expect((res as { status: string }).status).toBe("refused");
    expect(s.deps.confirm).not.toHaveBeenCalled();
    expect(s.deps.notify).toHaveBeenCalledWith("error", "maintenance.undo.refused.notFound");
  });

  it("新しい操作が同じページに関わっていれば、その操作を名指しして断る", async () => {
    const s = setup();
    const { run } = await mergeOnce(s);
    const [target] = s.result.current.recordedOperationsOf(run);

    vi.setSystemTime(new Date("2026-10-05T00:10:00Z"));
    const run2 = await s.result.current.beginRun("regenerate");
    const op2 = await run2.beginOperation({ kind: "regenerate", subject: { wikiId: "t1", title: "話題A（作り直し）" } });
    await op2.save("t1", makeDoc("話題A", "作り直した本文"));
    await op2.end();
    await run2.end();

    await act(async () => {
      await s.result.current.requestUndo(target);
    });
    expect(s.deps.confirm).not.toHaveBeenCalled();
    expect(s.deps.notify).toHaveBeenCalledWith(
      "error",
      'maintenance.undo.refused.blocked{"title":"話題A（作り直し）"}',
    );
    // 読んだ一覧からも同じ妨げが引ける
    await waitFor(() => expect(s.result.current.blockersOf(target)).toHaveLength(1));
  });

  it("プロバイダが記録に対応していなければ unsupported を notify する", async () => {
    const s = setup({ getProvider: () => ({}) as never });
    await act(async () => {
      await s.result.current.requestUndo({ runId: "maint-run-x", operationId: "o" });
    });
    expect(s.deps.notify).toHaveBeenCalledWith("error", "maintenance.undo.refused.unsupported");
  });

  describe("afterRestore", () => {
    it("書き出し → ピークの差し替え → 埋め込みの順。embed の失敗は握る", async () => {
      const s = setup({
        embed: vi.fn(async () => {
          throw new Error("embed failed");
        }),
      });
      const apply = vi.mocked(s.deps.applyLiveDoc);
      const { run } = await mergeOnce(s);
      const [target] = s.result.current.recordedOperationsOf(run);
      vi.mocked(s.deps.flushEditors).mockClear();
      await act(async () => {
        await s.result.current.requestUndo(target);
      });
      expect(s.deps.embed).toHaveBeenCalledWith("t1", expect.anything());
      expect(apply).toHaveBeenCalledWith("wiki:t1", expect.anything());
      // 取り消しの読み込み前と、差し替えの直前の 2 回書き出す
      expect(vi.mocked(s.deps.flushEditors).mock.calls.filter((c) => c[0] === "wiki:t1").length).toBeGreaterThanOrEqual(2);
      expect(s.deps.notify).toHaveBeenCalledWith("success", "maintenance.undo.done");
    });

    it("ピークの差し替えが先、埋め込みがあと", async () => {
      const s = setup();
      const { run } = await mergeOnce(s);
      const [target] = s.result.current.recordedOperationsOf(run);
      await act(async () => {
        await s.result.current.requestUndo(target);
      });
      expect(s.order).toEqual(["apply:wiki:t1", "embed:t1"]);
    });

    it("メインで開いているページは、ピークを差し替えた数に関係なく開き直す", async () => {
      const s = setup();
      vi.mocked(s.deps.applyLiveDoc).mockReturnValue({ applied: 1, refused: 0 });
      const { run } = await mergeOnce(s);
      const [target] = s.result.current.recordedOperationsOf(run);
      const fm = { ...s.makeFm(), activeFileId: "wiki:t1" };
      s.rerender({ ...s.deps, fm });
      await act(async () => {
        await s.result.current.requestUndo(target);
      });
      expect(fm.handleOpenWikiFile).toHaveBeenCalledWith("t1");
    });

    it("別のページを開いていれば開き直さない", async () => {
      const s = setup();
      vi.mocked(s.deps.applyLiveDoc).mockReturnValue({ applied: 0, refused: 0 });
      const { run } = await mergeOnce(s);
      const [target] = s.result.current.recordedOperationsOf(run);
      const fm = { ...s.makeFm(), activeFileId: "wiki:other" };
      s.rerender({ ...s.deps, fm });
      await act(async () => {
        await s.result.current.requestUndo(target);
      });
      expect(fm.handleOpenWikiFile).not.toHaveBeenCalled();
    });

    it("ピークが差し替えを断ったら、開き直すよう知らせる", async () => {
      const s = setup();
      vi.mocked(s.deps.applyLiveDoc).mockReturnValue({ applied: 0, refused: 1 });
      const { run } = await mergeOnce(s);
      const [target] = s.result.current.recordedOperationsOf(run);
      await act(async () => {
        await s.result.current.requestUndo(target);
      });
      expect(s.deps.notify).toHaveBeenCalledWith("error", "maintenance.undo.peekNotUpdated");
    });
  });
});

describe("一覧の読み込み", () => {
  /** storage に n 件の実行を直接置く（新しいほど番号が大きい） */
  function seedRuns(s: ReturnType<typeof setup>, n: number) {
    for (let i = 1; i <= n; i++) {
      const id = makeRunKey(new Date(Date.UTC(2026, 8, 1, 0, 0, i)), uuid(i));
      const op = makeOp({ id: `op${i}`, subject: { wikiId: i % 2 ? "odd" : "even", title: `T${i}` } });
      s.h.storage.store.set(id, makeRun(id, [op], new Date(Date.UTC(2026, 8, 1, 0, 0, i)).toISOString()));
    }
  }

  it("最初は新しい 30 実行・hasMore・loadMore で残りを足す。壊れた実行は数だけ返す", async () => {
    // 先に storage に置いてからマウントする
    const s = setup({ storageReady: false });
    seedRuns(s, 35);
    s.h.storage.store.set(makeRunKey(new Date(Date.UTC(2026, 7, 1)), uuid(99)), { broken: true });
    s.rerender({ ...s.deps, storageReady: true });

    await waitFor(() => expect(s.result.current.runs).toHaveLength(MAINTENANCE_LIST_PAGE_SIZE));
    expect(s.result.current.runs[0].id > s.result.current.runs[1].id).toBe(true); // 新しい順
    expect(s.result.current.hasMore).toBe(true);
    expect(s.result.current.loading).toBe(false);

    await act(async () => {
      await s.result.current.loadMore();
    });
    expect(s.result.current.runs).toHaveLength(35);
    expect(s.result.current.unreadableCount).toBe(1);
    expect(s.result.current.hasMore).toBe(false);

    // refresh しても広げた分は保たれる
    await act(async () => {
      await s.result.current.refresh();
    });
    expect(s.result.current.runs).toHaveLength(35);
  });

  it("storageReady が false の間は読まない。operationsForPage は読み込み済みの分から引く", async () => {
    const s = setup({ storageReady: false });
    seedRuns(s, 4);
    expect(s.result.current.runs).toHaveLength(0);
    s.rerender({ ...s.deps, storageReady: true });
    await waitFor(() => expect(s.result.current.runs).toHaveLength(4));
    expect(s.result.current.operationsForPage("odd").map((x) => x.op.id).sort()).toEqual(["op1", "op3"]);
    expect(s.result.current.operationsForPage("none")).toEqual([]);
  });

  it("プロバイダが替わると一覧を空にして読み直す", async () => {
    const s = setup();
    seedRuns(s, 2);
    await act(async () => {
      await s.result.current.refresh();
    });
    expect(s.result.current.runs).toHaveLength(2);

    const other = makeHost();
    s.rerender({ ...s.deps, providerId: "p2", getProvider: () => other.host.provider() });
    await waitFor(() => expect(s.result.current.runs).toHaveLength(0));
  });
});

describe("期限切れの掃除", () => {
  const expiredKey = (n: number) => makeRunKey(new Date(Date.UTC(2020, 0, 1, 0, 0, n)), uuid(n));

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-05T00:00:00Z"));
  });

  async function advance(ms: number) {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(ms);
    });
  }

  /** 掃除（接頭辞 "maint-"）の list だけを数える */
  const purgeCalls = (s: ReturnType<typeof setup>) =>
    vi.mocked(s.h.storage.listAppDataKeys).mock.calls.filter(([p]) => p === "maint-").length;

  function withSpy() {
    return setup({ storageReady: false }, { spy: true });
  }

  it("storageReady になってから数秒おいて 1 回だけ走り、期限切れだけを消す", async () => {
    const s = withSpy();
    s.h.storage.store.set(expiredKey(1), makeRun(expiredKey(1), []));
    await advance(MAINTENANCE_PURGE_DELAY_MS * 2);
    expect(purgeCalls(s)).toBe(0);

    s.rerender({ ...s.deps, storageReady: true });
    await advance(MAINTENANCE_PURGE_DELAY_MS - 1);
    expect(purgeCalls(s)).toBe(0);
    await advance(2);
    expect(purgeCalls(s)).toBe(1);
    expect(s.h.storage.store.has(expiredKey(1))).toBe(false);

    // 同じプロバイダでは 2 回目を走らせない
    s.rerender({ ...s.deps, storageReady: true });
    await advance(MAINTENANCE_PURGE_DELAY_MS * 3);
    expect(purgeCalls(s)).toBe(1);
  });

  it("providerId が変わるともう 1 回走る", async () => {
    const s = withSpy();
    s.rerender({ ...s.deps, storageReady: true });
    await advance(MAINTENANCE_PURGE_DELAY_MS + 1);
    expect(purgeCalls(s)).toBe(1);

    s.h.storage.store.set(expiredKey(2), makeRun(expiredKey(2), []));
    s.rerender({ ...s.deps, storageReady: true, providerId: "p2" });
    await advance(MAINTENANCE_PURGE_DELAY_MS + 1);
    expect(purgeCalls(s)).toBe(2);
    expect(s.h.storage.store.has(expiredKey(2))).toBe(false);
  });

  it("待っている間に providerId が変わると、古いほうのタイマーは捨てる", async () => {
    const s = withSpy();
    s.rerender({ ...s.deps, storageReady: true });
    await advance(MAINTENANCE_PURGE_DELAY_MS - 100);
    s.rerender({ ...s.deps, storageReady: true, providerId: "p2" });
    await advance(MAINTENANCE_PURGE_DELAY_MS + 1);
    expect(purgeCalls(s)).toBe(1);
  });

  it("アンマウントでタイマーが止まる", async () => {
    const s = withSpy();
    s.rerender({ ...s.deps, storageReady: true });
    s.unmount();
    await advance(MAINTENANCE_PURGE_DELAY_MS * 2);
    expect(purgeCalls(s)).toBe(0);
  });

  it("StrictMode で effect が 2 回走っても 1 回だけ走る", async () => {
    const s = setup({ storageReady: true }, { strict: true, spy: true });
    await advance(MAINTENANCE_PURGE_DELAY_MS + 1);
    expect(purgeCalls(s)).toBe(1);
  });

  it("掃除の失敗は握る（例外が外へ出ない）", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const s = withSpy();
    vi.mocked(s.h.storage.listAppDataKeys).mockImplementation(async () => {
      throw new Error("list failed");
    });
    s.rerender({ ...s.deps, storageReady: true });
    await advance(MAINTENANCE_PURGE_DELAY_MS + 1);
    expect(warn).toHaveBeenCalled();
  });
});

describe("一括アーカイブの取り消し・identity・take", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-05T00:00:00Z"));
  });

  it("bulk_archive は件数入りの確認文で、ログには戻した対象の wikiId と件数が入る", async () => {
    const s = setup();
    const run = await s.result.current.beginRun("bulk_archive");
    const op = await run.beginOperation({
      kind: "archive",
      related: [
        { wikiId: "t1", title: "話題A", role: "archived" },
        { wikiId: "t2", title: "話題B", role: "archived" },
      ],
    });
    await op.archive("t1");
    await op.archive("t2");
    const end = await op.end();
    await run.end();
    expect(s.h.flags.get("t2")?.archivedAt).toBeTruthy();

    let res: unknown;
    await act(async () => {
      res = await s.result.current.requestUndo({ runId: end.runId!, operationId: end.operationId });
    });
    expect((res as { status: string }).status).toBe("done");
    expect(vi.mocked(s.deps.confirm).mock.calls[0][0]).toContain("maintenance.op.archive_many");
    expect(vi.mocked(s.deps.confirm).mock.calls[0][0]).not.toContain("話題A");
    expect(s.h.flags.get("t2")?.archivedAt).toBeNull();
    const [, ids, summary] = vi.mocked(s.deps.appendLog).mock.calls[0];
    expect([...(ids as string[])].sort()).toEqual(["t1", "t2"]);
    expect(summary).toContain('"count":"2"');
  });

  it("blockersOf / operationsForPage は runs が変わると identity が変わる", async () => {
    const s = setup();
    const before = s.result.current.operationsForPage;
    const beforeB = s.result.current.blockersOf;
    await mergeOnce(s);
    await waitFor(() => expect(s.result.current.runs).toHaveLength(1));
    expect(s.result.current.operationsForPage).not.toBe(before);
    expect(s.result.current.blockersOf).not.toBe(beforeB);
    expect(s.result.current.operationsForPage("t1")).toHaveLength(1);
  });

  it("recordedOperationsOf は取り出すと空になる", async () => {
    const s = setup();
    const { run } = await mergeOnce(s);
    expect(s.result.current.recordedOperationsOf(run)).toHaveLength(1);
    expect(s.result.current.recordedOperationsOf(run)).toHaveLength(0);
  });
});
