// @vitest-environment jsdom
// MemoQuoteLayer（紐づいた引用ブロックの縦線と印の層）のテスト。
//
// 対象の不変条件:
// - 紐づいた quote ブロックにだけ、メモの色の縦線の style（id は memo-quote-style。ハイライトとは別）が入る。
//   本文に無いブロックの紐づけは出ない
// - 印はブロックにマウスが載っている間だけ出る（普段は出ない）。元のメモが更新されていれば点が付く
// - 押すと小窓が開き、元のメモが更新されていれば「本文に反映」で updateBlock と紐づけの更新が走る
// - 「紐づけを外す」で紐づけが消え、縦線も印も消える。editable=false では反映・解除を出さない
// - 引用ブロックでなくなったもの（段落などに変えた）は、紐づけが残っていても縦線も印も出ない
// - 1 行の引用では、印が下へはみ出さないよう上の余白を詰める
// - hidden では何も出ない
// 文言は LocaleProvider の既定（jsdom → en）で照合する。

import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { useEffect } from "react";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import { LocaleProvider } from "../../i18n";
import { MemoQuoteLayer } from "./MemoQuoteLayer";
import { MemoQuoteProvider, useMemoQuoteStore } from "./store";
import type { MemoQuoteRef } from "../../lib/document-types";
import type { CaptureIndex } from "../mobile-capture";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
class NoopObserver {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}
(globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= NoopObserver;

const REF = (captureId: string, quotedText = "本文"): MemoQuoteRef => ({
  captureId,
  quotedAt: "2026-10-30T11:00:00.000Z",
  quotedText,
});
const captures = (...items: CaptureIndex["captures"]): CaptureIndex => ({
  version: 1,
  updatedAt: "2026-10-30T00:00:00.000Z",
  captures: items,
});
const CAP = (id: string, text: string) => ({ id, text, createdAt: "2026-10-30T10:00:00.000Z" });

// BlockNote の DOM を最小限まねる。引用ブロックの矩形は jsdom では 0 なので差し込む
function buildWrapper(blocks: { id: string; type: string }[]) {
  const root = document.createElement("div");
  for (const b of blocks) {
    const outer = document.createElement("div");
    outer.setAttribute("data-node-type", "blockOuter");
    outer.setAttribute("data-id", b.id);
    const container = document.createElement("div");
    container.className = "bn-block";
    const content = document.createElement("div");
    content.className = "bn-block-content";
    content.setAttribute("data-content-type", b.type);
    const bq = document.createElement("blockquote");
    bq.getBoundingClientRect = () =>
      ({ top: 100, left: 50, right: 450, bottom: 140, width: 400, height: 40, x: 50, y: 100, toJSON: () => ({}) }) as DOMRect;
    content.appendChild(bq);
    container.appendChild(content);
    outer.appendChild(container);
    root.appendChild(outer);
  }
  document.body.appendChild(root);
  return root;
}

function Seed({ snapshot }: { snapshot: Record<string, MemoQuoteRef> }) {
  const store = useMemoQuoteStore();
  useEffect(() => {
    store.restoreSnapshot(snapshot);
    // 一度だけ流し込む
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return null;
}
function Probe({ onStore }: { onStore: (quotes: Map<string, MemoQuoteRef>) => void }) {
  onStore(useMemoQuoteStore().quotes);
  return null;
}

let root: HTMLElement;
beforeEach(() => {
  root = buildWrapper([
    { id: "q1", type: "quote" },
    { id: "plain", type: "quote" },
  ]);
});
afterEach(() => {
  cleanup();
  root.remove();
});

function renderLayer(opts: {
  snapshot?: Record<string, MemoQuoteRef>;
  captureIndex?: CaptureIndex;
  editor?: unknown;
  editable?: boolean;
  hidden?: boolean;
  onStore?: (q: Map<string, MemoQuoteRef>) => void;
}) {
  return render(
    <LocaleProvider>
      <MemoQuoteProvider>
        <Seed snapshot={opts.snapshot ?? { q1: REF("c1") }} />
        {opts.onStore && <Probe onStore={opts.onStore} />}
        <MemoQuoteLayer
          editor={opts.editor ?? { getBlock: () => ({}), updateBlock: vi.fn() }}
          wrapperEl={root}
          captureIndex={opts.captureIndex ?? captures(CAP("c1", "本文"))}
          editable={opts.editable ?? true}
          hidden={opts.hidden}
        />
      </MemoQuoteProvider>
    </LocaleProvider>,
  );
}

const hover = (id: string) => {
  const outer = root.querySelector(`[data-id="${id}"]`)!;
  fireEvent.mouseOver(outer);
};

describe("MemoQuoteLayer", () => {
  it("紐づいた引用ブロックにだけ縦線の style を入れる（本文に無いブロックの紐づけは出ない）", async () => {
    renderLayer({ snapshot: { q1: REF("c1"), gone: REF("c2") } });
    await waitFor(() => expect(document.getElementById("memo-quote-style")).toBeTruthy());
    const css = document.getElementById("memo-quote-style")!.textContent!;
    expect(css).toContain('[data-id="q1"]');
    expect(css).not.toContain('[data-id="plain"]');
    expect(css).not.toContain('[data-id="gone"]');
    // ハイライト用の style とは別物
    expect(document.getElementById("doc-provenance-highlight")).toBeNull();
  });

  it("段落に変えたブロックは、紐づけが残っていても縦線も印も出ない", async () => {
    root.remove();
    root = buildWrapper([
      { id: "q1", type: "quote" },
      { id: "changed", type: "paragraph" },
    ]);
    renderLayer({ snapshot: { q1: REF("c1"), changed: REF("c2") } });
    await waitFor(() => expect(document.getElementById("memo-quote-style")).toBeTruthy());
    const css = document.getElementById("memo-quote-style")!.textContent!;
    expect(css).toContain('[data-id="q1"]');
    expect(css).not.toContain('[data-id="changed"]');
    hover("changed");
    await new Promise((r) => setTimeout(r, 30));
    expect(screen.queryByRole("button", { name: "Memo" })).toBeNull();
  });

  it("1 行の引用（高さ 27px）は印の上の余白を詰め、複数行（高さ 40px）は 8px のまま", async () => {
    root.remove();
    root = buildWrapper([
      { id: "one", type: "quote" },
      { id: "multi", type: "quote" },
    ]);
    const heightOf = (id: string, h: number) => {
      const bq = root.querySelector(`[data-id="${id}"] blockquote`) as HTMLElement;
      bq.getBoundingClientRect = () =>
        ({ top: 100, left: 50, right: 450, bottom: 100 + h, width: 400, height: h, x: 50, y: 100, toJSON: () => ({}) }) as DOMRect;
    };
    heightOf("one", 27);
    heightOf("multi", 40);
    renderLayer({ snapshot: { one: REF("c1"), multi: REF("c2") }, captureIndex: captures(CAP("c1", "本文"), CAP("c2", "本文")) });
    await waitFor(() => expect(document.getElementById("memo-quote-style")).toBeTruthy());
    hover("one");
    const oneChip = (await screen.findByRole("button", { name: "Memo" })) as HTMLElement;
    // wrapper の rect は 0 なので top = anchor.top + inset。1 行は (27-22)/2 = 2.5
    expect(parseFloat(oneChip.style.top)).toBeCloseTo(100 + 2.5, 1);
    hover("multi");
    await waitFor(() => {
      const chip = screen.getByRole("button", { name: "Memo" }) as HTMLElement;
      expect(parseFloat(chip.style.top)).toBeCloseTo(108, 1);
    });
  });

  it("印はマウスが載っている間だけ出る。紐づいていないブロックには出ない", async () => {
    renderLayer({});
    await waitFor(() => expect(document.getElementById("memo-quote-style")).toBeTruthy());
    expect(screen.queryByRole("button", { name: "Memo" })).toBeNull();
    hover("q1");
    expect(await screen.findByRole("button", { name: "Memo" })).toBeTruthy();
    hover("plain");
    await waitFor(() => expect(screen.queryByRole("button", { name: "Memo" })).toBeNull());
  });

  it("元のメモが更新されていれば、印に点が付き、名前も更新を伝える", async () => {
    renderLayer({ captureIndex: captures(CAP("c1", "本文（追記）")) });
    await waitFor(() => expect(document.getElementById("memo-quote-style")).toBeTruthy());
    hover("q1");
    const chip = await screen.findByRole("button", { name: "Memo (the original has been updated)" });
    expect(chip.querySelector('[data-test="memoChipDot"]')).toBeTruthy();
  });

  it("押すと小窓が開き、更新があれば「本文に反映」で中身を置き換えて紐づけを更新する", async () => {
    const editor = { getBlock: vi.fn(() => ({ id: "q1" })), updateBlock: vi.fn() };
    let quotes: Map<string, MemoQuoteRef> = new Map();
    renderLayer({
      editor,
      captureIndex: captures(CAP("c1", "新しい本文")),
      onStore: (q) => {
        quotes = q;
      },
    });
    await waitFor(() => expect(document.getElementById("memo-quote-style")).toBeTruthy());
    hover("q1");
    fireEvent.click(await screen.findByRole("button", { name: "Memo (the original has been updated)" }));
    expect(screen.getByText("The original memo has been updated")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Update this quote" }));
    expect(editor.updateBlock).toHaveBeenCalledWith("q1", {
      content: [{ type: "text", text: "新しい本文", styles: {} }],
    });
    await waitFor(() => expect(quotes.get("q1")?.quotedText).toBe("新しい本文"));
  });

  it("「紐づけを外す」で紐づけが消え、縦線も印も消える", async () => {
    renderLayer({});
    await waitFor(() => expect(document.getElementById("memo-quote-style")).toBeTruthy());
    hover("q1");
    fireEvent.click(await screen.findByRole("button", { name: "Memo" }));
    fireEvent.click(screen.getByRole("button", { name: "Detach from memo" }));
    await waitFor(() => expect(document.getElementById("memo-quote-style")).toBeNull());
    expect(screen.queryByRole("button", { name: "Memo" })).toBeNull();
  });

  it("editable=false: 小窓に「紐づけを外す」を出さない", async () => {
    renderLayer({ editable: false });
    await waitFor(() => expect(document.getElementById("memo-quote-style")).toBeTruthy());
    hover("q1");
    fireEvent.click(await screen.findByRole("button", { name: "Memo" }));
    expect(screen.getByRole("dialog", { name: "Quoted memo" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Detach from memo" })).toBeNull();
  });

  it("元のメモが削除されていれば小窓がそう伝える", async () => {
    renderLayer({ captureIndex: captures() });
    await waitFor(() => expect(document.getElementById("memo-quote-style")).toBeTruthy());
    hover("q1");
    fireEvent.click(await screen.findByRole("button", { name: "Memo" }));
    expect(screen.getByText("The original memo was deleted")).toBeTruthy();
  });

  it("hidden では何も出さない", async () => {
    renderLayer({ hidden: true });
    hover("q1");
    expect(document.getElementById("memo-quote-style")).toBeNull();
    expect(screen.queryByRole("button", { name: "Memo" })).toBeNull();
  });
});
