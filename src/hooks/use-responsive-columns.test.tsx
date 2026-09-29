// @vitest-environment jsdom
// use-responsive-columns のテスト
// jsdom にはレイアウトが無いので、枠（表の親要素）の offsetWidth を差し替えて確かめる。

import { afterEach, describe, expect, it } from "vitest";
import { act, cleanup, render } from "@testing-library/react";
import { useResponsiveColumns } from "./use-responsive-columns";
import { requiredWidth, type ColumnPlan } from "../lib/responsive-columns";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const PLAN: ColumnPlan<"a" | "b"> = {
  baseWidth: 400,
  hideable: [
    { key: "a", width: 100 },
    { key: "b", width: 50 },
  ],
};

let frameWidth = 0;
let resizeCallbacks: Array<() => void> = [];

class FakeResizeObserver {
  constructor(cb: () => void) {
    resizeCallbacks.push(cb);
  }
  observe() {}
  disconnect() {}
}

function Harness() {
  const cols = useResponsiveColumns(PLAN);
  return (
    <div data-testid="frame" style={{ paddingLeft: 24, paddingRight: 24 }}>
      <table ref={cols.tableRef}>
        <tbody>
          <tr>
            <td data-testid="hidden">{[...cols.hidden].join(",")}</td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

function setup(width: number) {
  frameWidth = width;
  resizeCallbacks = [];
  (globalThis as { ResizeObserver?: unknown }).ResizeObserver = FakeResizeObserver;
  Object.defineProperty(HTMLElement.prototype, "offsetWidth", {
    configurable: true,
    get() {
      return (this as HTMLElement).dataset.testid === "frame" ? frameWidth : 0;
    },
  });
  return render(<Harness />);
}

afterEach(() => {
  cleanup();
  delete (globalThis as { ResizeObserver?: unknown }).ResizeObserver;
  delete (HTMLElement.prototype as { offsetWidth?: unknown }).offsetWidth;
});

describe("useResponsiveColumns", () => {
  it("枠の幅（padding を除く）が足りないと、先頭の列から隠す", () => {
    // padding 24×2 を除いた幅が必要幅（0 個隠す）に 1px 足りない
    const { getByTestId } = setup(requiredWidth(PLAN, 0) - 1 + 48);
    expect(getByTestId("hidden").textContent).toBe("a");
  });

  it("十分広ければ隠さない", () => {
    const { getByTestId } = setup(requiredWidth(PLAN, 0) + 48);
    expect(getByTestId("hidden").textContent).toBe("");
  });

  it("枠の幅が変わると隠す数が追従する", () => {
    const { getByTestId } = setup(2000);
    expect(getByTestId("hidden").textContent).toBe("");
    frameWidth = requiredWidth(PLAN, 1) - 1 + 48;
    act(() => resizeCallbacks.forEach((cb) => cb()));
    expect(getByTestId("hidden").textContent).toBe("a,b");
  });

  it("幅が測れない環境（レイアウトなし）では隠さない", () => {
    const { getByTestId } = setup(0);
    expect(getByTestId("hidden").textContent).toBe("");
  });
});
