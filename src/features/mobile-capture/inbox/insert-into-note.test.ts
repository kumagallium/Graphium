// 受信箱 → ノート本文への挿入（insert-into-note）のテスト。
//
// 対象の不変条件:
// - cursorInsertTarget: カーソルのブロックの後ろ。空の段落なら手前。取れなければ末尾のブロック
// - readInboxDragNames: 外から来た値は信用しない（形が違えば空）
// - dropInsertTarget: ブロックの上半分 → before、下半分 → after、余白 → 縦位置が最も近いブロック
// - insertInboxItems: 渡した順に並べる・仮の空段落を残さない・メモは引用＋紐づけ・URL は ogImage 空
//
// メモの挿入は insert-memo-quote の実物を使う（偽エディタがその要求を満たす）。

// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import {
  cursorInsertTarget,
  dropInsertTarget,
  insertInboxItems,
  readInboxDragNames,
  type InboxInsertable,
} from "./insert-into-note";

afterEach(() => {
  document.body.innerHTML = "";
});

const para = (id: string, text = "") => ({
  id,
  type: "paragraph",
  content: text ? [{ type: "text", text, styles: {} }] : [],
  children: [],
});

describe("cursorInsertTarget", () => {
  it("カーソルのブロックの後ろ", () => {
    const editor = { getTextCursorPosition: () => ({ block: para("b1", "本文") }), document: [] };
    expect(cursorInsertTarget(editor)).toEqual({ blockId: "b1", placement: "after" });
  });

  it("空の段落なら手前", () => {
    const editor = { getTextCursorPosition: () => ({ block: para("b1") }), document: [] };
    expect(cursorInsertTarget(editor)).toEqual({ blockId: "b1", placement: "before" });
  });

  it("getTextCursorPosition が throw したら末尾のブロック", () => {
    const editor = {
      getTextCursorPosition: () => {
        throw new Error("no focus");
      },
      document: [para("b1", "x"), para("b2", "y")],
    };
    expect(cursorInsertTarget(editor)).toEqual({ blockId: "b2", placement: "after" });
  });

  it("エディタが無ければ null", () => {
    expect(cursorInsertTarget(null)).toBeNull();
  });
});

describe("readInboxDragNames", () => {
  it("正しい JSON 配列を読む", () => {
    expect(readInboxDragNames(JSON.stringify(["a.jpg", "b.jpg"]))).toEqual(["a.jpg", "b.jpg"]);
  });

  it("文字列以外の要素（と空文字）を落とす", () => {
    expect(readInboxDragNames(JSON.stringify(["a.jpg", 1, null, { x: 1 }, ""]))).toEqual(["a.jpg"]);
  });

  it("配列でない・壊れた JSON・null・空は空配列", () => {
    expect(readInboxDragNames('{"a":1}')).toEqual([]);
    expect(readInboxDragNames("[not json")).toEqual([]);
    expect(readInboxDragNames(null)).toEqual([]);
    expect(readInboxDragNames(undefined)).toEqual([]);
    expect(readInboxDragNames("")).toEqual([]);
  });
});

describe("dropInsertTarget", () => {
  /** 縦に並ぶ 2 ブロック（id=top: 0〜100、id=bottom: 200〜300）を作る。 */
  function setup() {
    const root = document.createElement("div");
    const mk = (id: string, top: number, height: number) => {
      const el = document.createElement("div");
      el.setAttribute("data-node-type", "blockContainer");
      el.setAttribute("data-id", id);
      el.getBoundingClientRect = () =>
        ({ top, bottom: top + height, height, left: 0, right: 100, width: 100, x: 0, y: top, toJSON: () => ({}) }) as DOMRect;
      root.appendChild(el);
      return el;
    };
    const top = mk("top", 0, 100);
    const bottom = mk("bottom", 200, 100);
    document.body.appendChild(root);
    return { root, top, bottom };
  }

  it("ブロックの上半分 → before、下半分 → after", () => {
    const { root, top } = setup();
    const doc = { elementFromPoint: () => top };
    expect(dropInsertTarget(root, 10, 20, doc)).toEqual({ blockId: "top", placement: "before" });
    expect(dropInsertTarget(root, 10, 80, doc)).toEqual({ blockId: "top", placement: "after" });
  });

  it("ブロックの外（余白）は縦位置が最も近いブロックで判定する", () => {
    const { root } = setup();
    const doc = { elementFromPoint: () => null };
    // top(0〜100) の下の余白。top に近い → after 側ではなく、top の下半分より下なので after
    expect(dropInsertTarget(root, 10, 120, doc)).toEqual({ blockId: "top", placement: "after" });
    // bottom(200〜300) の上の余白。bottom に近く、その上半分より上なので before
    expect(dropInsertTarget(root, 10, 180, doc)).toEqual({ blockId: "bottom", placement: "before" });
  });

  it("root が無ければ null、ブロックが 1 つも無ければ null", () => {
    expect(dropInsertTarget(null, 0, 0, { elementFromPoint: () => null })).toBeNull();
    const empty = document.createElement("div");
    expect(dropInsertTarget(empty, 0, 0, { elementFromPoint: () => null })).toBeNull();
  });
});

describe("insertInboxItems", () => {
  /** document 配列を持つ単純な偽エディタ。insertBlocks は id の無いブロックに id を振って返す。 */
  function makeEditor(initial: any[]) {
    const document: any[] = [...initial];
    let seq = 0;
    const editor = {
      document,
      getBlock: (id: string) => document.find((b) => b.id === id),
      insertBlocks: vi.fn((blocks: any[], ref: any, placement: "before" | "after") => {
        const made = blocks.map((b) => ({ ...b, id: b.id ?? `new-${++seq}` }));
        const idx = document.findIndex((b) => b.id === ref.id);
        document.splice(placement === "before" ? idx : idx + 1, 0, ...made);
        return made;
      }),
      removeBlocks: vi.fn((blocks: any[]) => {
        for (const b of blocks) {
          const i = document.findIndex((x) => x.id === b.id);
          if (i >= 0) document.splice(i, 1);
        }
      }),
    };
    return editor;
  }

  const mat = (name: string): InboxInsertable => ({
    kind: "material",
    name,
    entry: { type: "image", url: `blob:${name}`, name },
  });
  const memo: InboxInsertable = { kind: "memo", name: "m.graphium.json", captureId: "cap-1", text: "メモ本文" };
  const urlItem: InboxInsertable = {
    kind: "url",
    name: "u.graphium.json",
    url: "https://example.com/x",
    title: "題",
    description: "説明",
    domain: "example.com",
  };

  it("(a) after に素材 2 件を渡した順で並べる", () => {
    const editor = makeEditor([para("p1", "a"), para("p2", "b")]);
    const setQuote = vi.fn();
    const res = insertInboxItems(editor, [mat("one.jpg"), mat("two.jpg")], { blockId: "p1", placement: "after" }, { setQuote });
    expect(editor.document.map((b) => b.props?.name ?? b.id)).toEqual(["p1", "one.jpg", "two.jpg", "p2"]);
    expect(res.blockIds).toHaveLength(2);
    expect(res.memoIds).toEqual([]);
  });

  it("(b) before のとき target の手前に順に入り、仮の空段落が残らない", () => {
    const editor = makeEditor([para("p1", "a"), para("p2")]);
    const res = insertInboxItems(editor, [mat("one.jpg"), mat("two.jpg")], { blockId: "p2", placement: "before" }, { setQuote: vi.fn() });
    expect(editor.document.map((b) => b.props?.name ?? b.id)).toEqual(["p1", "one.jpg", "two.jpg", "p2"]);
    expect(editor.removeBlocks).toHaveBeenCalledTimes(1);
    expect(res.blockIds).toHaveLength(2);
  });

  it("(c) memo は引用ブロックになり、setQuote が呼ばれ memoIds に入る", () => {
    const editor = makeEditor([para("p1", "a")]);
    const setQuote = vi.fn();
    const res = insertInboxItems(editor, [memo], { blockId: "p1", placement: "after" }, { setQuote });
    expect(editor.document[1].type).toBe("quote");
    expect(setQuote).toHaveBeenCalledTimes(1);
    expect(setQuote.mock.calls[0][0]).toBe(editor.document[1].id);
    expect(setQuote.mock.calls[0][1]).toMatchObject({ captureId: "cap-1", quotedText: "メモ本文" });
    expect(res.memoIds).toEqual(["cap-1"]);
    expect(res.blockIds).toEqual([editor.document[1].id]);
  });

  it("(d) url は bookmark ブロックで、ogImage は空文字", () => {
    const editor = makeEditor([para("p1", "a")]);
    insertInboxItems(editor, [urlItem], { blockId: "p1", placement: "after" }, { setQuote: vi.fn() });
    expect(editor.document[1].type).toBe("bookmark");
    expect(editor.document[1].props).toEqual({
      url: "https://example.com/x",
      title: "題",
      description: "説明",
      ogImage: "",
      domain: "example.com",
    });
  });

  it("(e) target のブロックが無ければ文書末尾に入る", () => {
    const editor = makeEditor([para("p1", "a"), para("p2", "b")]);
    insertInboxItems(editor, [mat("one.jpg")], { blockId: "missing", placement: "before" }, { setQuote: vi.fn() });
    expect(editor.document.map((b) => b.props?.name ?? b.id)).toEqual(["p1", "p2", "one.jpg"]);
    // target が null でも同じ
    const editor2 = makeEditor([para("p1", "a")]);
    insertInboxItems(editor2, [mat("one.jpg")], null, { setQuote: vi.fn() });
    expect(editor2.document.map((b) => b.props?.name ?? b.id)).toEqual(["p1", "one.jpg"]);
  });

  it("(f) items が空なら何もしない", () => {
    const editor = makeEditor([para("p1", "a")]);
    const res = insertInboxItems(editor, [], { blockId: "p1", placement: "after" }, { setQuote: vi.fn() });
    expect(res).toEqual({ blockIds: [], memoIds: [] });
    expect(editor.insertBlocks).not.toHaveBeenCalled();
    expect(editor.document).toHaveLength(1);
  });
});
