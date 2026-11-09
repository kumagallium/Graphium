// @vitest-environment jsdom
// FileSidebar の「メモ」入口のテスト。
// 上段（「+ ノート」と「ファイル取り込み」）には「+ メモ」を置かず、
// メモは素材の節の「メモ」行の ＋ から作る（design.md 2026-10-20）。

import { describe, it, expect, afterEach, vi } from "vitest";
import { render, fireEvent, cleanup, screen } from "@testing-library/react";
// FileSidebar → PdfViewer → react-pdf が jsdom に無い DOMMatrix を要求するので差し替える
vi.mock("react-pdf", () => ({ Document: () => null, Page: () => null, pdfjs: { GlobalWorkerOptions: {} } }));
vi.mock("react-pdf/dist/Page/TextLayer.css", () => ({}));

import { FileSidebar, type FileSidebarProps } from "./FileSidebar";
import { LocaleProvider } from "../i18n";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => {
  cleanup();
  // タブの選択・節の開閉は localStorage に残るので、テスト間に持ち越さない
  localStorage.clear();
  sessionStorage.clear();
});

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
    const { queryByText } = renderSidebar({ defaultTab: "materials", onNewMemo: () => {}, onOpenIntake: () => {} });
    expect(queryByText("+ メモ")).toBeNull();
    expect(queryByText("+ Memo")).toBeNull();
  });

  it("メモ行の ＋ を押すと onNewMemo が呼ばれ、一覧は開かない", () => {
    const onNewMemo = vi.fn();
    const onShowMemos = vi.fn();
    const { container } = renderSidebar({ defaultTab: "materials", onNewMemo, onShowMemos });
    const plus = container.querySelector<HTMLButtonElement>('button[data-tooltip*="M"][aria-label]');
    expect(plus).not.toBeNull();
    fireEvent.click(plus!);
    expect(onNewMemo).toHaveBeenCalledTimes(1);
    expect(onShowMemos).not.toHaveBeenCalled();
  });

  it("0 件でもメモ行は出て、数字は出さない", () => {
    const { container } = renderSidebar({ defaultTab: "materials", onNewMemo: () => {}, memoCount: 0 });
    const row = container.querySelector(".group.relative");
    expect(row).not.toBeNull();
    expect(row!.textContent).not.toMatch(/\d/);
  });

  // 件数と ＋ は同じ右端に来るので、＋ が出ている間は重ならないようにする（PR #1412 の図で発覚）
  function memoRow(container: HTMLElement) {
    const button = container.querySelector<HTMLButtonElement>(".group.relative > button:not([aria-label])")!;
    const count = Array.from(button.querySelectorAll("span")).find((s) => s.textContent === "3")!;
    return { button, count };
  }

  it("選択中は ＋ を出したまま、件数をその左に置く（hover でも隠さない）", () => {
    const { container } = renderSidebar({ defaultTab: "materials", onNewMemo: () => {}, memoCount: 3, memosActive: true });
    const { button, count } = memoRow(container);
    expect(button.className).toMatch(/(^|\s)pr-7(\s|$)/);
    expect(button.className).not.toContain("md:pr-2");
    expect(count.className).not.toContain("invisible");
  });

  it("選択していないときは hover で件数と ＋ を入れ替え、hover の無い幅では ＋ の分を空ける", () => {
    const { container } = renderSidebar({ defaultTab: "materials", onNewMemo: () => {}, memoCount: 3 });
    const { button, count } = memoRow(container);
    expect(button.className).toContain("pr-7 md:pr-2");
    expect(count.className).toContain("md:group-hover:invisible");
  });

  it("onNewMemo が無ければ ＋ は出さない", () => {
    const { container } = renderSidebar({ defaultTab: "materials" });
    expect(container.querySelector(".group.relative button[aria-label]")).toBeNull();
  });
});

describe("FileSidebar のタブ", () => {
  it("タブを押すと中身が切り替わる（ノート → 素材でメモ行が出る）", () => {
    const { container } = renderSidebar({ onNewMemo: () => {} });
    expect(container.querySelector(".group.relative")).toBeNull();
    fireEvent.click(screen.getByRole("tab", { name: /素材|Materials/i }));
    expect(container.querySelector(".group.relative")).not.toBeNull();
  });

  it("タブを押しても右の画面は切り替えない", () => {
    const onShowMemos = vi.fn();
    const onShowAssetGallery = vi.fn();
    renderSidebar({ onShowMemos, onShowAssetGallery });
    fireEvent.click(screen.getByRole("tab", { name: /素材|Materials/i }));
    expect(onShowMemos).not.toHaveBeenCalled();
    expect(onShowAssetGallery).not.toHaveBeenCalled();
  });

  it("onOpenSearch を渡すと検索ボタンが出て、押すと呼ばれる", () => {
    const onOpenSearch = vi.fn();
    renderSidebar({ onOpenSearch });
    fireEvent.click(screen.getByRole("button", { name: /検索|Search/ }));
    expect(onOpenSearch).toHaveBeenCalledTimes(1);
  });

  it("onOpenSearch を渡さなければ検索ボタンは出ない", () => {
    renderSidebar();
    expect(screen.queryByRole("button", { name: /検索|Search/ })).toBeNull();
  });

  it("AI が使えずナレッジも無いときはナレッジのタブが出ない", () => {
    renderSidebar({ onShowWikiList: () => {}, aiAvailable: true, agentConfigured: false });
    expect(screen.getAllByRole("tab")).toHaveLength(2);
    expect(screen.queryByRole("tab", { name: /ナレッジ|Knowledge/ })).toBeNull();
  });

  it("AI が使えればナレッジのタブが出る", () => {
    renderSidebar({ onShowWikiList: () => {}, aiAvailable: true, agentConfigured: true });
    expect(screen.getAllByRole("tab")).toHaveLength(3);
  });

  it("activeAssetType が null → image に変わると素材タブに切り替わる", () => {
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
    } as unknown as FileSidebarProps;
    const ui = (extra: Partial<FileSidebarProps>) => (
      <LocaleProvider>
        <FileSidebar {...props} {...extra} />
      </LocaleProvider>
    );
    const { rerender } = render(ui({}));
    expect(screen.getByRole("tab", { name: /ノート|Notes/ }).getAttribute("aria-selected")).toBe("true");
    rerender(ui({ activeAssetType: "image" }));
    expect(screen.getByRole("tab", { name: /素材|Materials/ }).getAttribute("aria-selected")).toBe("true");
    // 画面はそのままでも、手でタブを戻せる（署名が変わらないので戻されない）
    fireEvent.click(screen.getByRole("tab", { name: /ノート|Notes/ }));
    expect(screen.getByRole("tab", { name: /ノート|Notes/ }).getAttribute("aria-selected")).toBe("true");
  });

  it('layout: "sections" ではタブが出ない', () => {
    renderSidebar({ layout: "sections" });
    expect(screen.queryByRole("tablist")).toBeNull();
  });

  it("チャットの行がヘッダーに出て、押すと onShowChatList が呼ばれる", () => {
    const onShowChatList = vi.fn();
    renderSidebar({ onShowChatList, chatCount: 12 });
    const row = screen.getByRole("button", { name: /チャット|Chat/ });
    expect(row.textContent).toContain("12");
    fireEvent.click(row);
    expect(onShowChatList).toHaveBeenCalledTimes(1);
  });

  it('layout: "sections" では onOpenSearch を渡しても検索ボタンが出ない', () => {
    renderSidebar({ layout: "sections", onOpenSearch: () => {} });
    expect(screen.queryByRole("button", { name: /検索|Search/ })).toBeNull();
  });

  it("selectedFolder が残ったまま activeWikiKind が topic → null になってもナレッジのタブのまま", () => {
    const base = {
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
      onShowWikiList: () => {},
      aiAvailable: true,
      selectedFolder: "X",
    } as unknown as FileSidebarProps;
    const ui = (extra: Partial<FileSidebarProps>) => (
      <LocaleProvider>
        <FileSidebar {...base} {...extra} />
      </LocaleProvider>
    );
    const { rerender } = render(ui({ activeWikiKind: "topic" }));
    expect(screen.getByRole("tab", { name: /ナレッジ|Knowledge/ }).getAttribute("aria-selected")).toBe("true");
    rerender(ui({ activeWikiKind: null }));
    expect(screen.getByRole("tab", { name: /ナレッジ|Knowledge/ }).getAttribute("aria-selected")).toBe("true");
  });

  it("再マウントしても、画面が同じなら手で選んだタブは戻されない", () => {
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
      activeAssetType: "image",
      activeLabel: null,
      onShowWikiList: () => {},
      aiAvailable: true,
    } as unknown as FileSidebarProps;
    const ui = (
      <LocaleProvider>
        <FileSidebar {...props} />
      </LocaleProvider>
    );
    const first = render(ui);
    expect(screen.getByRole("tab", { name: /素材|Materials/ }).getAttribute("aria-selected")).toBe("true");
    fireEvent.click(screen.getByRole("tab", { name: /ナレッジ|Knowledge/ }));
    first.unmount();
    render(ui);
    expect(screen.getByRole("tab", { name: /ナレッジ|Knowledge/ }).getAttribute("aria-selected")).toBe("true");
  });

  it("→ キーで隣のタブが選ばれ、端では折り返す", () => {
    renderSidebar({ onShowWikiList: () => {}, aiAvailable: true, agentConfigured: true, defaultTab: "notes" });
    fireEvent.keyDown(screen.getByRole("tab", { name: /ノート|Notes/ }), { key: "ArrowRight" });
    expect(screen.getByRole("tab", { name: /ナレッジ|Knowledge/ }).getAttribute("aria-selected")).toBe("true");
    fireEvent.keyDown(screen.getByRole("tab", { name: /ナレッジ|Knowledge/ }), { key: "End" });
    fireEvent.keyDown(screen.getByRole("tab", { name: /素材|Materials/ }), { key: "ArrowRight" });
    expect(screen.getByRole("tab", { name: /ノート|Notes/ }).getAttribute("aria-selected")).toBe("true");
  });

  it("共有フォルダの行が 3 つのタブの一番下に出て、押すとタブごとの種類で呼ばれる", () => {
    const onShowSharedLibrary = vi.fn();
    renderSidebar({ onShowSharedLibrary, onShowWikiList: () => {}, aiAvailable: true, agentConfigured: true });
    const sharedBtn = () => screen.getByRole("button", { name: /共有フォルダ|Shared folder/ });
    fireEvent.click(sharedBtn());
    expect(onShowSharedLibrary).toHaveBeenLastCalledWith("note");
    fireEvent.click(screen.getByRole("tab", { name: /ナレッジ|Knowledge/ }));
    fireEvent.click(sharedBtn());
    expect(onShowSharedLibrary).toHaveBeenLastCalledWith("knowledge");
    fireEvent.click(screen.getByRole("tab", { name: /素材|Materials/ }));
    fireEvent.click(sharedBtn());
    expect(onShowSharedLibrary).toHaveBeenLastCalledWith("asset");
  });

  it("onShowSharedLibrary が無ければどのタブにも共有フォルダの行は出ない", () => {
    renderSidebar({ onShowWikiList: () => {}, aiAvailable: true, agentConfigured: true });
    for (const name of [/ノート|Notes/, /ナレッジ|Knowledge/, /素材|Materials/]) {
      fireEvent.click(screen.getByRole("tab", { name }));
      expect(screen.queryByRole("button", { name: /共有フォルダ|Shared folder/ })).toBeNull();
    }
  });

  it("ナレッジのタブで sharedLibraryActive が true になってもタブは動かない", () => {
    const base = {
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
      onShowWikiList: () => {},
      onShowSharedLibrary: () => {},
      aiAvailable: true,
    } as unknown as FileSidebarProps;
    const ui = (extra: Partial<FileSidebarProps>) => (
      <LocaleProvider>
        <FileSidebar {...base} {...extra} />
      </LocaleProvider>
    );
    const { rerender } = render(ui({ sharedLibraryActive: false }));
    fireEvent.click(screen.getByRole("tab", { name: /ナレッジ|Knowledge/ }));
    rerender(ui({ sharedLibraryActive: true }));
    expect(screen.getByRole("tab", { name: /ナレッジ|Knowledge/ }).getAttribute("aria-selected")).toBe("true");
  });

  it("sections では共有フォルダの行は引数無しで呼ばれる", () => {
    const onShowSharedLibrary = vi.fn();
    // sections では共有フォルダの節は既定で畳まれているので開いておく
    localStorage.setItem("graphium-sidebar-section:library", "1");
    renderSidebar({ layout: "sections", onShowSharedLibrary });
    fireEvent.click(screen.getByRole("button", { name: /共有フォルダ|Shared folder/ }));
    expect(onShowSharedLibrary).toHaveBeenCalledWith();
  });

  it("ノートのタブでは共有フォルダの行が「すべてのノート」より前にある", () => {
    const { container } = renderSidebar({
      onShowSharedLibrary: () => {},
      onSelectFolder: () => {},
    });
    const shared = screen.getByRole("button", { name: /共有フォルダ|Shared folder/ });
    const allNotes = screen.getByText(/すべてのノート|All Notes/);
    expect(container.contains(allNotes)).toBe(true);
    expect(shared.compareDocumentPosition(allNotes) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("ノートのタブではラベルの節が「すべてのノート」（伸びるフォルダの一覧）より前にある", () => {
    // ラベルは数行で長さが決まっている。フォルダの下に置くと押し出されて見えなくなる
    const noteIndex = {
      notes: [
        { noteId: "n1", title: "Baguette", labels: [{ label: "material", preview: "flour" }] },
      ],
    } as unknown as FileSidebarProps["noteIndex"];
    renderSidebar({ noteIndex, onSelectFolder: () => {} });
    const labels = screen.getByText(/^ラベル$|^Labels$/);
    const allNotes = screen.getByText(/すべてのノート|All Notes/);
    expect(labels.compareDocumentPosition(allNotes) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});
