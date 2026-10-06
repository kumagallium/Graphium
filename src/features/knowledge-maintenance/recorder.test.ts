import { afterEach, describe, expect, it, vi } from "vitest";
import {
  activeRunIds,
  beginMaintenanceRun,
  isMaintenanceRecordFailed,
  isMaintenanceSaveBusy,
  isMaintenanceSaveFailed,
  resetUnsupportedWarningForTest,
  SAVE_MAX_ATTEMPTS,
} from "./recorder";
import { loadPageCopy, loadRun } from "./run-store";
import { makeDoc, makeHost } from "./test-helpers";
import type { MaintenanceRunHandle } from "./recorder";
import { asMaintenanceStorage } from "./types";

const keysOf = (h: ReturnType<typeof makeHost>, prefix: string) =>
  [...h.storage.store.keys()].filter((k) => k.startsWith(prefix));

async function begin(h: ReturnType<typeof makeHost>): Promise<MaintenanceRunHandle> {
  return beginMaintenanceRun(h.host, { trigger: "merge_topics", actor: { via: "app" } });
}

const openRuns: MaintenanceRunHandle[] = [];
afterEach(async () => {
  // 閉じ忘れが他のテストの activeRunIds に漏れないように
  for (const r of openRuns.splice(0)) await r.end();
  vi.restoreAllMocks();
});

describe("op.save の順序", () => {
  it("写しとメタが、元の保存より先に書かれる", async () => {
    const h = makeHost();
    h.addPage("w1", makeDoc("A", "旧"));
    const run = await begin(h);
    openRuns.push(run);
    const op = await run.beginOperation({ kind: "regenerate", subject: { wikiId: "w1", title: "A" } });
    h.calls.length = 0;

    await op.save("w1", makeDoc("A", "新"));

    const iFlush = h.calls.indexOf("flush:w1");
    const iCopy = h.calls.findIndex((c) => c.startsWith("write:maint-copy-"));
    const iMeta = h.calls.findIndex((c) => c.startsWith("write:maint-run-"));
    const iSave = h.calls.indexOf("save:w1");
    expect(iFlush).toBeGreaterThanOrEqual(0);
    expect(iFlush).toBeLessThan(iCopy);
    expect(iCopy).toBeLessThan(iMeta);
    expect(iMeta).toBeLessThan(iSave);
    expect(h.host.loadWikiDocFresh).toHaveBeenCalledWith("w1");

    const [copyKey] = keysOf(h, "maint-copy-");
    const copy = await loadPageCopy(asMaintenanceStorage(h.storage)!, copyKey);
    expect(copy?.doc.pages[0].blocks[0]).toMatchObject({ content: [{ text: "旧" }] });
    expect(copy?.doc).not.toHaveProperty("documentProvenance");
    await op.end();
    await run.end();
  });

  it("写しが書けなければ保存しない", async () => {
    const h = makeHost();
    h.addPage("w1", makeDoc("A", "旧"));
    const raw = h.storage.writeAppData;
    h.storage.writeAppData = async (k, v) => {
      if (k.startsWith("maint-copy-")) throw new Error("disk full");
      await raw(k, v);
    };
    const run = await begin(h);
    openRuns.push(run);
    const op = await run.beginOperation({ kind: "regenerate" });

    await expect(op.save("w1", makeDoc("A", "新"))).rejects.toThrow("disk full");
    expect(h.host.saveWikiFile).not.toHaveBeenCalled();
    expect(h.pages.get("w1")).toEqual(makeDoc("A", "旧"));
    await op.end();
  });

  it("メタが書けなければ保存せず、写しも片付ける", async () => {
    const h = makeHost();
    h.addPage("w1", makeDoc("A", "旧"));
    // 開始時のメタは書けて、写しのあとのメタだけ失敗させる
    let failMeta = false;
    const raw = h.storage.writeAppData;
    h.storage.writeAppData = async (k, v) => {
      if (failMeta && k.startsWith("maint-run-")) throw new Error("meta fail");
      await raw(k, v);
    };
    const run = await begin(h);
    openRuns.push(run);
    const op = await run.beginOperation({ kind: "regenerate" });
    failMeta = true;

    await expect(op.save("w1", makeDoc("A", "新"))).rejects.toThrow("meta fail");
    expect(h.host.saveWikiFile).not.toHaveBeenCalled();
    expect(keysOf(h, "maint-copy-")).toEqual([]);
  });

  it("同じページを 2 回保存しても、写しは最初の 1 回だけ", async () => {
    const h = makeHost();
    h.addPage("w1", makeDoc("A", "旧"));
    const run = await begin(h);
    openRuns.push(run);
    const op = await run.beginOperation({ kind: "regenerate" });

    await op.save("w1", makeDoc("A", "中間"));
    await op.save("w1", makeDoc("A", "最終"));

    expect(keysOf(h, "maint-copy-")).toHaveLength(1);
    const [copyKey] = keysOf(h, "maint-copy-");
    const copy = await loadPageCopy(asMaintenanceStorage(h.storage)!, copyKey);
    expect(copy?.doc.pages[0].blocks[0]).toMatchObject({ content: [{ text: "旧" }] });
    await op.end();
    await run.end();
    const saved = await loadRun(asMaintenanceStorage(h.storage)!, run.id);
    expect(saved?.operations[0].pages).toHaveLength(1);
  });

  it("現在の内容が読めないページ（新規）は写しなしで保存し、2 回目も写さない", async () => {
    const h = makeHost();
    const run = await begin(h);
    openRuns.push(run);
    const op = await run.beginOperation({ kind: "regenerate" });

    await op.save("new1", makeDoc("N", "1"));
    await op.save("new1", makeDoc("N", "2"));

    expect(h.host.saveWikiFile).toHaveBeenCalledTimes(2);
    expect(keysOf(h, "maint-copy-")).toEqual([]);
  });

  it("保存の戻り値を返す", async () => {
    const h = makeHost();
    h.addPage("w1", makeDoc("A", "旧"));
    const run = await begin(h);
    openRuns.push(run);
    const op = await run.beginOperation({ kind: "regenerate" });
    await expect(op.save("w1", makeDoc("A", "新"))).resolves.toBe(true);
  });
});

describe("保存が false（保存中）を返したとき", () => {
  it("間隔を空けて試し、途中で成功すれば成功にする", async () => {
    const h = makeHost();
    h.addPage("w1", makeDoc("A", "旧"));
    h.saveResults.push(false, false);
    const run = await begin(h);
    openRuns.push(run);
    const op = await run.beginOperation({ kind: "regenerate" });

    await expect(op.save("w1", makeDoc("A", "新"))).resolves.toBe(true);
    expect(h.host.saveWikiFile).toHaveBeenCalledTimes(3);
    expect(h.host.sleep).toHaveBeenCalledTimes(2);
    expect(h.pages.get("w1")?.pages[0].blocks[0]).toMatchObject({ content: [{ text: "新" }] });
  });

  it("5 回とも false なら例外にする（写しは 1 つだけ）", async () => {
    const h = makeHost();
    h.addPage("w1", makeDoc("A", "旧"));
    h.saveResults.push(...Array(SAVE_MAX_ATTEMPTS).fill(false));
    const run = await begin(h);
    openRuns.push(run);
    const op = await run.beginOperation({ kind: "regenerate" });

    await expect(op.save("w1", makeDoc("A", "新"))).rejects.toThrow();
    expect(SAVE_MAX_ATTEMPTS).toBe(5);
    expect(h.host.saveWikiFile).toHaveBeenCalledTimes(5);
    expect(h.host.sleep).toHaveBeenCalledTimes(4);
    expect(keysOf(h, "maint-copy-")).toHaveLength(1);
  });
});

describe("保存の失敗と保存中の見分け", () => {
  it("false のあと isSaving が false なら、再試行せず save_failed を投げる", async () => {
    const h = makeHost();
    h.addPage("w1", makeDoc("A", "旧"));
    h.saveResults.push(false);
    const host = { ...h.host, isSaving: () => false };
    const run = await beginMaintenanceRun(host, { trigger: "merge_topics", actor: { via: "app" } });
    openRuns.push(run);
    const op = await run.beginOperation({ kind: "regenerate" });

    const err = await op.save("w1", makeDoc("A", "新")).catch((e) => e);
    expect(isMaintenanceSaveFailed(err)).toBe(true);
    expect(isMaintenanceSaveBusy(err)).toBe(false);
    expect(err.code).toBe("save_failed");
    expect(h.host.saveWikiFile).toHaveBeenCalledTimes(1);
    expect(h.host.sleep).not.toHaveBeenCalled();
  });

  it("false のあと isSaving が true なら、今までどおり再試行して最後は save_busy", async () => {
    const h = makeHost();
    h.addPage("w1", makeDoc("A", "旧"));
    h.saveResults.push(...Array(SAVE_MAX_ATTEMPTS).fill(false));
    const host = { ...h.host, isSaving: () => true };
    const run = await beginMaintenanceRun(host, { trigger: "merge_topics", actor: { via: "app" } });
    openRuns.push(run);
    const op = await run.beginOperation({ kind: "regenerate" });

    const err = await op.save("w1", makeDoc("A", "新")).catch((e) => e);
    expect(isMaintenanceSaveBusy(err)).toBe(true);
    expect(h.host.saveWikiFile).toHaveBeenCalledTimes(SAVE_MAX_ATTEMPTS);
  });
});

describe("記録を始められないとき・写しが書けないとき", () => {
  it("実行のメタが書けなければ、例外にせず記録なしの素通しにして通知する", async () => {
    const h = makeHost();
    h.addPage("w1", makeDoc("A", "旧"));
    h.addPage("w2", makeDoc("B", "x"));
    h.storage.writeAppData = async () => {
      throw new Error("disk full");
    };
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const onRecordingUnavailable = vi.fn();
    const run = await beginMaintenanceRun({ ...h.host, onRecordingUnavailable }, {
      trigger: "merge_topics",
      actor: { via: "app" },
    });
    openRuns.push(run);

    const op = await run.beginOperation({ kind: "merge_topics", related: [{ wikiId: "w2", title: "B", role: "absorbed" }] });
    expect(op.recording).toBe(false);
    expect(onRecordingUnavailable).toHaveBeenCalledTimes(1);
    expect(String(onRecordingUnavailable.mock.calls[0][0])).toContain("disk full");

    // 操作そのものは今までどおり動く
    await expect(op.save("w1", makeDoc("A", "新"))).resolves.toBe(true);
    await op.trash("w2");
    expect(h.flags.get("w2")?.deletedAt).not.toBeNull();
    expect(await op.end()).toMatchObject({ recorded: false });
    expect(await run.end()).toEqual({ recorded: false });
    expect(keysOf(h, "maint-")).toEqual([]);
  });

  it("通知の呼び出しが例外でも握る", async () => {
    const h = makeHost();
    h.storage.writeAppData = async () => {
      throw new Error("disk full");
    };
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const run = await beginMaintenanceRun(
      {
        ...h.host,
        onRecordingUnavailable: () => {
          throw new Error("notify");
        },
      },
      { trigger: "merge_topics", actor: { via: "app" } },
    );
    openRuns.push(run);
    const op = await run.beginOperation({ kind: "regenerate" });
    expect(op.recording).toBe(false);
  });

  it("開始時のメタの失敗のあと、同じ実行の次の操作は記録できる（書きかけの操作は残らない）", async () => {
    const h = makeHost();
    h.addPage("w1", makeDoc("A", "旧"));
    const raw = h.storage.writeAppData;
    let fail = true;
    h.storage.writeAppData = async (k, v) => {
      if (fail) throw new Error("once");
      await raw(k, v);
    };
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const run = await begin(h);
    openRuns.push(run);
    const bad = await run.beginOperation({ kind: "regenerate" });
    expect(bad.recording).toBe(false);
    fail = false;
    const op = await run.beginOperation({ kind: "regenerate" });
    expect(op.recording).toBe(true);
    await op.save("w1", makeDoc("A", "新"));
    await op.end();
    await run.end();
    const saved = await loadRun(asMaintenanceStorage(h.storage)!, run.id);
    expect(saved?.operations.map((o) => o.id)).toEqual([op.id]);
  });

  it("操作の途中で写しが書けなければ record_failed で例外にし、その保存をしない", async () => {
    const h = makeHost();
    h.addPage("w1", makeDoc("A", "旧"));
    const raw = h.storage.writeAppData;
    h.storage.writeAppData = async (k, v) => {
      if (k.startsWith("maint-copy-")) throw new Error("disk full");
      await raw(k, v);
    };
    const run = await begin(h);
    openRuns.push(run);
    const op = await run.beginOperation({ kind: "regenerate" });
    const err = await op.save("w1", makeDoc("A", "新")).catch((e) => e);
    expect(isMaintenanceRecordFailed(err)).toBe(true);
    expect(err.code).toBe("record_failed");
    expect(err.message).toContain("disk full");
    expect(h.host.saveWikiFile).not.toHaveBeenCalled();
  });
});

describe("firstWriteAt（最初に書き換えた時刻）", () => {
  it("最初の写しの直前に 1 回だけ入り、startedAt より後になる", async () => {
    const h = makeHost();
    h.addPage("w1", makeDoc("A", "旧"));
    h.addPage("w2", makeDoc("B", "旧"));
    const run = await begin(h);
    openRuns.push(run);
    const op = await run.beginOperation({ kind: "regenerate" });
    await op.save("w1", makeDoc("A", "新"));
    const first = (await loadRun(asMaintenanceStorage(h.storage)!, run.id))!.operations[0];
    expect(first.firstWriteAt).toBeTruthy();
    expect(Date.parse(first.firstWriteAt!)).toBeGreaterThan(Date.parse(first.startedAt));
    await op.save("w2", makeDoc("B", "新"));
    await op.end();
    await run.end();
    const saved = (await loadRun(asMaintenanceStorage(h.storage)!, run.id))!.operations[0];
    expect(saved.firstWriteAt).toBe(first.firstWriteAt);
  });

  it("書き換える前（begin だけ）は入らない", async () => {
    const h = makeHost();
    const run = await begin(h);
    openRuns.push(run);
    await run.beginOperation({ kind: "regenerate" });
    const saved = (await loadRun(asMaintenanceStorage(h.storage)!, run.id))!.operations[0];
    expect(saved.firstWriteAt).toBeUndefined();
  });

  it("最初のフラグを動かす直前にも入る", async () => {
    const h = makeHost();
    h.addPage("w2", makeDoc("B", "x"));
    const run = await begin(h);
    openRuns.push(run);
    const op = await run.beginOperation({ kind: "merge_topics" });
    await op.trash("w2");
    await op.end();
    await run.end();
    const saved = (await loadRun(asMaintenanceStorage(h.storage)!, run.id))!.operations[0];
    expect(saved.firstWriteAt).toBeTruthy();
  });
});

describe("op.end / run.end", () => {
  it("変わらなかった写しは捨てる（キーも消す）", async () => {
    const h = makeHost();
    h.addPage("w1", makeDoc("A", "同じ"));
    h.addPage("w2", makeDoc("B", "旧"));
    const run = await begin(h);
    openRuns.push(run);
    const op = await run.beginOperation({ kind: "merge_topics" });
    // w1 は同じ内容（modifiedAt だけ違っても同じ扱い）、w2 は変わる
    await op.save("w1", makeDoc("A", "同じ", { modifiedAt: "2026-02-02T00:00:00.000Z" }));
    await op.save("w2", makeDoc("B", "新"));
    expect(keysOf(h, "maint-copy-")).toHaveLength(2);

    const res = await op.end();
    await run.end();

    expect(res.recorded).toBe(true);
    expect(keysOf(h, "maint-copy-")).toHaveLength(1);
    const saved = await loadRun(asMaintenanceStorage(h.storage)!, run.id);
    expect(saved?.operations[0].pages.map((p) => p.wikiId)).toEqual(["w2"]);
    expect(saved?.operations[0].status).toBe("applied");
    expect(saved?.operations[0].endedAt).toBeTruthy();
    expect(saved?.endedAt).toBeTruthy();
  });

  it("空の操作はメタから外し、空の実行は残さない", async () => {
    const h = makeHost();
    h.addPage("w1", makeDoc("A", "同じ"));
    const run = await begin(h);
    const op = await run.beginOperation({
      kind: "merge_topics",
      related: [{ wikiId: "w2", title: "B", role: "absorbed" }],
    });
    // 開始時にメタ（related つき）が書かれている
    const started = await loadRun(asMaintenanceStorage(h.storage)!, run.id);
    expect(started?.operations[0].status).toBe("running");
    expect(started?.operations[0].related).toHaveLength(1);

    await op.save("w1", makeDoc("A", "同じ"));
    const res = await op.end();
    expect(res.recorded).toBe(false);
    await run.end();

    expect(keysOf(h, "maint-")).toEqual([]);
  });

  it("操作を 1 つも作らなかった実行はメタを書かない", async () => {
    const h = makeHost();
    const run = await begin(h);
    await run.end();
    expect(keysOf(h, "maint-")).toEqual([]);
    expect(h.calls.filter((c) => c.startsWith("write:"))).toEqual([]);
  });

  it("op.end は何度呼んでも同じ結果。閉じ忘れの操作は run.end が閉じる", async () => {
    const h = makeHost();
    h.addPage("w1", makeDoc("A", "旧"));
    const run = await begin(h);
    const op = await run.beginOperation({ kind: "regenerate" });
    await op.save("w1", makeDoc("A", "新"));
    await run.end();
    const again = await op.end();
    expect(again.recorded).toBe(true);
    const saved = await loadRun(asMaintenanceStorage(h.storage)!, run.id);
    expect(saved?.operations[0].status).toBe("applied");
  });

  it("保存が例外でも op.end で変わらなかった写しは消え、空の実行も残らない", async () => {
    const h = makeHost();
    h.addPage("w1", makeDoc("A", "旧"));
    h.host.saveWikiFile.mockRejectedValueOnce(new Error("boom"));
    const run = await begin(h);
    const op = await run.beginOperation({ kind: "regenerate" });
    await expect(op.save("w1", makeDoc("A", "新"))).rejects.toThrow("boom");
    await op.end();
    await run.end();
    expect(keysOf(h, "maint-")).toEqual([]);
  });

  it("実行中は activeRunIds に入り、run.end で外れる", async () => {
    const h = makeHost();
    const run = await begin(h);
    expect(activeRunIds().has(run.id)).toBe(true);
    await run.end();
    expect(activeRunIds().has(run.id)).toBe(false);
  });
});

describe("フラグ", () => {
  it("立っていないときだけ動かし、前後を記録する。立っているページには何もしない", async () => {
    const h = makeHost();
    h.addPage("w1", makeDoc("A", "x"));
    h.addPage("w2", makeDoc("B", "x"), { deletedAt: "2026-09-01T00:00:00.000Z" });
    h.addPage("w3", makeDoc("C", "x"));
    const run = await begin(h);
    const op = await run.beginOperation({ kind: "merge_topics" });

    await op.trash("w1");
    await op.trash("w2"); // すでにゴミ箱: 何もしない
    await op.archive("w3");
    await op.archive("w3"); // すでにアーカイブ: 何もしない
    await op.end();
    await run.end();

    expect(h.host.trashWiki).toHaveBeenCalledTimes(1);
    expect(h.host.archiveWiki).toHaveBeenCalledTimes(1);
    const saved = await loadRun(asMaintenanceStorage(h.storage)!, run.id);
    const flags = saved!.operations[0].flags;
    expect(flags.map((f) => [f.wikiId, f.flag, f.before])).toEqual([
      ["w1", "deletedAt", null],
      ["w3", "archivedAt", null],
    ]);
    expect(flags[0].after).toBeTruthy();
  });

  it("restoreFromTrash / restoreFromArchive は立っているときだけ戻し、前後を記録する", async () => {
    const h = makeHost();
    h.addPage("w1", makeDoc("A", "x"), { deletedAt: "2026-09-01T00:00:00.000Z" });
    h.addPage("w2", makeDoc("B", "x"));
    h.addPage("w3", makeDoc("C", "x"), { archivedAt: "2026-09-02T00:00:00.000Z" });
    const run = await begin(h);
    const op = await run.beginOperation({ kind: "undo" });

    await op.restoreFromTrash("w1");
    await op.restoreFromTrash("w2"); // 立っていない: 何もしない
    await op.restoreFromArchive("w3");
    await op.end();
    await run.end();

    expect(h.host.restoreWikiFlag).toHaveBeenCalledTimes(2);
    const saved = await loadRun(asMaintenanceStorage(h.storage)!, run.id);
    expect(saved!.operations[0].flags).toEqual([
      { wikiId: "w1", flag: "deletedAt", before: "2026-09-01T00:00:00.000Z", after: null },
      { wikiId: "w3", flag: "archivedAt", before: "2026-09-02T00:00:00.000Z", after: null },
    ]);
  });

  it("呼んでも実際には変わらなかったフラグは記録しない（フラグだけの空の操作は残らない）", async () => {
    const h = makeHost();
    h.addPage("w1", makeDoc("A", "x"));
    h.host.trashWiki.mockImplementation(async () => {}); // 索引が変わらない
    const run = await begin(h);
    const op = await run.beginOperation({ kind: "archive" });
    await op.trash("w1");
    const res = await op.end();
    await run.end();
    expect(res.recorded).toBe(false);
    expect(keysOf(h, "maint-")).toEqual([]);
  });
});

describe("メタの書き込み", () => {
  it("同じ実行のメタは直列に書かれる", async () => {
    const h = makeHost();
    for (const id of ["w1", "w2", "w3"]) h.addPage(id, makeDoc(id, "旧"));
    let inFlight = 0;
    let maxInFlight = 0;
    const raw = h.storage.writeAppData;
    h.storage.writeAppData = async (k, v) => {
      if (k.startsWith("maint-run-")) {
        inFlight++;
        maxInFlight = Math.max(maxInFlight, inFlight);
        await new Promise((r) => setTimeout(r, 5));
        await raw(k, v);
        inFlight--;
      } else {
        await raw(k, v);
      }
    };
    const run = await begin(h);
    const op = await run.beginOperation({ kind: "regenerate" });
    await Promise.all(["w1", "w2", "w3"].map((id) => op.save(id, makeDoc(id, "新"))));
    await op.end();
    await run.end();

    expect(maxInFlight).toBe(1);
    const saved = await loadRun(asMaintenanceStorage(h.storage)!, run.id);
    expect(saved?.operations[0].pages).toHaveLength(3);
    // 写しのキーは連番で重ならない
    expect(new Set(saved?.operations[0].pages.map((p) => p.copyKey)).size).toBe(3);
  });
});

describe("ページの排他", () => {
  it("2 つの実行が同じページを同時に書いても、写しと保存が入れ子にならない", async () => {
    const h = makeHost();
    h.addPage("w1", makeDoc("A", "旧"));
    h.host.saveWikiFile.mockImplementation(async (id, doc) => {
      h.calls.push(`save:${id}`);
      await new Promise((r) => setTimeout(r, 10));
      h.pages.set(id, structuredClone(doc));
      return true;
    });
    const r1 = await begin(h);
    const r2 = await begin(h);
    const o1 = await r1.beginOperation({ kind: "regenerate" });
    const o2 = await r2.beginOperation({ kind: "regenerate" });

    await Promise.all([o1.save("w1", makeDoc("A", "一")), o2.save("w1", makeDoc("A", "二"))]);
    await o1.end();
    await o2.end();
    await r1.end();
    await r2.end();

    // 2 つ目の写しは 1 つ目の保存の結果になる
    const st = asMaintenanceStorage(h.storage)!;
    const second = await loadRun(st, r2.id);
    const copy = await loadPageCopy(st, second!.operations[0].pages[0].copyKey);
    expect(copy?.doc.pages[0].blocks[0]).toMatchObject({ content: [{ text: "一" }] });
  });
});

describe("ストレージが非対応のとき", () => {
  it("記録なしで素通しし、コンソールに 1 回だけ出す", async () => {
    resetUnsupportedWarningForTest();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const h = makeHost();
    h.addPage("w1", makeDoc("A", "旧"));
    h.addPage("w2", makeDoc("B", "x"));
    // list / delete を持たない provider
    h.host.provider = () => ({ readAppData: async () => null, writeAppData: async () => {} }) as never;

    const run = await begin(h);
    expect(run.recording).toBe(false);
    const op = await run.beginOperation({ kind: "merge_topics" });
    expect(op.recording).toBe(false);
    await expect(op.save("w1", makeDoc("A", "新"))).resolves.toBe(true);
    expect(h.host.saveWikiFile).toHaveBeenCalledTimes(1);
    await op.trash("w2");
    await op.trash("w2"); // 立っているので 1 回だけ
    expect(h.host.trashWiki).toHaveBeenCalledTimes(1);
    expect(await op.end()).toMatchObject({ recorded: false });
    expect(await run.end()).toEqual({ recorded: false });
    expect(keysOf(h, "maint-")).toEqual([]);

    await begin(h);
    expect(warn).toHaveBeenCalledTimes(1);
  });
});
