import { describe, it, expect, vi } from "vitest";
import { makeCopyKey, makeRunKey } from "./run-format";
import { MAINTENANCE_PURGE_MAX_PER_RUN } from "./types";
import {
  deletePageCopy,
  deleteRun,
  listRunKeys,
  loadPageCopy,
  loadRecentRuns,
  loadRun,
  loadRunsFrom,
  purgeExpired,
  saveRunMeta,
  writePageCopy,
} from "./run-store";
import { asMaintenanceStorage, type MaintenancePageCopyFile } from "./types";
import { makeOp, makeRun, makeStorage, UUID_A, UUID_B, UUID_C } from "./test-helpers";

const key = (day: number, uuid = UUID_A) => makeRunKey(new Date(Date.UTC(2026, 9, day)), uuid);

describe("run-store", () => {
  it("保存して読み戻せる", async () => {
    const s = makeStorage();
    const run = makeRun(key(1), [makeOp({ id: "o1" })]);
    await saveRunMeta(s, run);
    expect(await loadRun(s, run.id)).toEqual(run);
  });

  it("壊れたメタ・formatVersion 違い・キーと id の不一致は null", async () => {
    const s = makeStorage();
    const k = key(1);
    s.store.set(k, "壊れた");
    expect(await loadRun(s, k)).toBeNull();
    s.store.set(k, { ...makeRun(k, []), formatVersion: 2 });
    expect(await loadRun(s, k)).toBeNull();
    s.store.set(k, makeRun(key(2), []));
    expect(await loadRun(s, k)).toBeNull();
    s.store.set(k, { ...makeRun(k, []), operations: [{ id: 1 }] });
    expect(await loadRun(s, k)).toBeNull();
    expect(await loadRun(s, "maint-run-bad")).toBeNull();
  });

  describe("読み込む記録を信用しすぎない", () => {
    const flagOk = { wikiId: "w1", flag: "deletedAt" as const, before: null, after: "x" };

    it("pages / flags / related の壊れた要素を持つ実行は null", async () => {
      const k = key(1);
      const goodCopy = makeCopyKey(k, 0);
      const cases: Record<string, Record<string, unknown>> = {
        "related が文字列": { related: ["w1"] },
        "related の wikiId が数値": { related: [{ wikiId: 1, title: "", role: "absorbed" }] },
        "pages が null を含む": { pages: [null] },
        "pages の copyKey が無い": { pages: [{ wikiId: "w1", title: "" }] },
        "pages の copyKey が copy でない": { pages: [{ wikiId: "w1", title: "", copyKey: k }] },
        "pages の copyKey が別の実行のもの": {
          pages: [{ wikiId: "w1", title: "", copyKey: makeCopyKey(key(2), 0) }],
        },
        "flags の flag が未知": { flags: [{ ...flagOk, flag: "other" }] },
        "flags が wikiId なし": { flags: [{ flag: "deletedAt" }] },
        "undoOf の形が違う": { undoOf: "x" },
        "undoResult に pages が無い": { undoResult: { flags: [] } },
      };
      for (const [name, over] of Object.entries(cases)) {
        const s = makeStorage();
        s.store.set(k, makeRun(k, [makeOp({ id: "o1", ...(over as object) })]));
        expect(await loadRun(s, k), name).toBeNull();
      }
      // 正常な形は通る
      const s = makeStorage();
      const ok = makeRun(k, [
        makeOp({
          id: "o1",
          related: [{ wikiId: "w2", title: "B", role: "absorbed" }],
          pages: [{ wikiId: "w1", title: "A", copyKey: goodCopy }],
          flags: [flagOk],
        }),
      ]);
      s.store.set(k, ok);
      expect(await loadRun(s, k)).toEqual(ok);
    });

    it("未知の kind の操作は、実行を読めない扱いにせず、その操作だけ除く", async () => {
      const k = key(1);
      const s = makeStorage();
      s.store.set(k, makeRun(k, [makeOp({ id: "o1" }), makeOp({ id: "o2", kind: "split" as never })]));
      const run = await loadRun(s, k);
      expect(run?.operations.map((o) => o.id)).toEqual(["o1"]);
    });

    it("壊れた実行が 1 件あっても、他の実行は一覧に出る", async () => {
      const s = makeStorage();
      const bad = key(1);
      const good = key(2, UUID_B);
      s.store.set(bad, makeRun(bad, [makeOp({ id: "o1", related: [null as never] })]));
      await saveRunMeta(s, makeRun(good, [makeOp({ id: "o2" })]));
      const r = await loadRecentRuns(s, { limit: 10 });
      expect(r.runs.map((x) => x.id)).toEqual([good]);
      expect(r.unreadable).toEqual([bad]);
    });

    it("写しは wikiId・doc.pages・doc.title が合わなければ null", async () => {
      const s = makeStorage();
      const runKey = key(1);
      const copyKey = makeCopyKey(runKey, 0);
      const base = {
        formatVersion: 1,
        runId: runKey,
        operationId: "o1",
        wikiId: "w1",
        capturedAt: "",
        doc: { title: "T", pages: [] },
      };
      const bads = [
        { ...base, wikiId: "w/../1" },
        { ...base, wikiId: "" },
        { ...base, wikiId: "a".repeat(201) },
        { ...base, doc: { title: "T" } },
        { ...base, doc: { title: 1, pages: [] } },
      ];
      for (const b of bads) {
        s.store.set(copyKey, b);
        expect(await loadPageCopy(s, copyKey)).toBeNull();
      }
      s.store.set(copyKey, base);
      expect(await loadPageCopy(s, copyKey)).not.toBeNull();
    });
  });

  it("写しの書き込み・読み出し・削除", async () => {
    const s = makeStorage();
    const runKey = key(1);
    const copyKey = makeCopyKey(runKey, 0);
    const file: MaintenancePageCopyFile = {
      formatVersion: 1,
      runId: runKey,
      operationId: "o1",
      wikiId: "w1",
      capturedAt: "2026-10-01T00:00:00Z",
      doc: { version: 5, title: "T", pages: [], createdAt: "", modifiedAt: "" } as never,
    };
    await writePageCopy(s, copyKey, file);
    expect(await loadPageCopy(s, copyKey)).toEqual(file);
    await deletePageCopy(s, copyKey);
    expect(await loadPageCopy(s, copyKey)).toBeNull();
    await expect(writePageCopy(s, runKey, file)).rejects.toThrow();
  });

  it("listRunKeys は新しい順で、run だけ・厳密に合うものだけ", async () => {
    const s = makeStorage();
    for (const d of [2, 5, 3]) await saveRunMeta(s, makeRun(key(d), []));
    s.store.set(makeCopyKey(key(5), 0), {});
    s.store.set(`${key(4)} (conflict)`, {});
    expect(await listRunKeys(s)).toEqual([key(5), key(3), key(2)]);
  });

  it("deleteRun で消える", async () => {
    const s = makeStorage();
    await saveRunMeta(s, makeRun(key(1), []));
    await deleteRun(s, key(1));
    expect(await listRunKeys(s)).toEqual([]);
  });

  it("loadRecentRuns は新しい順に limit 件、beforeKey で続きを読み、壊れたものを飛ばす", async () => {
    const s = makeStorage();
    for (const d of [1, 2, 3, 4, 5]) await saveRunMeta(s, makeRun(key(d), []));
    s.store.set(key(4), "壊れた");
    const first = await loadRecentRuns(s, { limit: 2 });
    expect(first.runs.map((r) => r.id)).toEqual([key(5)]);
    expect(first.unreadable).toEqual([key(4)]);
    expect(first.hasMore).toBe(true);
    const next = await loadRecentRuns(s, { limit: 2, beforeKey: key(4) });
    expect(next.runs.map((r) => r.id)).toEqual([key(3), key(2)]);
    expect(next.hasMore).toBe(true);
    const last = await loadRecentRuns(s, { limit: 2, beforeKey: key(2) });
    expect(last.runs.map((r) => r.id)).toEqual([key(1)]);
    expect(last.hasMore).toBe(false);
  });

  it("loadRunsFrom は fromKey を含むそれ以降の全実行（新しい順）", async () => {
    const s = makeStorage();
    for (const d of [1, 2, 3, 4]) await saveRunMeta(s, makeRun(key(d), []));
    const { runs } = await loadRunsFrom(s, key(2));
    expect(runs.map((r) => r.id)).toEqual([key(4), key(3), key(2)]);
  });

  it("loadRunsFrom は fromKey より少し前に始まって重なり得る実行も読む", async () => {
    const s = makeStorage();
    const at = (h: number, uuid: string) => makeRunKey(new Date(Date.UTC(2026, 9, 5, h)), uuid);
    const early = at(1, UUID_A); // 9 時間前: 重ならない
    const long = at(9, UUID_B); // 1 時間前: 重なり得る
    const from = at(10, UUID_C);
    for (const k of [early, long, from]) await saveRunMeta(s, makeRun(k, []));
    const { runs } = await loadRunsFrom(s, from);
    expect(runs.map((r) => r.id).sort()).toEqual([long, from].sort());
  });

  it("列挙に対応しないプロバイダは asMaintenanceStorage が null", () => {
    const base = { readAppData: async () => null, writeAppData: async () => {} };
    expect(asMaintenanceStorage(base)).toBeNull();
    expect(asMaintenanceStorage({ ...base, listAppDataKeys: async () => [] })).toBeNull();
    expect(asMaintenanceStorage(null)).toBeNull();
    expect(
      asMaintenanceStorage({ ...base, listAppDataKeys: async () => [], deleteAppData: async () => {} }),
    ).not.toBeNull();
  });
});

describe("purgeExpired", () => {
  const now = new Date(Date.UTC(2027, 9, 10)); // 2026-10-05 から 370 日後

  it("365 日より前の run と copy を消し、新しいものは残す", async () => {
    const s = makeStorage();
    const old = key(5);
    const recent = makeRunKey(new Date(Date.UTC(2027, 5, 1)), UUID_B);
    await saveRunMeta(s, makeRun(old, []));
    s.store.set(makeCopyKey(old, 0), {});
    await saveRunMeta(s, makeRun(recent, []));
    const r = await purgeExpired(s, now);
    expect(r).toEqual({ deleted: 2, unparseable: [], skippedForClock: false, capped: false });
    expect([...s.store.keys()]).toEqual([recent]);
  });

  it("厳密に合わないキーは消さずに報告する", async () => {
    const s = makeStorage();
    const odd = `${key(5)} (conflict)`;
    s.store.set(odd, {});
    s.store.set("maint-other", {});
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const r = await purgeExpired(s, now);
    warn.mockRestore();
    expect(r.deleted).toBe(0);
    expect(r.unparseable.sort()).toEqual([odd, "maint-other"].sort());
    expect(s.store.size).toBe(2);
  });

  it("時計が戻っている（最新のキーが now より 1 日以上先）なら何も消さない", async () => {
    const s = makeStorage();
    await saveRunMeta(s, makeRun(key(5), []));
    await saveRunMeta(s, makeRun(makeRunKey(new Date(Date.UTC(2027, 9, 12)), UUID_C), []));
    const r = await purgeExpired(s, now);
    expect(r.skippedForClock).toBe(true);
    expect(r.deleted).toBe(0);
    expect(s.store.size).toBe(2);
  });

  it("1 回の掃除で消すのは古い順に最大 200 キー。残りは次の掃除で消える", async () => {
    const s = makeStorage();
    const total = MAINTENANCE_PURGE_MAX_PER_RUN + 5;
    const keys: string[] = [];
    for (let i = 0; i < total; i++) {
      // 秒をずらして 2025 年の期限切れキーを作る（i が小さいほど古い）
      const uuid = `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`;
      const k = makeRunKey(new Date(Date.UTC(2025, 0, 1, 0, 0, i)), uuid);
      keys.push(k);
      s.store.set(k, {});
    }
    const r1 = await purgeExpired(s, now);
    expect(MAINTENANCE_PURGE_MAX_PER_RUN).toBe(200);
    expect(r1).toMatchObject({ deleted: 200, capped: true });
    // 残るのは新しい側の 5 件
    expect([...s.store.keys()].sort()).toEqual(keys.slice(200).sort());
    const r2 = await purgeExpired(s, now);
    expect(r2).toMatchObject({ deleted: 5, capped: false });
    expect(s.store.size).toBe(0);
  });

  it("1 件の削除が失敗しても先へ進む", async () => {
    const s = makeStorage();
    await saveRunMeta(s, makeRun(key(5), []));
    await saveRunMeta(s, makeRun(key(6), []));
    const orig = s.deleteAppData;
    s.deleteAppData = async (k) => {
      if (k === key(5)) throw new Error("fail");
      return orig(k);
    };
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const r = await purgeExpired(s, now);
    warn.mockRestore();
    expect(r.deleted).toBe(1);
    expect(s.store.has(key(5))).toBe(true);
  });
});
