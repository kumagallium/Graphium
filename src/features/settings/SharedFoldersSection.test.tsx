// @vitest-environment jsdom
// 設定 → 共有 の共有フォルダ一覧（§26・1 行 1 フォルダの形）。文言は既定の en で照合する。
// - 追加するとフォルダ名を初期値にした名前の入力が出て、確定すると保存される。1 件目が既定のまま
// - 「既定の共有先にする」「名前を変える」「外す」は行の ⋯ メニューから。外すは確認してから
// - 同じフォルダは二度登録しない
// - 状態の印（つながっている・届かない）と中身の件数を行に出す
// - 行を押すと、場所・置き場・接続の確認が開く

import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor, within } from "@testing-library/react";
import { LocaleProvider } from "../../i18n";
import { SharedFoldersSection, type SharedFoldersSectionProps } from "./SharedFoldersSection";
import { createSharedFolder, getSharedFolders, setSharedFolders, type SharedEntry } from "../../lib/storage/shared";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

beforeEach(() => localStorage.clear());
afterEach(() => cleanup());

function renderSection(test: SharedFoldersSectionProps["__test"] = {}, onChange = vi.fn()) {
  render(
    <LocaleProvider>
      <SharedFoldersSection
        onChange={onChange}
        __test={{ checkReachable: async () => true, entries: { entries: [], entryRoots: {} }, ...test }}
      />
    </LocaleProvider>,
  );
  return onChange;
}

const rows = () => screen.getAllByTestId("shared-folder-card");
const openMenu = (row: HTMLElement) => fireEvent.click(within(row).getByRole("button", { name: /^Actions for/ }));

describe("SharedFoldersSection", () => {
  it("未登録なら案内と「フォルダを選択」。選ぶとフォルダ名を初期値に名前を聞き、確定で保存する", async () => {
    const onChange = renderSection({ pickFolder: async () => "/Volumes/Org" });
    expect(screen.getByText(/No shared folder yet/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Choose folder" }));
    const input = (await screen.findByLabelText("Shared folder name")) as HTMLInputElement;
    expect(input.value).toBe("Org");
    fireEvent.change(input, { target: { value: "Whole organization" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(getSharedFolders()[0]).toMatchObject({ root: "/Volumes/Org", name: "Whole organization" });
    expect(onChange).toHaveBeenCalled();
    expect(localStorage.getItem("graphium-shared-root")).toBe("/Volumes/Org");
  });

  it("2 件目を足しても既定の共有先は 1 件目のまま、既定の印は 1 件目に出る", async () => {
    setSharedFolders([createSharedFolder("/Volumes/Org", "Org")]);
    renderSection({ pickFolder: async () => "/Volumes/TeamA" });
    fireEvent.click(screen.getByRole("button", { name: "Add a shared folder" }));
    await waitFor(() => expect(getSharedFolders()).toHaveLength(2));
    expect(getSharedFolders()[0].root).toBe("/Volumes/Org");
    expect(within(rows()[0]).getByText("Default")).toBeTruthy();
  });

  it("同じフォルダは二度登録しない", async () => {
    setSharedFolders([createSharedFolder("/Volumes/Org", "Org")]);
    renderSection({ pickFolder: async () => "/Volumes/Org" });
    fireEvent.click(screen.getByRole("button", { name: "Add a shared folder" }));
    await screen.findByText("This folder is already added.");
    expect(getSharedFolders()).toHaveLength(1);
  });

  it("⋯ の「既定の共有先にする」で先頭へ移る（既定のフォルダのメニューには出さない）", () => {
    setSharedFolders([createSharedFolder("/Volumes/Org", "Org"), createSharedFolder("/Volumes/TeamA", "Team A")]);
    renderSection();
    openMenu(rows()[0]);
    expect(screen.queryByRole("button", { name: "Make default" })).toBeNull();
    fireEvent.keyDown(document, { key: "Escape" });
    openMenu(rows()[1]);
    fireEvent.click(screen.getByRole("button", { name: "Make default" }));
    expect(getSharedFolders().map((f) => f.name)).toEqual(["Team A", "Org"]);
    expect(localStorage.getItem("graphium-shared-root")).toBe("/Volumes/TeamA");
  });

  it("⋯ の「名前を変える」で名前の入力に変わり、外側で確定する", () => {
    setSharedFolders([createSharedFolder("/Volumes/Org", "Org")]);
    renderSection();
    openMenu(rows()[0]);
    fireEvent.click(screen.getByRole("button", { name: "Rename" }));
    const input = screen.getByLabelText("Shared folder name");
    fireEvent.change(input, { target: { value: "Whole organization" } });
    fireEvent.blur(input);
    expect(getSharedFolders()[0].name).toBe("Whole organization");
  });

  it("⋯ の「外す」は確認してから", () => {
    setSharedFolders([createSharedFolder("/Volumes/Org", "Org"), createSharedFolder("/Volumes/TeamA", "Team A")]);
    renderSection();
    openMenu(rows()[1]);
    fireEvent.click(screen.getByRole("button", { name: "Remove" }));
    expect(getSharedFolders()).toHaveLength(2);
    screen.getByText(/only removes it from Graphium/);
    fireEvent.click(screen.getByRole("button", { name: "Remove" }));
    expect(getSharedFolders().map((f) => f.name)).toEqual(["Org"]);
  });

  it("状態の印と中身の件数を行に出す", async () => {
    setSharedFolders([createSharedFolder("/Volumes/Org", "Org"), createSharedFolder("/Volumes/TeamA", "Team A")]);
    const e = (id: string, type: SharedEntry["type"]) => ({ id, type }) as SharedEntry;
    renderSection({
      checkReachable: async (root) => root === "/Volumes/Org",
      entries: {
        entries: [e("n1", "note"), e("n2", "note"), e("t1", "template"), e("c1", "comment")],
        entryRoots: { n1: "/Volumes/TeamA", n2: "/Volumes/TeamA", t1: "/Volumes/Org", c1: "/Volumes/TeamA" },
      },
    });
    await waitFor(() => expect(within(rows()[1]).getByText("Can't reach")).toBeTruthy());
    expect(within(rows()[0]).getByText("Connected")).toBeTruthy();
    expect(within(rows()[0]).getByText("Templates 1")).toBeTruthy();
    // コメントは数えない
    expect(within(rows()[1]).getByText("Notes 2")).toBeTruthy();
  });

  it("行を押すと場所・置き場・接続の確認が開き、確かめた結果が出る", async () => {
    setSharedFolders([{ ...createSharedFolder("/Volumes/Org", "Org"), blobRoot: "/Volumes/Org-blobs" }]);
    renderSection({ testShared: async () => ({ ok: true, id: "x", hash: "y" }) });
    fireEvent.click(within(rows()[0]).getByRole("button", { name: "Show details" }));
    expect(screen.getByText("/Volumes/Org-blobs")).toBeTruthy();
    fireEvent.click(screen.getAllByRole("button", { name: "Check connection" })[0]);
    await screen.findByText("Read and write work");
  });
});
