// @vitest-environment jsdom
// サイドピークの ⋯「リンクをコピー」がコピーするリンクの回帰ガード
import { describe, expect, it } from "vitest";
import { parseGraphiumLink } from "../block-link/graphium-link";
import { peekNoteLink } from "./peek-note-menu";

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
