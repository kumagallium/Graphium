// @vitest-environment jsdom
// テンプレート挿入（features/template/insert.ts）のテスト
//
// 挿入はメインエディタと SidePeek の共通の出どころ。ラベル・前手順リンク・表の列の
// ふるまいは「渡されたストア」に、挿入したブロックの id で書かれなければならない
// （取り違えると、ピークで挿したテンプレートの注釈がメイン側のノートや別のブロックに付く）。
//
// 実物の BlockNote に挿す確認（挿入前に振った id が挿入後も保たれ、先頭列の名前が読める）は
// templates.test.ts が持つ。ここでは step ブロックやカスタムスタイルを含むテンプレートも
// 扱えるよう、insert.ts が使う範囲だけを持つ偽のエディタを使う。

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const shared = vi.hoisted(() => ({ readSharedEntryBody: vi.fn() }));
vi.mock("../sharing/shared-library-store", () => ({
  readSharedEntryBody: shared.readSharedEntryBody,
}));

import { insertPageTemplate, insertTemplateDef, loadSharedTemplate, type TemplateTargetStores } from "./insert";
import { serializeTemplate } from "./save";
import { getAllTemplates, type TemplateDef } from "./templates";
import type { PageTemplate } from "./types";
import type { SharedEntry } from "../../lib/storage/shared";

const identity = (key: string) => key;

function officialTemplate(id: string): TemplateDef {
  const tmpl = getAllTemplates().find((x) => x.id === id);
  if (!tmpl) throw new Error(`${id} template is not registered`);
  return tmpl;
}

/** ブロックを id で（子孫まで）探す */
function findBlock(blocks: any[], id: string): any | null {
  for (const b of blocks) {
    if (b.id === id) return b;
    const hit = findBlock(b.children ?? [], id);
    if (hit) return hit;
  }
  return null;
}

/**
 * insert.ts が使う範囲だけを持つエディタの偽物。
 * 挿入は渡されたブロックの複製を返し、id は BlockNote と同じく保つ。
 */
function makeEditor(initial: any[]) {
  let doc: any[] = structuredClone(initial);
  const editor = {
    cursorBlockId: null as string | null,
    get document() {
      return doc;
    },
    insertBlocks(blocks: any[], ref: any, placement: "before" | "after") {
      const copies = structuredClone(blocks);
      const at = doc.findIndex((b) => b.id === ref.id);
      doc.splice(placement === "after" ? at + 1 : at, 0, ...copies);
      return copies;
    },
    removeBlocks(blocks: any[]) {
      const ids = new Set(blocks.map((b) => b.id));
      doc = doc.filter((b) => !ids.has(b.id));
    },
    getBlock(id: string) {
      return findBlock(doc, id);
    },
    setTextCursorPosition(id: string) {
      editor.cursorBlockId = id;
    },
  };
  return editor;
}

const paragraph = (id: string, text: string) => ({
  id,
  type: "paragraph",
  content: text ? [{ type: "text", text, styles: {} }] : [],
  children: [],
});

/** 書き込みを記録するストア */
function recordingStores() {
  const calls = {
    labels: [] as [string, string][],
    attributes: [] as [string, unknown][],
    links: [] as { sourceBlockId: string; targetBlockId: string; type: string; createdBy: string }[],
    columnTypes: [] as [string, string, string][],
  };
  const stores: TemplateTargetStores = {
    setLabel: (blockId, label) => void calls.labels.push([blockId, label]),
    setAttributes: (blockId, attrs) => void calls.attributes.push([blockId, attrs]),
    addLink: (params) => void calls.links.push(params),
    addColumnType: (blockId, columnName, type) => void calls.columnTypes.push([blockId, columnName, type]),
  };
  return { stores, calls };
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  shared.readSharedEntryBody.mockReset();
});

describe("insertTemplateDef（公式テンプレート）", () => {
  it("スラッシュだけのブロックの後ろに挿し、そのブロックは消す", () => {
    const editor = makeEditor([paragraph("before", "前の段落"), paragraph("slash", "/")]);
    const { stores } = recordingStores();

    insertTemplateDef(editor, editor.getBlock("slash"), officialTemplate("plan"), stores, identity);

    expect(editor.getBlock("slash")).toBeNull();
    expect(editor.document[0].id).toBe("before");
    expect(editor.document[1].type).toBe("heading");
  });

  it("文字の入ったブロックは消さない", () => {
    const editor = makeEditor([paragraph("memo", "メモ")]);
    const { stores } = recordingStores();

    insertTemplateDef(editor, editor.getBlock("memo"), officialTemplate("plan"), stores, identity);

    expect(editor.document[0].id).toBe("memo");
    expect(editor.document.length).toBeGreaterThan(1);
  });

  it("計画テンプレート: 挿入した表の先頭列に note-link を、次フレームで渡したストアへ付ける", () => {
    const editor = makeEditor([paragraph("slash", "/")]);
    const { stores, calls } = recordingStores();

    insertTemplateDef(editor, editor.getBlock("slash"), officialTemplate("plan"), stores, identity);
    // エディタの状態反映を待ってから付ける（挿入の直後にはまだ付かない）
    expect(calls.columnTypes).toEqual([]);

    vi.runAllTimers();
    expect(calls.columnTypes).toHaveLength(1);
    const [blockId, columnName, type] = calls.columnTypes[0];
    expect(editor.getBlock(blockId)?.type).toBe("table");
    expect(columnName).toBe("template.plan.colSampleName");
    expect(type).toBe("note-link");
  });

  it("実験テンプレート: 手順 2 → 手順 1 の前手順リンクを、変換後の step 同士に張る", () => {
    const editor = makeEditor([paragraph("slash", "/")]);
    const { stores, calls } = recordingStores();

    insertTemplateDef(editor, editor.getBlock("slash"), officialTemplate("experiment"), stores, identity);
    vi.runAllTimers();

    const steps = editor.document.filter((b) => b.type === "step");
    expect(steps).toHaveLength(2);
    expect(calls.links).toEqual([
      { sourceBlockId: steps[1].id, targetBlockId: steps[0].id, type: "informed_by", createdBy: "human" },
    ]);
    // procedure / plan / result は step への変換で消費され、ラベルとしては残らない
    expect(calls.labels).toEqual([]);
  });

  it("カーソルは focusPath のブロック（計画タイトルの見出し）に置く", () => {
    const editor = makeEditor([paragraph("slash", "/")]);
    const { stores } = recordingStores();

    insertTemplateDef(editor, editor.getBlock("slash"), officialTemplate("plan"), stores, identity);

    expect(editor.cursorBlockId).toBe(editor.document[0].id);
    expect(editor.document[0]).toMatchObject({ type: "heading", props: { level: 1 } });
  });
});

describe("insertPageTemplate（チームの共有テンプレート）", () => {
  const ATTRS = { checked: false, executor: "human", status: "planned" } as const;
  const TEMPLATE: PageTemplate = {
    name: "焼結テンプレ",
    savedAt: "2026-09-01T00:00:00Z",
    pageTitle: "焼結の手順",
    blocks: [
      { id: "h1", type: "heading", props: { level: 1 }, content: [], children: [] },
      {
        id: "s1",
        type: "step",
        content: [],
        children: [
          {
            id: "t1",
            type: "table",
            content: {
              type: "tableContent",
              rows: [{ cells: [[{ type: "text", text: "試料", styles: {} }], [{ type: "text", text: "温度", styles: {} }]] }],
            },
            children: [],
          },
        ],
      },
    ],
    labels: [["s1", "procedure"]],
    attributes: [["s1", ATTRS]],
    tableMeta: { t1: { columns: { 試料: ["note-link"] } } },
  };

  it("id を振り直し、ラベル・連動属性・先頭列のふるまいを新しい id で付ける", () => {
    const editor = makeEditor([paragraph("slash", "/")]);
    const { stores, calls } = recordingStores();

    insertPageTemplate(editor, editor.getBlock("slash"), TEMPLATE, stores);
    vi.runAllTimers();

    const step = editor.document.find((b) => b.type === "step");
    const table = step.children[0];
    // 共有した人の blockId のままだと、別ノートのブロックと id がぶつかる
    expect(step.id).not.toBe("s1");
    expect(table.id).not.toBe("t1");
    expect(calls.labels).toEqual([[step.id, "procedure"]]);
    expect(calls.attributes).toEqual([[step.id, ATTRS]]);
    expect(calls.columnTypes).toEqual([[table.id, "試料", "note-link"]]);
    // 共有テンプレートは focusPath を持たないので、挿入した先頭に置く
    expect(editor.cursorBlockId).toBe(editor.document[0].id);
  });

  it("中身が空なら何もしない（スラッシュのブロックも残す）", () => {
    const editor = makeEditor([paragraph("slash", "/")]);
    const { stores, calls } = recordingStores();

    insertPageTemplate(editor, editor.getBlock("slash"), { ...TEMPLATE, blocks: [], labels: [], attributes: [] }, stores);
    vi.runAllTimers();

    expect(editor.document.map((b) => b.id)).toEqual(["slash"]);
    expect(calls).toEqual({ labels: [], attributes: [], links: [], columnTypes: [] });
  });
});

describe("loadSharedTemplate（共有ライブラリからの読み出し）", () => {
  const ENTRY = { id: "tpl-1", type: "template", extra: { title: "焼結テンプレ" } } as unknown as SharedEntry;
  const TEMPLATE: PageTemplate = {
    name: "焼結テンプレ",
    savedAt: "2026-09-01T00:00:00Z",
    pageTitle: "焼結の手順",
    blocks: [paragraph("p1", "電気炉で焼結する")],
    labels: [],
    attributes: [],
  };
  const body = () => new TextEncoder().encode(serializeTemplate(TEMPLATE));

  it("hash が合えば本文を PageTemplate として返す（日本語も壊さない）", async () => {
    shared.readSharedEntryBody.mockResolvedValue({ body: body(), verified: true });
    const confirm = vi.spyOn(window, "confirm");

    await expect(loadSharedTemplate(ENTRY)).resolves.toEqual(TEMPLATE);
    expect(confirm).not.toHaveBeenCalled();
  });

  it("hash が合わないときは挿すか確かめ、取りやめたら null", async () => {
    shared.readSharedEntryBody.mockResolvedValue({ body: body(), verified: false });
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);

    await expect(loadSharedTemplate(ENTRY)).resolves.toBeNull();
    expect(confirm).toHaveBeenCalledTimes(1);
  });

  it("hash が合わなくても、続けると答えたら本文を返す", async () => {
    shared.readSharedEntryBody.mockResolvedValue({ body: body(), verified: false });
    vi.spyOn(window, "confirm").mockReturnValue(true);

    await expect(loadSharedTemplate(ENTRY)).resolves.toEqual(TEMPLATE);
  });

  it("読めなければ理由を知らせて null", async () => {
    shared.readSharedEntryBody.mockRejectedValue(new Error("共有フォルダが見つからない"));
    const alert = vi.spyOn(window, "alert").mockImplementation(() => {});

    await expect(loadSharedTemplate(ENTRY)).resolves.toBeNull();
    expect(alert).toHaveBeenCalledTimes(1);
    expect(String(alert.mock.calls[0][0])).toContain("共有フォルダが見つからない");
  });
});
