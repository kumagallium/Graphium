// @vitest-environment jsdom
// 計画の行の記録の流れを、実際の共有・複製の関数でつないで確かめる。
//
//   先生: 計画を共有する
//   学生: 共有の計画を複製 → 行からノートを作る → 記録して共有する（区切りごとに更新）
//   先生: 自分の計画の行に、学生の記録が並ぶ
//
// 共有フォルダは Tauri invoke のモック（メモリ上）。先生と学生は別々の手元（別の id 空間）を持つ。

import { beforeEach, describe, expect, it, vi } from "vitest";

const invokeMock = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/core", () => ({ invoke: invokeMock }));

import type { GraphiumDocument } from "../../lib/document-types";
import type { SharedEntry } from "../../lib/storage/shared";
import type { AuthorIdentity } from "../document-provenance/types";
import { collectOperationRows } from "../network-graph/plan-flow";
import { shareNote } from "./share-note";
import { forkSharedNote } from "./fork-note";
import {
  groupPlanRecordsByRow,
  planRowKey,
  planSharedIdsOf,
  readPlanRowRef,
  resolvePlanRowForNote,
} from "./plan-row-ref";

const ROOT = "/tmp/shared";
const teacher: AuthorIdentity = { name: "山田 先生", email: "yamada@example.ac.jp" };
const student: AuthorIdentity = { name: "佐藤 花", email: "sato@example.ac.jp" };

/** 共有フォルダ（メモリ上）。key = entryType/id */
const shared = new Map<string, string>();
const sharedEntries = (): SharedEntry[] => [...shared.values()].map((raw) => JSON.parse(raw).entry);

beforeEach(() => {
  shared.clear();
  localStorage.clear();
  invokeMock.mockReset();
  invokeMock.mockImplementation(async (cmd: string, args: any) => {
    switch (cmd) {
      case "shared_write":
        shared.set(`${args.entryType}/${args.id}`, args.content);
        return null;
      case "shared_read": {
        const v = shared.get(`${args.entryType}/${args.id}`);
        if (!v) throw new Error("not found");
        return v;
      }
      case "shared_readable_sync":
        return null;
      default:
        throw new Error(`unmocked: ${cmd}`);
    }
  });
});

const cell = (text: string, styles: Record<string, unknown> = {}) => ({
  type: "tableCell",
  content: [{ type: "text", text, styles }],
});

/** 先生の計画。「こね」は先生が自分のノートを作ってある（学生の端末には無いノート） */
function teacherPlan(): GraphiumDocument {
  return {
    version: 5,
    title: "食パンの計画",
    kind: "plan",
    noteContexts: ["パン/食パン"],
    noteLinks: [{ targetNoteId: "teacher-knead", sourceBlockId: "tbl-1", type: "derived_from" }],
    pages: [
      {
        id: "p1",
        title: "食パンの計画",
        blocks: [
          {
            id: "tbl-1",
            type: "table",
            content: {
              type: "tableContent",
              rows: [
                { cells: [cell("工程"), cell("条件")] },
                { cells: [cell("@こね", { textColor: "blue", tableRowIdentity: "row_knead" }), cell("10 分")] },
                { cells: [cell("一次発酵", { tableRowIdentity: "row_ferment" }), cell("60 分")] },
                { cells: [cell("焼成", { tableRowIdentity: "row_bake" }), cell("200 ℃")] },
              ],
            },
            children: [],
          },
        ],
        labels: {},
        provLinks: [],
        knowledgeLinks: [],
        tableMeta: { "tbl-1": { columns: { 工程: ["note-link"] }, noteLinks: { "@こね": "teacher-knead" } } },
      },
    ],
    createdAt: "2026-11-01T00:00:00Z",
    modifiedAt: "2026-11-01T00:00:00Z",
  } as unknown as GraphiumDocument;
}

function rowNote(title: string, planNoteId: string): GraphiumDocument {
  return {
    version: 5,
    title,
    kind: "note",
    derivedFromNoteId: planNoteId,
    derivedFromBlockId: "tbl-1",
    pages: [
      {
        id: "p1",
        title,
        blocks: [{ id: "b1", type: "paragraph", content: [{ type: "text", text: "記録" }] }],
        labels: {},
        provLinks: [],
        knowledgeLinks: [],
      },
    ],
    createdAt: "2026-11-10T00:00:00Z",
    modifiedAt: "2026-11-10T00:00:00Z",
  } as unknown as GraphiumDocument;
}

/** 行からノートを作ったときに表の注釈へ入るつながり（create-note-from-row と同じ形）を足す */
function linkRow(plan: GraphiumDocument, rowName: string, noteId: string): GraphiumDocument {
  const page = plan.pages[0];
  const meta = page.tableMeta!["tbl-1"];
  return {
    ...plan,
    pages: [
      {
        ...page,
        tableMeta: { "tbl-1": { ...meta, noteLinks: { ...(meta.noteLinks ?? {}), [`@${rowName}`]: noteId } } },
      },
    ],
  };
}

describe("計画の行の記録の流れ（先生が共有 → 学生が複製して記録を共有 → 先生の計画に並ぶ）", () => {
  it("学生が共有した記録が、先生の計画の同じ行に並ぶ。再共有しても対応は残る", async () => {
    // ── 先生: 計画を共有 ──
    const sharedPlan = await shareNote(teacherPlan(), { root: ROOT, author: teacher });
    if (!sharedPlan.ok) throw new Error(sharedPlan.error);
    const teacherPlanDoc = sharedPlan.doc;
    const planSharedId = teacherPlanDoc.sharedRef!.id;

    // ── 学生: 複製する（学生の端末には先生のノートが無い） ──
    const forked = await forkSharedNote(planSharedId, { root: ROOT, isLocalNote: () => false });
    if (!forked.ok) throw new Error(forked.error);
    let studentPlan = forked.doc;
    // 先生のノートを指していた行は、行から作れる状態に戻っている
    expect(collectOperationRows(studentPlan).map((r) => [r.name, r.state])).toEqual([
      ["こね", "unlinked"],
      ["一次発酵", "unlinked"],
      ["焼成", "unlinked"],
    ]);
    expect(studentPlan.kind).toBe("plan");

    // ── 学生: 「一次発酵」の行からノートを作る ──
    studentPlan = linkRow(studentPlan, "一次発酵", "student-ferment");
    const studentNotes = new Map<string, GraphiumDocument>([
      ["student-plan", studentPlan],
      ["student-ferment", rowNote("一次発酵", "student-plan")],
    ]);
    const loadNote = async (id: string) => studentNotes.get(id) ?? null;

    // ── 学生: 記録を共有する ──
    const found = await resolvePlanRowForNote("student-ferment", studentNotes.get("student-ferment")!, {
      index: null,
      loadNote,
    });
    expect(found?.ref).toEqual({
      planIds: [planSharedId],
      tableBlockId: "tbl-1",
      rowId: "row_ferment",
      rowName: "一次発酵",
    });
    const first = await shareNote(studentNotes.get("student-ferment")!, {
      root: ROOT,
      author: student,
      planRow: found!.ref,
    });
    if (!first.ok) throw new Error(first.error);
    studentNotes.set("student-ferment", first.doc);

    // ── 先生: 自分の計画の行に、学生の記録が並ぶ ──
    const teacherRows = collectOperationRows(teacherPlanDoc);
    const grouped = groupPlanRecordsByRow(planSharedIdsOf(teacherPlanDoc), teacherRows, sharedEntries());
    const fermentRow = teacherRows.find((r) => r.rowId === "row_ferment")!;
    const records = grouped.byRow.get(planRowKey(fermentRow)) ?? [];
    expect(records.map((e) => [e.author.name, e.id])).toEqual([["佐藤 花", first.doc.sharedRef!.id]]);
    expect(grouped.unmatched).toEqual([]);
    // ほかの行には何も並ばない
    expect(grouped.byRow.size).toBe(1);

    // ── 学生: 計画の写しを片付けたあとで、記録を更新して共有し直す ──
    studentNotes.delete("student-plan");
    const again = await resolvePlanRowForNote("student-ferment", studentNotes.get("student-ferment")!, {
      index: null,
      loadNote,
    });
    expect(again).toBeNull();
    const second = await shareNote(
      { ...studentNotes.get("student-ferment")!, title: "一次発酵（28 ℃）" },
      { root: ROOT, author: student },
    );
    if (!second.ok) throw new Error(second.error);
    expect(second.isUpdate).toBe(true);
    const updated = sharedEntries().find((e) => e.id === first.doc.sharedRef!.id)!;
    expect(readPlanRowRef(updated)?.rowId).toBe("row_ferment");
    expect(updated.history?.length).toBe(1);

    // ── 学生の複製からも、同じ行に同じ記録が見える ──
    const studentRows = collectOperationRows(studentPlan);
    const fromStudent = groupPlanRecordsByRow(planSharedIdsOf(studentPlan), studentRows, sharedEntries());
    expect(fromStudent.byRow.get(planRowKey(studentRows.find((r) => r.rowId === "row_ferment")!))?.length).toBe(1);
  });

  it("先生が自分の行のノートを共有したときも、同じ行に並ぶ", async () => {
    const sharedPlan = await shareNote(teacherPlan(), { root: ROOT, author: teacher });
    if (!sharedPlan.ok) throw new Error(sharedPlan.error);
    const notes = new Map<string, GraphiumDocument>([
      ["teacher-plan", sharedPlan.doc],
      ["teacher-knead", rowNote("こね", "teacher-plan")],
    ]);
    const found = await resolvePlanRowForNote("teacher-knead", notes.get("teacher-knead")!, {
      index: null,
      loadNote: async (id) => notes.get(id) ?? null,
    });
    const shared1 = await shareNote(notes.get("teacher-knead")!, { root: ROOT, author: teacher, planRow: found?.ref });
    if (!shared1.ok) throw new Error(shared1.error);

    const rows = collectOperationRows(sharedPlan.doc);
    const grouped = groupPlanRecordsByRow(planSharedIdsOf(sharedPlan.doc), rows, sharedEntries());
    expect(grouped.byRow.get(planRowKey(rows[0]))?.map((e) => e.author.name)).toEqual(["山田 先生"]);
  });

  it("先生が計画の行名を変えても、行の id で同じ行に並ぶ", async () => {
    const sharedPlan = await shareNote(teacherPlan(), { root: ROOT, author: teacher });
    if (!sharedPlan.ok) throw new Error(sharedPlan.error);
    const planSharedId = sharedPlan.doc.sharedRef!.id;
    await shareNote(rowNote("焼成", "x"), {
      root: ROOT,
      author: student,
      planRow: { planIds: [planSharedId], tableBlockId: "tbl-1", rowId: "row_bake", rowName: "焼成" },
    });
    // 先生の側で行名を変える
    const renamed = JSON.parse(JSON.stringify(sharedPlan.doc)) as GraphiumDocument;
    (renamed.pages[0].blocks[0] as any).content.rows[3].cells[0].content[0].text = "焼成（スチームあり）";
    const rows = collectOperationRows(renamed);
    const grouped = groupPlanRecordsByRow(planSharedIdsOf(renamed), rows, sharedEntries());
    expect(grouped.byRow.get(planRowKey(rows[2]))?.length).toBe(1);
    expect(grouped.unmatched).toEqual([]);
  });
});
