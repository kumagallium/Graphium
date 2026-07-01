import { describe, it, expect } from "vitest";
import { resolveMentionFromLinks } from "./resolve-mention";
import { formatMentionDate } from "./mention-menu";
import type { BlockLink } from "./link-types";

// テスト用の reference リンクを作る
function refLink(sourceBlockId: string, targetNoteId: string): BlockLink {
  return {
    id: `link-${targetNoteId}`,
    sourceBlockId,
    targetBlockId: "",
    type: "reference",
    layer: "knowledge",
    createdBy: "human",
    targetNoteId,
  };
}

describe("resolveMentionFromLinks", () => {
  it("同名ノートでも targetNoteId で一意に解決する", () => {
    // 同じタイトル "新しいノート" を持つ 2 件。ブロックのリンクは note-B を指す。
    const links = [refLink("blk1", "note-B")];
    const getNote = (id: string) =>
      id === "note-A" || id === "note-B"
        ? { title: "新しいノート", isWiki: false }
        : null;

    const res = resolveMentionFromLinks(links, "新しいノート", getNote);
    expect(res).toEqual({ noteId: "note-B", isWiki: false });
  });

  it("reference リンクが無ければ null（＝タイトル逆引きへフォールバック）", () => {
    const res = resolveMentionFromLinks([], "どれか", () => null);
    expect(res).toBeNull();
  });

  it("クリックテキストがどのリンク先タイトルとも一致しなければ null（アセット等の同居メンション）", () => {
    // ブロックには note への reference があるが、クリックしたのは別テキスト（例: PDF 素材）
    const links = [refLink("blk1", "note-A")];
    const getNote = (id: string) =>
      id === "note-A" ? { title: "会議メモ", isWiki: false } : null;

    const res = resolveMentionFromLinks(links, "論文.pdf", getNote);
    expect(res).toBeNull();
  });

  it("同ブロックに複数リンクがあればクリックテキストで正しいリンクを選ぶ", () => {
    const links = [refLink("blk1", "note-A"), refLink("blk1", "note-B")];
    const getNote = (id: string) => {
      if (id === "note-A") return { title: "実験ノート", isWiki: false };
      if (id === "note-B") return { title: "解析ノート", isWiki: false };
      return null;
    };

    expect(resolveMentionFromLinks(links, "解析ノート", getNote)).toEqual({
      noteId: "note-B",
      isWiki: false,
    });
  });

  it("Wiki は 🤖/Summary: プレフィックスを剥がして実タイトルと照合する", () => {
    const links = [refLink("blk1", "wiki-1")];
    const getNote = (id: string) =>
      id === "wiki-1" ? { title: "光合成の効率", isWiki: true } : null;

    const res = resolveMentionFromLinks(
      links,
      "🤖 Concept: 光合成の効率",
      getNote,
    );
    expect(res).toEqual({ noteId: "wiki-1", isWiki: true });
  });

  it("targetNoteId が index/files で見つからない（削除済み）リンクはスキップして null", () => {
    const links = [refLink("blk1", "gone")];
    const res = resolveMentionFromLinks(links, "消えたノート", () => null);
    expect(res).toBeNull();
  });

  it("reference 以外のリンクは無視する", () => {
    const provLink: BlockLink = {
      id: "l1",
      sourceBlockId: "blk1",
      targetBlockId: "blk2",
      type: "derived_from",
      layer: "prov",
      createdBy: "human",
      targetNoteId: "note-A",
    };
    const getNote = () => ({ title: "何か", isWiki: false });
    expect(resolveMentionFromLinks([provLink], "何か", getNote)).toBeNull();
  });
});

describe("formatMentionDate", () => {
  it("ISO 文字列を YYYY-MM-DD HH:mm に整形する", () => {
    // ローカルタイムゾーン差を避けるため、日付が跨がない正午の値を使う
    expect(formatMentionDate("2026-06-30T12:00:00.000Z")).toMatch(
      /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/,
    );
  });

  it("不正な値は空文字を返す", () => {
    expect(formatMentionDate("not-a-date")).toBe("");
    expect(formatMentionDate("")).toBe("");
  });
});
