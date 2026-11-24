import { describe, expect, it } from "vitest";
import type { GraphiumDocument } from "../../lib/document-types";
import type { SharedEntry } from "../../lib/storage/shared";
import {
  findPlanRecords,
  groupPlanRecordsByRow,
  parsePlanRowRef,
  planRowKey,
  planSharedIdsOf,
  PLAN_IDS_LIMIT,
  ROW_NAME_MAX_LENGTH,
  readPlanRowRef,
  resolvePlanRowForNote,
  resolvePlanRowRef,
} from "./plan-row-ref";
import type { GraphiumIndex } from "../navigation/index-file";

const cell = (text: string, rowId?: string) => ({
  type: "tableCell",
  content: [{ type: "text", text, styles: rowId ? { tableRowIdentity: rowId } : {} }],
});

/** note-link 列つきの表を 1 つ持つ計画ノート */
function planDoc(over: Partial<GraphiumDocument> = {}, noteLinks: Record<string, string> = {}): GraphiumDocument {
  return {
    version: 3,
    title: "食パンの計画",
    kind: "plan",
    pages: [
      {
        id: "main",
        title: "Main",
        blocks: [
          {
            id: "tbl-1",
            type: "table",
            content: {
              type: "tableContent",
              rows: [
                { cells: [cell("工程"), cell("条件")] },
                { cells: [cell("@こね", "row_a"), cell("10 分")] },
                { cells: [cell("一次発酵", "row_b"), cell("60 分")] },
                { cells: [cell("焼成"), cell("200 ℃")] },
              ],
            },
            children: [],
          },
        ],
        labels: {},
        provLinks: [],
        knowledgeLinks: [],
        tableMeta: { "tbl-1": { columns: { 工程: ["note-link"] }, noteLinks } },
      },
    ],
    createdAt: "2026-11-01T00:00:00.000Z",
    modifiedAt: "2026-11-01T00:00:00.000Z",
    ...over,
  } as GraphiumDocument;
}

const forkedFrom = {
  sharedId: "plan-shared",
  hash: "sha256:x",
  authorName: "先生",
  authorEmail: "teacher@example.com",
  forkedAt: "2026-11-02T00:00:00.000Z",
};

function entry(id: string, planRow: unknown, over: Partial<SharedEntry> = {}): SharedEntry {
  return {
    id,
    type: "note",
    author: { name: "学生 A", email: "a@example.com" },
    created_at: "2026-11-03T00:00:00.000Z",
    updated_at: "2026-11-03T00:00:00.000Z",
    hash: `sha256:${id}`,
    prov: { derived_from: [] },
    extra: { title: id, ...(planRow === undefined ? {} : { planRow }) },
    ...over,
  } as SharedEntry;
}

describe("planSharedIdsOf", () => {
  it("写しの元を先に、自分で共有した計画を後に返す", () => {
    expect(
      planSharedIdsOf({
        forkedFrom,
        sharedRef: { id: "my-plan", type: "note", sharedAt: "", hash: "" },
      }),
    ).toEqual(["plan-shared", "my-plan"]);
  });

  it("共有に出ていない計画は空", () => {
    expect(planSharedIdsOf({})).toEqual([]);
    expect(planSharedIdsOf(null)).toEqual([]);
  });

  it("提案として出しているだけの参照は計画の id にしない", () => {
    expect(planSharedIdsOf({ sharedRef: { id: "p1", type: "proposal", sharedAt: "", hash: "" } })).toEqual([]);
  });
});

describe("resolvePlanRowRef", () => {
  it("写しの計画の行から作ったノートに、元の計画と行の id を添える", () => {
    const plan = planDoc({ forkedFrom }, { "@こね": "note-knead" });
    const found = resolvePlanRowRef("note-knead", [{ noteId: "plan-local", doc: plan }]);
    expect(found?.ref).toEqual({
      planIds: ["plan-shared"],
      tableBlockId: "tbl-1",
      rowId: "row_a",
      rowName: "こね",
    });
    expect(found?.planTitle).toBe("食パンの計画");
    expect(found?.planNoteId).toBe("plan-local");
  });

  it("行の id がまだ無い行は、名前だけで添える", () => {
    const plan = planDoc({ forkedFrom }, { 焼成: "note-bake" });
    expect(resolvePlanRowRef("note-bake", [{ noteId: "plan-local", doc: plan }])?.ref).toEqual({
      planIds: ["plan-shared"],
      tableBlockId: "tbl-1",
      rowName: "焼成",
    });
  });

  it("共有に出ていない計画の行は対応にならない", () => {
    const plan = planDoc({}, { "@こね": "note-knead" });
    expect(resolvePlanRowRef("note-knead", [{ noteId: "plan-local", doc: plan }])).toBeNull();
  });

  it("行に無いノートは対応にならない", () => {
    const plan = planDoc({ forkedFrom }, { "@こね": "note-knead" });
    expect(resolvePlanRowRef("someone-else", [{ noteId: "plan-local", doc: plan }])).toBeNull();
  });

  it("先に渡した候補が勝つ", () => {
    const first = planDoc({ forkedFrom }, { 一次発酵: "note-x" });
    const second = planDoc({ forkedFrom: { ...forkedFrom, sharedId: "other-plan" } }, { "@こね": "note-x" });
    const found = resolvePlanRowRef("note-x", [
      { noteId: "p1", doc: first },
      { noteId: "p2", doc: second },
    ]);
    expect(found?.ref.planIds).toEqual(["plan-shared"]);
    expect(found?.ref.rowName).toBe("一次発酵");
  });
});

describe("parsePlanRowRef / readPlanRowRef", () => {
  it("形の合わないものは null", () => {
    expect(parsePlanRowRef(null)).toBeNull();
    expect(parsePlanRowRef({ planIds: [], tableBlockId: "t", rowName: "a" })).toBeNull();
    expect(parsePlanRowRef({ planIds: ["p"], rowName: "a" })).toBeNull();
    expect(parsePlanRowRef({ planIds: ["p"], tableBlockId: "t" })).toBeNull();
    expect(parsePlanRowRef({ planIds: [1, "p"], tableBlockId: "t", rowName: "a", rowId: 3 })).toEqual({
      planIds: ["p"],
      tableBlockId: "t",
      rowName: "a",
    });
  });

  it("ノート以外の封筒からは読まない", () => {
    const ref = { planIds: ["p"], tableBlockId: "t", rowName: "a" };
    expect(readPlanRowRef(entry("n1", ref))).toEqual(ref);
    expect(readPlanRowRef(entry("k1", ref, { type: "knowledge" }))).toBeNull();
  });
});

describe("findPlanRecords / groupPlanRecordsByRow", () => {
  const rows = [
    { tableBlockId: "tbl-1", rowId: "row_a", name: "@こね" },
    { tableBlockId: "tbl-1", rowId: "row_b", name: "一次発酵（改）" },
    { tableBlockId: "tbl-1", name: "焼成" },
  ];
  const ref = (over: Record<string, unknown>) => ({ planIds: ["plan-shared"], tableBlockId: "tbl-1", rowName: "", ...over });

  it("計画を指している記録だけを、新しい順に返す", () => {
    const entries = [
      entry("old", ref({ rowId: "row_a", rowName: "こね" }), { updated_at: "2026-11-03T00:00:00.000Z" }),
      entry("new", ref({ rowId: "row_a", rowName: "こね" }), { updated_at: "2026-11-05T00:00:00.000Z" }),
      entry("other-plan", { planIds: ["zzz"], tableBlockId: "tbl-1", rowName: "こね" }),
      entry("plain", undefined),
      entry("gone", ref({ rowId: "row_a", rowName: "こね" }), { status: "unshared" }),
    ];
    expect(findPlanRecords(["plan-shared"], entries).map((r) => r.entry.id)).toEqual(["new", "old"]);
    expect(findPlanRecords([], entries)).toEqual([]);
  });

  it("行の id で振り分ける（計画の側で行名を変えていても合う）", () => {
    const { byRow, unmatched } = groupPlanRecordsByRow(
      ["plan-shared"],
      rows,
      [entry("r1", ref({ rowId: "row_b", rowName: "一次発酵" }))],
    );
    expect(byRow.get(planRowKey(rows[1]))?.map((e) => e.id)).toEqual(["r1"]);
    expect(unmatched).toEqual([]);
  });

  it("行の id が無い記録は、同じ表の同じ名前の行に寄せる", () => {
    const { byRow } = groupPlanRecordsByRow(
      ["plan-shared"],
      rows,
      [entry("r1", ref({ rowName: "焼成" })), entry("r2", ref({ rowName: " こね " }))],
    );
    expect(byRow.get(planRowKey(rows[2]))?.map((e) => e.id)).toEqual(["r1"]);
    expect(byRow.get(planRowKey(rows[0]))?.map((e) => e.id)).toEqual(["r2"]);
  });

  it("1 つの行に複数の人の記録が並ぶ", () => {
    const { byRow } = groupPlanRecordsByRow(
      ["plan-shared"],
      rows,
      [
        entry("a", ref({ rowId: "row_a", rowName: "こね" }), { updated_at: "2026-11-03T00:00:00.000Z" }),
        entry("b", ref({ rowId: "row_a", rowName: "こね" }), {
          updated_at: "2026-11-04T00:00:00.000Z",
          author: { name: "学生 B", email: "b@example.com" },
        }),
      ],
    );
    expect(byRow.get(planRowKey(rows[0]))?.map((e) => e.id)).toEqual(["b", "a"]);
  });

  it("合う行が無い記録は unmatched に残す", () => {
    const { byRow, unmatched } = groupPlanRecordsByRow(
      ["plan-shared"],
      rows,
      [entry("r1", ref({ rowId: "row_zzz", rowName: "写しで足した行" }))],
    );
    expect(byRow.size).toBe(0);
    expect(unmatched.map((u) => u.entry.id)).toEqual(["r1"]);
  });

  it("別の表の同じ名前の行には寄せない", () => {
    const { unmatched } = groupPlanRecordsByRow(
      ["plan-shared"],
      rows,
      [entry("r1", { planIds: ["plan-shared"], tableBlockId: "tbl-2", rowName: "焼成" })],
    );
    expect(unmatched.map((u) => u.entry.id)).toEqual(["r1"]);
  });

  it("計画そのものは記録に数えない", () => {
    const self = entry("plan-shared", ref({ rowId: "row_a", rowName: "こね" }));
    expect(findPlanRecords(["plan-shared"], [self])).toEqual([]);
  });
});

describe("resolvePlanRowForNote", () => {
  const indexOf = (notes: { noteId: string; targets: string[]; modifiedAt?: string; deletedAt?: string }[]) =>
    ({
      version: 1,
      notes: notes.map((n) => ({
        noteId: n.noteId,
        title: n.noteId,
        modifiedAt: n.modifiedAt ?? "2026-11-01T00:00:00.000Z",
        outgoingLinks: n.targets.map((targetNoteId) => ({ targetNoteId })),
        ...(n.deletedAt ? { deletedAt: n.deletedAt } : {}),
      })),
    }) as unknown as GraphiumIndex;

  it("派生元の計画から対応を組む", async () => {
    const plan = planDoc({ forkedFrom }, { "@こね": "note-knead" });
    const loaded: string[] = [];
    const found = await resolvePlanRowForNote(
      "note-knead",
      { derivedFromNoteId: "plan-local" },
      {
        index: null,
        loadNote: async (id) => {
          loaded.push(id);
          return id === "plan-local" ? plan : null;
        },
      },
    );
    expect(found?.ref.rowId).toBe("row_a");
    expect(loaded).toEqual(["plan-local"]);
  });

  it("既存のノートを行に紐付けたときは、このノートを指しているノートから拾う", async () => {
    const plan = planDoc({ forkedFrom }, { 一次発酵: "note-ferment" });
    const memo = planDoc({}, {});
    const found = await resolvePlanRowForNote(
      "note-ferment",
      {},
      {
        index: indexOf([
          { noteId: "memo", targets: ["note-ferment"], modifiedAt: "2026-11-09T00:00:00.000Z" },
          { noteId: "plan-local", targets: ["note-ferment"] },
          { noteId: "trashed-plan", targets: ["note-ferment"], deletedAt: "2026-11-02T00:00:00.000Z" },
        ]),
        loadNote: async (id) => (id === "plan-local" ? plan : id === "memo" ? memo : null),
      },
    );
    expect(found?.planNoteId).toBe("plan-local");
    expect(found?.ref.rowName).toBe("一次発酵");
  });

  it("計画が読めない・見つからないときは null（投げない）", async () => {
    const found = await resolvePlanRowForNote(
      "note-knead",
      { derivedFromNoteId: "plan-local" },
      {
        index: null,
        loadNote: async () => {
          throw new Error("gone");
        },
      },
    );
    expect(found).toBeNull();
  });
});

describe("他の人が書いた封筒への防御", () => {
  it("planIds は先頭の数件だけを見て、長すぎる id は捨てる。行の名前は切る", () => {
    const many = Array.from({ length: 1000 }, (_, i) => `plan-${i}`);
    const parsed = parsePlanRowRef({
      planIds: ["x".repeat(500), ...many],
      tableBlockId: "tbl-1",
      rowId: "r".repeat(500),
      rowName: "名".repeat(5000),
    });
    expect(parsed?.planIds.length).toBe(PLAN_IDS_LIMIT - 1);
    expect(parsed?.planIds[0]).toBe("plan-0");
    expect(parsed?.rowId).toBeUndefined();
    expect(parsed?.rowName.length).toBe(ROW_NAME_MAX_LENGTH);
    expect(parsePlanRowRef({ planIds: ["p"], tableBlockId: "t".repeat(500), rowName: "a" })).toBeNull();
  });

  it("updated_at が欠けた・文字列でない封筒が混ざっても並べ替えで落ちない", () => {
    const ref = { planIds: ["plan-shared"], tableBlockId: "tbl-1", rowId: "row_a", rowName: "こね" };
    const broken = entry("broken", ref);
    delete (broken as any).updated_at;
    const odd = entry("odd", ref);
    (odd as any).updated_at = 12345;
    const fine = entry("fine", ref, { updated_at: "2026-11-05T00:00:00.000Z" });
    const found = findPlanRecords(["plan-shared"], [broken, fine, odd]);
    expect(found.map((r) => r.entry.id)[0]).toBe("fine");
    expect(found).toHaveLength(3);
    expect(() => groupPlanRecordsByRow(["plan-shared"], [{ tableBlockId: "tbl-1", rowId: "row_a", name: "こね" }], [broken, odd, fine])).not.toThrow();
  });

  it("extra が変な形の封筒は読み飛ばす", () => {
    const weird = [
      entry("a", undefined, { extra: "oops" as any }),
      entry("b", undefined, { extra: null as any }),
      entry("c", "<img src=x onerror=alert(1)>"),
      entry("d", { planIds: "plan-shared", tableBlockId: "t", rowName: "x" }),
    ];
    expect(findPlanRecords(["plan-shared"], weird)).toEqual([]);
  });

  it("表の形が壊れた計画ノートは飛ばして、次の候補を見る", async () => {
    const brokenPlan = { ...planDoc({ forkedFrom }), pages: [{ id: "p", title: "", blocks: "oops", tableMeta: 3 }] } as any;
    const good = planDoc({ forkedFrom }, { "@こね": "note-knead" });
    const found = await resolvePlanRowForNote(
      "note-knead",
      { derivedFromNoteId: "broken" },
      {
        index: {
          version: 1,
          notes: [{ noteId: "good", title: "", modifiedAt: "2026-11-01T00:00:00.000Z", outgoingLinks: [{ targetNoteId: "note-knead" }] }],
        } as any,
        loadNote: async (id) => (id === "broken" ? brokenPlan : id === "good" ? good : null),
      },
    );
    expect(found?.planNoteId).toBe("good");
  });
});
