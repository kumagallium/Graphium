// @vitest-environment jsdom
// FolderTree の最上位フォルダ上限（maxTopLevel）のテスト。

import { describe, it, expect, afterEach } from "vitest";
import { render, fireEvent, cleanup, screen } from "@testing-library/react";
import { FolderTree } from "./FolderTree";
import { LocaleProvider } from "../../i18n";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => {
  cleanup();
  localStorage.clear();
});

// f01〜f12 の 12 フォルダ（名前順に並ぶ）
const folders = Array.from({ length: 12 }, (_, i) => ({
  value: `f${String(i + 1).padStart(2, "0")}`,
  count: 1,
}));

function renderTree(extra: Partial<React.ComponentProps<typeof FolderTree>> = {}) {
  return render(
    <LocaleProvider>
      <FolderTree folders={folders} unfiledCount={2} onCreateFolder={() => {}} {...extra} />
    </LocaleProvider>,
  );
}

const folderButtons = () => screen.queryAllByRole("button", { name: /^f\d\d/ });

describe("FolderTree の maxTopLevel", () => {
  it("上限を超えると 8 件と「残り 4 件を表示」を出し、押すと 12 件になる", () => {
    renderTree({ maxTopLevel: 8 });
    expect(folderButtons()).toHaveLength(8);
    fireEvent.click(screen.getByRole("button", { name: /残り 4 件を表示|Show 4 more/ }));
    expect(folderButtons()).toHaveLength(12);
    expect(screen.getByRole("button", { name: /少なく表示|Show less/ })).not.toBeNull();
    expect(localStorage.getItem("graphium-sidebar-folders-show-all")).toBe("1");
  });

  it("「少なく表示」で 8 件に戻る", () => {
    localStorage.setItem("graphium-sidebar-folders-show-all", "1");
    renderTree({ maxTopLevel: 8 });
    expect(folderButtons()).toHaveLength(12);
    fireEvent.click(screen.getByRole("button", { name: /少なく表示|Show less/ }));
    expect(folderButtons()).toHaveLength(8);
    expect(localStorage.getItem("graphium-sidebar-folders-show-all")).toBe("0");
  });

  it("選択中のフォルダが隠れる側（10 件目）なら、最初から全部出す", () => {
    renderTree({ maxTopLevel: 8, selected: "f10" });
    expect(folderButtons()).toHaveLength(12);
  });

  it("maxTopLevel が無ければ全部出し、ボタンも出さない", () => {
    renderTree();
    expect(folderButtons()).toHaveLength(12);
    expect(screen.queryByRole("button", { name: /残り|Show/ })).toBeNull();
  });

  it("未分類の行は上限に数えず常に出る", () => {
    renderTree({ maxTopLevel: 8 });
    expect(screen.getByRole("button", { name: /未分類|Unfiled/ })).not.toBeNull();
  });

  // フォルダ作成: 「＋ 新しいフォルダ」→ 名前入力 → Enter
  function createFolder(name: string) {
    fireEvent.click(screen.getByRole("button", { name: /^(新しいフォルダ|New folder)$/ }));
    const input = screen.getByRole("textbox");
    fireEvent.change(input, { target: { value: name } });
    fireEvent.keyDown(input, { key: "Enter" });
  }

  it("maxTopLevel 無しで作成しても show-all は書かれない", () => {
    renderTree();
    createFolder("zzz");
    expect(localStorage.getItem("graphium-sidebar-folders-show-all")).toBeNull();
  });

  it("フォルダ 3 つ・maxTopLevel=8 で作成しても書かれない", () => {
    renderTree({ folders: folders.slice(0, 3), maxTopLevel: 8 });
    createFolder("zzz");
    expect(localStorage.getItem("graphium-sidebar-folders-show-all")).toBeNull();
  });

  it("12 個・maxTopLevel=8 で作成すると全部表示になる", () => {
    renderTree({ maxTopLevel: 8 });
    createFolder("zzz");
    expect(localStorage.getItem("graphium-sidebar-folders-show-all")).toBe("1");
    expect(folderButtons().length).toBeGreaterThan(8);
  });
});

describe("FolderTree の並び", () => {
  it("中身のノートが多いフォルダから並ぶ（同数は名前順）", () => {
    render(
      <LocaleProvider>
        <FolderTree
          folders={[
            { value: "f01", count: 1 },
            { value: "f02", count: 5 },
            { value: "f03", count: 1 },
          ]}
        />
      </LocaleProvider>,
    );
    expect(folderButtons().map((b) => b.textContent?.match(/f\d\d/)?.[0])).toEqual(["f02", "f01", "f03"]);
  });
});
