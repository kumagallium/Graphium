// 本文から参照が無くなったつながりの線を noteLinks から外す処理（note-link-cleanup.ts）の回帰ガード
import { describe, expect, it } from "vitest";
import type { GraphiumDocument, NoteLink } from "../../lib/document-types";
import type { GraphiumIndex } from "../navigation/index-file";
import {
  noteLinkTargetInfoResolver,
  pruneDocConnections,
  pruneUnreferencedConnections,
  type ConnectionCleanupInput,
} from "./note-link-cleanup";
import { mentionLabelResolver } from "./mention-paste";

const OWNER = "note-owner";

const text = (t: string, styles: Record<string, unknown> = {}) => ({ type: "text", text: t, styles });
const blue = (t: string) => text(t, { textColor: "blue" });
const para = (id: string, content: any[], children: any[] = []) => ({ id, type: "paragraph", content, children });
const table = (id: string, rows: any[][][]) => ({
  id,
  type: "table",
  content: { type: "tableContent", rows: rows.map((cells) => ({ cells: cells.map((c) => ({ type: "tableCell", content: c })) })) },
  children: [],
});

/** ノートの一覧（v33）。derivedFrom を渡したノートは、そのノートから派生で作ったもの */
function index(notes: Array<{ id: string; title: string; derivedFrom?: string; source?: "ai" }>, version = 33): GraphiumIndex {
  return {
    version,
    updatedAt: "2026-11-06T00:00:00.000Z",
    notes: notes.map((n) => ({
      noteId: n.id,
      title: n.title,
      derivedFromNoteId: n.derivedFrom,
      source: n.source,
    })) as any,
  };
}

const link = (targetNoteId: string, sourceBlockId: string): NoteLink => ({ targetNoteId, sourceBlockId, type: "derived_from" });
const ref = (sourceBlockId: string, targetNoteId: string) => ({ sourceBlockId, targetNoteId });

function run(over: Partial<ConnectionCleanupInput> & { idx: GraphiumIndex }) {
  const { idx, ...rest } = over;
  return pruneUnreferencedConnections({
    ownerNoteId: OWNER,
    noteLinks: [],
    blocks: [],
    links: [],
    labelOfTarget: mentionLabelResolver(idx, []),
    targetInfo: noteLinkTargetInfoResolver(idx),
    ...rest,
  });
}

describe("pruneUnreferencedConnections", () => {
  const idx = index([
    { id: "a", title: "カレーの下ごしらえ" },
    { id: "b", title: "スパイスの配合" },
    { id: "child", title: "派生したノート", derivedFrom: OWNER },
    { id: "row", title: "試料 1" },
  ]);

  it("本文から @ を消したつながりの線は外す", () => {
    const noteLinks = [link("a", "p1")];
    // @ を入れたときの reference リンクは本文の文字を消しても残る（実際に起きた形）
    const result = run({ idx, noteLinks, blocks: [para("p1", [text("下ごしらえは済んだ")])], links: [ref("p1", "a")] });
    expect(result.noteLinks).toEqual([]);
    expect(result.removed).toEqual(noteLinks);
  });

  it("ブロックごと消した @ のつながりの線も外す", () => {
    const result = run({ idx, noteLinks: [link("a", "gone")], blocks: [para("p1", [text("本文")])] });
    expect(result.noteLinks).toEqual([]);
  });

  it("本文に @ が残っているつながりの線は残す（段落・子ブロック・表のセル）", () => {
    const noteLinks = [link("a", "p1"), link("b", "t1")];
    const blocks = [
      para("p0", [text("前置き")], [para("p1", [text("参照 "), blue("@カレーの下ごしらえ"), text(" ")])]),
      table("t1", [[[text("名前")]], [[text("メモ "), blue("@スパイスの配合")]]]),
    ];
    const result = run({ idx, noteLinks, blocks, links: [ref("p1", "a"), ref("t1", "b")] });
    expect(result.noteLinks).toBe(noteLinks);
    expect(result.removed).toEqual([]);
  });

  it("派生の線は本文に @ が無くても残す", () => {
    const noteLinks = [link("child", "p1")];
    const result = run({ idx, noteLinks, blocks: [para("p1", [text("派生ボタンで作った")])] });
    expect(result.noteLinks).toBe(noteLinks);
  });

  it("表の行に既存のノートを紐付けた線は、セルの @ が無くても残す", () => {
    const noteLinks = [link("row", "t1")];
    // 行の名前は打ち直されて @ が外れても、表の注釈の紐付けが残っていればつながりは生きている
    const blocks = [table("t1", [[[text("名前")]], [[text("試料 1（再測定）")]]])];
    const result = run({
      idx,
      noteLinks,
      blocks,
      tableMeta: { t1: { noteLinks: { "@試料 1": "row" } } },
    });
    expect(result.noteLinks).toBe(noteLinks);
  });

  it("相手が一覧に無い・一覧が古い版なら外さない（判定できない）", () => {
    const unknown = [link("not-indexed", "p1")];
    expect(run({ idx, noteLinks: unknown, blocks: [para("p1", [])] }).noteLinks).toBe(unknown);
    const oldIdx = index([{ id: "a", title: "カレーの下ごしらえ" }], 32);
    const noteLinks = [link("a", "p1")];
    expect(run({ idx: oldIdx, noteLinks, blocks: [para("p1", [])] }).noteLinks).toBe(noteLinks);
  });

  it("改名が届かず古い名前のまま残った @ は、同じブロックのリンクで生きているとみなす", () => {
    const noteLinks = [link("a", "p1")];
    const blocks = [para("p1", [blue("@下ごしらえ（旧題）")])];
    const result = run({ idx, noteLinks, blocks, links: [ref("p1", "a")] });
    expect(result.noteLinks).toBe(noteLinks);
  });

  it("同じブロックに別の @ が残っていても、消した方の線は外す", () => {
    const noteLinks = [link("a", "p1"), link("b", "p1")];
    const blocks = [para("p1", [blue("@スパイスの配合")])];
    const result = run({ idx, noteLinks, blocks, links: [ref("p1", "a"), ref("p1", "b")] });
    expect(result.noteLinks).toEqual([link("b", "p1")]);
  });

  it("前の保存で外した線は、取り消しで @ が戻れば戻す", () => {
    const removed = link("a", "p1");
    const blocks = [para("p1", [blue("@カレーの下ごしらえ")])];
    const result = run({ idx, noteLinks: [], restorable: [removed], blocks, links: [ref("p1", "a")] });
    expect(result.noteLinks).toEqual([removed]);
    expect(result.restored).toEqual([removed]);
    // @ が戻っていなければ戻さない
    expect(run({ idx, noteLinks: [], restorable: [removed], blocks: [para("p1", [])] }).restored).toEqual([]);
  });
});

describe("pruneDocConnections", () => {
  const idx = index([
    { id: "a", title: "カレーの下ごしらえ" },
    { id: "child", title: "派生したノート", derivedFrom: OWNER },
  ]);
  const ctx = {
    ownerNoteId: OWNER,
    labelOfTarget: mentionLabelResolver(idx, []),
    targetInfo: noteLinkTargetInfoResolver(idx),
  };
  const doc = (blocks: any[], noteLinks?: NoteLink[]): GraphiumDocument =>
    ({
      version: 1,
      title: "t",
      pages: [{ id: "main", title: "t", blocks, labels: {}, provLinks: [], knowledgeLinks: [] }],
      noteLinks,
      createdAt: "",
      modifiedAt: "",
    }) as unknown as GraphiumDocument;

  it("変わらなければ doc をそのまま返す", () => {
    const d = doc([para("p1", [blue("@カレーの下ごしらえ")])], [link("a", "p1")]);
    expect(pruneDocConnections(d, ctx).doc).toBe(d);
  });

  it("全部外れたら noteLinks の項目ごと省き、派生の線だけなら残す", () => {
    const onlyConnection = doc([para("p1", [])], [link("a", "p1")]);
    expect(pruneDocConnections(onlyConnection, ctx).doc.noteLinks).toBeUndefined();
    const mixed = doc([para("p1", [])], [link("a", "p1"), link("child", "p1")]);
    expect(pruneDocConnections(mixed, ctx).doc.noteLinks).toEqual([link("child", "p1")]);
  });
});
