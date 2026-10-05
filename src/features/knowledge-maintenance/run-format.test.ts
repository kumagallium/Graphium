import { describe, it, expect } from "vitest";
import type { GraphiumDocument } from "../../lib/document-types";
import {
  deriveOperationStates,
  findBlockingOperations,
  formatKeyTimestamp,
  isExpired,
  makeCopyKey,
  makeRunKey,
  operationKey,
  parseMaintenanceKey,
  sameContent,
  toDocCopy,
} from "./run-format";
import { makeOp, makeRun, UUID_A, UUID_B } from "./test-helpers";

const D = new Date(Date.UTC(2026, 9, 5, 1, 2, 3));

describe("キー", () => {
  it("UTC の日時で整形する", () => {
    expect(formatKeyTimestamp(D)).toBe("20261005T010203Z");
  });

  it("run / copy のキーが往復する", () => {
    const runKey = makeRunKey(D, UUID_A);
    expect(runKey).toBe(`maint-run-20261005T010203Z-${UUID_A}`);
    const p = parseMaintenanceKey(runKey)!;
    expect(p.kind).toBe("run");
    expect(p.date.getTime()).toBe(D.getTime());
    expect(p.uuid).toBe(UUID_A);
    expect(p.runKey).toBe(runKey);

    const copyKey = makeCopyKey(runKey, 3);
    expect(copyKey).toBe(`maint-copy-20261005T010203Z-${UUID_A}-3`);
    const c = parseMaintenanceKey(copyKey)!;
    expect(c.kind).toBe("copy");
    expect(c.seq).toBe(3);
    expect(c.runKey).toBe(runKey);
  });

  it("似た名前のキーを拾わない", () => {
    const run = makeRunKey(D, UUID_A);
    const bad = [
      "maint-run-20261005T010203Z",
      `${run}-1`, // run に連番
      `${run} (conflict)`,
      `x${run}`,
      `maint-run-20261305T010203Z-${UUID_A}`, // 13 月
      `maint-run-20261005T250203Z-${UUID_A}`, // 25 時
      `maint-run-20261005T010203Z-${UUID_A.slice(1)}`, // uuid が短い
      `maint-run-20261005T010203Z-${UUID_A.replace(/1/g, "g")}`, // 16 進でない
      `maint-copy-20261005T010203Z-${UUID_A}`, // copy に連番なし
      `maint-copy-20261005T010203Z-${UUID_A}-x`,
      `maint-copy-20261005T010203Z-${UUID_A}-1.json`,
      "snapshot:abc",
      "",
    ];
    for (const k of bad) expect(parseMaintenanceKey(k), k).toBeNull();
  });

  it("makeCopyKey は不正な run キー・連番で例外", () => {
    expect(() => makeCopyKey("maint-run-x", 0)).toThrow();
    expect(() => makeCopyKey(makeRunKey(D, UUID_A), -1)).toThrow();
  });
});

describe("isExpired", () => {
  const p = parseMaintenanceKey(makeRunKey(D, UUID_A))!;
  const day = 86_400_000;
  it("ちょうど 365 日は残し、超えたら期限切れ", () => {
    expect(isExpired(p, new Date(D.getTime() + 365 * day), 365)).toBe(false);
    expect(isExpired(p, new Date(D.getTime() + 365 * day + 1000), 365)).toBe(true);
  });
  it("時計が戻って now がキーより前でも期限切れにならない", () => {
    expect(isExpired(p, new Date(D.getTime() - 400 * day), 365)).toBe(false);
  });
});

function makeDoc(over: Partial<GraphiumDocument> = {}): GraphiumDocument {
  return {
    version: 5,
    title: "T",
    pages: [{ id: "p1", title: "T", blocks: [], labels: {}, provLinks: [], knowledgeLinks: [] }],
    createdAt: "2026-01-01T00:00:00Z",
    modifiedAt: "2026-01-01T00:00:00Z",
    ...over,
  } as GraphiumDocument;
}

describe("toDocCopy / sameContent", () => {
  it("toDocCopy は documentProvenance を除く", () => {
    const doc = makeDoc({ documentProvenance: { revisions: [] } } as unknown as Partial<GraphiumDocument>);
    expect("documentProvenance" in toDocCopy(doc)).toBe(false);
    expect(toDocCopy(doc).title).toBe("T");
  });

  it("wikiMeta だけ違う → 違う", () => {
    const a = makeDoc({ wikiMeta: { kind: "topic" } } as unknown as Partial<GraphiumDocument>);
    const b = makeDoc({ wikiMeta: { kind: "insight" } } as unknown as Partial<GraphiumDocument>);
    expect(sameContent(a, b)).toBe(false);
  });

  it("title だけ違う → 違う", () => {
    expect(sameContent(makeDoc(), makeDoc({ title: "U" }))).toBe(false);
  });

  it("modifiedAt / documentProvenance だけ違う → 同じ", () => {
    const a = makeDoc();
    const b = makeDoc({
      modifiedAt: "2026-02-02T00:00:00Z",
      documentProvenance: { revisions: [1] },
    } as unknown as Partial<GraphiumDocument>);
    expect(sameContent(a, b)).toBe(true);
  });

  it("キー順が違う → 同じ", () => {
    const a = makeDoc({ wikiMeta: { a: 1, b: { x: 1, y: 2 } } } as unknown as Partial<GraphiumDocument>);
    const b = makeDoc({ wikiMeta: { b: { y: 2, x: 1 }, a: 1 } } as unknown as Partial<GraphiumDocument>);
    expect(sameContent(a, b)).toBe(true);
  });

  it("undefined の項目は無いものとして扱う", () => {
    const a = makeDoc({ wikiMeta: { a: 1, b: undefined } } as unknown as Partial<GraphiumDocument>);
    const b = makeDoc({ wikiMeta: { a: 1 } } as unknown as Partial<GraphiumDocument>);
    expect(sameContent(a, b)).toBe(true);
  });
});

// 実行 R1（古い）, R2, R3 を作る補助
const R1 = makeRunKey(new Date(Date.UTC(2026, 9, 1)), UUID_A);
const R2 = makeRunKey(new Date(Date.UTC(2026, 9, 2)), UUID_B);
const R3 = makeRunKey(new Date(Date.UTC(2026, 9, 3)), UUID_A);
const R4 = makeRunKey(new Date(Date.UTC(2026, 9, 4)), UUID_B);
const none = new Set<string>();
const st = (m: ReturnType<typeof deriveOperationStates>, r: string, o: string) =>
  m.get(operationKey(r, o))?.state;

const merge = (id: string, at: string, wiki: string) =>
  makeOp({
    id,
    startedAt: at,
    pages: [{ wikiId: wiki, title: wiki, copyKey: "k" }],
    related: [{ wikiId: `${wiki}-src`, title: "s", role: "absorbed" }],
  });
const undoOp = (
  id: string,
  at: string,
  of: { runId: string; operationId: string },
  ok = true,
  wiki = "w1",
) =>
  makeOp({
    id,
    kind: "undo",
    startedAt: at,
    undoOf: of,
    pages: [{ wikiId: wiki, title: wiki, copyKey: "k" }],
    undoResult: { pages: [{ wikiId: wiki, ok }], flags: [] },
  });

describe("deriveOperationStates", () => {
  it("取り消しが無ければ applied", () => {
    const m = deriveOperationStates([makeRun(R1, [merge("o1", "2026-10-01T00:00:00Z", "w1")])], none);
    expect(st(m, R1, "o1")).toBe("applied");
  });

  it("取り消されると undone、undoneBy が付く", () => {
    const runs = [
      makeRun(R1, [merge("o1", "2026-10-01T00:00:00Z", "w1")]),
      makeRun(R2, [undoOp("u1", "2026-10-02T00:00:00Z", { runId: R1, operationId: "o1" })]),
    ];
    const m = deriveOperationStates(runs, none);
    expect(st(m, R1, "o1")).toBe("undone");
    expect(m.get(operationKey(R1, "o1"))?.undoneBy).toEqual({ runId: R2, operationId: "u1" });
    expect(st(m, R2, "u1")).toBe("applied");
  });

  it("取り消しの取り消しで元が applied に戻る", () => {
    const runs = [
      makeRun(R1, [merge("o1", "2026-10-01T00:00:00Z", "w1")]),
      makeRun(R2, [undoOp("u1", "2026-10-02T00:00:00Z", { runId: R1, operationId: "o1" })]),
      makeRun(R3, [undoOp("u2", "2026-10-03T00:00:00Z", { runId: R2, operationId: "u1" })]),
    ];
    const m = deriveOperationStates(runs, none);
    expect(st(m, R1, "o1")).toBe("applied");
    expect(st(m, R2, "u1")).toBe("undone");
    expect(st(m, R3, "u2")).toBe("applied");
  });

  it("再取り消し後はまた undone", () => {
    const runs = [
      makeRun(R1, [merge("o1", "2026-10-01T00:00:00Z", "w1")]),
      makeRun(R2, [undoOp("u1", "2026-10-02T00:00:00Z", { runId: R1, operationId: "o1" })]),
      makeRun(R3, [undoOp("u2", "2026-10-03T00:00:00Z", { runId: R2, operationId: "u1" })]),
      makeRun(R4, [undoOp("u3", "2026-10-04T00:00:00Z", { runId: R1, operationId: "o1" })]),
    ];
    const m = deriveOperationStates(runs, none);
    expect(st(m, R1, "o1")).toBe("undone");
    expect(m.get(operationKey(R1, "o1"))?.undoneBy?.operationId).toBe("u3");
  });

  it("一部失敗の取り消しは undo_partial", () => {
    const runs = [
      makeRun(R1, [merge("o1", "2026-10-01T00:00:00Z", "w1")]),
      makeRun(R2, [undoOp("u1", "2026-10-02T00:00:00Z", { runId: R1, operationId: "o1" }, false)]),
    ];
    expect(st(deriveOperationStates(runs, none), R1, "o1")).toBe("undo_partial");
  });

  it("有効な取り消しが複数あれば最新で判定", () => {
    const runs = [
      makeRun(R1, [merge("o1", "2026-10-01T00:00:00Z", "w1")]),
      makeRun(R2, [undoOp("u1", "2026-10-02T00:00:00Z", { runId: R1, operationId: "o1" }, false)]),
      makeRun(R3, [undoOp("u2", "2026-10-03T00:00:00Z", { runId: R1, operationId: "o1" }, true)]),
    ];
    expect(st(deriveOperationStates(runs, none), R1, "o1")).toBe("undone");
  });

  it("running は、動いている実行なら running・そうでなければ interrupted", () => {
    const runs = [makeRun(R1, [makeOp({ id: "o1", status: "running" })])];
    expect(st(deriveOperationStates(runs, new Set([R1])), R1, "o1")).toBe("running");
    expect(st(deriveOperationStates(runs, none), R1, "o1")).toBe("interrupted");
  });

  it("途中の undo（running）は取り消しとして数えない", () => {
    const u = undoOp("u1", "2026-10-02T00:00:00Z", { runId: R1, operationId: "o1" });
    u.status = "running";
    const runs = [makeRun(R1, [merge("o1", "2026-10-01T00:00:00Z", "w1")]), makeRun(R2, [u])];
    expect(st(deriveOperationStates(runs, new Set([R2])), R1, "o1")).toBe("applied");
  });
});

describe("findBlockingOperations", () => {
  const target = { runId: R1, operationId: "o1" };

  it("同じページに関わる、より新しい操作が妨げる。自分自身は含めない", () => {
    const runs = [
      makeRun(R1, [merge("o1", "2026-10-01T00:00:00Z", "w1")]),
      makeRun(R2, [merge("o2", "2026-10-02T00:00:00Z", "w1")]),
    ];
    const b = findBlockingOperations(runs, target);
    expect(b.map((x) => x.operationId)).toEqual(["o2"]);
  });

  it("flags / related だけで関わる操作も妨げる", () => {
    const runs = [
      makeRun(R1, [merge("o1", "2026-10-01T00:00:00Z", "w1")]),
      makeRun(R2, [
        makeOp({
          id: "o2",
          startedAt: "2026-10-02T00:00:00Z",
          flags: [{ wikiId: "w1-src", flag: "deletedAt", before: null, after: "x" }],
        }),
      ]),
      makeRun(R3, [
        makeOp({
          id: "o3",
          startedAt: "2026-10-03T00:00:00Z",
          related: [{ wikiId: "w1", title: "", role: "archived" }],
        }),
      ]),
    ];
    expect(findBlockingOperations(runs, target).map((x) => x.operationId)).toEqual(["o2", "o3"]);
  });

  it("古い操作・別ページの操作は妨げない", () => {
    const runs = [
      makeRun(R1, [merge("o1", "2026-10-02T00:00:00Z", "w1")]),
      makeRun(R2, [merge("o0", "2026-10-01T00:00:00Z", "w1")]),
      makeRun(R3, [merge("o2", "2026-10-03T00:00:00Z", "w9")]),
    ];
    expect(findBlockingOperations(runs, target)).toEqual([]);
  });

  it("取り消し済みの新しい操作は妨げない", () => {
    const runs = [
      makeRun(R1, [merge("o1", "2026-10-01T00:00:00Z", "w1")]),
      makeRun(R2, [merge("o2", "2026-10-02T00:00:00Z", "w1")]),
      makeRun(R3, [undoOp("u2", "2026-10-03T00:00:00Z", { runId: R2, operationId: "o2" }, true, "w9")]),
    ];
    // u2 は w9 だけ触るので妨げない。o2 は undone なので妨げない
    expect(findBlockingOperations(runs, target)).toEqual([]);
  });

  it("新しい操作を取り消した undo 操作（同じページ）は、その操作と打ち消し合って妨げない", () => {
    const runs = [
      makeRun(R1, [merge("o1", "2026-10-01T00:00:00Z", "w1")]),
      makeRun(R2, [merge("o2", "2026-10-02T00:00:00Z", "w1")]),
      makeRun(R3, [undoOp("u2", "2026-10-03T00:00:00Z", { runId: R2, operationId: "o2" })]),
    ];
    expect(findBlockingOperations(runs, target)).toEqual([]);
  });

  it("古い操作を取り消した undo（target より後に書いた）は妨げる", () => {
    const runs = [
      makeRun(R1, [merge("o0", "2026-10-01T00:00:00Z", "w1")]),
      makeRun(R2, [merge("o1", "2026-10-02T00:00:00Z", "w1")]),
      makeRun(R3, [undoOp("u0", "2026-10-03T00:00:00Z", { runId: R1, operationId: "o0" })]),
    ];
    expect(
      findBlockingOperations(runs, { runId: R2, operationId: "o1" }).map((x) => x.operationId),
    ).toEqual(["u0"]);
  });

  it("T1・T2 → T2 を取り消し済みなら T1 は妨げられない。T2 の取り消しの失敗（一部）は妨げる", () => {
    const base = [
      makeRun(R1, [merge("o1", "2026-10-01T00:00:00Z", "w1")]),
      makeRun(R2, [merge("o2", "2026-10-02T00:00:00Z", "w1")]),
    ];
    const ok = [...base, makeRun(R3, [undoOp("u2", "2026-10-03T00:00:00Z", { runId: R2, operationId: "o2" })])];
    expect(findBlockingOperations(ok, target)).toEqual([]);
    const partial = [
      ...base,
      makeRun(R3, [undoOp("u2", "2026-10-03T00:00:00Z", { runId: R2, operationId: "o2" }, false)]),
    ];
    expect(findBlockingOperations(partial, target).map((x) => x.operationId)).toEqual(["o2", "u2"]);
  });

  it("target を取り消した undo と、その取り消しは妨げない（再取り消しできる）", () => {
    const runs = [
      makeRun(R1, [merge("o1", "2026-10-01T00:00:00Z", "w1")]),
      makeRun(R2, [undoOp("u1", "2026-10-02T00:00:00Z", { runId: R1, operationId: "o1" })]),
      makeRun(R3, [undoOp("u2", "2026-10-03T00:00:00Z", { runId: R2, operationId: "u1" })]),
    ];
    expect(findBlockingOperations(runs, target)).toEqual([]);
  });

  it("一部だけ取り消された操作はまだ効いているので妨げる", () => {
    const runs = [
      makeRun(R1, [merge("o1", "2026-10-01T00:00:00Z", "w1")]),
      makeRun(R2, [merge("o2", "2026-10-02T00:00:00Z", "w1")]),
      makeRun(R3, [undoOp("u2", "2026-10-03T00:00:00Z", { runId: R2, operationId: "o2" }, false, "w9")]),
    ];
    expect(findBlockingOperations(runs, target).map((x) => x.operationId)).toEqual(["o2"]);
  });

  it("対象が無ければ空", () => {
    expect(findBlockingOperations([], target)).toEqual([]);
  });
});

describe("操作の新旧は最初に書き換えた時刻（firstWriteAt）で決める", () => {
  it("begin が先でも書き込みが後の操作は、あとから begin して先に書いた操作より新しい", () => {
    // A: 00:00 に begin（LLM を待って 00:10 に最初の書き込み）/ B: 00:05 に begin して 00:06 に書き込み
    const a = makeOp({
      id: "a",
      startedAt: "2026-10-01T00:00:00Z",
      firstWriteAt: "2026-10-01T00:10:00Z",
      pages: [{ wikiId: "w1", title: "", copyKey: "c" }],
    });
    const b = makeOp({
      id: "b",
      startedAt: "2026-10-01T00:05:00Z",
      firstWriteAt: "2026-10-01T00:06:00Z",
      pages: [{ wikiId: "w1", title: "", copyKey: "c" }],
    });
    const runs = [makeRun(R1, [a]), makeRun(R2, [b])];
    // B を取り消すとき、新しい A が妨げる（startedAt だけなら逆になる）
    expect(findBlockingOperations(runs, { runId: R2, operationId: "b" }).map((x) => x.operationId)).toEqual(["a"]);
    // A を取り消すとき、B は古いので妨げない
    expect(findBlockingOperations(runs, { runId: R1, operationId: "a" })).toEqual([]);
  });

  it("firstWriteAt が無い操作は startedAt で並ぶ", () => {
    const a = makeOp({ id: "a", startedAt: "2026-10-01T00:00:00Z", pages: [{ wikiId: "w1", title: "", copyKey: "c" }] });
    const b = makeOp({ id: "b", startedAt: "2026-10-01T00:05:00Z", pages: [{ wikiId: "w1", title: "", copyKey: "c" }] });
    const runs = [makeRun(R1, [a]), makeRun(R2, [b])];
    expect(findBlockingOperations(runs, { runId: R1, operationId: "a" }).map((x) => x.operationId)).toEqual(["b"]);
  });

  it("想定外の値（配列でない・null の要素）でも妨げの判定が例外にならない", () => {
    const weird = makeOp({
      id: "w",
      startedAt: "2026-10-02T00:00:00Z",
      pages: null as never,
      flags: [null as never],
      related: [{ wikiId: 3 } as never],
    });
    const runs = [
      makeRun(R1, [makeOp({ id: "o1", startedAt: "2026-10-01T00:00:00Z", pages: [{ wikiId: "w1", title: "", copyKey: "c" }] })]),
      makeRun(R2, [weird]),
    ];
    expect(findBlockingOperations(runs, { runId: R1, operationId: "o1" })).toEqual([]);
  });
});
