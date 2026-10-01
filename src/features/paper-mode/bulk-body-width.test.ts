// これまでのノートをまとめて A4 にする（標準に戻す）の純関数・実行器のテスト。
//
// 守ること:
// - 対象はノート索引の自分のノート（ゴミ箱を除く・アーカイブを含む・Wiki/スキルを除く）
// - 書くのは幅の 2 項目だけ。modifiedAt・版の履歴・ほかの項目は 1 つも変わらない
// - 幅いっぱい・すでに A4 は飛ばす。止められる。1 件の失敗で続ける。戻せる

import { describe, expect, it, vi } from "vitest";
import type { GraphiumDocument } from "../../lib/document-types";
import type { NoteIndexEntry } from "../navigation/index-file";
import { migrateToLatest } from "../../lib/document-migration";
import {
  bulkWidthCandidates,
  copyBodyWidthFields,
  planBulkWidth,
  runBulkBodyWidth,
  type BulkWidthDeps,
} from "./bulk-body-width";

function entry(noteId: string, extra: Partial<NoteIndexEntry> = {}): NoteIndexEntry {
  return { noteId, title: noteId, modifiedAt: "2026-01-01T00:00:00Z", createdAt: "", headings: [], labels: [], outgoingLinks: [], ...extra };
}

/** 幅以外の項目をたくさん持つ doc（落とす・足すを検出する） */
function makeDoc(title: string, extra: Record<string, unknown> = {}): GraphiumDocument {
  return {
    version: 6,
    title,
    pages: [{ id: "p1", title: "Main", blocks: [{ id: "b1", type: "paragraph", content: [] }], labels: {}, provLinks: [], knowledgeLinks: [] }],
    createdAt: "2026-01-01T00:00:00.000Z",
    modifiedAt: "2026-01-02T03:04:05.000Z",
    noteContexts: ["実験"],
    documentProvenance: { revisions: [{ id: "r1" }], activities: [] },
    customField: { keep: true },
    ...extra,
  } as unknown as GraphiumDocument;
}

function keysOf(doc: object) {
  return Object.keys(doc).sort();
}

describe("bulkWidthCandidates（対象の選び方）", () => {
  it("ゴミ箱を除き、アーカイブは含める。Wiki・スキルは除く", () => {
    const ids = bulkWidthCandidates([
      entry("a"),
      entry("archived", { archivedAt: "2026-02-01T00:00:00Z" }),
      entry("trashed", { deletedAt: "2026-02-01T00:00:00Z" }),
      entry("trashed-archived", { deletedAt: "x", archivedAt: "y" }),
      entry("wiki", { source: "ai", wikiKind: "claim" }),
      entry("skill", { source: "skill" }),
      entry("human", { source: "human" }),
    ]).map((n) => n.noteId);
    expect(ids).toEqual(["a", "archived", "human"]);
  });
});

describe("planBulkWidth（A4 にする）", () => {
  it("標準のノート: paperSize: a4 を書く。幅の項目以外は 1 つも変わらない", () => {
    const doc = makeDoc("標準");
    const plan = planBulkWidth(doc, "a4");
    expect(plan.kind).toBe("change");
    if (plan.kind !== "change") return;
    expect(plan.doc.paperSize).toBe("a4");
    const { paperSize: _p, ...rest } = plan.doc as unknown as Record<string, unknown>;
    expect(rest).toEqual(doc);
    expect(plan.doc.modifiedAt).toBe("2026-01-02T03:04:05.000Z");
    expect(plan.doc.documentProvenance).toEqual(doc.documentProvenance);
  });

  it("fullWidth: false の明示は外す（undefined のキーも残さない）", () => {
    const plan = planBulkWidth(makeDoc("x", { fullWidth: false }), "a4");
    expect(plan.kind).toBe("change");
    if (plan.kind !== "change") return;
    expect("fullWidth" in plan.doc).toBe(false);
    expect(plan.doc.paperSize).toBe("a4");
  });

  it("幅いっぱい（fullWidth: true）は変えない", () => {
    expect(planBulkWidth(makeDoc("x", { fullWidth: true }), "a4")).toEqual({ kind: "skip", reason: "fullWidth" });
  });

  it("すでに A4 は飛ばす", () => {
    expect(planBulkWidth(makeDoc("x", { paperSize: "a4" }), "a4")).toEqual({ kind: "skip", reason: "alreadyA4" });
  });

  it("知らない paperSize（将来の版が書いた値）は上書きしない", () => {
    expect(planBulkWidth(makeDoc("x", { paperSize: "letter" }), "a4")).toEqual({ kind: "skip", reason: "unknownPaper" });
  });
});

describe("planBulkWidth（標準に戻す）", () => {
  it("A4 のノートから paperSize を外す。ほかは変わらない", () => {
    const doc = makeDoc("a4", { paperSize: "a4" });
    const plan = planBulkWidth(doc, "standard");
    expect(plan.kind).toBe("change");
    if (plan.kind !== "change") return;
    expect("paperSize" in plan.doc).toBe(false);
    expect(keysOf(plan.doc)).toEqual(keysOf(doc).filter((k) => k !== "paperSize"));
    expect(plan.doc.modifiedAt).toBe(doc.modifiedAt);
  });

  it("標準・幅いっぱいのノートは触らない（fullWidth は触らない）", () => {
    expect(planBulkWidth(makeDoc("x"), "standard")).toEqual({ kind: "skip", reason: "notA4" });
    expect(planBulkWidth(makeDoc("x", { fullWidth: true }), "standard")).toEqual({ kind: "skip", reason: "notA4" });
  });

  it("A4 と幅いっぱいが両方立った doc は、見えていた幅（A4）を標準にするので両方外す", () => {
    const plan = planBulkWidth(makeDoc("both", { paperSize: "a4", fullWidth: true }), "standard");
    expect(plan.kind).toBe("change");
    if (plan.kind !== "change") return;
    expect("paperSize" in plan.doc).toBe(false);
    expect("fullWidth" in plan.doc).toBe(false);
  });
});

describe("copyBodyWidthFields", () => {
  it("幅の 2 項目だけを source に揃える。ほかの項目は target のまま", () => {
    const target = { title: "新しい本文", fullWidth: true, paperSize: undefined };
    expect(copyBodyWidthFields(target, { title: "古い", paperSize: "a4" })).toEqual({ title: "新しい本文", paperSize: "a4" });
    expect(copyBodyWidthFields({ title: "t", paperSize: "a4" }, { title: "古い" })).toEqual({ title: "t" });
  });
});

/** インメモリの provider（読み書きの履歴付き） */
function memory(docs: Record<string, GraphiumDocument>) {
  const store = new Map(Object.entries(docs).map(([id, d]) => [id, structuredClone(d)]));
  const log: string[] = [];
  const deps: BulkWidthDeps = {
    loadFile: async (id) => {
      log.push(`load:${id}`);
      const d = store.get(id);
      if (!d) throw new Error("missing");
      return structuredClone(d);
    },
    saveFile: async (id, doc) => {
      log.push(`save:${id}`);
      store.set(id, structuredClone(doc));
    },
  };
  return { store, log, deps };
}

describe("runBulkBodyWidth", () => {
  it("A4 にする: 変えた・幅いっぱい・すでに A4 を数え、書くのは変えたものだけ。更新日時と履歴は同じ", async () => {
    const orig = {
      std: makeDoc("std"),
      full: makeDoc("full", { fullWidth: true }),
      a4: makeDoc("a4", { paperSize: "a4" }),
      std2: makeDoc("std2"),
    };
    const { store, log, deps } = memory(orig);
    const changed: string[] = [];
    const r = await runBulkBodyWidth(["std", "full", "a4", "std2"], "a4", { ...deps, onChanged: (id) => changed.push(id) });
    expect(r).toMatchObject({ total: 4, changed: 2, skippedFullWidth: 1, skippedAlready: 1, failed: 0, aborted: false });
    expect(log.filter((l) => l.startsWith("save:"))).toEqual(["save:std", "save:std2"]);
    expect(changed).toEqual(["std", "std2"]);
    for (const id of ["std", "std2"] as const) {
      const d = store.get(id)!;
      expect(d.paperSize).toBe("a4");
      expect(d.modifiedAt).toBe(orig[id].modifiedAt);
      expect(d.documentProvenance).toEqual(orig[id].documentProvenance);
      expect(d.pages).toEqual(orig[id].pages);
    }
    expect(store.get("full")).toEqual(orig.full);
    expect(store.get("a4")).toEqual(orig.a4);
  });

  it("順番に 1 件ずつ（読む→書くを重ねない）、書く直前に読み直す", async () => {
    const { log, deps } = memory({ a: makeDoc("a"), b: makeDoc("b") });
    await runBulkBodyWidth(["a", "b"], "a4", deps);
    expect(log).toEqual(["load:a", "save:a", "load:b", "save:b"]);
  });

  it("標準に戻す: A4 のノートだけ書く。標準・幅いっぱいは触らない", async () => {
    const { store, log, deps } = memory({
      a4: makeDoc("a4", { paperSize: "a4" }),
      std: makeDoc("std"),
      full: makeDoc("full", { fullWidth: true }),
    });
    const r = await runBulkBodyWidth(["a4", "std", "full"], "standard", deps);
    expect(r).toMatchObject({ changed: 1, skippedOther: 2, failed: 0 });
    expect(log.filter((l) => l.startsWith("save:"))).toEqual(["save:a4"]);
    expect("paperSize" in store.get("a4")!).toBe(false);
    expect(store.get("full")!.fullWidth).toBe(true);
  });

  it("途中で止められる（止めた時点までは書けていて、もう一度押せば続きから進む）", async () => {
    const { store, deps } = memory({ a: makeDoc("a"), b: makeDoc("b"), c: makeDoc("c") });
    const controller = new AbortController();
    const first = await runBulkBodyWidth(["a", "b", "c"], "a4", {
      ...deps,
      signal: controller.signal,
      onProgress: ({ done }) => {
        if (done === 1) controller.abort();
      },
    });
    expect(first).toMatchObject({ changed: 1, aborted: true });
    expect(store.get("a")!.paperSize).toBe("a4");
    expect(store.get("b")!.paperSize).toBeUndefined();
    const second = await runBulkBodyWidth(["a", "b", "c"], "a4", deps);
    expect(second).toMatchObject({ changed: 2, skippedAlready: 1, aborted: false });
  });

  it("1 件の失敗（読み・書きとも）で止めず、数えて続ける", async () => {
    const { store, deps } = memory({ ok1: makeDoc("ok1"), badRead: makeDoc("badRead"), badWrite: makeDoc("badWrite"), ok2: makeDoc("ok2") });
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const r = await runBulkBodyWidth(["ok1", "gone", "badWrite", "ok2"], "a4", {
      ...deps,
      saveFile: async (id, doc) => {
        if (id === "badWrite") throw new Error("disk full");
        await deps.saveFile(id, doc);
      },
    });
    expect(r).toMatchObject({ changed: 2, failed: 2, failedIds: ["gone", "badWrite"] });
    expect(store.get("ok2")!.paperSize).toBe("a4");
    expect(store.get("badWrite")!.paperSize).toBeUndefined();
  });

  it("beforeEach が失敗した 1 件は失敗に数え、読み書きしない", async () => {
    const { log, deps } = memory({ a: makeDoc("a"), b: makeDoc("b") });
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const r = await runBulkBodyWidth(["a", "b"], "a4", {
      ...deps,
      beforeEach: async (id) => {
        if (id === "a") throw new Error("flush failed");
      },
    });
    expect(r).toMatchObject({ changed: 1, failed: 1, failedIds: ["a"] });
    expect(log).toEqual(["load:b", "save:b"]);
  });

  it("進み具合を 0 件から 1 件ごとに報告する", async () => {
    const { deps } = memory({ a: makeDoc("a"), b: makeDoc("b") });
    const seen: string[] = [];
    await runBulkBodyWidth(["a", "b"], "a4", { ...deps, onProgress: (p) => seen.push(`${p.done}/${p.total}`) });
    expect(seen).toEqual(["0/2", "1/2", "2/2"]);
  });

  // 実際の provider の loadFile は migrateToLatest を通す。古い版の doc を読んで書き戻すと、
  // 幅だけでなく読み込み時の整え（version の引き上げ）も一緒に保存される。UI と manual は
  // 「幅だけ」と言い切らず、この挙動を認める文面にしてある
  it("古い版（version 5）の doc: 読み込み時の整えも保存される（version が上がる）が、更新日時と履歴は同じ", async () => {
    const orig = makeDoc("old", { version: 5 });
    const store = new Map<string, GraphiumDocument>([["old", structuredClone(orig)]]);
    const r = await runBulkBodyWidth(["old"], "a4", {
      loadFile: async (id) => migrateToLatest(structuredClone(store.get(id)!), id),
      saveFile: async (id, doc) => {
        store.set(id, structuredClone(doc));
      },
    });
    expect(r.changed).toBe(1);
    const saved = store.get("old")!;
    expect(saved.paperSize).toBe("a4");
    expect(saved.version).toBe(6);
    expect(saved.modifiedAt).toBe(orig.modifiedAt);
    expect(saved.documentProvenance).toEqual(orig.documentProvenance);
  });
});
