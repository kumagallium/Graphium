// 拡大縮小のキー判定とホイールの積算（純関数）を固定する。
// 倍率の段・二重発火の防止は Rust 側（src-tauri/src/ui_zoom.rs）のテストが持つ。

import { describe, expect, it } from "vitest";
import {
  INITIAL_WHEEL_ZOOM_STATE,
  matchZoomKey,
  reduceWheelZoom,
  wheelDeltaToPixels,
  WHEEL_IDLE_RESET_MS,
  WHEEL_STEP_INTERVAL_MS,
  WHEEL_STEP_THRESHOLD,
  type WheelZoomState,
  type ZoomKeyEvent,
} from "./ui-zoom";

function key(over: Partial<ZoomKeyEvent> & { key: string }): ZoomKeyEvent {
  return {
    code: "",
    metaKey: false,
    ctrlKey: false,
    altKey: false,
    shiftKey: false,
    ...over,
  };
}

const win = (over: Partial<ZoomKeyEvent> & { key: string }) =>
  matchZoomKey(key({ ctrlKey: true, ...over }), false);
const mac = (over: Partial<ZoomKeyEvent> & { key: string }) =>
  matchZoomKey(key({ metaKey: true, ...over }), true);

describe("matchZoomKey: Windows / Linux（Ctrl）", () => {
  it("US 配列: Ctrl + = / Ctrl + Shift + = で拡大", () => {
    expect(win({ key: "=", code: "Equal" })).toBe("in");
    expect(win({ key: "+", code: "Equal", shiftKey: true })).toBe("in");
  });

  it("JIS 配列: 「+」キー（Shift なしは ;）で拡大", () => {
    expect(win({ key: ";", code: "Semicolon" })).toBe("in");
    expect(win({ key: "+", code: "Semicolon", shiftKey: true })).toBe("in");
  });

  it("JIS 配列: Shift + -（key は =）は縮小でなく拡大", () => {
    expect(win({ key: "=", code: "Minus", shiftKey: true })).toBe("in");
  });

  it("テンキーの + で拡大", () => {
    expect(win({ key: "+", code: "NumpadAdd" })).toBe("in");
  });

  it("Ctrl + - / テンキーの − で縮小", () => {
    expect(win({ key: "-", code: "Minus" })).toBe("out");
    expect(win({ key: "-", code: "NumpadSubtract" })).toBe("out");
  });

  it("Ctrl + 0 / テンキーの 0 で元に戻す（Shift なし）", () => {
    expect(win({ key: "0", code: "Digit0" })).toBe("reset");
    expect(win({ key: "0", code: "Numpad0" })).toBe("reset");
    expect(win({ key: "0", code: "Digit0", shiftKey: true })).toBeNull();
  });

  it("Alt が押されていたら対象外（BlockNote の Mod-Alt-0〜6 と衝突させない）", () => {
    expect(win({ key: "0", code: "Digit0", altKey: true })).toBeNull();
    expect(win({ key: "=", code: "Equal", altKey: true })).toBeNull();
    expect(win({ key: "-", code: "Minus", altKey: true })).toBeNull();
  });

  it("Ctrl が無ければ対象外（素のキー入力を奪わない）", () => {
    expect(matchZoomKey(key({ key: "=", code: "Equal" }), false)).toBeNull();
    expect(matchZoomKey(key({ key: "-", code: "Minus" }), false)).toBeNull();
    expect(matchZoomKey(key({ key: "0", code: "Digit0" }), false)).toBeNull();
  });

  it("⌘S などほかのキーは対象外", () => {
    expect(win({ key: "s", code: "KeyS" })).toBeNull();
    expect(win({ key: "k", code: "KeyK" })).toBeNull();
    expect(win({ key: "\\", code: "Backslash" })).toBeNull();
  });

  it("Windows で Win キー（meta）併用は対象外", () => {
    expect(
      matchZoomKey(key({ key: "=", code: "Equal", ctrlKey: true, metaKey: true }), false),
    ).toBeNull();
  });
});

describe("matchZoomKey: macOS（⌘）", () => {
  it("⌘ + = / ⌘ + - / ⌘ + 0", () => {
    expect(mac({ key: "=", code: "Equal" })).toBe("in");
    expect(mac({ key: "-", code: "Minus" })).toBe("out");
    expect(mac({ key: "0", code: "Digit0" })).toBe("reset");
  });

  it("JIS 配列: ⌘ + ;（「+」キー）で拡大", () => {
    expect(mac({ key: ";", code: "Semicolon" })).toBe("in");
  });

  it("Ctrl のみは対象外（mac の Ctrl + - などを奪わない）", () => {
    expect(matchZoomKey(key({ key: "-", code: "Minus", ctrlKey: true }), true)).toBeNull();
    expect(matchZoomKey(key({ key: "=", code: "Equal", ctrlKey: true }), true)).toBeNull();
    expect(matchZoomKey(key({ key: "0", code: "Digit0", ctrlKey: true }), true)).toBeNull();
  });

  it("⌥ 併用は対象外", () => {
    expect(mac({ key: "0", code: "Digit0", altKey: true })).toBeNull();
  });
});

describe("wheelDeltaToPixels", () => {
  it("ピクセルはそのまま、行は ×40、ページは ×800", () => {
    expect(wheelDeltaToPixels(10, 0)).toBe(10);
    expect(wheelDeltaToPixels(3, 1)).toBe(120);
    expect(wheelDeltaToPixels(-1, 2)).toBe(-800);
  });
});

describe("reduceWheelZoom", () => {
  const px = (deltaY: number) => ({ deltaY, deltaMode: 0 });

  it("閾値に届くまでは動かず、積算だけ進む", () => {
    const r = reduceWheelZoom(INITIAL_WHEEL_ZOOM_STATE, px(-40), 1000);
    expect(r.direction).toBeNull();
    expect(r.state.accum).toBe(-40);
  });

  it("上に回す（deltaY < 0）で拡大 +1、積算は 0 に戻る", () => {
    const r = reduceWheelZoom(INITIAL_WHEEL_ZOOM_STATE, px(-WHEEL_STEP_THRESHOLD), 1000);
    expect(r.direction).toBe(1);
    expect(r.state.accum).toBe(0);
    expect(r.state.lastStepAt).toBe(1000);
  });

  it("下に回す（deltaY > 0）で縮小 -1", () => {
    const r = reduceWheelZoom(INITIAL_WHEEL_ZOOM_STATE, px(120), 1000);
    expect(r.direction).toBe(-1);
  });

  it("細かい delta を重ねて閾値を越えたら 1 段", () => {
    let state: WheelZoomState = INITIAL_WHEEL_ZOOM_STATE;
    let direction: -1 | 1 | null = null;
    for (const [i, d] of [30, 30, 30, 30].entries()) {
      const r = reduceWheelZoom(state, px(d), 1000 + i * 20);
      state = r.state;
      direction = r.direction;
    }
    expect(direction).toBe(-1);
    expect(state.accum).toBe(0);
  });

  it("300ms 操作が無ければ積算を捨てる", () => {
    const first = reduceWheelZoom(INITIAL_WHEEL_ZOOM_STATE, px(80), 1000);
    expect(first.state.accum).toBe(80);
    // 間が空いた後の 80 は、足しても 160 にならず 80 から始まる
    const later = reduceWheelZoom(first.state, px(80), 1000 + WHEEL_IDLE_RESET_MS + 1);
    expect(later.direction).toBeNull();
    expect(later.state.accum).toBe(80);
  });

  it("段と段の間は 150ms 空ける（積算は閾値で頭打ち）", () => {
    const stepped = reduceWheelZoom(INITIAL_WHEEL_ZOOM_STATE, px(-100), 1000);
    expect(stepped.direction).toBe(1);
    // 50ms 後にまた大きく回しても動かない。積算は閾値で止まる
    const blocked = reduceWheelZoom(stepped.state, px(-500), 1050);
    expect(blocked.direction).toBeNull();
    expect(blocked.state.accum).toBe(-WHEEL_STEP_THRESHOLD);
    // 150ms 経った次のイベントで 1 段動く
    const next = reduceWheelZoom(blocked.state, px(-10), 1000 + WHEEL_STEP_INTERVAL_MS);
    expect(next.direction).toBe(1);
  });

  it("行単位の delta（deltaMode = 1）も積算に効く", () => {
    const r = reduceWheelZoom(INITIAL_WHEEL_ZOOM_STATE, { deltaY: -3, deltaMode: 1 }, 1000);
    expect(r.direction).toBe(1);
  });
});
