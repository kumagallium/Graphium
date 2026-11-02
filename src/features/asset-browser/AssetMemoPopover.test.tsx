// @vitest-environment jsdom
// AssetMemoPopover / AssetMemoButton（素材のメモの小窓と、サイドピークのヘッダーの入口）のテスト。
//
// 対象の不変条件:
// - 見出しは素材名。書けるとき（onCreate）は書く欄が出て、読むだけのときは出ない
// - 「全画面で開く」は onOpenFull があるときだけ。押すと小窓を閉じてから開く
// - AssetMemoButton: メモの件数（素材の「メモ」タブと同じ集合）を印に出し、押すと小窓が開く。
//   0 件でも書けるなら出す。読むだけで 0 件なら出さない。書くと素材の entry と本文が渡る
// 文言は LocaleProvider の既定（jsdom → en）で照合する。

import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor, within } from "@testing-library/react";
import { LocaleProvider } from "../../i18n";
import { AssetMemoButton, AssetMemoPopover } from "./AssetMemoPopover";
import type { CaptureEntry, CaptureIndex } from "../mobile-capture";
import type { MediaIndexEntry } from "./media-index";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

class NoopObserver {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}
(globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= NoopObserver;

afterEach(cleanup);

const ENTRY: MediaIndexEntry = {
  fileId: "img-1",
  name: "sem-900c.png",
  type: "image",
  mimeType: "image/png",
  url: "",
  thumbnailUrl: "",
  uploadedAt: "2026-10-30T00:00:00.000Z",
  usedIn: [],
};

const MEMO: CaptureEntry = {
  id: "m1",
  text: "粒界に析出物",
  createdAt: "2026-10-30T10:00:00.000Z",
  sourceAsset: { fileId: "img-1", type: "image" },
};

function captures(...items: CaptureEntry[]): CaptureIndex {
  return { version: 1, updatedAt: "2026-10-30T00:00:00.000Z", captures: items };
}

describe("AssetMemoPopover", () => {
  function setup(props: Partial<React.ComponentProps<typeof AssetMemoPopover>> = {}) {
    const anchor = document.createElement("button");
    document.body.appendChild(anchor);
    const onClose = vi.fn();
    render(
      <LocaleProvider>
        <AssetMemoPopover anchor={anchor} entry={ENTRY} memos={[MEMO]} onClose={onClose} {...props} />
      </LocaleProvider>,
    );
    return { onClose };
  }

  it("見出しは素材名。onCreate が無ければ書く欄は出ない", () => {
    setup();
    const dialog = screen.getByRole("dialog", { name: "sem-900c.png" });
    expect(within(dialog).getByText("粒界に析出物")).toBeTruthy();
    expect(within(dialog).queryByRole("textbox")).toBeNull();
    expect(within(dialog).queryByRole("button", { name: "Open full screen" })).toBeNull();
  });

  it("onCreate があれば書く欄が出て、⏎ で本文が渡る", async () => {
    const onCreate = vi.fn().mockResolvedValue(undefined);
    setup({ onCreate });
    const box = within(screen.getByRole("dialog")).getByRole("textbox");
    fireEvent.change(box, { target: { value: "新しいメモ" } });
    fireEvent.keyDown(box, { key: "Enter" });
    await waitFor(() => expect(onCreate).toHaveBeenCalledWith("新しいメモ"));
  });

  it("「全画面で開く」は小窓を閉じてから onOpenFull を呼ぶ", () => {
    const calls: string[] = [];
    const onOpenFull = vi.fn(() => calls.push("open"));
    const { onClose } = setup({ onOpenFull });
    onClose.mockImplementation(() => calls.push("close"));
    fireEvent.click(screen.getByRole("button", { name: "Open full screen" }));
    expect(calls).toEqual(["close", "open"]);
  });
});

describe("AssetMemoButton", () => {
  it("件数を印に出し、押すと小窓が開く。書くと素材の entry と本文が渡る", async () => {
    const onCreateMemo = vi.fn().mockResolvedValue(undefined);
    render(
      <LocaleProvider>
        <AssetMemoButton entry={ENTRY} captureIndex={captures(MEMO)} onCreateMemo={onCreateMemo} />
      </LocaleProvider>,
    );
    const chip = screen.getByRole("button", { name: "1 memo(s)" });
    expect(chip.textContent).toBe("1");
    fireEvent.click(chip);
    const dialog = await screen.findByRole("dialog", { name: "sem-900c.png" });
    const box = within(dialog).getByRole("textbox");
    fireEvent.change(box, { target: { value: "追記" } });
    fireEvent.keyDown(box, { key: "Enter" });
    await waitFor(() => expect(onCreateMemo).toHaveBeenCalledWith(ENTRY, "追記"));
  });

  it("0 件でも書けるなら印を出す（ヘッダーの入口なので常に見える）", () => {
    render(
      <LocaleProvider>
        <AssetMemoButton entry={ENTRY} captureIndex={captures()} onCreateMemo={vi.fn()} />
      </LocaleProvider>,
    );
    expect(screen.getByRole("button", { name: "Write a memo on this material" })).toBeTruthy();
  });

  it("読むだけ（onCreateMemo 無し）で 0 件なら出さない。1 件以上あれば読むために出す", () => {
    const { unmount } = render(
      <LocaleProvider>
        <AssetMemoButton entry={ENTRY} captureIndex={captures()} />
      </LocaleProvider>,
    );
    expect(document.querySelector("[data-memo-chip]")).toBeNull();
    unmount();
    render(
      <LocaleProvider>
        <AssetMemoButton entry={ENTRY} captureIndex={captures(MEMO)} />
      </LocaleProvider>,
    );
    expect(screen.getByRole("button", { name: "1 memo(s)" })).toBeTruthy();
  });

  it("もう一度押すと小窓が閉じる。Esc でも閉じる", async () => {
    render(
      <LocaleProvider>
        <AssetMemoButton entry={ENTRY} captureIndex={captures(MEMO)} onCreateMemo={vi.fn()} />
      </LocaleProvider>,
    );
    const chip = screen.getByRole("button", { name: "1 memo(s)" });
    fireEvent.click(chip);
    await screen.findByRole("dialog");
    fireEvent.click(chip);
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    fireEvent.click(chip);
    await screen.findByRole("dialog");
    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });
});
