// @vitest-environment jsdom
// inbox のデスクトップ側設定（localStorage）のテスト。
//
// 対象の不変条件:
// - keep-archive は既定 false（= 取り込み成功後に Inbox 側ファイルを削除）
// - ON は "1" で永続化、OFF はキーごと消える（既定に戻す = 痕跡を残さない）
// - root は set/get の round-trip、空文字/null で解除

import { describe, it, expect, beforeEach } from "vitest";
import {
  getInboxRoot,
  setInboxRoot,
  getInboxKeepArchive,
  setInboxKeepArchive,
} from "./config";

beforeEach(() => {
  localStorage.clear();
});

describe("inbox config — root", () => {
  it("round-trips the sync folder root and clears on null/empty", () => {
    expect(getInboxRoot()).toBeNull();
    setInboxRoot("/sync/root");
    expect(getInboxRoot()).toBe("/sync/root");
    setInboxRoot(null);
    expect(getInboxRoot()).toBeNull();
    setInboxRoot("/sync/root");
    setInboxRoot("   ");
    expect(getInboxRoot()).toBeNull();
  });
});

describe("inbox config — keep archive (post-import disposal)", () => {
  it("defaults to false: imported files are deleted from the inbox", () => {
    expect(getInboxKeepArchive()).toBe(false);
  });

  it("persists true and reads it back", () => {
    setInboxKeepArchive(true);
    expect(getInboxKeepArchive()).toBe(true);
    expect(localStorage.getItem("graphium-inbox-keep-archive")).toBe("1");
  });

  it("removes the key when turned back off (false is the default)", () => {
    setInboxKeepArchive(true);
    setInboxKeepArchive(false);
    expect(getInboxKeepArchive()).toBe(false);
    expect(localStorage.getItem("graphium-inbox-keep-archive")).toBeNull();
  });
});
