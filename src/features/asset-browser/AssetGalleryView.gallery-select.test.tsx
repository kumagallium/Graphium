// @vitest-environment jsdom
// 素材ギャラリー表示（gallery モード）の複数選択のテスト。
//
// 対象の不変条件:
// - gallery のタイルにチェックボックスがあり、押すと選択バー（n / total）が出る
// - 選択バーの「チームに共有」は gallery でも出て、選んだ id の配列で呼ばれ、選択が解ける
// - ツールバーの「すべて選択」で全件選択 → もう一度押すと解除
// - 表示モード（gallery ⇄ list）を切り替えても選択は残る
//
// 文言は LocaleProvider の既定（jsdom の navigator.language → en）で照合する。

import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";

// 素材ピーク（MaterialSidePeek → MediaPreview → PdfViewer）が react-pdf を引くが、
// pdfjs は import しただけで DOMMatrix を触り jsdom で落ちる。描かないスタブに差し替える
vi.mock("react-pdf", () => ({
  pdfjs: { GlobalWorkerOptions: {} as Record<string, unknown> },
  Document: () => null,
  Page: () => null,
}));
vi.mock("../../lib/pdfjs-config", () => ({}));
// BlockNote 実体は jsdom で描けないので、本文は中身を持たない箱に差し替える
vi.mock("../../base/editor", () => ({
  SandboxEditor: () => <div data-testid="fake-editor" />,
}));
// サムネイルはストレージプロバイダを引く。テストでは登録していないので、
// 「Drive 等の外部 URL」と同じ扱い（extractFileId が null）になる代役を置く
vi.mock("../../lib/storage/registry", () => ({
  getActiveProvider: () => ({
    extractFileId: () => null,
    getMediaBlobUrl: async () => "",
  }),
}));

import { LocaleProvider } from "../../i18n";
import { AssetGalleryView } from "./AssetGalleryView";
import type { MediaIndex, MediaIndexEntry } from "./media-index";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// jsdom は matchMedia を持たない。useIsDesktop が落ちるので常に false（overlay）にする
if (!window.matchMedia) {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    }),
  });
}

class NoopObserver {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}
(globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= NoopObserver;
(globalThis as { IntersectionObserver?: unknown }).IntersectionObserver ??= NoopObserver;

function imageEntry(n: number, uploadedAt: string): MediaIndexEntry {
  return {
    fileId: `img-${n}`,
    name: `sample-${n}.png`,
    type: "image",
    mimeType: "image/png",
    url: `https://example.test/img-${n}.png`,
    thumbnailUrl: `https://example.test/img-${n}-thumb.png`,
    uploadedAt,
    usedIn: [],
  };
}

// 既定の並びは uploadedAt の降順なので、img-1 → img-2 → img-3 の順に出る
const MEDIA_INDEX: MediaIndex = {
  version: 7,
  updatedAt: "2026-01-04T00:00:00.000Z",
  media: [
    imageEntry(1, "2026-01-03T00:00:00.000Z"),
    imageEntry(2, "2026-01-02T00:00:00.000Z"),
    imageEntry(3, "2026-01-01T00:00:00.000Z"),
  ],
};

function renderGallery(onBulkShare?: (fileIds: string[]) => void) {
  return render(
    <LocaleProvider>
      <AssetGalleryView
        mediaIndex={MEDIA_INDEX}
        // image は既定が gallery 表示（localStorage に保存値が無い状態で開く）
        mediaType="image"
        onBack={() => {}}
        onNavigateNote={() => {}}
        onDeleteMedia={async () => {}}
        onRenameMedia={async () => {}}
        onBulkShare={onBulkShare}
      />
    </LocaleProvider>,
  );
}

/** タイル／行のチェックボックス（包む要素）を上から順に返す */
function checkboxCells(): HTMLElement[] {
  return screen.getAllByTitle("Drag to select a range");
}

/** チェックボックスを 1 つトグルする（mousedown で即トグル → mouseup で確定） */
function toggle(index: number): void {
  fireEvent.mouseDown(checkboxCells()[index], { button: 0 });
  fireEvent.mouseUp(window);
}

afterEach(() => {
  cleanup();
  localStorage.clear();
});

describe("ギャラリー表示の複数選択", () => {
  it("タイルのチェックボックスで選択すると選択バーが出る", () => {
    renderGallery();
    // 選択前はバーが無い
    expect(screen.queryByText("1 / 3")).toBeNull();

    expect(checkboxCells()).toHaveLength(3);
    toggle(0);

    expect(screen.getByText("1 / 3")).toBeTruthy();
  });

  it("2 件選んで「チームに共有」を押すと選択 id で呼ばれ、選択が解ける", () => {
    const shared: string[][] = [];
    renderGallery((ids) => shared.push(ids));

    toggle(0);
    toggle(1);
    expect(screen.getByText("2 / 3")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Share 2" }));

    expect(shared).toEqual([["img-1", "img-2"]]);
    // 共有はモーダルに引き継ぐので、バーごと選択が消える
    expect(screen.queryByText("2 / 3")).toBeNull();
  });

  it("ツールバーの「すべて選択」で全件選択 → もう一度で解除", () => {
    renderGallery();

    fireEvent.click(screen.getByTitle("Select all"));
    expect(screen.getByText("3 / 3")).toBeTruthy();

    // 全選択中はタイトルが「選択解除」に変わる（同じチェックボックス）
    fireEvent.click(screen.getByTitle("Deselect all"));
    expect(screen.queryByText("3 / 3")).toBeNull();
  });

  it("list → gallery に切り替えても選択は残る", () => {
    renderGallery();

    // list へ切り替えて 2 件選ぶ
    fireEvent.click(screen.getByTitle("List"));
    toggle(0);
    toggle(1);
    expect(screen.getByText("2 / 3")).toBeTruthy();

    // gallery に戻しても選択はそのまま
    fireEvent.click(screen.getByTitle("Gallery"));
    expect(screen.getByText("2 / 3")).toBeTruthy();
    const boxes = checkboxCells().map(
      (cell) => (cell.querySelector("input[type=checkbox]") as HTMLInputElement).checked,
    );
    expect(boxes).toEqual([true, true, false]);
  });
});
