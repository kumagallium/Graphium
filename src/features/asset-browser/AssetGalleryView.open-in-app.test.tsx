// @vitest-environment jsdom
// 素材一覧のダブルクリックで「アプリで開く」のテスト。
//
// 対象の不変条件:
// - 一覧の行・ギャラリーのカードをダブルクリックすると、開ける素材（デスクトップ版の
//   ドキュメント）はアプリで開く
// - 開けない素材（canOpenInApp が false。ブラウザ版・画像など）では何もしない

import { describe, it, expect, vi, afterEach } from "vitest";
import { render, fireEvent, cleanup, screen } from "@testing-library/react";

vi.mock("react-pdf", () => ({
  pdfjs: { GlobalWorkerOptions: {} as Record<string, unknown> },
  Document: () => null,
  Page: () => null,
}));
vi.mock("../../lib/pdfjs-config", () => ({}));
vi.mock("../../base/editor", () => ({
  SandboxEditor: () => <div data-testid="fake-editor" />,
}));
vi.mock("../../lib/storage/registry", () => ({
  getActiveProvider: () => ({
    id: "filesystem",
    extractFileId: () => null,
    getMediaBlobUrl: async () => "",
  }),
}));
// デスクトップかどうかの判定と起動は差し替える（ドキュメントだけ開ける扱い）
const openInApp = vi.fn(async (_entry: unknown) => {});
vi.mock("./open-in-app", () => ({
  canOpenInApp: (entry: { type: string }) => entry.type === "document",
  openInApp: (entry: unknown) => openInApp(entry),
}));

import { LocaleProvider } from "../../i18n";
import { AssetGalleryView } from "./AssetGalleryView";
import type { MediaIndex, MediaIndexEntry, MediaType } from "./media-index";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

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

function entryOf(fileId: string, name: string, type: MediaType, mimeType: string): MediaIndexEntry {
  return {
    fileId,
    name,
    type,
    mimeType,
    url: `https://example.test/${name}`,
    thumbnailUrl: "",
    uploadedAt: "2026-01-03T00:00:00.000Z",
    usedIn: [],
  };
}

const DOCX = entryOf("doc-1", "bake-plan.docx", "document", "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
const PNG = entryOf("img-1", "crumb.png", "image", "image/png");

function renderView(mediaType: MediaType, media: MediaIndexEntry[]) {
  const index: MediaIndex = { version: 7, updatedAt: "2026-01-04T00:00:00.000Z", media };
  return render(
    <LocaleProvider>
      <AssetGalleryView
        mediaIndex={index}
        mediaType={mediaType}
        onBack={() => {}}
        onNavigateNote={() => {}}
        onDeleteMedia={async () => {}}
        onRenameMedia={async () => {}}
      />
    </LocaleProvider>,
  );
}

afterEach(() => {
  cleanup();
  localStorage.clear();
  openInApp.mockClear();
});

describe("素材一覧のダブルクリックでアプリで開く", () => {
  it("ドキュメント一覧の行をダブルクリックすると、その素材をアプリで開く", () => {
    renderView("document", [DOCX]);
    const row = screen.getAllByText("bake-plan.docx")[0].closest("tr");
    expect(row).not.toBeNull();
    fireEvent.doubleClick(row!);
    expect(openInApp).toHaveBeenCalledTimes(1);
    expect(openInApp).toHaveBeenCalledWith(expect.objectContaining({ fileId: "doc-1" }));
  });

  it("開けない素材（画像）のカードをダブルクリックしても何もしない", () => {
    renderView("image", [PNG]);
    const card = document.querySelector("button.block.w-full");
    expect(card).not.toBeNull();
    fireEvent.doubleClick(card!);
    expect(openInApp).not.toHaveBeenCalled();
  });
});
