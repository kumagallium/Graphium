// @vitest-environment jsdom
// 右パネルの受信箱（MobileInboxPanel）のテスト。
//
// 対象の不変条件:
// - 未接続なら接続の案内、items が空なら空の表示
// - クリックは選ぶだけ（onInsert を呼ばない）。ダブルクリック・＋・Enter・「選んだ N 件」で onInsert
// - 複数まとめて入れるときは古い順（modifiedAt の昇順）で渡る
// - 待ち中（busyNames）のタイルは操作できない
// - ドラッグは INBOX_DRAG_MIME に名前の JSON 配列を載せる（選んだタイルから引くと選んだ全部）
//
// 文言は LocaleProvider の既定（jsdom → en）で照合する。

import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { MobileInboxPanel, INBOX_DRAG_MIME } from "./MobileInboxPanel";
import type { InboxSource } from "./InboxView";
import { LocaleProvider } from "../../../i18n";
import type { CaptureRef } from "./types";

// react-pdf は import だけで jsdom に無い DOMMatrix を触るので、描画しないスタブにする
vi.mock("react-pdf", () => ({
  pdfjs: { GlobalWorkerOptions: {} as Record<string, unknown> },
  Document: () => null,
  Page: () => null,
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// 画像のサムネイルは blob URL を作るので、jsdom に無い createObjectURL をスタブする
Object.assign(URL, { createObjectURL: vi.fn(() => "blob:stub"), revokeObjectURL: vi.fn() });

afterEach(() => cleanup());

const source: InboxSource = {
  listPending: vi.fn(async () => []),
  readBlob: vi.fn(async () => new Blob([new Uint8Array([1]) as BlobPart], { type: "image/jpeg" })),
};

// 一覧は新しい順（IMG_3 > IMG_2 > IMG_1）に並ぶ。渡す順はわざとばらす
const R1: CaptureRef = { name: "IMG_1.jpg", bytes: 1, modifiedAt: "2026-07-24T08:00:00Z" };
const R2: CaptureRef = { name: "IMG_2.jpg", bytes: 2, modifiedAt: "2026-07-24T09:00:00Z" };
const R3: CaptureRef = { name: "IMG_3.jpg", bytes: 3, modifiedAt: "2026-07-24T10:00:00Z" };
const ITEMS = [R2, R3, R1];

function renderPanel(props: Partial<React.ComponentProps<typeof MobileInboxPanel>> = {}) {
  const onInsert = vi.fn();
  render(
    <LocaleProvider>
      <MobileInboxPanel source={source} items={ITEMS} onInsert={onInsert} {...props} />
    </LocaleProvider>,
  );
  return { onInsert };
}

const tiles = () => Array.from(document.querySelectorAll<HTMLElement>('[data-test="mobileInboxTile"]'));
const tileOf = (name: string) => tiles().find((t) => t.querySelector(`[aria-label="${name}"]`))!;

describe("MobileInboxPanel", () => {
  it("source が null なら接続の案内を出し、ボタンで onConnect を呼ぶ", () => {
    const onConnect = vi.fn();
    renderPanel({ source: null, onConnect });
    expect(screen.getByText(/Connect a sync folder/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Connect sync folder" }));
    expect(onConnect).toHaveBeenCalledTimes(1);
  });

  it("items が空なら空の表示", () => {
    renderPanel({ items: [] });
    expect(screen.getByText("Nothing new")).toBeTruthy();
    expect(tiles()).toHaveLength(0);
  });

  it("タイルをクリックしても onInsert は呼ばれず、そのタイルが選ばれる", () => {
    const { onInsert } = renderPanel();
    fireEvent.click(screen.getByRole("button", { name: "IMG_2.jpg" }));
    expect(onInsert).not.toHaveBeenCalled();
    expect(tileOf("IMG_2.jpg").getAttribute("data-selected")).toBe("true");
    expect(tileOf("IMG_1.jpg").getAttribute("data-selected")).toBeNull();
  });

  it("ダブルクリックで onInsert がその 1 件で呼ばれる", () => {
    const { onInsert } = renderPanel();
    fireEvent.doubleClick(screen.getByRole("button", { name: "IMG_2.jpg" }));
    expect(onInsert).toHaveBeenCalledTimes(1);
    expect(onInsert).toHaveBeenCalledWith([R2]);
  });

  it("＋ボタンで onInsert が呼ばれる", () => {
    const { onInsert } = renderPanel();
    fireEvent.click(screen.getByRole("button", { name: "Put in note: IMG_3.jpg" }));
    expect(onInsert).toHaveBeenCalledWith([R3]);
  });

  it("チェックで 2 件選ぶと「選んだ 2 件」のボタンが出て、古い順で onInsert が呼ばれる", () => {
    const { onInsert } = renderPanel();
    // 新しい方から先に選んでも、渡るのは古い順
    fireEvent.click(screen.getByRole("checkbox", { name: "Select: IMG_3.jpg" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Select: IMG_2.jpg" }));
    fireEvent.click(screen.getByRole("button", { name: "Put 2 selected in note" }));
    expect(onInsert).toHaveBeenCalledTimes(1);
    expect(onInsert.mock.calls[0][0]).toEqual([R2, R3]);
    // 入れたあとは選択が解ける
    expect(screen.queryByRole("button", { name: /selected in note/ })).toBeNull();
  });

  it("Enter キーで onInsert が呼ばれる", () => {
    const { onInsert } = renderPanel();
    fireEvent.keyDown(screen.getByRole("button", { name: "IMG_1.jpg" }), { key: "Enter" });
    expect(onInsert).toHaveBeenCalledWith([R1]);
  });

  it("busyNames に入っているタイルのボタンは disabled", () => {
    renderPanel({ busyNames: new Set(["IMG_2.jpg"]) });
    expect((screen.getByRole("button", { name: "IMG_2.jpg" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "Put in note: IMG_2.jpg" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("checkbox", { name: "Select: IMG_2.jpg" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "IMG_1.jpg" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("dragstart で INBOX_DRAG_MIME に名前の JSON 配列を載せる", () => {
    renderPanel();
    const setData = vi.fn();
    fireEvent.dragStart(tileOf("IMG_1.jpg"), { dataTransfer: { setData, effectAllowed: "" } });
    expect(setData).toHaveBeenCalledWith(INBOX_DRAG_MIME, JSON.stringify(["IMG_1.jpg"]));
  });

  it("選んだタイルから引くと、選んだ全部を運ぶ（古い順）", () => {
    renderPanel();
    fireEvent.click(screen.getByRole("checkbox", { name: "Select: IMG_3.jpg" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Select: IMG_1.jpg" }));
    const setData = vi.fn();
    fireEvent.dragStart(tileOf("IMG_3.jpg"), { dataTransfer: { setData, effectAllowed: "" } });
    expect(setData).toHaveBeenCalledWith(INBOX_DRAG_MIME, JSON.stringify(["IMG_1.jpg", "IMG_3.jpg"]));
    // 選んでいないタイルから引くと、そのタイルだけ
    const setData2 = vi.fn();
    fireEvent.dragStart(tileOf("IMG_2.jpg"), { dataTransfer: { setData: setData2, effectAllowed: "" } });
    expect(setData2).toHaveBeenCalledWith(INBOX_DRAG_MIME, JSON.stringify(["IMG_2.jpg"]));
  });
});
