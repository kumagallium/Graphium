// 更新の行: 自分のノートを、作った日とは別に、書き換えた日ごとに 1 行ずつ出す。
import { describe, expect, it } from "vitest";
import type { NoteIndexEntry } from "../navigation/index-file";
import { buildRecords, noteUpdatesToRecords } from "./from-indexes";
import { bodyHitKey, bundleRuns, dayKeyOf, isHit, isOwnRow, updatedRowId } from "./model";

function note(over: Partial<NoteIndexEntry> = {}): NoteIndexEntry {
  return {
    noteId: "n1",
    title: "食パン 試作",
    createdAt: "2026-11-10T12:00:00.000Z",
    modifiedAt: "2026-11-17T12:00:00.000Z",
    headings: [{ blockId: "b1", text: "材料", level: 2 }],
    labels: [],
    outgoingLinks: [],
    ...over,
  };
}

const NONE: ReadonlySet<string> = new Set();

/** 1 行だけ返るはずの場面で、その行を取り出す */
function only(entry: NoteIndexEntry) {
  const rows = noteUpdatesToRecords(entry, NONE);
  expect(rows).toHaveLength(1);
  return rows[0];
}

const ROW_17 = updatedRowId("n1", dayKeyOf("2026-11-17T12:00:00.000Z"));

describe("noteUpdatesToRecords", () => {
  it("作った日と別の日に更新したノートは、更新した日時に更新の行を作る", () => {
    const row = only(note({ noteContexts: ["パン教室"] }));
    expect(row).toEqual({
      id: ROW_17,
      kind: "note",
      at: "2026-11-17T12:00:00.000Z",
      origin: "written",
      who: { type: "self" },
      title: "食パン 試作",
      update: { createdAt: "2026-11-10T12:00:00.000Z" },
      folders: ["パン教室"],
    });
  });

  it("更新の行には見出しを載せない（作成の行に任せる）", () => {
    const row = only(note());
    expect(row?.detail).toBeUndefined();
    expect(row?.trace).toBeUndefined();
  });

  it("AI のページには更新の行を出さない（知識の流れの書き足しで 1 日に数百件になるため）", () => {
    expect(noteUpdatesToRecords(note({ source: "ai", wikiKind: "topic", model: "m" }), NONE)).toEqual([]);
    expect(
      noteUpdatesToRecords(note({ source: "ai", wikiKind: "topic", editedAt: ["2026-11-12T12:00:00.000Z"] }), NONE),
    ).toEqual([]);
  });

  it("AI が書いたノートの更新は自分", () => {
    expect(only(note({ model: "m" })).who).toEqual({ type: "self" });
  });

  it("作った日と同じ日の更新・作った日時より前の更新・読めない日時では作らない", () => {
    const none = (over: Partial<NoteIndexEntry>) => noteUpdatesToRecords(note(over), NONE);
    expect(none({ modifiedAt: "2026-11-10T12:30:00.000Z" })).toEqual([]);
    expect(none({ modifiedAt: "2026-11-01T12:00:00.000Z" })).toEqual([]);
    expect(none({ modifiedAt: "壊れた日時" })).toEqual([]);
    expect(none({ createdAt: "" })).toEqual([]);
    expect(
      none({
        modifiedAt: "2026-11-10T12:30:00.000Z",
        editedAt: ["2026-11-10T12:10:00.000Z", "2026-11-01T12:00:00.000Z", "壊れた日時"],
      }),
    ).toEqual([]);
  });

  it("書き換えた日ごとに 1 行ずつ、その日の最後の時刻に出す（同じ日は 1 行）", () => {
    const rows = noteUpdatesToRecords(
      note({
        editedAt: ["2026-11-10T12:20:00.000Z", "2026-11-12T12:00:00.000Z", "2026-11-17T11:00:00.000Z"],
        modifiedAt: "2026-11-17T12:00:00.000Z",
      }),
      NONE,
    );
    expect(rows.map((r) => [r.id, r.at])).toEqual([
      [updatedRowId("n1", dayKeyOf("2026-11-12T12:00:00.000Z")), "2026-11-12T12:00:00.000Z"],
      [ROW_17, "2026-11-17T12:00:00.000Z"],
    ]);
    // どの行も作った日時を持ち、同じノートの本文を見る
    expect(rows.every((r) => r.update?.createdAt === "2026-11-10T12:00:00.000Z")).toBe(true);
    expect(rows.map(bodyHitKey)).toEqual(["note:n1", "note:n1"]);
  });

  it("最後の更新日が人の書き換えの日でなくても（AI の書き足しなど）、その日の行は出す", () => {
    const rows = noteUpdatesToRecords(note({ editedAt: ["2026-11-12T12:00:00.000Z"] }), NONE);
    expect(rows.map((r) => r.at)).toEqual(["2026-11-12T12:00:00.000Z", "2026-11-17T12:00:00.000Z"]);
  });
});

describe("buildRecords と更新の行", () => {
  it("作成の行は作った日に残し、更新の行を足す", () => {
    const rows = buildRecords({ notes: [note()], media: [], captures: [] });
    expect(rows.map((r) => [r.id, r.at])).toEqual([
      [ROW_17, "2026-11-17T12:00:00.000Z"],
      ["note:n1", "2026-11-10T12:00:00.000Z"],
    ]);
  });

  it("ごみ箱・アーカイブ・スキルには更新の行も出さない", () => {
    const rows = buildRecords({
      notes: [note({ noteId: "t", deletedAt: "x" }), note({ noteId: "a", archivedAt: "x" }), note({ noteId: "s", source: "skill" })],
      media: [],
      captures: [],
    });
    expect(rows).toEqual([]);
  });
});

describe("更新の行の扱い", () => {
  const [updated, created] = buildRecords({ notes: [note()], media: [], captures: [] });

  it("記録そのものとしては数えない", () => {
    expect(isOwnRow(created)).toBe(true);
    expect(isOwnRow(updated)).toBe(false);
  });

  it("本文の当たりは、作成の行と同じノートの本文で引く", () => {
    const bodyHits = new Map([["note:n1", { text: "こね上げ温度", ranges: [] }]]);
    expect(bodyHitKey(updated)).toBe("note:n1");
    expect(isHit(updated, "こね上げ", bodyHits)).toBe(true);
  });

  it("続いた更新の行は、作成の行とは別にまとめる", () => {
    const ids = ["a", "b", "c"];
    const rows = [
      ...ids.map((id) => ({ ...updated, id: `note-updated:${id}` })),
      ...ids.map((id) => ({ ...created, id: `note:${id}` })),
    ];
    const entries = bundleRuns(rows, 3);
    expect(entries.map((e) => ("type" in e && e.type === "bundle" ? e.items.length : 1))).toEqual([3, 3]);
  });
});
