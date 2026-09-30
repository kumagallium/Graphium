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
