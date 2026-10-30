// @vitest-environment jsdom
// MemoChip（メモの印）と、印を出すかの判定 isMemoChipVisible のテスト。
//
// 対象の不変条件:
// - 1 件以上は常に出す（hover / 選択に関わらず）
// - 0 件は hover できる端末で、マウスが載っている／選択中／小窓を開いている間だけ
// - タッチ端末（hover なし）では 0 件の印は出さない
// - hideCount は件数を出さず付箋だけ。dot は更新の目印の点を添える
// - 印: 1 件以上は数字つき、0 件は数字なし。visible=false では何も描かない
// 文言は呼び出し側から渡す（label）。

import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { MemoChip, isMemoChipVisible } from "./MemoChip";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(cleanup);

describe("isMemoChipVisible", () => {
  const base = { hovered: false, selected: false, canHover: true };

  it("1 件以上は常に出す", () => {
    expect(isMemoChipVisible({ ...base, count: 1 })).toBe(true);
    expect(isMemoChipVisible({ ...base, count: 3, canHover: false })).toBe(true);
  });

  it("0 件は何もしていなければ出さない", () => {
    expect(isMemoChipVisible({ ...base, count: 0 })).toBe(false);
  });

  it("0 件でも、マウスが載っている・選択中・小窓を開いている間は出す", () => {
    expect(isMemoChipVisible({ ...base, count: 0, hovered: true })).toBe(true);
    expect(isMemoChipVisible({ ...base, count: 0, selected: true })).toBe(true);
    expect(isMemoChipVisible({ ...base, count: 0, active: true })).toBe(true);
  });

  it("タッチ端末（hover なし）では 0 件の印は出さない", () => {
    expect(isMemoChipVisible({ count: 0, hovered: true, selected: true, active: true, canHover: false })).toBe(false);
  });
});

describe("MemoChip", () => {
  it("1 件以上は件数を出し、label を aria-label とツールチップにする", () => {
    render(<MemoChip count={3} visible onClick={() => {}} label="3 memos" usage="Read or write" />);
    const chip = screen.getByRole("button", { name: "3 memos" });
    expect(chip.textContent).toBe("3");
    expect(chip.getAttribute("data-tooltip")).toBe("3 memos");
    expect(chip.getAttribute("data-tooltip-usage")).toBe("Read or write");
  });

  it("0 件は数字を出さず、薄く出す", () => {
    render(<MemoChip count={0} visible onClick={() => {}} label="Write a memo" />);
    const chip = screen.getByRole("button", { name: "Write a memo" });
    expect(chip.textContent).toBe("");
    expect(chip.style.opacity).toBe("0.7");
  });

  it("小窓を開いている（active）0 件の印は薄くしない", () => {
    render(<MemoChip count={0} visible active onClick={() => {}} label="Write a memo" />);
    expect(screen.getByRole("button", { name: "Write a memo" }).style.opacity).toBe("1");
  });

  it("hideCount は件数を出さず付箋だけにする。dot を付けると点が添わる", () => {
    const { rerender } = render(<MemoChip count={1} hideCount visible onClick={() => {}} label="Memo" />);
    const chip = screen.getByRole("button", { name: "Memo" });
    expect(chip.textContent).toBe("");
    expect(chip.querySelector("[data-test=memoChipDot]")).toBeNull();
    rerender(<MemoChip count={1} hideCount dot visible onClick={() => {}} label="Memo" />);
    expect(screen.getByRole("button", { name: "Memo" }).querySelector("[data-test=memoChipDot]")).toBeTruthy();
  });

  it("visible=false では何も描かない", () => {
    const { container } = render(<MemoChip count={2} visible={false} onClick={() => {}} label="x" />);
    expect(container.firstChild).toBeNull();
  });

  it("押すと onClick が呼ばれ、マウスダウンは既定動作を止める（エディタの選択を奪わない）", () => {
    const onClick = vi.fn();
    render(<MemoChip count={1} visible onClick={onClick} label="1 memo" chipId="blk-1" />);
    const chip = screen.getByRole("button", { name: "1 memo" });
    expect(chip.getAttribute("data-memo-chip")).toBe("blk-1");
    const notPrevented = fireEvent.mouseDown(chip);
    expect(notPrevented).toBe(false);
    fireEvent.click(chip);
    expect(onClick).toHaveBeenCalledTimes(1);
  });
});
