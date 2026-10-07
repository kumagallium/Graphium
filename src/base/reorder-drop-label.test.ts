// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { withReorderDropLabel, _reorderDropLabelElement } from "./reorder-drop-label";

// DropCursor と同じく、エディタの offsetParent の中に横線の要素を置いた状態を作る
function setup({ dragging }: { dragging: boolean }) {
  const parent = document.createElement("div");
  const dom = document.createElement("div");
  parent.appendChild(dom);
  document.body.appendChild(parent);
  Object.defineProperty(dom, "offsetParent", { value: parent });
  const cursor = document.createElement("div");
  cursor.className = "prosemirror-dropcursor-block prosemirror-dropcursor-block-horizontal";
  cursor.getBoundingClientRect = () =>
    ({ left: 120, top: 300, width: 500, height: 4, right: 620, bottom: 304 }) as DOMRect;
  parent.appendChild(cursor);
  const view = { dom, dragging: dragging ? { slice: {}, move: true } : null };
  return { view, cursor };
}

const ctx = (view: unknown) => ({ view, event: {}, editor: {}, defaultPosition: null }) as never;
const flush = () => new Promise<void>((r) => queueMicrotask(r));

describe("withReorderDropLabel", () => {
  afterEach(() => {
    window.dispatchEvent(new Event("dragend"));
    document.body.innerHTML = "";
  });

  it("ブロックを掴んで上下に並べ替えるとき、線の右端に案内を出す", async () => {
    const { view } = setup({ dragging: true });
    const hook = withReorderDropLabel(() => ({ pos: 5, orientation: "block-horizontal" }));
    expect(hook(ctx(view))).toEqual({ pos: 5, orientation: "block-horizontal" });
    await flush();
    const el = _reorderDropLabelElement();
    expect(el).not.toBeNull();
    expect(el!.style.left).toBe("620px");
    expect(el!.style.top).toBe("302px");
  });

  it("ファイルの投入（掴んだブロックが無い）では出さない", async () => {
    const { view } = setup({ dragging: false });
    withReorderDropLabel(() => ({ pos: 5, orientation: "block-horizontal" }))(ctx(view));
    await flush();
    expect(_reorderDropLabelElement()).toBeNull();
  });

  it("横並べ・中に入れる・文字のドラッグに切り替わったら消す", async () => {
    const { view } = setup({ dragging: true });
    let result: { pos: number; orientation: string } | null = { pos: 5, orientation: "block-horizontal" };
    const hook = withReorderDropLabel(() => result as never);
    hook(ctx(view));
    await flush();
    expect(_reorderDropLabelElement()).not.toBeNull();
    result = { pos: 5, orientation: "block-vertical-right" };
    hook(ctx(view));
    expect(_reorderDropLabelElement()).toBeNull();
    result = { pos: 5, orientation: "block-horizontal" };
    hook(ctx(view));
    await flush();
    result = null;
    hook(ctx(view));
    expect(_reorderDropLabelElement()).toBeNull();
  });

  it("エディタの外へ出たら消す", async () => {
    const { view } = setup({ dragging: true });
    withReorderDropLabel(() => ({ pos: 5, orientation: "block-horizontal" }))(ctx(view));
    await flush();
    const outside = document.createElement("div");
    document.body.appendChild(outside);
    outside.dispatchEvent(new Event("dragover", { bubbles: true }));
    expect(_reorderDropLabelElement()).toBeNull();
  });
});
