// @vitest-environment jsdom
// 共有先の選択（§26 PR3）。文言は既定の en で照合する。
// - 共有フォルダが 1 件なら何も描かない（従来どおりすぐ共有）
// - 2 件以上なら選べて、初期値は既定の共有先
// - 選ぶ必要があるのは「初回共有」かつ「2 件以上」のときだけ
// - 初回共有は選んだフォルダとその置き場へ、再共有は選んだ値を無視してコピーのあるフォルダへ

import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { LocaleProvider } from "../../i18n";
import { createSharedFolder, setSharedFolders } from "../../lib/storage/shared";
import { SharedFolderPicker, needsSharedFolderChoice } from "./SharedFolderPicker";
import { ShareToFolderDialog } from "./ShareToFolderDialog";
import { resolveShareTarget } from "./share-target";
import { __setSharedLibraryLoaderForTest, groupSharedEntriesByType } from "./shared-library-store";
import type { SharedEntry } from "../../lib/storage/shared";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const ORG = "/Volumes/Org";
const TEAM = "/Volumes/TeamA";

beforeEach(() => {
  localStorage.clear();
  __setSharedLibraryLoaderForTest(null, { roots: [] });
});
afterEach(() => cleanup());

function twoFolders() {
  setSharedFolders([
    { ...createSharedFolder(ORG, "Whole org"), blobRoot: "/Volumes/Org-blobs" },
    { ...createSharedFolder(TEAM, "Team A"), blobRoot: "/Volumes/TeamA-blobs" },
  ]);
}

describe("needsSharedFolderChoice", () => {
  it("1 件だけなら選ばせない", () => {
    setSharedFolders([createSharedFolder(ORG)]);
    expect(needsSharedFolderChoice(false)).toBe(false);
  });
  it("2 件以上の初回共有だけ選ばせる（再共有は選ばせない）", () => {
    twoFolders();
    expect(needsSharedFolderChoice(false)).toBe(true);
    expect(needsSharedFolderChoice(true)).toBe(false);
  });
});

describe("SharedFolderPicker", () => {
  it("1 件だけなら何も描かない", () => {
    setSharedFolders([createSharedFolder(ORG)]);
    render(
      <LocaleProvider>
        <SharedFolderPicker value={ORG} onChange={() => {}} />
      </LocaleProvider>,
    );
    expect(screen.queryByTestId("shared-folder-picker")).toBeNull();
  });

  it("2 件以上なら名前とパスを並べ、選ぶと onChange に渡る", () => {
    twoFolders();
    const onChange = vi.fn();
    render(
      <LocaleProvider>
        <SharedFolderPicker value={ORG} onChange={onChange} />
      </LocaleProvider>,
    );
    expect(screen.getByText("Whole org")).toBeTruthy();
    expect(screen.getByText(TEAM)).toBeTruthy();
    fireEvent.click(screen.getByRole("radio", { name: /Team A/ }));
    expect(onChange).toHaveBeenCalledWith(TEAM);
  });
});

describe("ShareToFolderDialog", () => {
  it("初期値は既定の共有先で、選び直したフォルダで共有する", () => {
    twoFolders();
    const onConfirm = vi.fn();
    render(
      <LocaleProvider>
        <ShareToFolderDialog open itemTitle="Starter log" onConfirm={onConfirm} onClose={() => {}} />
      </LocaleProvider>,
    );
    expect((screen.getByRole("radio", { name: /Whole org/ }) as HTMLInputElement).checked).toBe(true);
    fireEvent.click(screen.getByRole("radio", { name: /Team A/ }));
    fireEvent.click(screen.getByRole("button", { name: "Share" }));
    expect(onConfirm).toHaveBeenCalledWith(TEAM);
  });
});

describe("resolveShareTarget と選んだ共有フォルダ", () => {
  it("初回共有は選んだフォルダとその置き場へ", async () => {
    twoFolders();
    expect(await resolveShareTarget(undefined, TEAM)).toEqual({ root: TEAM, blobRoot: "/Volumes/TeamA-blobs" });
  });

  it("再共有は選んだ値を無視してコピーのあるフォルダへ", async () => {
    twoFolders();
    const mine = { id: "mine", type: "note", hash: "h", author: { name: "a", email: "a@b.co" } } as unknown as SharedEntry;
    __setSharedLibraryLoaderForTest(
      async (root) => ({ entries: groupSharedEntriesByType(root === ORG ? [mine] : []), errors: {} }),
      { roots: [ORG, TEAM] },
    );
    expect((await resolveShareTarget("mine", TEAM))?.root).toBe(ORG);
  });
});

describe("ShareToFolderDialog（移す）", () => {
  it("いまのフォルダは選択肢に出さず、残りから選んで移す", () => {
    twoFolders();
    const onConfirm = vi.fn();
    render(
      <LocaleProvider>
        <ShareToFolderDialog open mode="move" excludeRoot={ORG} itemTitle="Starter log" onConfirm={onConfirm} onClose={() => {}} />
      </LocaleProvider>,
    );
    expect(screen.getByText("Which shared folder should this move to?")).toBeTruthy();
    expect(screen.queryByRole("radio", { name: /Whole org/ })).toBeNull();
    // 移す先が 1 つだけでも、どこへ移すかは見せる
    expect((screen.getByRole("radio", { name: /Team A/ }) as HTMLInputElement).checked).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Move" }));
    expect(onConfirm).toHaveBeenCalledWith(TEAM);
  });
});
