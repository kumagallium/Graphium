// @vitest-environment jsdom
// サイドピークの ⋯「リンクをコピー」がコピーするリンクの回帰ガード
import { describe, expect, it } from "vitest";
import { parseGraphiumLink } from "../block-link/graphium-link";
import { canArchiveFromPeek, peekNoteLink } from "./peek-note-menu";

describe("peekNoteLink", () => {
  it("ノートは #note/<id>", () => {
    expect(parseGraphiumLink(peekNoteLink("n-1", undefined)!)).toEqual({ kind: "note", id: "n-1" });
    expect(peekNoteLink("n-1", undefined)).toContain("#note/n-1");
  });

  it("ナレッジは開いている文書の種別で #knowledge/<種別>/<id>（wiki: は外す）", () => {
    expect(peekNoteLink("wiki:w-1", "topic")).toContain("#knowledge/topic/w-1");
    expect(parseGraphiumLink(peekNoteLink("wiki:w-1", "topic")!)).toEqual({ kind: "knowledge", id: "w-1" });
  });

  it("文書を読み込む前で種別が分からなくても、貼れば同じページを指す", () => {
    expect(parseGraphiumLink(peekNoteLink("wiki:w-1", undefined)!)).toEqual({ kind: "knowledge", id: "w-1" });
  });

  it("版のスナップショット・スキルはリンクで開けないので null", () => {
    expect(peekNoteLink("snapshot:n-1:3", undefined)).toBeNull();
    expect(peekNoteLink("skill:s-1", undefined)).toBeNull();
  });
});

describe("canArchiveFromPeek", () => {
  const fresh = { archived: false, trashed: false };

  it("通常のノートなら出す", () => {
    expect(canArchiveFromPeek("n-1", fresh)).toBe(true);
  });

  it("ナレッジ・スキル・版のスナップショットには出さない（全画面の ⋯ と同じ）", () => {
    for (const id of ["wiki:w-1", "skill:s-1", "snapshot:n-1:3"]) expect(canArchiveFromPeek(id, fresh)).toBe(false);
  });

  it("すでにアーカイブ・ゴミ箱に入っているなら出さない（バナーの復元を使う）", () => {
    expect(canArchiveFromPeek("n-1", { archived: true, trashed: false })).toBe(false);
    expect(canArchiveFromPeek("n-1", { archived: false, trashed: true })).toBe(false);
  });
});
