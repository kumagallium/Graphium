import { afterEach, describe, expect, it, vi } from "vitest";
import type { GraphiumDocument } from "../../lib/document-types";
import { beginMaintenanceRun } from "./recorder";
import { deriveOperationStates, makeCopyKey, makeRunKey, operationKey } from "./run-format";
import { loadRecentRuns, saveRunMeta, writePageCopy } from "./run-store";
import { describeUndoImpact, undoMaintenanceOperation, type UndoExtras } from "./undo";
import { makeDoc, makeHost, makeOp, makeRun, UUID_A } from "./test-helpers";
import type { MaintenanceRunHandle } from "./recorder";
import { asMaintenanceStorage } from "./types";

type H = ReturnType<typeof makeHost>;

const textOf = (d: GraphiumDocument | undefined) =>
  (d?.pages[0].blocks[0] as unknown as { content: { text: string }[] }).content[0].text;

function makeExtras(over: Partial<UndoExtras> = {}) {
  return {
    getAuthor: vi.fn(async () => ({ email: "u@example.com" })),
    afterRestore: vi.fn(async () => {}),
    logUndone: vi.fn(async () => {}),
    ...over,
  };
}

/** 統合 1 件を記録つきで行う（target に本文を書き、sources をゴミ箱（merge_atoms はアーカイブ）へ） */
async function doMerge(
  h: H,
  targetId: string,
  sources: string[],
  next: GraphiumDocument,
  kind: "merge_topics" | "merge_atoms" = "merge_topics",
) {
  const run = await beginMaintenanceRun(h.host, { trigger: kind, actor: { via: "app" } });
  const op = await run.beginOperation({
    kind,
    subject: { wikiId: targetId, title: next.title },
    related: sources.map((id) => ({ wikiId: id, title: id, role: "absorbed" as const })),
  });
  try {
    await op.save(targetId, next);
    for (const s of sources) {
      if (kind === "merge_atoms") await op.archive(s);
      else await op.trash(s);
    }
  } finally {
    await op.end();
    await run.end();
  }
  return { runId: run.id, operationId: op.id };
}

const storageOf = (h: H) => asMaintenanceStorage(h.storage)!;
const allRuns = async (h: H) => (await loadRecentRuns(storageOf(h), { limit: 100 })).runs;
const stateOf = async (h: H, t: { runId: string; operationId: string }) =>
  deriveOperationStates(await allRuns(h), new Set()).get(operationKey(t.runId, t.operationId))?.state;

function setupMerge() {
  const h = makeHost();
  h.addPage("w1", makeDoc("統合先", "旧"));
  h.addPage("w2", makeDoc("吸収される", "x"));
  return h;
}

const openRuns: MaintenanceRunHandle[] = [];
afterEach(async () => {
  for (const r of openRuns.splice(0)) await r.end();
  vi.restoreAllMocks();
});

describe("話題の統合の取り消し", () => {
  it("残す側の内容と、吸収側のフラグが戻る。編集の記録は maintenance_undo", async () => {
    const h = setupMerge();
    const t = await doMerge(h, "w1", ["w2"], makeDoc("統合先", "新"));
    expect(textOf(h.pages.get("w1"))).toBe("新");
    expect(h.flags.get("w2")?.deletedAt).toBeTruthy();

    const extras = makeExtras();
    const out = await undoMaintenanceOperation(h.host, extras, t);

    expect(out.status).toBe("done");
    if (out.status !== "done") return;
    expect(out.restoredPages.map((p) => p.wikiId)).toEqual(["w1"]);
    expect(out.restoredFlags).toEqual([{ wikiId: "w2", flag: "deletedAt" }]);
    expect(out.failedPages).toEqual([]);
    expect(out.failedFlags).toEqual([]);
    expect(textOf(h.pages.get("w1"))).toBe("旧");
    expect(h.flags.get("w2")?.deletedAt).toBeNull();

    // 編集の記録: 人の操作 maintenance_undo が 1 件
    const prov = h.pages.get("w1")!.documentProvenance!;
    expect(prov.activities[prov.activities.length - 1]?.type).toBe("maintenance_undo");
    expect(extras.getAuthor).toHaveBeenCalledTimes(1);
    // 検索の取り直し・エディタの差し替えは戻したページごと
    expect(extras.afterRestore).toHaveBeenCalledTimes(1);
    expect(extras.afterRestore).toHaveBeenCalledWith("w1", expect.objectContaining({ title: "統合先" }));
    expect(extras.logUndone).toHaveBeenCalledWith(
      expect.objectContaining({ target: t, restoredPageCount: 1, failedCount: 0 }),
    );
    // 取り消し自身も 1 操作として記録され、元の操作は「取り消し済み」と導かれる
    const runs = await allRuns(h);
    expect(runs).toHaveLength(2);
    const undoRun = runs.find((r) => r.id === out.undoRunId)!;
    expect(undoRun.trigger).toBe("undo");
    expect(undoRun.operations[0]).toMatchObject({
      kind: "undo",
      status: "applied",
      undoOf: t,
      related: [{ wikiId: "w2", role: "absorbed" }],
    });
    expect(undoRun.operations[0].undoResult?.pages).toEqual([{ wikiId: "w1", ok: true }]);
    expect(undoRun.operations[0].pages).toHaveLength(1); // 取り消す前の内容も写しに残る
    expect(await stateOf(h, t)).toBe("undone");
  });

  it("merge_atoms のアーカイブも戻る", async () => {
    const h = setupMerge();
    const t = await doMerge(h, "w1", ["w2"], makeDoc("統合先", "新"), "merge_atoms");
    expect(h.flags.get("w2")?.archivedAt).toBeTruthy();
    const out = await undoMaintenanceOperation(h.host, makeExtras(), t);
    expect(out.status).toBe("done");
    expect(h.flags.get("w2")?.archivedAt).toBeNull();
  });

  it("洞察の統合: 本文が同じでも title と wikiMeta が戻る", async () => {
    const h = makeHost();
    const before = makeDoc("旧タイトル", "同じ本文", {
      wikiMeta: { kind: "atom", note: "旧" } as never,
    });
    h.addPage("w1", before);
    h.addPage("w2", makeDoc("吸収", "x"));
    const next = makeDoc("新タイトル", "同じ本文", { wikiMeta: { kind: "atom", note: "新" } as never });
    const t = await doMerge(h, "w1", ["w2"], next, "merge_atoms");
    expect(h.pages.get("w1")?.title).toBe("新タイトル");

    const out = await undoMaintenanceOperation(h.host, makeExtras(), t);

    expect(out.status).toBe("done");
    expect(h.pages.get("w1")?.title).toBe("旧タイトル");
    expect((h.pages.get("w1")?.wikiMeta as unknown as { note: string }).note).toBe("旧");
  });
});

describe("一部が戻せないとき", () => {
  it("吸収側が完全削除済みなら、その分だけ失敗を書き、状態は一部だけ取り消し済み", async () => {
    const h = setupMerge();
    h.addPage("w3", makeDoc("吸収 2", "x"));
    const t = await doMerge(h, "w1", ["w2", "w3"], makeDoc("統合先", "新"));
    h.flags.delete("w3"); // 完全削除（索引から消える）
    h.pages.delete("w3");

    const out = await undoMaintenanceOperation(h.host, makeExtras(), t);

    expect(out.status).toBe("done");
    if (out.status !== "done") return;
    expect(out.restoredFlags).toEqual([{ wikiId: "w2", flag: "deletedAt" }]);
    expect(out.failedFlags).toEqual([{ wikiId: "w3", flag: "deletedAt", reason: "not_in_index" }]);
    expect(textOf(h.pages.get("w1"))).toBe("旧");
    expect(await stateOf(h, t)).toBe("undo_partial");
  });

  it("残す側のページが完全削除されていれば、そのページは失敗にして先へ進む", async () => {
    const h = setupMerge();
    const t = await doMerge(h, "w1", ["w2"], makeDoc("統合先", "新"));
    h.pages.delete("w1");

    const out = await undoMaintenanceOperation(h.host, makeExtras(), t);

    if (out.status !== "done") throw new Error("done のはず");
    expect(out.failedPages).toEqual([{ wikiId: "w1", title: "統合先", reason: "missing" }]);
    expect(out.restoredFlags).toHaveLength(1); // フラグは戻る
    expect(await stateOf(h, t)).toBe("undo_partial");
  });

  it("人がすでに手で戻していたフラグは触らない（失敗にもしない）", async () => {
    const h = setupMerge();
    const t = await doMerge(h, "w1", ["w2"], makeDoc("統合先", "新"));
    h.flags.get("w2")!.deletedAt = null; // 人がゴミ箱から戻した

    const out = await undoMaintenanceOperation(h.host, makeExtras(), t);

    if (out.status !== "done") throw new Error("done のはず");
    expect(h.host.restoreWikiFlag).not.toHaveBeenCalled();
    expect(out.failedFlags).toEqual([]);
    expect(await stateOf(h, t)).toBe("undone");
  });

  it("フラグが別の値に変わっていたら触らず失敗にする", async () => {
    const h = setupMerge();
    const t = await doMerge(h, "w1", ["w2"], makeDoc("統合先", "新"));
    h.flags.get("w2")!.deletedAt = "2099-01-01T00:00:00.000Z"; // 人があとからもう一度ゴミ箱へ

    const out = await undoMaintenanceOperation(h.host, makeExtras(), t);

    if (out.status !== "done") throw new Error("done のはず");
    expect(h.host.restoreWikiFlag).not.toHaveBeenCalled();
    expect(out.failedFlags).toEqual([{ wikiId: "w2", flag: "deletedAt", reason: "flag_changed" }]);
  });

  it("途中で保存が失敗しても例外にせず、そのページを失敗にして結果に書く", async () => {
    const h = makeHost();
    h.addPage("w1", makeDoc("A", "旧A"));
    const run = await beginMaintenanceRun(h.host, { trigger: "rebuild_topics", actor: { via: "app" } });
    const o1 = await run.beginOperation({ kind: "regenerate", subject: { wikiId: "w1", title: "A" } });
    await o1.save("w1", makeDoc("A", "新A"));
    await o1.end();
    await run.end();

    // 取り消し中、保存は常に false
    h.host.saveWikiFile.mockImplementation(async () => false);
    const out = await undoMaintenanceOperation(h.host, makeExtras(), {
      runId: run.id,
      operationId: o1.id,
    });
    if (out.status !== "done") throw new Error("done のはず");
    expect(out.failedPages.map((p) => p.wikiId)).toEqual(["w1"]);
    expect(out.failedPages[0].reason).toContain("error");
    expect(textOf(h.pages.get("w1"))).toBe("新A");
    expect(await stateOf(h, { runId: run.id, operationId: o1.id })).toBe("undo_partial");
  });
});

describe("取り消しの取り消し", () => {
  it("ページとフラグが再び戻り、そのあとにもう一度元の操作を取り消せる", async () => {
    const h = setupMerge();
    const t = await doMerge(h, "w1", ["w2"], makeDoc("統合先", "新"));

    const u1 = await undoMaintenanceOperation(h.host, makeExtras(), t);
    if (u1.status !== "done") throw new Error("u1");
    expect(textOf(h.pages.get("w1"))).toBe("旧");
    expect(h.flags.get("w2")?.deletedAt).toBeNull();

    // 取り消しを取り消す: 統合後の内容とゴミ箱が戻る
    const uu = await undoMaintenanceOperation(h.host, makeExtras(), {
      runId: u1.undoRunId,
      operationId: u1.undoOperationId,
    });
    expect(uu.status).toBe("done");
    expect(textOf(h.pages.get("w1"))).toBe("新");
    expect(h.flags.get("w2")?.deletedAt).toBeTruthy();
    expect(await stateOf(h, t)).toBe("applied");

    // そのあとの再取り消し（ゴミ箱の時刻は作り直されているが、鎖から導いて動かす）
    const again = await undoMaintenanceOperation(h.host, makeExtras(), t);
    if (again.status !== "done") throw new Error(`again: ${JSON.stringify(again)}`);
    expect(again.failedFlags).toEqual([]);
    expect(textOf(h.pages.get("w1"))).toBe("旧");
    expect(h.flags.get("w2")?.deletedAt).toBeNull();
    expect(await stateOf(h, t)).toBe("undone");
  });

  it("取り消し済みの操作は断る", async () => {
    const h = setupMerge();
    const t = await doMerge(h, "w1", ["w2"], makeDoc("統合先", "新"));
    await undoMaintenanceOperation(h.host, makeExtras(), t);
    const again = await undoMaintenanceOperation(h.host, makeExtras(), t);
    expect(again).toEqual({ status: "refused", refusal: { code: "already_undone" } });
  });
});

describe("取り消せない場合", () => {
  it("より新しい有効な操作が同じページに関わっていれば断り、妨げる操作を返す", async () => {
    const h = setupMerge();
    h.addPage("w3", makeDoc("吸収 3", "x"));
    const t1 = await doMerge(h, "w1", ["w2"], makeDoc("統合先", "一"));
    const t2 = await doMerge(h, "w1", ["w3"], makeDoc("統合先", "二"));

    const out = await undoMaintenanceOperation(h.host, makeExtras(), t1);

    expect(out.status).toBe("refused");
    if (out.status !== "refused" || out.refusal.code !== "blocked") throw new Error("blocked のはず");
    expect(out.refusal.blockers.map((b) => b.operationId)).toEqual([t2.operationId]);
    expect(textOf(h.pages.get("w1"))).toBe("二"); // 何も変えていない
    // 見積もりも同じ判定
    const impact = await describeUndoImpact(h.host, await allRuns(h), t1);
    expect(impact.canUndo).toBe(false);
    expect(impact.refusal?.code).toBe("blocked");
    // 新しいほうは取り消せる
    expect((await undoMaintenanceOperation(h.host, makeExtras(), t2)).status).toBe("done");
    // 新しい順に巻き戻せば、古いほうも取り消せる
    expect((await undoMaintenanceOperation(h.host, makeExtras(), t1)).status).toBe("done");
  });

  it("対象の操作が無い（期限切れ）・写しが読めない", async () => {
    const h = setupMerge();
    const t = await doMerge(h, "w1", ["w2"], makeDoc("統合先", "新"));
    expect(
      await undoMaintenanceOperation(h.host, makeExtras(), { runId: t.runId, operationId: "nope" }),
    ).toEqual({ status: "refused", refusal: { code: "not_found" } });

    const [copyKey] = [...h.storage.store.keys()].filter((k) => k.startsWith("maint-copy-"));
    h.storage.store.delete(copyKey);
    const out = await undoMaintenanceOperation(h.host, makeExtras(), t);
    expect(out).toEqual({
      status: "refused",
      refusal: { code: "copy_unreadable", copyKeys: [copyKey] },
    });
    expect(textOf(h.pages.get("w1"))).toBe("新");
  });

  it("いま動いている実行の操作は断る", async () => {
    const h = setupMerge();
    const run = await beginMaintenanceRun(h.host, { trigger: "merge_topics", actor: { via: "app" } });
    openRuns.push(run);
    const op = await run.beginOperation({ kind: "merge_topics", subject: { wikiId: "w1", title: "x" } });
    await op.save("w1", makeDoc("統合先", "新"));

    const out = await undoMaintenanceOperation(h.host, makeExtras(), { runId: run.id, operationId: op.id });
    expect(out).toEqual({ status: "refused", refusal: { code: "in_progress" } });
    await op.end();
  });

  it("同じ操作の取り消しが同時に 2 つ走らない", async () => {
    const h = setupMerge();
    const t = await doMerge(h, "w1", ["w2"], makeDoc("統合先", "新"));
    const extras = makeExtras({
      getAuthor: vi.fn(async () => {
        await new Promise((r) => setTimeout(r, 10));
        return {};
      }),
    });

    const results = await Promise.all([
      undoMaintenanceOperation(h.host, extras, t),
      undoMaintenanceOperation(h.host, extras, t),
    ]);

    const statuses = results.map((x) => (x.status === "done" ? "done" : x.refusal.code));
    expect(statuses.sort()).toEqual(["done", "in_progress"]);
    expect((await allRuns(h)).filter((r) => r.trigger === "undo")).toHaveLength(1);
  });

  it("取り消し自身の記録が書けないなら、ページにもフラグにも触らず断る", async () => {
    const h = setupMerge();
    const t = await doMerge(h, "w1", ["w2"], makeDoc("統合先", "新"));
    const writeSpy = vi
      .spyOn(h.storage as { writeAppData: (k: string, v: string) => Promise<void> }, "writeAppData")
      .mockRejectedValue(new Error("disk"));
    const out = await undoMaintenanceOperation(h.host, makeExtras(), t);
    writeSpy.mockRestore();
    expect(out.status).toBe("refused");
    expect(textOf(h.pages.get("w1"))).toBe("新");
    expect(h.flags.get("w2")?.deletedAt).toBeTruthy();
  });

  it("ストレージが非対応なら断る", async () => {
    const h = setupMerge();
    h.host.provider = () => ({}) as never;
    const out = await undoMaintenanceOperation(h.host, makeExtras(), { runId: "x", operationId: "y" });
    expect(out).toEqual({ status: "refused", refusal: { code: "unsupported" } });
  });
});

describe("中断された操作", () => {
  /** 落ちた実行を直接組み立てる（フラグの記録は欠けている） */
  async function setupInterrupted(h: H) {
    const startedAt = new Date(Date.UTC(2026, 9, 1, 0, 0, 0));
    const runKey = makeRunKey(startedAt, UUID_A);
    const copyKey = makeCopyKey(runKey, 0);
    const st = storageOf(h);
    const { documentProvenance: _p, ...copyDoc } = makeDoc("統合先", "旧");
    void _p;
    await writePageCopy(st, copyKey, {
      formatVersion: 1,
      runId: runKey,
      operationId: "o1",
      wikiId: "w1",
      capturedAt: startedAt.toISOString(),
      doc: copyDoc,
    });
    await saveRunMeta(
      st,
      makeRun(runKey, [
        makeOp({
          id: "o1",
          status: "running",
          startedAt: startedAt.toISOString(),
          subject: { wikiId: "w1", title: "統合先" },
          related: [
            { wikiId: "w2", title: "吸収された", role: "absorbed" },
            { wikiId: "w3", title: "前から捨てていた", role: "absorbed" },
          ],
          pages: [{ wikiId: "w1", title: "統合先", copyKey }],
        }),
      ]),
    );
    return { runId: runKey, operationId: "o1" };
  }

  it("導出上は interrupted。開始以降に立ったフラグだけを補って戻す", async () => {
    const h = makeHost();
    h.addPage("w1", makeDoc("統合先", "新"));
    h.addPage("w2", makeDoc("吸収された", "x"), { deletedAt: "2026-10-01T00:05:00.000Z" });
    h.addPage("w3", makeDoc("前から捨てていた", "x"), { deletedAt: "2026-09-01T00:00:00.000Z" });
    const t = await setupInterrupted(h);
    expect(await stateOf(h, t)).toBe("interrupted");

    const impact = await describeUndoImpact(h.host, await allRuns(h), t);
    expect(impact.canUndo).toBe(true);
    expect(impact.flags.map((f) => f.wikiId)).toEqual(["w2"]);

    const out = await undoMaintenanceOperation(h.host, makeExtras(), t);

    if (out.status !== "done") throw new Error(JSON.stringify(out));
    expect(textOf(h.pages.get("w1"))).toBe("旧");
    expect(h.flags.get("w2")?.deletedAt).toBeNull();
    expect(h.flags.get("w3")?.deletedAt).toBe("2026-09-01T00:00:00.000Z"); // 開始より前のものは触らない
    expect(await stateOf(h, t)).toBe("undone");
  });
});

describe("やり直し", () => {
  it("すでに写しと同じ内容のページは書かない（二重に書かない）", async () => {
    const h = setupMerge();
    h.addPage("w3", makeDoc("吸収 2", "x"));
    const t = await doMerge(h, "w1", ["w2", "w3"], makeDoc("統合先", "新"));
    h.flags.delete("w3");
    h.pages.delete("w3");

    const first = await undoMaintenanceOperation(h.host, makeExtras(), t);
    expect(first.status).toBe("done");
    expect(await stateOf(h, t)).toBe("undo_partial");
    const savesAfterFirst = h.host.saveWikiFile.mock.calls.length;
    const extras = makeExtras();

    const second = await undoMaintenanceOperation(h.host, extras, t);

    if (second.status !== "done") throw new Error(JSON.stringify(second));
    expect(h.host.saveWikiFile.mock.calls.length).toBe(savesAfterFirst); // 保存は増えない
    expect(second.restoredPages).toEqual([]);
    expect(second.unchangedPages.map((p) => p.wikiId)).toEqual(["w1"]);
    expect(extras.afterRestore).not.toHaveBeenCalled();
    expect(textOf(h.pages.get("w1"))).toBe("旧");
  });
});

describe("describeUndoImpact", () => {
  it("操作のあとの編集の回数・記録に残らない変更・照合の結果・完全削除を返す", async () => {
    const h = makeHost();
    h.addPage("w1", makeDoc("A", "旧", { wikiMeta: { kind: "atom" } as never }));
    h.addPage("w2", makeDoc("B", "旧"));
    h.addPage("w3", makeDoc("C", "旧"));
    const run = await beginMaintenanceRun(h.host, { trigger: "rebuild_topics", actor: { via: "app" } });
    const op = await run.beginOperation({ kind: "regenerate" });
    for (const id of ["w1", "w2", "w3"]) await op.save(id, makeDoc(id, "新"));
    await op.end();
    await run.end();
    const t = { runId: run.id, operationId: op.id };

    const later = "2099-01-01T00:00:00.000Z";
    const rev = (n: number) => ({
      id: `rev-${n}`,
      savedAt: later,
      summary: {},
      contentHash: "h",
      wasGeneratedBy: "e",
    });
    // w1: 2 回編集され、照合の結果もついた
    h.pages.set(
      "w1",
      makeDoc("w1", "新", {
        modifiedAt: later,
        wikiMeta: { kind: "atom", sourceCheck: { checkedAt: later } } as never,
        documentProvenance: { revisions: [rev(1), rev(2)], activities: [], agents: [] } as never,
      }),
    );
    // w2: 記録に残らない変更（modifiedAt だけ進んでいる）
    h.pages.set("w2", makeDoc("w2", "新", { modifiedAt: later }));
    // w3: 完全削除
    h.pages.delete("w3");

    const impact = await describeUndoImpact(h.host, await allRuns(h), t);

    expect(impact.canUndo).toBe(true);
    const by = Object.fromEntries(impact.pages.map((p) => [p.wikiId, p]));
    expect(by.w1).toMatchObject({ editsAfter: 2, untrackedChange: false, checksAlsoRevert: true, deleted: false });
    expect(by.w2).toMatchObject({ editsAfter: 0, untrackedChange: true, checksAlsoRevert: false });
    expect(by.w3).toMatchObject({ deleted: true });
  });

  it("フラグの対象が索引に無いと restorable: false", async () => {
    const h = setupMerge();
    const t = await doMerge(h, "w1", ["w2"], makeDoc("統合先", "新"));
    h.flags.delete("w2");
    const impact = await describeUndoImpact(h.host, await allRuns(h), t);
    expect(impact.canUndo).toBe(true);
    expect(impact.flags).toEqual([{ wikiId: "w2", flag: "deletedAt", title: "w2", restorable: false }]);
  });

  it("書き込みをしない（見積もりは読むだけ）", async () => {
    const h = setupMerge();
    const t = await doMerge(h, "w1", ["w2"], makeDoc("統合先", "新"));
    const runs = await allRuns(h);
    const keysBefore = [...h.storage.store.keys()].sort();
    const saves = h.host.saveWikiFile.mock.calls.length;
    await describeUndoImpact(h.host, runs, t);
    expect([...h.storage.store.keys()].sort()).toEqual(keysBefore);
    expect(h.host.saveWikiFile.mock.calls.length).toBe(saves);
  });
});

describe("describeUndoImpact: 未保存の編集の書き出し", () => {
  it("ページを読む前に flushEditors を待つ（排他は取らない）", async () => {
    const h = setupMerge();
    const t = await doMerge(h, "w1", ["w2"], makeDoc("統合先", "新"));
    const runs = await allRuns(h);
    h.host.flushEditors.mockClear();
    h.host.loadWikiDocFresh.mockClear();
    const order: string[] = [];
    h.host.flushEditors.mockImplementation(async (id: string) => {
      order.push(`flush:${id}`);
    });
    const load = h.host.loadWikiDocFresh.getMockImplementation()!;
    h.host.loadWikiDocFresh.mockImplementation(async (id: string) => {
      order.push(`load:${id}`);
      return load(id);
    });
    await describeUndoImpact(h.host, runs, t);
    expect(order).toEqual(["flush:w1", "load:w1"]);
  });
});

describe("壊れた記録が混ざっていても", () => {
  it("壊れた要素を持つ実行が 1 件あっても、他の実行の一覧・妨げの判定・取り消しが動く", async () => {
    const h = setupMerge();
    const t = await doMerge(h, "w1", ["w2"], makeDoc("統合先", "新"));
    // 壊れた実行（related に null・pages の copyKey が無い）を、新しい時刻のキーで足す
    const badKey = makeRunKey(new Date(Date.UTC(2099, 0, 1)), "99999999-2222-3333-4444-555555555555");
    h.storage.store.set(
      badKey,
      makeRun(badKey, [
        makeOp({ id: "bad1", related: [null as never], pages: [{ wikiId: "w1", title: "", copyKey: "x" }] }),
      ]),
    );

    // 一覧: 壊れた実行は飛ばされ、元の実行は出る
    const { runs, unreadable } = await loadRecentRuns(storageOf(h), { limit: 100 });
    expect(unreadable).toEqual([badKey]);
    expect(runs.map((r) => r.id)).toContain(t.runId);

    // 妨げの判定・見積もり・取り消しは壊れた実行に邪魔されない
    const impact = await describeUndoImpact(h.host, runs, t);
    expect(impact.canUndo).toBe(true);
    const out = await undoMaintenanceOperation(h.host, makeExtras(), t);
    expect(out.status).toBe("done");
    expect(textOf(h.pages.get("w1"))).toBe("旧");
    expect(h.flags.get("w2")?.deletedAt).toBeNull();
  });
});
