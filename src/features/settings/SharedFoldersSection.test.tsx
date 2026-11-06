// @vitest-environment jsdom
// 設定 → 共有 の共有フォルダ一覧（§26）。文言は既定の en で照合する。
// - 追加すると一覧の末尾に入り、1 件目が既定の共有先のまま
// - 「既定の共有先にする」で並びの先頭へ移り、旧キーにも写る
// - 外すのは確認してから（登録だけを外す）
// - 同じフォルダは二度登録しない

import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor, within } from "@testing-library/react";
import { LocaleProvider } from "../../i18n";
import { SharedFoldersSection } from "./SharedFoldersSection";
import { createSharedFolder, getSharedFolders, setSharedFolders } from "../../lib/storage/shared";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

beforeEach(() => localStorage.clear());
afterEach(() => cleanup());

function renderSection(pickFolder: (current?: string) => Promise<string | null>, onChange = vi.fn()) {
  render(
    <LocaleProvider>
      <SharedFoldersSection onChange={onChange} __test={{ pickFolder }} />
    </LocaleProvider>,
  );
  return onChange;
}

describe("SharedFoldersSection", () => {
  it("未登録なら「フォルダを選択」で 1 件目を登録する", async () => {
    const onChange = renderSection(async () => "/Volumes/Org");
    fireEvent.click(screen.getByRole("button", { name: "Choose folder" }));
    await waitFor(() => expect(getSharedFolders().map((f) => f.root)).toEqual(["/Volumes/Org"]));
    expect(onChange).toHaveBeenLastCalledWith([expect.objectContaining({ root: "/Volumes/Org" })]);
    expect(localStorage.getItem("graphium-shared-root")).toBe("/Volumes/Org");
  });

  it("2 件目を足しても既定の共有先は 1 件目のまま", async () => {
    setSharedFolders([createSharedFolder("/Volumes/Org", "Org")]);
    renderSection(async () => "/Volumes/TeamA");
    fireEvent.click(screen.getByRole("button", { name: "Add a shared folder" }));
    await waitFor(() => expect(getSharedFolders()).toHaveLength(2));
    expect(getSharedFolders()[0].root).toBe("/Volumes/Org");
    expect(screen.getByText("Default")).toBeTruthy();
  });

  it("同じフォルダは二度登録しない", async () => {
    setSharedFolders([createSharedFolder("/Volumes/Org", "Org")]);
    renderSection(async () => "/Volumes/Org");
    fireEvent.click(screen.getByRole("button", { name: "Add a shared folder" }));
    await screen.findByText("This folder is already added.");
    expect(getSharedFolders()).toHaveLength(1);
  });

  it("「既定の共有先にする」で先頭へ移る", () => {
    setSharedFolders([createSharedFolder("/Volumes/Org", "Org"), createSharedFolder("/Volumes/TeamA", "Team A")]);
    renderSection(async () => null);
    fireEvent.click(screen.getByRole("button", { name: "Make default" }));
    expect(getSharedFolders().map((f) => f.name)).toEqual(["Team A", "Org"]);
    expect(localStorage.getItem("graphium-shared-root")).toBe("/Volumes/TeamA");
  });

  it("名前は入力を離れたときに保存する", () => {
    setSharedFolders([createSharedFolder("/Volumes/Org")]);
    renderSection(async () => null);
    const input = screen.getByLabelText("Shared folder name");
    fireEvent.change(input, { target: { value: "Whole organization" } });
    expect(getSharedFolders()[0].name).toBe("");
    fireEvent.blur(input);
    expect(getSharedFolders()[0].name).toBe("Whole organization");
  });

  it("外すのは確認してから", () => {
    setSharedFolders([createSharedFolder("/Volumes/Org", "Org"), createSharedFolder("/Volumes/TeamA", "Team A")]);
    renderSection(async () => null);
    const card = screen.getAllByTestId("shared-folder-card")[1];
    fireEvent.click(within(card).getByRole("button", { name: "Remove" }));
    expect(getSharedFolders()).toHaveLength(2);
    within(card).getByText(/only removes it from Graphium/);
    fireEvent.click(within(card).getByRole("button", { name: "Remove" }));
    expect(getSharedFolders().map((f) => f.name)).toEqual(["Org"]);
  });
});
