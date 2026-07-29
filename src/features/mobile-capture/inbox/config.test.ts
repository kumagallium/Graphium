// @vitest-environment jsdom
// inbox のデスクトップ側設定（localStorage）のテスト。
//
// 対象の不変条件:
// - keep-archive は既定 false（= 取り込み成功後に Inbox 側ファイルを削除）
// - ON は "1" で永続化、OFF はキーごと消える（既定に戻す = 痕跡を残さない）
// - root は set/get の round-trip、空文字/null で解除
// - setter は CustomEvent を流す（設定モーダルと受信箱ビューの 2 入口が同じ
//   localStorage を触るため。片方の変更がもう片方に届かないとズレる）

import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  getInboxRoot,
  setInboxRoot,
  getInboxKeepArchive,
  setInboxKeepArchive,
  INBOX_CONFIG_EVENT,
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

describe("inbox config — change notification", () => {
  it("notifies both entry points (settings modal / inbox view) on every setter", () => {
    const listener = vi.fn();
    window.addEventListener(INBOX_CONFIG_EVENT, listener);
    setInboxRoot("/sync/root");
    expect(listener).toHaveBeenCalledTimes(1);
    setInboxKeepArchive(true);
    expect(listener).toHaveBeenCalledTimes(2);
    setInboxRoot(null);
    expect(listener).toHaveBeenCalledTimes(3);
    window.removeEventListener(INBOX_CONFIG_EVENT, listener);
  });
});
