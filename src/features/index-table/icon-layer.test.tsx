// @vitest-environment jsdom
// IndexTableIconLayer（インデックステーブルの行アイコン）のテスト。
//
// 対象の不変条件（SidePeek でもインデックステーブルを使えるようにしたときのもの）:
// - 渡された外枠（SidePeek の wrapper）の中の表を測り、その中に描く。
//   外枠がまだ付いていない（null）間は、最初の [data-label-wrapper]＝メインに落とさない。
// - 行からノートを作る・つながった行を開くは、描いているエディタの受け口を引く。
//   ピークで作ったノートの派生元と noteLinks はピークのノートに入り、メインには入らない。
// - 読み取り専用のノートでは作る入口を出さない（つながった行を開く覆いは出す）。
//
// メインとピークで同じノートを開くと、同じブロック ID の表が 2 つ並ぶ。メインの外枠にも
// 同じ表を置き、覆いの位置で「どちらの表を測ったか」まで確かめる。

import { describe, it, expect, afterEach, vi } from "vitest";
import { render, act, cleanup, waitFor } from "@testing-library/react";
import { useEffect } from "react";
import { TableMetaStoreProvider, useTableMetaStore } from "../table-meta/store";
import type { TableMeta } from "../table-meta/types";
import { IndexTableIconLayer } from "./icon-layer";
import { setEditorIndexTableCallbacks, type EditorIndexTableCallbacks } from "./context";

const createFile = vi.hoisted(() => vi.fn(async (_title: string, _doc: unknown) => "created-note"));
vi.mock("../../lib/storage/registry", () => ({
  getActiveProvider: () => ({ createFile }),
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const TABLE_ID = "index-table";
/** つながった行（3 行目）の先頭セルの位置。外枠ごとに変えて、測った表を見分ける */
const MAIN_LINKED_CELL_TOP = 900;
const PEEK_LINKED_CELL_TOP = 120;

const textCell = (text: string) => [{ type: "text", text, styles: {} }];

/** 先頭列が note-link の表（ヘッダ + 2 行。3 行目だけノートにつながっている） */
function makeTableBlock() {
  return {
    id: TABLE_ID,
    type: "table",
    content: {
      type: "tableContent",
      rows: [
        { cells: [textCell("Name"), textCell("Condition")] },
        { cells: [textCell("Sample A"), textCell("300 K")] },
        { cells: [textCell("@Sample B"), textCell("400 K")] },
      ],
    },
    children: [],
  };
}

const META: Record<string, TableMeta> = {
  [TABLE_ID]: {
    columns: { Name: ["note-link"] },
    noteLinks: { "@Sample B": "linked-note-b" },
  },
};

function rect(top: number): DOMRect {
  return {
    top,
    bottom: top + 20,
    left: 10,
    right: 110,
    width: 100,
    height: 20,
    x: 10,
    y: top,
    toJSON: () => ({}),
  } as DOMRect;
}

/** BlockNote が描く表の DOM を最小限に再現した外枠 */
function mountWrapper(linkedCellTop: number): HTMLElement {
  const wrapper = document.createElement("div");
  wrapper.setAttribute("data-label-wrapper", "");
  const outer = document.createElement("div");
  outer.setAttribute("data-id", TABLE_ID);
  outer.setAttribute("data-node-type", "blockOuter");
  const table = document.createElement("table");
  const tbody = document.createElement("tbody");
  for (let i = 0; i < 3; i++) {
    const tr = document.createElement("tr");
    const first = document.createElement("td");
    if (i === 2) first.getBoundingClientRect = () => rect(linkedCellTop);
    tr.appendChild(first);
    tr.appendChild(document.createElement("td"));
    tbody.appendChild(tr);
  }
  table.appendChild(tbody);
  outer.appendChild(table);
  wrapper.appendChild(outer);
  document.body.appendChild(wrapper);
  return wrapper;
}

function makeEditor() {
  const block = makeTableBlock();
  return {
    document: [block],
    getBlock: (id: string) => (id === TABLE_ID ? block : undefined),
    updateBlock: vi.fn(),
  };
}

function makeCallbacks(currentFileId: string): EditorIndexTableCallbacks {
  return {
    files: [],
    currentFileId,
    onRefreshFiles: vi.fn(),
    onOpenSidePeek: vi.fn(),
    onAddNoteLink: vi.fn(),
  };
}

/** ストアに表の注釈を入れる（ノートを開いたときの restore 相当） */
function Seed() {
  const store = useTableMetaStore();
  useEffect(() => {
    store.restore(META);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return null;
}

/** 「行からノートを作る」ボタン（覆いは div なので button だけを数える） */
const createButtons = (root: HTMLElement) => [...root.querySelectorAll("button")];
/** つながった行を開く透明な覆い */
const linkOverlays = (root: HTMLElement) =>
  [...root.querySelectorAll<HTMLElement>("div")].filter((el) => el.style.cursor === "pointer");

describe("IndexTableIconLayer（SidePeek の外枠に描く）", () => {
  const mounted: HTMLElement[] = [];

  afterEach(() => {
    cleanup();
    mounted.splice(0).forEach((el) => el.remove());
    createFile.mockClear();
  });

  function setup(options: { readOnly?: boolean; peekAttached?: boolean } = {}) {
    // DOM 順でメインの外枠が先に出る（素の querySelector はこちらを拾う）
    const mainWrapper = mountWrapper(MAIN_LINKED_CELL_TOP);
    const peekWrapper = options.peekAttached === false ? null : mountWrapper(PEEK_LINKED_CELL_TOP);
    mounted.push(mainWrapper);
    if (peekWrapper) mounted.push(peekWrapper);

    const mainEditor = makeEditor();
    const peekEditor = makeEditor();
    const main = { ...makeCallbacks("main-note"), onNoteCreated: vi.fn() };
    const peek = makeCallbacks("peek-note");
    setEditorIndexTableCallbacks(mainEditor, main);
    setEditorIndexTableCallbacks(peekEditor, peek);

    render(
      <TableMetaStoreProvider>
        <Seed />
        <IndexTableIconLayer
          editorRef={{ current: peekEditor }}
          wrapperEl={peekWrapper}
          readOnly={options.readOnly}
        />
      </TableMetaStoreProvider>,
    );
    return { mainWrapper, peekWrapper: peekWrapper!, peekEditor, main, peek };
  }

  it("ピークの外枠の中の表を測って描き、メインの外枠には描かない", async () => {
    const { mainWrapper, peekWrapper } = setup();
    await waitFor(() => expect(createButtons(peekWrapper)).toHaveLength(1));
    const overlays = linkOverlays(peekWrapper);
    expect(overlays).toHaveLength(1);
    // 覆いはピーク側の表のセルに重なる（先に出るメイン側の表を測らない）
    expect(overlays[0].style.top).toBe(`${PEEK_LINKED_CELL_TOP}px`);
    expect(createButtons(mainWrapper)).toHaveLength(0);
    expect(linkOverlays(mainWrapper)).toHaveLength(0);
  });

  it("行から作ったノートの派生元と noteLinks はピークのノートに入る（メインには入らない）", async () => {
    const { peekWrapper, peekEditor, main, peek } = setup();
    await waitFor(() => expect(createButtons(peekWrapper)).toHaveLength(1));

    await act(async () => {
      createButtons(peekWrapper)[0].click();
    });
    await waitFor(() => expect(peek.onRefreshFiles).toHaveBeenCalledTimes(1));

    expect(createFile).toHaveBeenCalledTimes(1);
    const [title, doc] = createFile.mock.calls[0];
    expect(title).toBe("Sample A");
    expect(doc).toMatchObject({ derivedFromNoteId: "peek-note", derivedFromBlockId: TABLE_ID });
    expect(peek.onAddNoteLink).toHaveBeenCalledWith("created-note", TABLE_ID);
    // 行の先頭セルはピークのエディタで @名前 に書き換わる
    expect(peekEditor.updateBlock).toHaveBeenCalledTimes(1);
    // ピークは作った直後に開かない（受け口に onNoteCreated を渡していない）
    expect(peek.onOpenSidePeek).not.toHaveBeenCalled();
    expect(main.onAddNoteLink).not.toHaveBeenCalled();
    expect(main.onRefreshFiles).not.toHaveBeenCalled();
    expect(main.onNoteCreated).not.toHaveBeenCalled();
  });

  it("つながった行の覆いを押すと、ピークの受け口で行ノートを開く", async () => {
    const { peekWrapper, main, peek } = setup();
    await waitFor(() => expect(linkOverlays(peekWrapper)).toHaveLength(1));
    act(() => {
      linkOverlays(peekWrapper)[0].click();
    });
    expect(peek.onOpenSidePeek).toHaveBeenCalledWith("linked-note-b");
    expect(main.onOpenSidePeek).not.toHaveBeenCalled();
  });

  it("読み取り専用のノートでは作る入口を出さず、つながった行は開ける", async () => {
    const { peekWrapper } = setup({ readOnly: true });
    await waitFor(() => expect(linkOverlays(peekWrapper)).toHaveLength(1));
    expect(createButtons(peekWrapper)).toHaveLength(0);
  });

  it("外枠がまだ付いていない間は、メインの外枠に落とさず何も描かない", async () => {
    const { mainWrapper } = setup({ peekAttached: false });
    // 再計算（50ms 後）と DOM 待ちの再試行（200ms 後）が済むまで待つ
    await new Promise((resolve) => setTimeout(resolve, 400));
    expect(createButtons(mainWrapper)).toHaveLength(0);
    expect(linkOverlays(mainWrapper)).toHaveLength(0);
  });
});
