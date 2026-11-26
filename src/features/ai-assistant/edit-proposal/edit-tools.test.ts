import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GraphiumDocument } from "../../../lib/document-types";

const appData = new Map<string, unknown>();
vi.mock("../../../lib/storage/registry", () => ({
  getActiveProvider: () => ({
    readAppData: async (k: string) => appData.get(k) ?? null,
    writeAppData: async (k: string, v: unknown) => {
      appData.set(k, v);
    },
  }),
}));

import {
  __resetEditProposalControllerForTest,
  applyProposal,
  declineProposal,
  registerEditFileHost,
  registerLiveEditor,
  undoProposal,
} from "./controller";
import { combineClientTools, createEditToolSession } from "./edit-tools";
import { createEditFileHost } from "./file-host";

const para = (id: string, text: string) => ({
  id,
  type: "paragraph",
  props: {},
  content: [{ type: "text", text, styles: {} }],
  children: [],
});

function makeDoc(title: string, blocks: any[], extra: Partial<GraphiumDocument> = {}): GraphiumDocument {
  return {
    version: 6,
    title,
    pages: [{ id: "main", title, blocks, labels: {}, provLinks: [], knowledgeLinks: [] }],
    createdAt: "2026-11-01T00:00:00.000Z",
    modifiedAt: "2026-11-01T00:00:00.000Z",
    ...extra,
  };
}

let files: Map<string, GraphiumDocument>;
let saved: string[];
let openElsewhere: Set<string>;
let pushed: string[];

beforeEach(() => {
  __resetEditProposalControllerForTest();
  appData.clear();
  saved = [];
  openElsewhere = new Set();
  pushed = [];
  files = new Map([
    ["n1", makeDoc("パンの記録", [para("a", "一次発酵: 30℃"), para("b", "焼成: 200℃")])],
    ["skill:s1", makeDoc("記録の書き方", [
      { id: "sep", type: "heading", props: { level: 2 }, content: [{ type: "text", text: "Prompt Template", styles: {} }], children: [] },
      para("p1", "条件は本文に書く"),
    ], { source: "skill" })],
  ]);
  registerEditFileHost(
    createEditFileHost({
      notes: () => [
        { noteId: "n1", title: "パンの記録" },
        { noteId: "w1", title: "パンのトピック", wikiKind: "topic", source: "ai" },
      ],
      skills: () => [
        { id: "s1", title: "記録の書き方", system: false },
        { id: "sys", title: "Knowledge schema", system: true },
      ],
      loadNote: async (id) => files.get(id) ?? null,
      loadSkill: async (id) => files.get(`skill:${id}`) ?? null,
      saveNote: async (id, doc) => {
        files.set(id, doc);
        saved.push(id);
        return true;
      },
      saveSkill: async (id, doc) => {
        files.set(`skill:${id}`, doc);
        saved.push(`skill:${id}`);
        return true;
      },
      openNote: () => {},
      openSkill: () => {},
      agentLabel: () => "test-model",
      // openElsewhere = 書き出しても未保存が残るピーク
      settleOpenEditors: async (id) => !openElsewhere.has(id),
      pushToOpenEditors: (id) => {
        pushed.push(id);
      },
    }),
  );
});

afterEach(() => {
  __resetEditProposalControllerForTest();
});

const text = (id: string, blockId: string) =>
  files.get(id)!.pages[0].blocks.find((b: any) => b.id === blockId)?.content?.[0]?.text;

describe("書き換えの道具", () => {
  it("読んでから提案すると修正案ができ、まだ何も書き換えない", async () => {
    const s = createEditToolSession({ currentNoteId: "n1" });
    const read = await s.execute("read_for_edit", { target: "this note" });
    expect(read).toContain('[b1 | paragraph] 一次発酵: 30℃');
    const out = await s.execute("propose_edit", {
      target: "this note",
      reason: "条件をそろえる",
      changes: [{ op: "replace", block: "b1", text: "一次発酵: 28℃" }, { op: "insert_after", block: "b2", text: "冷ます: 30 分" }],
    });
    expect(out).toContain("Proposed 2 change(s)");
    expect(out).toContain("Nothing has been changed yet");
    const [p] = s.proposals();
    expect(p.target).toEqual({ kind: "note", id: "n1", title: "パンの記録" });
    expect(p.changes.map((c) => [c.op, c.blockId, c.before])).toEqual([
      ["replace", "a", "一次発酵: 30℃"],
      ["insert", "b", "焼成: 200℃"],
    ]);
    expect(saved).toEqual([]);
  });

  it("読む前の提案・知らない番号・ナレッジ・システムスキルは断る", async () => {
    const s = createEditToolSession({ currentNoteId: "n1" });
    expect(await s.execute("propose_edit", { target: "this note", changes: [{ op: "delete", block: "b1" }] })).toMatch(/read_for_edit/);
    await s.execute("read_for_edit", { target: "this note" });
    expect(await s.execute("propose_edit", { target: "this note", changes: [{ op: "delete", block: "b9" }] })).toMatch(/unknown block/);
    expect(await s.execute("read_for_edit", { target: "パンのトピック" })).toMatch(/knowledge pages/);
    expect(await s.execute("read_for_edit", { target: "skill: Knowledge schema" })).toMatch(/built-in skills/);
    expect(await s.execute("read_for_edit", { target: "this note" })).not.toMatch(/Error/);
    expect(await createEditToolSession({}).execute("read_for_edit", { target: "this note" })).toMatch(/not attached/);
  });

  it("フォルダで絞った会話では、範囲の外のノートを読めない", async () => {
    const s = createEditToolSession({ onlyIds: new Set(["other"]) });
    expect(await s.execute("read_for_edit", { target: "パンの記録" })).toMatch(/outside the folder/);
    const inside = createEditToolSession({ onlyIds: new Set(["n1"]) });
    expect(await inside.execute("read_for_edit", { target: "パンの記録" })).not.toMatch(/Error/);
  });

  it("表・画像などのブロックは消せない（後ろに足すのは可）", async () => {
    files.set("n1", makeDoc("パンの記録", [
      para("a", "一次発酵: 30℃"),
      { id: "t", type: "table", props: {}, content: { type: "tableContent", rows: [] }, children: [] },
    ]));
    const s = createEditToolSession({ currentNoteId: "n1" });
    await s.execute("read_for_edit", { target: "this note" });
    expect(await s.execute("propose_edit", { target: "this note", changes: [{ op: "delete", block: "b2" }] })).toMatch(/read-only/);
    expect(await s.execute("propose_edit", { target: "this note", changes: [{ op: "insert_after", block: "b2", text: "表の補足" }] })).toMatch(/Proposed 1/);
  });

  it("スキルは区切りの見出しを出さずに読める", async () => {
    const s = createEditToolSession({});
    const read = await s.execute("read_for_edit", { target: "skill: 記録の書き方" });
    expect(read).toContain("[b1 | paragraph] 条件は本文に書く");
    expect(read).not.toContain("Prompt Template");
  });

  it("combineClientTools は名前で振り分ける", async () => {
    const other = { toolNames: ["search_my_knowledge"], execute: async () => "searched" };
    const c = combineClientTools(other, null, createEditToolSession({}));
    expect(c.names).toEqual(["search_my_knowledge", "read_for_edit", "propose_edit"]);
    expect(await c.execute("search_my_knowledge", {})).toBe("searched");
    expect(await c.execute("nope", {})).toMatch(/unknown tool/);
  });
});

describe("反映・やめる・元に戻す", () => {
  const propose = async () => {
    const s = createEditToolSession({ currentNoteId: "n1" });
    await s.execute("read_for_edit", { target: "this note" });
    await s.execute("propose_edit", { target: "this note", changes: [{ op: "replace", block: "b1", text: "一次発酵: 28℃" }] });
    return s.proposals()[0];
  };

  it("閉じているノートはファイルに保存し、来歴に AI の編集を刻む", async () => {
    const p = await propose();
    await applyProposal(p, [p.changes[0].id]);
    expect(text("n1", "a")).toBe("一次発酵: 28℃");
    expect(saved).toEqual(["n1"]);
    const prov = files.get("n1")!.documentProvenance;
    const acts = prov?.activities ?? [];
    expect(acts[acts.length - 1]?.type).toBe("ai_generation");
    expect(appData.get("edit-proposal-status")).toEqual({ [p.changes[0].id]: "applied" });
  });

  it("案の後に本文が変わっていたら stale にして書かない", async () => {
    const p = await propose();
    files.set("n1", makeDoc("パンの記録", [para("a", "一次発酵: 27℃（人が直した）"), para("b", "焼成: 200℃")]));
    await applyProposal(p, [p.changes[0].id]);
    expect(saved).toEqual([]);
    expect(appData.get("edit-proposal-status")).toEqual({ [p.changes[0].id]: "stale" });
  });

  it("開いているノートはエディタに書き、元に戻せる（その後に触られていれば戻さない）", async () => {
    let live = structuredClone(files.get("n1")!.pages[0].blocks);
    registerLiveEditor("n1", { read: () => structuredClone(live), write: (b) => (live = structuredClone(b)) });
    const p = await propose();
    await applyProposal(p, [p.changes[0].id]);
    expect(live[0].content[0].text).toBe("一次発酵: 28℃");
    expect(saved).toEqual([]);
    expect(await undoProposal([p.changes[0].id])).toBe(true);
    expect(live[0].content[0].text).toBe("一次発酵: 30℃");
    expect(appData.get("edit-proposal-status")).toEqual({});

    await applyProposal(p, [p.changes[0].id]);
    live[1].content[0].text = "焼成: 210℃";
    expect(await undoProposal([p.changes[0].id])).toBe(false);
    expect(live[0].content[0].text).toBe("一次発酵: 28℃");
  });

  it("書いたノートは、開いているピーク・別ウィンドウに流し込む", async () => {
    const p = await propose();
    await applyProposal(p, [p.changes[0].id]);
    expect(pushed).toEqual(["n1"]);
  });

  it("ピークの未保存を書き出せないときは書かず busy にする（もう一度押せる）", async () => {
    const p = await propose();
    openElsewhere.add("n1");
    await applyProposal(p, [p.changes[0].id]);
    expect(saved).toEqual([]);
    expect(appData.get("edit-proposal-status")).toEqual({ [p.changes[0].id]: "busy" });
    openElsewhere.clear();
    await applyProposal(p, [p.changes[0].id]);
    expect(text("n1", "a")).toBe("一次発酵: 28℃");
  });

  it("保存された案が書き換えてはいけないものを指していれば、反映の前に断る", async () => {
    const forged = {
      id: "p",
      target: { kind: "skill" as const, id: "sys", title: "無害な題" },
      changes: [{ id: "c", op: "delete" as const, blockId: "x", before: "" }],
    };
    await applyProposal(forged, ["c"]);
    expect(saved).toEqual([]);
    expect(appData.get("edit-proposal-status")).toEqual({ c: "failed" });
  });

  it("元に戻すは、反映後に別のブロックの props（文字色・表など）が変わっていれば戻さない", async () => {
    let live = structuredClone(files.get("n1")!.pages[0].blocks);
    registerLiveEditor("n1", { read: () => structuredClone(live), write: (b) => (live = structuredClone(b)) });
    const p = await propose();
    await applyProposal(p, [p.changes[0].id]);
    live[1].props = { textColor: "red" };
    expect(await undoProposal([p.changes[0].id])).toBe(false);
  });

  it("エディタへの書き込みが失敗したら failed にする", async () => {
    registerLiveEditor("n1", {
      read: () => structuredClone(files.get("n1")!.pages[0].blocks),
      write: () => {
        throw new Error("boom");
      },
    });
    const p = await propose();
    await applyProposal(p, [p.changes[0].id]);
    expect(appData.get("edit-proposal-status")).toEqual({ [p.changes[0].id]: "failed" });
  });

  it("やめるは状態だけを残す", async () => {
    const p = await propose();
    declineProposal([p.changes[0].id]);
    await vi.waitFor(() => expect(appData.get("edit-proposal-status")).toEqual({ [p.changes[0].id]: "declined" }));
    expect(saved).toEqual([]);
  });
});
