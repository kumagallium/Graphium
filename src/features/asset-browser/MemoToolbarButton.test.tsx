// @vitest-environment jsdom
// MemoToolbarButton（書式ツールバーの「メモ」ボタン）のテスト。
//
// 対象の不変条件:
// - name が aria-label とツールチップ、usage があれば使い方の行になる
// - 押すと onOpen が呼ばれる
// - mousedown は既定動作を止める（エディタの選択を外さない）

import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { MemoToolbarButton } from "./MemoToolbarButton";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(cleanup);

describe("MemoToolbarButton", () => {
  it("name を aria-label とツールチップにし、usage を使い方の行にする", () => {
    render(<MemoToolbarButton name="Memo on selection" usage="Write one" onOpen={() => {}} />);
    const btn = screen.getByRole("button", { name: "Memo on selection" });
    expect(btn.getAttribute("data-tooltip")).toBe("Memo on selection");
    expect(btn.getAttribute("data-tooltip-usage")).toBe("Write one");
  });

  it("usage が無ければ使い方の行を付けない", () => {
    render(<MemoToolbarButton name="Memo" onOpen={() => {}} />);
    expect(screen.getByRole("button", { name: "Memo" }).hasAttribute("data-tooltip-usage")).toBe(false);
  });

  it("押すと onOpen が呼ばれる", () => {
    const onOpen = vi.fn();
    render(<MemoToolbarButton name="Memo" onOpen={onOpen} />);
    fireEvent.click(screen.getByRole("button", { name: "Memo" }));
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it("mousedown の既定動作を止める（エディタの選択を保つ）", () => {
    render(<MemoToolbarButton name="Memo" onOpen={() => {}} />);
    const notPrevented = fireEvent.mouseDown(screen.getByRole("button", { name: "Memo" }));
    expect(notPrevented).toBe(false);
  });
});
