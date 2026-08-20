// @vitest-environment jsdom
// TableCaptionLayer（表のキャプション・折りたたみ）のテスト。
//
// 対象の不変条件:
// - 長い取り込み表の折りたたみ CSS は、表が画面外にあっても当たり続ける。
//   スクロールで CSS が付いたり外れたりすると表の高さが変わり、スクロール位置が
//   跳んで開閉がフレームごとに往復する（表が画面外に出た瞬間に伸びる →
//   スクロールアンカーで位置が跳ぶ → 裾が画面に戻って縮む → また画面外…）。
// - キャプションと裾（「あと N 行」）は画面に掛かっている表にだけ描く。
//
// getBoundingClientRect と innerHeight を差し替えて「画面内 / 画面外」を作る。

import { describe, it, expect, afterEach } from "vitest";
import { render, act, cleanup, waitFor } from "@testing-library/react";
import { useEffect } from "react";
import { TableMetaStoreProvider, useTableMetaStore } from "./store";
import { TableCaptionLayer } from "./caption-layer";
import type { TableMeta } from "./types";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const BLOCK_ID = "t1";
/** ヘッダを除いたデータ行数。閾値（20）を超えて折りたたみ対象になる長さ */
const DATA_ROWS = 47;
const FOLD_RULE = `[data-id="${BLOCK_ID}"] .tableWrapper tbody tr:nth-child(n+9){display:none;}`;

type Rect = { top: number; bottom: number };

/** BlockNote が描く表の DOM を最小限に再現し、rect を差し替えられるようにする */
function mountTableDom(rect: Rect) {
  const wrapper = document.createElement("div");
  wrapper.setAttribute("data-label-wrapper", "");
  const outer = document.createElement("div");
  outer.setAttribute("data-id", BLOCK_ID);
  outer.setAttribute("data-node-type", "blockOuter");
  const tableWrapper = document.createElement("div");
  tableWrapper.className = "tableWrapper";
  const table = document.createElement("table");
  const tbody = document.createElement("tbody");
  for (let i = 0; i < DATA_ROWS + 1; i++) {
    const tr = document.createElement("tr");
    tr.appendChild(document.createElement("td"));
    tbody.appendChild(tr);
  }
  table.appendChild(tbody);
  tableWrapper.appendChild(table);
  outer.appendChild(tableWrapper);
  wrapper.appendChild(outer);
  document.body.appendChild(wrapper);

  const current = { ...rect };
  table.getBoundingClientRect = () =>
    ({
      top: current.top,
      bottom: current.bottom,
      left: 0,
      right: 400,
      width: 400,
      height: current.bottom - current.top,
      x: 0,
      y: current.top,
      toJSON: () => ({}),
    }) as DOMRect;
  return {
    wrapper,
    setRect: (next: Rect) => {
      current.top = next.top;
      current.bottom = next.bottom;
    },
  };
}

function makeEditorRef(): { current: any } {
  const block = {
    id: BLOCK_ID,
    type: "table",
    content: {
      type: "tableContent",
      rows: Array.from({ length: DATA_ROWS + 1 }, () => ({ cells: [] })),
    },
    children: [],
  };
  return {
    current: {
      document: [block],
      getBlock: (id: string) => (id === BLOCK_ID ? block : undefined),
    },
  };
}

const META: Record<string, TableMeta> = {
  [BLOCK_ID]: {
    caption: "xrd_sample",
    source: {
      kind: "delimited-file",
      fileName: "xrd_sample.txt",
      importedAt: "2026-08-17T00:00:00.000Z",
      options: { headerRow: 1, endRow: 48, delimiter: "tab", collapseConsecutive: true },
    },
  },
};

/** ストアに取り込み表の注釈を入れる（ノートを開いたときの restore 相当） */
function Seed() {
  const store = useTableMetaStore();
  useEffect(() => {
    store.restore(META);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return null;
}

function foldStyleText(): string {
  return [...document.body.querySelectorAll("style")].map((s) => s.textContent ?? "").join("");
}

/** 裾の「あと N 行を表示」ボタン（言語に依らず隠れる行数 40 で引く） */
function hiddenRowsButton(): HTMLButtonElement | null {
  return (
    [...document.body.querySelectorAll("button")].find((b) => /\b40\b/.test(b.textContent ?? "")) ??
    null
  );
}

function scrollTo(setRect: (r: Rect) => void, rect: Rect) {
  act(() => {
    setRect(rect);
    // 層は window の scroll を capture で拾う
    window.dispatchEvent(new Event("scroll"));
  });
}

describe("TableCaptionLayer の折りたたみ", () => {
  let dom: ReturnType<typeof mountTableDom> | null = null;
  const originalInnerHeight = window.innerHeight;

  afterEach(() => {
    cleanup();
    dom?.wrapper.remove();
    dom = null;
    Object.defineProperty(window, "innerHeight", { value: originalInnerHeight, configurable: true });
  });

  function setup(rect: Rect) {
    Object.defineProperty(window, "innerHeight", { value: 720, configurable: true });
    dom = mountTableDom(rect);
    const editorRef = makeEditorRef();
    render(
      <TableMetaStoreProvider>
        <Seed />
        <TableCaptionLayer editorRef={editorRef} />
      </TableMetaStoreProvider>
    );
    return dom;
  }

  it("画面内の長い取り込み表は折りたたまれ、裾に「あと N 行」が出る", async () => {
    setup({ top: 100, bottom: 400 });
    await waitFor(() => {
      expect(foldStyleText()).toContain(FOLD_RULE);
      expect(hiddenRowsButton()).not.toBeNull();
    });
  });

  // #716 の回帰。折りたたみ CSS がスクロールで付いたり外れたりすると、表の高さが
  // 変わるたびにスクロールアンカーが位置を保とうとして scrollTop が跳ね、表が
  // 開いたり閉じたりチカチカする。画面のどこにあっても当たり続けることを守る。
  it("表が画面の上に抜けても折りたたみ CSS は外れない", async () => {
    const { setRect } = setup({ top: 100, bottom: 400 });
    await waitFor(() => expect(hiddenRowsButton()).not.toBeNull());

    // 表の裾が画面上端より上へ（rect.bottom < 0）
    scrollTo(setRect, { top: -900, bottom: -600 });

    await waitFor(() => expect(foldStyleText()).toContain(FOLD_RULE));
  });

  it("表が画面の下にあるうちも折りたたみ CSS が当たっている", async () => {
    setup({ top: 2000, bottom: 2300 });
    await waitFor(() => expect(foldStyleText()).toContain(FOLD_RULE));
  });

  it("画面外から戻ってきた表は畳んだまま", async () => {
    const { setRect } = setup({ top: -900, bottom: -600 });
    await waitFor(() => expect(foldStyleText()).toContain(FOLD_RULE));

    scrollTo(setRect, { top: 100, bottom: 400 });

    await waitFor(() => expect(hiddenRowsButton()).not.toBeNull());
    expect(foldStyleText()).toContain(FOLD_RULE);
  });

  // キャプションと裾はラッパーの中に絶対配置されるので、画面外のぶんは overflow が
  // 隠す。描く側で「見えているものだけ」に間引くと、同じ一覧から引いている
  // 折りたたみ CSS まで巻き込む恐れがあるので、間引きは入れない。
  it("画面外の表でも裾は描かれ続ける（間引きを CSS に漏らさない）", async () => {
    const { setRect } = setup({ top: 100, bottom: 400 });
    await waitFor(() => expect(hiddenRowsButton()).not.toBeNull());

    scrollTo(setRect, { top: -900, bottom: -600 });

    await waitFor(() => expect(foldStyleText()).toContain(FOLD_RULE));
    expect(hiddenRowsButton()).not.toBeNull();
  });
});
