// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HINT_GRADUATE_USES, installTooltips, recordHintUse, shouldShowUsage } from "./tooltip";

// jsdom の PointerEvent は無いことがあるので、pointerType を持つ Event を作って流す
function pointer(type: string, target: Element, init: { pointerType?: string; relatedTarget?: Element | null } = {}) {
  const e = new Event(type, { bubbles: true, cancelable: true }) as Event & {
    pointerType: string;
    relatedTarget: Element | null;
  };
  Object.defineProperty(e, "pointerType", { value: init.pointerType ?? "mouse" });
  Object.defineProperty(e, "relatedTarget", { value: init.relatedTarget ?? null });
  target.dispatchEvent(e);
}

function button(attrs: Record<string, string>) {
  const b = document.createElement("button");
  for (const [k, v] of Object.entries(attrs)) b.setAttribute(k, v);
  b.getBoundingClientRect = () => ({ left: 10, top: 10, right: 34, bottom: 34, width: 24, height: 24 }) as DOMRect;
  document.body.appendChild(b);
  return b;
}

const bubbleText = () => document.querySelector("[data-graphium-tooltip]")?.textContent ?? null;

describe("共通ツールチップ", () => {
  let ctl: ReturnType<typeof installTooltips>;
  beforeEach(() => {
    localStorage.clear();
    vi.useFakeTimers();
    ctl = installTooltips();
  });
  afterEach(() => {
    ctl.uninstall();
    document.body.innerHTML = "";
    vi.useRealTimers();
  });

  it("マウスで乗せて 0.5 秒待つと出る（通過しただけでは出ない）", () => {
    const b = button({ "data-tooltip": "閉じる" });
    pointer("pointerover", b);
    expect(bubbleText()).toBeNull();
    vi.advanceTimersByTime(600);
    expect(bubbleText()).toBe("閉じる");
    pointer("pointerout", b, { relatedTarget: document.body });
    expect(bubbleText()).toBeNull();
  });

  it("直前に別のヒントを見ていたら待たずに出す", () => {
    const a = button({ "data-tooltip": "A" });
    const b = button({ "data-tooltip": "B" });
    pointer("pointerover", a);
    vi.advanceTimersByTime(600);
    pointer("pointerout", a, { relatedTarget: b });
    pointer("pointerover", b);
    expect(bubbleText()).toBe("B");
  });

  it("中の子要素へ移っても消えない", () => {
    const b = button({ "data-tooltip": "閉じる" });
    const icon = document.createElement("svg");
    b.appendChild(icon);
    pointer("pointerover", b);
    vi.advanceTimersByTime(600);
    pointer("pointerout", b, { relatedTarget: icon });
    pointer("pointerover", icon);
    expect(bubbleText()).toBe("閉じる");
  });

  it("タッチでは出さない", () => {
    const b = button({ "data-tooltip": "閉じる" });
    pointer("pointerover", b, { pointerType: "touch" });
    vi.advanceTimersByTime(600);
    expect(bubbleText()).toBeNull();
  });

  it("押すと消え、卒業キーの要素は 1 回の押下を 1 回と数える", () => {
    const b = button({ "data-tooltip": "ブロックの操作", "data-tooltip-usage": "ドラッグで移動", "data-tooltip-graduate": "drag" });
    pointer("pointerover", b);
    vi.advanceTimersByTime(600);
    expect(bubbleText()).toBe("ブロックの操作ドラッグで移動");
    pointer("pointerdown", b);
    pointer("pointerdown", b); // 同じ押下で 2 度届いても 1 回
    expect(bubbleText()).toBeNull();
    expect(JSON.parse(localStorage.getItem("graphium.sideMenuHintUses")!)).toEqual({ drag: 1 });
  });

  it("卒業したら使い方の行を出さない", () => {
    for (let i = 0; i < HINT_GRADUATE_USES; i++) recordHintUse("drag");
    expect(shouldShowUsage("drag")).toBe(false);
    expect(shouldShowUsage("add")).toBe(true);
    const b = button({ "data-tooltip": "ブロックの操作", "data-tooltip-usage": "ドラッグで移動", "data-tooltip-graduate": "drag" });
    pointer("pointerover", b);
    vi.advanceTimersByTime(600);
    expect(bubbleText()).toBe("ブロックの操作");
  });

  it("壊れた保存値でも落ちずに使い方を出す", () => {
    localStorage.setItem("graphium.sideMenuHintUses", "{broken");
    expect(shouldShowUsage("add")).toBe(true);
  });

  it("display: contents の包みは最初の子の位置に出す", () => {
    const wrap = document.createElement("span");
    wrap.setAttribute("data-tooltip", "ブロックを追加");
    wrap.getBoundingClientRect = () => ({ left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0 }) as DOMRect;
    const inner = document.createElement("button");
    inner.getBoundingClientRect = () => ({ left: 100, top: 50, right: 124, bottom: 74, width: 24, height: 24 }) as DOMRect;
    wrap.appendChild(inner);
    document.body.appendChild(wrap);
    pointer("pointerover", inner);
    vi.advanceTimersByTime(600);
    expect(bubbleText()).toBe("ブロックを追加");
  });

  it("Esc・スクロールで消える", () => {
    const b = button({ "data-tooltip": "閉じる" });
    pointer("pointerover", b);
    vi.advanceTimersByTime(600);
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(bubbleText()).toBeNull();
    pointer("pointerout", b, { relatedTarget: document.body });
    pointer("pointerover", b);
    vi.advanceTimersByTime(600);
    document.dispatchEvent(new Event("scroll"));
    expect(bubbleText()).toBeNull();
  });

  it("空の data-tooltip では出さない", () => {
    const b = button({ "data-tooltip": "  " });
    pointer("pointerover", b);
    vi.advanceTimersByTime(600);
    expect(bubbleText()).toBeNull();
  });
});
