// @vitest-environment jsdom
// 素材詳細ヘッダのフォルダ行のテスト。
//
// 対象の不変条件:
// - 自分で付けたフォルダは × で出せる。出すと、その素材だけに「そのフォルダを除く」編集が渡る
// - 使っているノートから引き継いだフォルダ（導出）には × を付けない
// - 「＋ フォルダ」のピッカーで新しい名前を入れると、その素材に付ける編集が渡る
// - 付け外しの手段が渡らない文脈（メモのピーク等）では「＋ フォルダ」を出さず、何も無ければ行ごと出さない
// - 開いた時点の entry が古くても、フォルダは最新のインデックスから読む
//
// 文言は LocaleProvider の既定（jsdom の navigator.language → en）で照合する。

import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";

// アクションメニューの先で react-pdf を引くが、pdfjs は import しただけで DOMMatrix を触り
// jsdom で落ちる。描かないスタブに差し替える（ギャラリーのテストと同じ）
vi.mock("react-pdf", () => ({
  pdfjs: { GlobalWorkerOptions: {} as Record<string, unknown> },
  Document: () => null,
  Page: () => null,
}));
vi.mock("../../lib/pdfjs-config", () => ({}));
// アクションメニューが共有ストレージのプロバイダを引く。テストでは登録していないので代役を置く
vi.mock("../../lib/storage/registry", () => ({
  getActiveProvider: () => ({
    extractFileId: () => null,
    getMediaBlobUrl: async () => "",
  }),
}));

import { LocaleProvider } from "../../i18n";
import { MaterialDetailHeader } from "./material-detail-header";
import { buildNoteFolderLookup } from "./asset-folders";
import type { EditMediaContexts, MediaIndex, MediaIndexEntry } from "./media-index";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(cleanup);

const ENTRY: MediaIndexEntry = {
  fileId: "img-1",
  name: "crumb.jpg",
  type: "image",
  mimeType: "image/jpeg",
  url: "https://example.test/crumb.jpg",
  thumbnailUrl: "",
  uploadedAt: "2026-09-01T00:00:00.000Z",
  usedIn: [{ noteId: "n1", noteTitle: "Bake day", blockId: "b1" }],
  noteContexts: ["Sourdough"],
};

// n1 のノートは Baking フォルダに入っている → 素材には Baking が導出で付いて見える
const LOOKUP = buildNoteFolderLookup([{ noteId: "n1", noteContexts: ["Baking"] }]);

function renderHeader(opts: {
  entry?: MediaIndexEntry;
  mediaIndex?: MediaIndex | null;
  onEditFolders?: EditMediaContexts;
}) {
  return render(
    <LocaleProvider>
      <MaterialDetailHeader
        entry={opts.entry ?? ENTRY}
        mediaIndex={opts.mediaIndex}
        noteFolderLookup={LOOKUP}
        onEditFolders={opts.onEditFolders}
        onClose={() => {}}
      />
    </LocaleProvider>,
  );
}

describe("MaterialDetailHeader のフォルダ行", () => {
  it("自分で付けたフォルダは × で出せる（その素材だけに除く編集が渡る）", () => {
    const onEditFolders = vi.fn<EditMediaContexts>();
    renderHeader({ onEditFolders });

    fireEvent.click(screen.getByRole("button", { name: 'Remove from "Sourdough"' }));

    expect(onEditFolders).toHaveBeenCalledTimes(1);
    const [fileIds, edit] = onEditFolders.mock.calls[0];
    expect(fileIds).toEqual(["img-1"]);
    // 編集はその時点の値に当てる形。ほかのフォルダは残す
    expect(edit(["Sourdough", "Rye"])).toEqual(["Rye"]);
  });

  it("ノートから引き継いだフォルダには × を付けない", () => {
    renderHeader({ onEditFolders: vi.fn<EditMediaContexts>() });
    expect(screen.getByText("Baking")).toBeTruthy();
    expect(screen.queryByRole("button", { name: 'Remove from "Baking"' })).toBeNull();
  });

  it("「＋ フォルダ」から新しいフォルダを作って付けられる", () => {
    const onEditFolders = vi.fn<EditMediaContexts>();
    renderHeader({ onEditFolders });

    fireEvent.click(screen.getByRole("button", { name: /Folder/ }));
    const input = screen.getByPlaceholderText("Search folders, or type to create…");
    fireEvent.change(input, { target: { value: "Rye" } });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(onEditFolders).toHaveBeenCalledTimes(1);
    const [fileIds, edit] = onEditFolders.mock.calls[0];
    expect(fileIds).toEqual(["img-1"]);
    expect(edit(["Sourdough"])).toEqual(["Sourdough", "Rye"]);
  });

  it("付け外しの手段が無ければ「＋ フォルダ」も × も出さない", () => {
    renderHeader({});
    expect(screen.getByText("Sourdough")).toBeTruthy();
    expect(screen.queryByRole("button", { name: 'Remove from "Sourdough"' })).toBeNull();
    expect(screen.queryByRole("button", { name: /Folder/ })).toBeNull();
  });

  it("付け外しの手段も表示するフォルダも無ければ、行ごと出さない", () => {
    const { container } = renderHeader({
      entry: { ...ENTRY, usedIn: [], noteContexts: undefined },
    });
    expect(container.querySelector("[data-material-folder-row]")).toBeNull();
  });

  it("開いた時点の entry が古くても、最新のインデックスのフォルダを出す", () => {
    const mediaIndex: MediaIndex = {
      version: 7,
      updatedAt: "2026-09-02T00:00:00.000Z",
      media: [{ ...ENTRY, noteContexts: ["Rye"] }],
    };
    renderHeader({ mediaIndex, onEditFolders: vi.fn<EditMediaContexts>() });
    expect(screen.getByRole("button", { name: 'Remove from "Rye"' })).toBeTruthy();
    expect(screen.queryByText("Sourdough")).toBeNull();
  });
});
