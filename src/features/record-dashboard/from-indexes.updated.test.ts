// 更新の行: ノートと AI のページを、作った日とは別に、最後に更新した日にもう 1 行出す。
import { describe, expect, it } from "vitest";
import type { NoteIndexEntry } from "../navigation/index-file";
import { buildRecords, noteUpdateToRecord } from "./from-indexes";
import { bodyHitKey, bundleRuns, isHit, isOwnRow } from "./model";

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

describe("noteUpdateToRecord", () => {
  it("作った日と別の日に更新したノートは、更新した日時に更新の行を作る", () => {
    const row = noteUpdateToRecord(note({ noteContexts: ["パン教室"] }), NONE);
    expect(row).toEqual({
      id: "note-updated:n1",
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
    const row = noteUpdateToRecord(note(), NONE);
    expect(row?.detail).toBeUndefined();
    expect(row?.trace).toBeUndefined();
  });

  it("AI のページには更新の行を出さない（知識の流れの書き足しで 1 日に数百件になるため）", () => {
    expect(noteUpdateToRecord(note({ source: "ai", wikiKind: "topic", model: "m" }), NONE)).toBeNull();
  });

  it("AI が書いたノートの更新は自分", () => {
    expect(noteUpdateToRecord(note({ model: "m" }), NONE)?.who).toEqual({ type: "self" });
  });

  it("作った日と同じ日の更新・作った日時より前の更新・読めない日時では作らない", () => {
    expect(noteUpdateToRecord(note({ modifiedAt: "2026-11-10T12:30:00.000Z" }), NONE)).toBeNull();
    expect(noteUpdateToRecord(note({ modifiedAt: "2026-11-01T12:00:00.000Z" }), NONE)).toBeNull();
    expect(noteUpdateToRecord(note({ modifiedAt: "壊れた日時" }), NONE)).toBeNull();
    expect(noteUpdateToRecord(note({ createdAt: "" }), NONE)).toBeNull();
  });
});

describe("buildRecords と更新の行", () => {
  it("作成の行は作った日に残し、更新の行を足す", () => {
    const rows = buildRecords({ notes: [note()], media: [], captures: [] });
    expect(rows.map((r) => [r.id, r.at])).toEqual([
      ["note-updated:n1", "2026-11-17T12:00:00.000Z"],
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
