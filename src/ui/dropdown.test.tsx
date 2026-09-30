// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { Dropdown } from "./dropdown";

// jsdom は寸法を持たないので、小窓の実寸だけモックする
function mockSize(width: number, height: number) {
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
    width,
    height,
    top: 0,
    left: 0,
    right: width,
    bottom: height,
    x: 0,
    y: 0,
    toJSON: () => ({}),
  });
}

function panel() {
  return document.body.querySelector<HTMLElement>("div.fixed")!;
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("Dropdown の位置", () => {
  it("点が起点で下に収まらないとき点の上へ出す", () => {
    mockSize(200, 300);
    Object.assign(window, { innerWidth: 1000, innerHeight: 600 });
    render(
      <Dropdown position={{ top: 500, left: 100 }} onClose={() => {}}>
        x
      </Dropdown>,
    );
    expect(parseFloat(panel().style.top)).toBe(200);
  });

  it("点が起点で右に収まらないとき点の左へ出す", () => {
    mockSize(200, 100);
    Object.assign(window, { innerWidth: 1000, innerHeight: 600 });
    render(
      <Dropdown position={{ top: 100, left: 900 }} onClose={() => {}}>
        x
      </Dropdown>,
    );
    expect(parseFloat(panel().style.left)).toBe(700);
  });

  it("anchorRect があれば起点ボタンの上へ反転する", () => {
    mockSize(200, 300);
    Object.assign(window, { innerWidth: 1000, innerHeight: 600 });
    render(
      <Dropdown
        position={{ top: 534, left: 100 }}
        anchorRect={{ top: 500, bottom: 530, left: 100, right: 180 }}
        onClose={() => {}}
      >
        x
      </Dropdown>,
    );
    expect(parseFloat(panel().style.top)).toBe(196);
  });
});

describe("Dropdown の縮め方", () => {
  it("中身が空きより大きいとき最大高さを空きに縮める", () => {
    mockSize(200, 400);
    Object.assign(window, { innerWidth: 1000, innerHeight: 660 });
    render(
      <Dropdown
        position={{ top: 334, left: 100 }}
        anchorRect={{ top: 300, bottom: 330, left: 100, right: 180 }}
        onClose={() => {}}
      >
        x
      </Dropdown>,
    );
    // 上下とも空きは約 300px。400px は入らないので縮む
    const m = /max-height: min\(80vh, ([\d.]+)px\)/.exec(
      panel().getAttribute("style") ?? "",
    );
    expect(m).not.toBeNull();
    const max = parseFloat(m![1]);
    expect(max).toBeLessThan(400);
    expect(max).toBeGreaterThan(0);
  });

  it("測り直してもスクロール位置が 0 に戻らない", () => {
    mockSize(200, 400);
    Object.assign(window, { innerWidth: 1000, innerHeight: 660 });
    const { rerender } = render(
      <Dropdown position={{ top: 100, left: 100 }} onClose={() => {}}>
        x
      </Dropdown>,
    );
    const el = panel();
    // jsdom は scrollTop を保持するが、maxHeight の書き換えで 0 に戻す挙動を再現する
    let scroll = 40;
    let setter = 0;
    Object.defineProperty(el, "scrollTop", {
      configurable: true,
      get: () => scroll,
      set: (v: number) => {
        setter += 1;
        scroll = v;
      },
    });
    const styleDecl = el.style;
    const origSet = Object.getOwnPropertyDescriptor(
      Object.getPrototypeOf(styleDecl),
      "maxHeight",
    );
    if (origSet?.set) {
      Object.defineProperty(styleDecl, "maxHeight", {
        configurable: true,
        get: () => origSet.get!.call(styleDecl),
        set: (v: string) => {
          origSet.set!.call(styleDecl, v);
          scroll = 0; // ブラウザ同様、高さの変更でスクロールが 0 に戻る
        },
      });
    }
    rerender(
      <Dropdown position={{ top: 100, left: 100 }} onClose={() => {}}>
        y
      </Dropdown>,
    );
    expect(scroll).toBe(40);
    expect(setter).toBeGreaterThan(0);
  });
});
