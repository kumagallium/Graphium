// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import {
  HINT_GRADUATE_USES,
  SideMenuHint,
  recordHintUse,
  shouldShowUsage,
} from "./side-menu-hint";
import { LocaleProvider } from "../i18n";

const hint = () => document.querySelector("[data-graphium-side-menu-hint]");

function renderHint(kind: "add" | "drag" = "drag") {
  const r = render(
    <LocaleProvider>
      <SideMenuHint kind={kind}>
        <button type="button">⠿</button>
      </SideMenuHint>
    </LocaleProvider>,
  );
  return r.getByRole("button");
}

// jsdom の PointerEvent は pointerType を持たないので、マウスの enter を手で作る
function mouseEnter(el: Element) {
  fireEvent.pointerEnter(el, { pointerType: "mouse" });
}

describe("SideMenuHint", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.useFakeTimers();
  });
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it("使った回数が上限に届くまで使い方の行を出し、届いたら出さない", () => {
    expect(shouldShowUsage("drag")).toBe(true);
    for (let i = 0; i < HINT_GRADUATE_USES; i++) recordHintUse("drag");
    expect(shouldShowUsage("drag")).toBe(false);
    // 種類ごとに数える
    expect(shouldShowUsage("add")).toBe(true);
  });

  it("壊れた保存値でも落ちずに使い方を出す", () => {
    localStorage.setItem("graphium.sideMenuHintUses", "{broken");
    expect(shouldShowUsage("add")).toBe(true);
    recordHintUse("add");
    expect(shouldShowUsage("add")).toBe(true);
  });

  it("マウスで乗せて待つと出て、押すと消えて 1 回使ったと数える", () => {
    const button = renderHint();
    mouseEnter(button);
    expect(hint()).toBeNull(); // 通過しただけでは出さない
    act(() => {
      vi.advanceTimersByTime(600);
    });
    expect(hint()).not.toBeNull();
    fireEvent.pointerDown(button);
    fireEvent.pointerDown(button); // 同じ押下で 2 度届いても 1 回と数える
    expect(hint()).toBeNull();
    expect(JSON.parse(localStorage.getItem("graphium.sideMenuHintUses")!)).toEqual({ drag: 1 });
  });

  it("タッチでは出さない", () => {
    const button = renderHint();
    fireEvent.pointerEnter(button, { pointerType: "touch" });
    act(() => {
      vi.advanceTimersByTime(600);
    });
    expect(hint()).toBeNull();
  });
});
