// @vitest-environment jsdom
// 素材一覧（グリッドのカード・リストの行）のメモの印と小窓のテスト。
//
// 対象の不変条件:
// - captureIndex を渡すと、メモのある素材のカードに件数つきの印が出る（素材の「メモ」タブと同じ集合）
// - 0 件の素材は、書ける（onCreateMemoForAsset）ときだけ印を持つ（CSS の hover で出る）。
//   書けなくて 0 件なら印は無い。captureIndex が無ければ印は一切無い
// - 印を押すと素材の小窓が開く（見出し＝素材名）。カードを開く操作（サイドピーク）にはならない。
//   書くと onCreateMemoForAsset に素材と本文が渡る。「全画面で開く」で全画面ビューへ
// - リスト表示の行にも同じ印が出て、押しても行の「開く」にならない
// 文言は LocaleProvider の既定（jsdom → en）で照合する。

import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor, within } from "@testing-library/react";

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
    extractFileId: () => null,
    getMediaBlobUrl: async () => "",
  }),
}));

import { LocaleProvider } from "../../i18n";
import { AssetGalleryView } from "./AssetGalleryView";
import type { MediaIndex, MediaIndexEntry } from "./media-index";
import type { CaptureIndex } from "../mobile-capture";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// hover できる端末（マウス）として扱う。0 件の印は hover できる端末にだけ出る。
// それ以外の問い合わせ（画面幅など）は false のまま（useIsDesktop → overlay 表示）
if (!window.matchMedia) {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: (query: string) => ({
      matches: query.includes("hover: hover"),
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

const MEDIA_INDEX: MediaIndex = {
  version: 7,
  updatedAt: "2026-01-04T00:00:00.000Z",
  media: [
    imageEntry(1, "2026-01-03T00:00:00.000Z"),
    imageEntry(2, "2026-01-02T00:00:00.000Z"),
    imageEntry(3, "2026-01-01T00:00:00.000Z"),
  ],
};

const CAPTURES: CaptureIndex = {
  version: 1,
  updatedAt: "2026-10-30T00:00:00.000Z",
  captures: [
    { id: "m1", text: "粒界を確認", createdAt: "2026-10-30T10:00:00.000Z", sourceAsset: { fileId: "img-1", type: "image" } },
    { id: "m2", text: "倍率 5000", createdAt: "2026-10-30T09:00:00.000Z", sourceAsset: { fileId: "img-1", type: "image" } },
  ],
};

function renderGallery(props: Partial<React.ComponentProps<typeof AssetGalleryView>> = {}) {
  return render(
    <LocaleProvider>
      <AssetGalleryView
        mediaIndex={MEDIA_INDEX}
        mediaType="image"
        onBack={() => {}}
        onNavigateNote={() => {}}
        onDeleteMedia={async () => {}}
        onRenameMedia={async () => {}}
        {...props}
      />
    </LocaleProvider>,
  );
}

beforeEach(() => {
  try {
    localStorage.clear();
  } catch {
    // 無くても動く
  }
});
afterEach(cleanup);

function chipIds(): string[] {
  return Array.from(document.querySelectorAll("[data-memo-chip]")).map((el) => el.getAttribute("data-memo-chip") ?? "");
}

describe("素材一覧のメモの印（グリッド）", () => {
  it("メモのある素材には件数つきの印が出る。書けるなら 0 件の素材にも印がある", () => {
    renderGallery({ captureIndex: CAPTURES, onCreateMemoForAsset: vi.fn() });
    expect(screen.getByRole("button", { name: "2 memo(s)" }).textContent).toBe("2");
    expect(chipIds().sort()).toEqual(["gallery:img-1", "gallery:img-2", "gallery:img-3"]);
    // 0 件の印は CSS の hover で出る（普段は透明）
    const empty = screen.getAllByRole("button", { name: "Write a memo on this material" });
    expect(empty).toHaveLength(2);
    expect(empty[0].className).toContain("opacity-0");
  });

  it("書けなくて 0 件の素材には印が無い。captureIndex が無ければ印は一切出ない", () => {
    const { unmount } = renderGallery({ captureIndex: CAPTURES });
    expect(chipIds()).toEqual(["gallery:img-1"]);
    unmount();
    renderGallery();
    expect(chipIds()).toEqual([]);
  });

  it("印を押すと素材の小窓が開く。カードを開く（サイドピーク）にはならない", async () => {
    const onCreateMemoForAsset = vi.fn().mockResolvedValue(undefined);
    renderGallery({ captureIndex: CAPTURES, onCreateMemoForAsset });
    fireEvent.click(screen.getByRole("button", { name: "2 memo(s)" }));
    const dialog = await screen.findByRole("dialog", { name: "sample-1.png" });
    expect(within(dialog).getByText("粒界を確認")).toBeTruthy();
    expect(within(dialog).getByText("倍率 5000")).toBeTruthy();
    // サイドピーク（素材の詳細）は開いていない
    expect(document.querySelector("[data-side-peek]")).toBeNull();

    const box = within(dialog).getByRole("textbox");
    fireEvent.change(box, { target: { value: "新しいメモ" } });
    fireEvent.keyDown(box, { key: "Enter" });
    await waitFor(() =>
      expect(onCreateMemoForAsset).toHaveBeenCalledWith(expect.objectContaining({ fileId: "img-1" }), "新しいメモ"),
    );
  });

  it("小窓の「全画面で開く」で素材の全画面ビューへ移る", async () => {
    renderGallery({ captureIndex: CAPTURES, onCreateMemoForAsset: vi.fn() });
    fireEvent.click(screen.getByRole("button", { name: "2 memo(s)" }));
    const dialog = await screen.findByRole("dialog", { name: "sample-1.png" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Open full screen" }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "sample-1.png" })).toBeNull());
    // 全画面ビューは一覧のカードを置き換える
    await waitFor(() => expect(chipIds()).toEqual([]));
  });

  it("開いている素材（サイドピーク・全画面）が変わったら onViewingEntryChange で伝える", async () => {
    const onViewingEntryChange = vi.fn();
    renderGallery({ captureIndex: CAPTURES, onCreateMemoForAsset: vi.fn(), onViewingEntryChange });
    // 初回は null
    expect(onViewingEntryChange).toHaveBeenLastCalledWith(null);
    fireEvent.click(screen.getByRole("button", { name: "2 memo(s)" }));
    await screen.findByRole("dialog");
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Open full screen" }));
    await waitFor(() =>
      expect(onViewingEntryChange).toHaveBeenLastCalledWith(expect.objectContaining({ fileId: "img-1" })),
    );
  });
});

describe("素材一覧のメモの印（リスト）", () => {
  it("行にも件数つきの印が出て、押しても行の「開く」にならない", async () => {
    localStorage.setItem("graphium:assetViewModeByType", JSON.stringify({ image: "list" }));
    renderGallery({ captureIndex: CAPTURES, onCreateMemoForAsset: vi.fn() });
    const chip = screen.getByRole("button", { name: "2 memo(s)" });
    expect(chip.closest("tr")).not.toBeNull();
    fireEvent.click(chip);
    await screen.findByRole("dialog", { name: "sample-1.png" });
    expect(document.querySelector("[data-side-peek]")).toBeNull();
  });
});
