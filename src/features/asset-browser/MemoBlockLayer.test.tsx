// @vitest-environment jsdom
// MemoBlockLayer（ノートの素材ブロックに重ねるメモの印の層）のテスト。
//
// 対象の不変条件:
// - 素材に引けるブロック（image / video / pdf）にだけ印が出る。外部 URL・索引に無いものには出ない
// - 件数は素材の「メモ」タブと同じ集合（filterMemosByAsset）。1 件以上は常に出る
// - 0 件の印は、そのブロックにマウスが載っている間だけ出る
// - 印は絵の要素の右上から内側 8px（左は印の右端）
// - 押すと小窓が開き、見出しは素材の名前。書けるときは sourceAsset 用の {fileId, type} つきで onCreateMemo が呼ばれる
// - 書けないとき（onCreateMemo なし）は書く欄が無い。hidden では何も出ない
// - 書式ツールバーの「メモ」ボタン用の開き手（openMaterialMemo）が登録され、0 件でも小窓が開く。
//   保存に失敗（onCreateMemo が reject）しても、書いた文は書く欄に残る
// - 純関数: memoChipPosition / findMemoAnchorEl
// 文言は LocaleProvider の既定（jsdom → en）で照合する。

import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor, within } from "@testing-library/react";

vi.mock("../../lib/storage/registry", () => ({
  getActiveProvider: () => ({
    extractFileId: (url: string) => {
      const m = url.match(/^local-media:\/\/(.+)$/);
      return m ? m[1] : null;
    },
  }),
}));

let mockIndex: { media: unknown[] } | null = null;
vi.mock("./media-index", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./media-index")>();
  return { ...actual, getLatestMediaIndex: () => mockIndex };
});

import { LocaleProvider } from "../../i18n";
import { MemoBlockLayer, MEMO_CHIP_INSET, findMemoAnchorEl, memoChipPosition, scrollbarGutter } from "./MemoBlockLayer";
import { hasMaterialMemoOpener, openMaterialMemo } from "./memo-toolbar";
import type { CaptureIndex } from "../mobile-capture";
import type { MediaIndexEntry } from "./media-index";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

class NoopObserver {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}
(globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= NoopObserver;

function material(fileId: string, name: string, type: MediaIndexEntry["type"] = "image"): MediaIndexEntry {
  return {
    fileId,
    name,
    type,
    mimeType: "image/png",
    url: "",
    thumbnailUrl: "",
    uploadedAt: "2026-10-30T00:00:00.000Z",
    usedIn: [],
  };
}

const IMG = material("img-1", "sem-900c.png");
const VID = material("vid-1", "movie.mp4", "video");

function captures(...items: CaptureIndex["captures"]): CaptureIndex {
  return { version: 1, updatedAt: "2026-10-30T00:00:00.000Z", captures: items };
}

// ブロックの DOM（BlockNote の構造を最小限まねる）。絵の要素の矩形は jsdom では 0 なので差し込む
function buildWrapper(blocks: { id: string; type: string }[]) {
  const root = document.createElement("div");
  root.setAttribute("data-label-wrapper", "");
  for (const b of blocks) {
    const outer = document.createElement("div");
    outer.setAttribute("data-node-type", "blockOuter");
    outer.setAttribute("data-id", b.id);
    const container = document.createElement("div");
    container.className = "bn-block";
    const content = document.createElement("div");
    content.className = "bn-block-content";
    content.setAttribute("data-content-type", b.type);
    const pic = document.createElement("div");
    pic.className = "bn-file-block-content-wrapper";
    pic.getBoundingClientRect = () =>
      ({ top: 100, left: 50, right: 350, bottom: 300, width: 300, height: 200, x: 50, y: 100, toJSON: () => ({}) }) as DOMRect;
    content.appendChild(pic);
    container.appendChild(content);
    outer.appendChild(container);
    root.appendChild(outer);
  }
  document.body.appendChild(root);
  return root;
}

function makeEditor(blocks: Record<string, { type: string; props: { url: string } }>) {
  return { getBlock: (id: string) => blocks[id] };
}

let root: HTMLElement;

beforeEach(() => {
  mockIndex = { media: [IMG, VID] };
});
afterEach(() => {
  cleanup();
  root?.remove();
});

function renderLayer(props: Partial<React.ComponentProps<typeof MemoBlockLayer>>, editor: unknown) {
  return render(
    <LocaleProvider>
      <MemoBlockLayer editor={editor} wrapperEl={root} captureIndex={captures()} {...props} />
    </LocaleProvider>,
  );
}

describe("memoChipPosition / findMemoAnchorEl", () => {
  it("絵の右上から内側 8px（スクロール量込みのローカル座標）", () => {
    const pos = memoChipPosition({ top: 120, left: 60, right: 360 }, { top: 20, left: 10, right: 800 }, { top: 40, left: 0 });
    expect(pos).toEqual({ top: 120 - 20 + 40 + MEMO_CHIP_INSET, left: 360 - 10 - MEMO_CHIP_INSET });
  });

  it("画像・動画は層 2、PDF は data-memo-anchor、無ければ最初の子要素", () => {
    const withWrapper = document.createElement("div");
    withWrapper.innerHTML = '<div class="bn-file-block-content-wrapper" id="w"></div>';
    expect(findMemoAnchorEl(withWrapper)?.id).toBe("w");

    const pdf = document.createElement("div");
    pdf.innerHTML = '<div id="c"><div id="head"></div><div id="v" data-memo-anchor=""></div></div>';
    expect(findMemoAnchorEl(pdf)?.id).toBe("v");

    const plain = document.createElement("div");
    plain.innerHTML = '<div id="first"></div><div id="second"></div>';
    expect(findMemoAnchorEl(plain)?.id).toBe("first");

    expect(findMemoAnchorEl(document.createElement("div"))).toBeNull();
  });
});

describe("scrollbarGutter", () => {
  const sized = (offsetWidth: number, clientWidth: number, clientLeft = 0) => {
    const el = document.createElement("div");
    Object.defineProperty(el, "offsetWidth", { value: offsetWidth });
    Object.defineProperty(el, "clientWidth", { value: clientWidth });
    Object.defineProperty(el, "clientLeft", { value: clientLeft });
    return el;
  };
  it("縦スクロールバーが出ている分（offsetWidth - clientWidth - 枠）を返す。出ていなければ 0", () => {
    expect(scrollbarGutter(sized(300, 283))).toBe(17);
    // 枠線（clientLeft）はバーではない
    expect(scrollbarGutter(sized(300, 297, 1))).toBe(1);
    // オーバーレイ式・スクロールなし
    expect(scrollbarGutter(sized(300, 298, 1))).toBe(0);
    expect(scrollbarGutter(document.createElement("div"))).toBe(0);
  });
});

describe("MemoBlockLayer", () => {
  it("PDF の表示域にスクロールバーが出ていれば、その幅ぶん内側へ印を寄せる", async () => {
    root = buildWrapper([{ id: "b1", type: "pdf" }]);
    const pic = root.querySelector<HTMLElement>(".bn-file-block-content-wrapper")!;
    Object.defineProperty(pic, "offsetWidth", { value: 300 });
    Object.defineProperty(pic, "clientWidth", { value: 283 });
    mockIndex = { media: [material("pdf-1", "paper.pdf", "pdf")] };
    const editor = makeEditor({ b1: { type: "pdf", props: { url: "local-media://pdf-1" } } });
    renderLayer(
      { captureIndex: captures({ id: "m1", text: "a", createdAt: "2026-10-30T10:00:00.000Z", sourceAsset: { fileId: "pdf-1", type: "pdf" } }) },
      editor,
    );
    const chip = await screen.findByRole("button", { name: "1 memo(s)" });
    expect(chip.style.left).toBe(`${350 - 17 - MEMO_CHIP_INSET}px`);
  });

  it("読むだけ（onCreateMemo なし）で 0 件の素材には、hover しても印を出さない", async () => {
    root = buildWrapper([{ id: "b1", type: "image" }]);
    const editor = makeEditor({ b1: { type: "image", props: { url: "local-media://img-1" } } });
    renderLayer({ onCreateMemo: undefined }, editor);
    await new Promise((r) => setTimeout(r, 50));
    fireEvent.mouseOver(root.querySelector(".bn-file-block-content-wrapper")!);
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.queryByRole("button", { name: "Write a memo on this material" })).toBeNull();
  });

  it("文書の走査（tiptap の doc）から素材ブロックを引ける。getBlock は呼ばない", async () => {
    root = buildWrapper([{ id: "b1", type: "image" }]);
    const getBlock = vi.fn();
    const node = (name: string, attrs: Record<string, unknown>, firstChild?: unknown) => ({ type: { name }, attrs, firstChild });
    const container = node("blockContainer", { id: "b1" }, node("image", { url: "local-media://img-1" }));
    const editor = {
      getBlock,
      _tiptapEditor: {
        state: { doc: { descendants: (fn: (n: unknown) => boolean) => { fn(container); } } },
        on: () => {},
        off: () => {},
      },
    };
    renderLayer(
      { captureIndex: captures({ id: "m1", text: "a", createdAt: "2026-10-30T10:00:00.000Z", sourceAsset: { fileId: "img-1", type: "image" } }) },
      editor,
    );
    expect(await screen.findByRole("button", { name: "1 memo(s)" })).toBeTruthy();
    expect(getBlock).not.toHaveBeenCalled();
  });

  it("メモが 1 件以上ある素材のブロックに、件数つきの印が絵の右上へ出る", async () => {
    root = buildWrapper([{ id: "b1", type: "image" }]);
    const editor = makeEditor({ b1: { type: "image", props: { url: "local-media://img-1" } } });
    renderLayer(
      {
        captureIndex: captures(
          { id: "m1", text: "a", createdAt: "2026-10-30T10:00:00.000Z", sourceAsset: { fileId: "img-1", type: "image" } },
          { id: "m2", text: "b", createdAt: "2026-10-30T09:00:00.000Z", sourceAsset: { fileId: "img-1", type: "image" } },
          { id: "m3", text: "他の素材", createdAt: "2026-10-30T08:00:00.000Z", sourceAsset: { fileId: "other", type: "image" } },
        ),
      },
      editor,
    );
    const chip = await screen.findByRole("button", { name: "2 memo(s)" });
    expect(chip.textContent).toBe("2");
    expect(chip.style.top).toBe(`${100 + MEMO_CHIP_INSET}px`);
    expect(chip.style.left).toBe(`${350 - MEMO_CHIP_INSET}px`);
    // 印は外枠の中へ描く（ポータル先）
    expect(root.contains(chip)).toBe(true);
  });

  it("0 件の印は、ブロックにマウスが載っている間だけ出る", async () => {
    root = buildWrapper([{ id: "b1", type: "image" }]);
    const editor = makeEditor({ b1: { type: "image", props: { url: "local-media://img-1" } } });
    renderLayer({ onCreateMemo: vi.fn() }, editor);
    // 測り終わるのを待ってから、印が無いことを確かめる
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.queryByRole("button", { name: "Write a memo on this material" })).toBeNull();

    fireEvent.mouseOver(root.querySelector(".bn-file-block-content-wrapper")!);
    expect(await screen.findByRole("button", { name: "Write a memo on this material" })).toBeTruthy();

    fireEvent.mouseLeave(root);
    await waitFor(() => expect(screen.queryByRole("button", { name: "Write a memo on this material" })).toBeNull());
  });

  it("素材に引けないブロック（外部 URL・索引に無い）には印を出さない", async () => {
    root = buildWrapper([
      { id: "ext", type: "image" },
      { id: "missing", type: "image" },
    ]);
    const editor = makeEditor({
      ext: { type: "image", props: { url: "https://example.com/a.png" } },
      missing: { type: "image", props: { url: "local-media://not-in-index" } },
    });
    renderLayer(
      {
        captureIndex: captures({ id: "m1", text: "a", createdAt: "2026-10-30T10:00:00.000Z", sourceAsset: { fileId: "not-in-index", type: "image" } }),
      },
      editor,
    );
    await new Promise((r) => setTimeout(r, 50));
    expect(root.querySelector("[data-memo-chip]")).toBeNull();
  });

  it("押すと小窓が開き、見出しは素材の名前。書くと {fileId, type} つきで onCreateMemo が呼ばれる", async () => {
    root = buildWrapper([{ id: "b1", type: "video" }]);
    const editor = makeEditor({ b1: { type: "video", props: { url: "local-media://vid-1" } } });
    const onCreateMemo = vi.fn().mockResolvedValue(undefined);
    const onOpenMedia = vi.fn();
    renderLayer(
      {
        onCreateMemo,
        onOpenMedia,
        captureIndex: captures({ id: "m1", text: "既存のメモ", createdAt: "2026-10-30T10:00:00.000Z", sourceAsset: { fileId: "vid-1", type: "video" } }),
      },
      editor,
    );
    fireEvent.click(await screen.findByRole("button", { name: "1 memo(s)" }));
    const dialog = await screen.findByRole("dialog", { name: "movie.mp4" });
    expect(within(dialog).getByText("既存のメモ")).toBeTruthy();

    const box = within(dialog).getByRole("textbox");
    fireEvent.change(box, { target: { value: "新しい" } });
    fireEvent.keyDown(box, { key: "Enter" });
    await waitFor(() => expect(onCreateMemo).toHaveBeenCalledWith("新しい", { fileId: "vid-1", type: "video" }));

    // 全画面で開く（小窓は閉じる）
    fireEvent.click(within(dialog).getByRole("button", { name: "Open full screen" }));
    expect(onOpenMedia).toHaveBeenCalledWith("vid-1");
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("onCreateMemo が無ければ小窓は読むだけ（書く欄なし）", async () => {
    root = buildWrapper([{ id: "b1", type: "image" }]);
    const editor = makeEditor({ b1: { type: "image", props: { url: "local-media://img-1" } } });
    renderLayer(
      { captureIndex: captures({ id: "m1", text: "既存のメモ", createdAt: "2026-10-30T10:00:00.000Z", sourceAsset: { fileId: "img-1", type: "image" } }) },
      editor,
    );
    fireEvent.click(await screen.findByRole("button", { name: "1 memo(s)" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).queryByRole("textbox")).toBeNull();
    // 全画面ボタンも onOpenMedia が無ければ出ない
    expect(within(dialog).queryByRole("button", { name: "Open full screen" })).toBeNull();
  });

  it("メモの項目を押すと onOpenMemo に id が渡る", async () => {
    root = buildWrapper([{ id: "b1", type: "image" }]);
    const editor = makeEditor({ b1: { type: "image", props: { url: "local-media://img-1" } } });
    const onOpenMemo = vi.fn();
    renderLayer(
      {
        onOpenMemo,
        captureIndex: captures({ id: "m1", text: "既存のメモ", createdAt: "2026-10-30T10:00:00.000Z", sourceAsset: { fileId: "img-1", type: "image" } }),
      },
      editor,
    );
    fireEvent.click(await screen.findByRole("button", { name: "1 memo(s)" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByText("既存のメモ"));
    expect(onOpenMemo).toHaveBeenCalledWith("m1");
  });

  it("書式ツールバー用の開き手が登録され、0 件の素材でも小窓が開く。外れたら解除される", async () => {
    root = buildWrapper([{ id: "b1", type: "image" }]);
    const editor = makeEditor({ b1: { type: "image", props: { url: "local-media://img-1" } } });
    const { unmount } = renderLayer({ onCreateMemo: vi.fn() }, editor);
    expect(hasMaterialMemoOpener(editor)).toBe(true);
    // 測り終わるのを待ってから開く（印は 0 件で hover もしていないので出ていない）
    await new Promise((r) => setTimeout(r, 50));
    expect(root.querySelector("[data-memo-chip]")).toBeNull();
    let opened = false;
    await waitFor(() => {
      opened = openMaterialMemo(editor, "b1");
      expect(opened).toBe(true);
    });
    expect(await screen.findByRole("dialog", { name: "sem-900c.png" })).toBeTruthy();
    // 知らないブロックは開けない
    expect(openMaterialMemo(editor, "nope")).toBe(false);
    unmount();
    expect(hasMaterialMemoOpener(editor)).toBe(false);
  });

  it("保存に失敗（onCreateMemo が reject）しても、書いた文は書く欄に残る", async () => {
    root = buildWrapper([{ id: "b1", type: "image" }]);
    const editor = makeEditor({ b1: { type: "image", props: { url: "local-media://img-1" } } });
    const onCreateMemo = vi.fn().mockRejectedValue(new Error("save failed"));
    renderLayer(
      {
        onCreateMemo,
        captureIndex: captures({ id: "m1", text: "既存", createdAt: "2026-10-30T10:00:00.000Z", sourceAsset: { fileId: "img-1", type: "image" } }),
      },
      editor,
    );
    fireEvent.click(await screen.findByRole("button", { name: "1 memo(s)" }));
    const dialog = await screen.findByRole("dialog");
    const box = within(dialog).getByRole("textbox") as HTMLTextAreaElement;
    fireEvent.change(box, { target: { value: "消えてほしくない文" } });
    fireEvent.keyDown(box, { key: "Enter" });
    await waitFor(() => expect(onCreateMemo).toHaveBeenCalledTimes(1));
    // 書く欄が再び使え、文が残っている
    await waitFor(() => expect((within(dialog).getByRole("textbox") as HTMLTextAreaElement).disabled).toBe(false));
    expect((within(dialog).getByRole("textbox") as HTMLTextAreaElement).value).toBe("消えてほしくない文");
  });

  it("hidden のときは何も出さない", async () => {
    root = buildWrapper([{ id: "b1", type: "image" }]);
    const editor = makeEditor({ b1: { type: "image", props: { url: "local-media://img-1" } } });
    renderLayer(
      {
        hidden: true,
        captureIndex: captures({ id: "m1", text: "a", createdAt: "2026-10-30T10:00:00.000Z", sourceAsset: { fileId: "img-1", type: "image" } }),
      },
      editor,
    );
    await new Promise((r) => setTimeout(r, 50));
    expect(root.querySelector("[data-memo-chip]")).toBeNull();
  });
});
