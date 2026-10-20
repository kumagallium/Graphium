// @vitest-environment jsdom
// FileSidebar の「メモ」入口のテスト。
// 上段（「+ ノート」と「ファイル取り込み」）には「+ メモ」を置かず、
// メモは素材の節の「メモ」行の ＋ から作る（design.md 2026-10-20）。

import { describe, it, expect, afterEach, vi } from "vitest";
import { render, fireEvent, cleanup } from "@testing-library/react";
// FileSidebar → PdfViewer → react-pdf が jsdom に無い DOMMatrix を要求するので差し替える
vi.mock("react-pdf", () => ({ Document: () => null, Page: () => null, pdfjs: { GlobalWorkerOptions: {} } }));
vi.mock("react-pdf/dist/Page/TextLayer.css", () => ({}));

import { FileSidebar, type FileSidebarProps } from "./FileSidebar";
import { LocaleProvider } from "../i18n";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(cleanup);

function renderSidebar(extra: Partial<FileSidebarProps> = {}) {
  const props = {
    activeFileId: null,
    onSelect: () => {},
    onNewNote: () => {},
    onRefresh: () => {},
    onShowReleaseNotes: () => {},
    onShowSettings: () => {},
    agentConfigured: true,
    recentNotes: [],
    onShowNoteList: () => {},
    onShowAssetGallery: () => {},
    onShowLabelGallery: () => {},
    activeAssetType: null,
    activeLabel: null,
    onShowMemos: () => {},
    ...extra,
  } as unknown as FileSidebarProps;
  return render(
    <LocaleProvider>
      <FileSidebar {...props} />
    </LocaleProvider>,
  );
}

describe("FileSidebar のメモ入口", () => {
  it("上段に「+ メモ」ボタンは無い", () => {
    const { queryByText } = renderSidebar({ onNewMemo: () => {}, onOpenIntake: () => {} });
    expect(queryByText("+ メモ")).toBeNull();
    expect(queryByText("+ Memo")).toBeNull();
  });

  it("メモ行の ＋ を押すと onNewMemo が呼ばれ、一覧は開かない", () => {
    const onNewMemo = vi.fn();
    const onShowMemos = vi.fn();
    const { container } = renderSidebar({ onNewMemo, onShowMemos });
    const plus = container.querySelector<HTMLButtonElement>('button[data-tooltip*="M"][aria-label]');
    expect(plus).not.toBeNull();
    fireEvent.click(plus!);
    expect(onNewMemo).toHaveBeenCalledTimes(1);
    expect(onShowMemos).not.toHaveBeenCalled();
  });

  it("0 件でもメモ行は出て、数字は出さない", () => {
    const { container } = renderSidebar({ onNewMemo: () => {}, memoCount: 0 });
    const row = container.querySelector(".group.relative");
    expect(row).not.toBeNull();
    expect(row!.textContent).not.toMatch(/\d/);
  });

  it("onNewMemo が無ければ ＋ は出さない", () => {
    const { container } = renderSidebar();
    expect(container.querySelector(".group.relative button[aria-label]")).toBeNull();
  });
});
