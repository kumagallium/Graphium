// @vitest-environment jsdom
// AnchoredPortal: body 直下へ出て、位置が画面に収まる基準で決まることの確認。
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, act } from "@testing-library/react";
import { AnchoredPortal, ANCHORED_PORTAL_Z_INDEX } from "./anchored-portal";

const rect = (top: number, left: number, w: number, h: number) =>
  ({ top, left, bottom: top + h, right: left + w, width: w, height: h, x: left, y: top }) as DOMRect;

describe("AnchoredPortal", () => {
  const origRect = HTMLElement.prototype.getBoundingClientRect;
  beforeEach(() => {
    vi.stubGlobal("innerWidth", 800);
    vi.stubGlobal("innerHeight", 600);
    // 小窓は 200x300 の実寸
    HTMLElement.prototype.getBoundingClientRect = function () {
      return (this as HTMLElement).dataset.floating !== undefined
        ? rect(0, 0, 200, 300)
        : origRect.call(this);
    };
  });
  afterEach(() => {
    HTMLElement.prototype.getBoundingClientRect = origRect;
    vi.unstubAllGlobals();
  });

  it("枠の外（body 直下）に fixed で出て、ピークより上の z-index を持つ", async () => {
    const { container } = render(
      <div style={{ overflow: "hidden" }}>
        <AnchoredPortal anchor={rect(100, 50, 24, 24)} data-floating="" data-testid="pop">
          中身
        </AnchoredPortal>
      </div>,
    );
    await act(async () => {});
    const pop = document.querySelector('[data-testid="pop"]') as HTMLElement;
    expect(container.contains(pop)).toBe(false);
    expect(pop.parentElement).toBe(document.body);
    expect(pop.style.position).toBe("fixed");
    expect(Number(pop.style.zIndex)).toBe(ANCHORED_PORTAL_Z_INDEX);
    // 下に収まるのでそのまま下（bottom 124 + gap 4）
    expect(pop.style.top).toBe("128px");
    expect(pop.style.left).toBe("50px");
  });

  it("下に収まらなければ上へ反転し、右端は画面の内側へ押し戻す", async () => {
    render(
      <AnchoredPortal
        anchor={rect(560, 780, 10, 24)}
        placement="bottom-end"
        data-floating=""
        data-testid="pop2"
      >
        中身
      </AnchoredPortal>,
    );
    await act(async () => {});
    const pop = document.querySelector('[data-testid="pop2"]') as HTMLElement;
    // 上に反転: top = 560 - 4 - 300
    expect(pop.style.top).toBe("256px");
    // 右揃え: right(790) - 200 = 590（画面内）
    expect(pop.style.left).toBe("590px");
  });

  it("数値の maxHeight を持つ呼び出し側は、それを超えて伸ばさない", async () => {
    render(
      <AnchoredPortal
        anchor={rect(10, 10, 10, 10)}
        style={{ maxHeight: 120 }}
        data-floating=""
        data-testid="pop3"
      >
        中身
      </AnchoredPortal>,
    );
    await act(async () => {});
    const pop = document.querySelector('[data-testid="pop3"]') as HTMLElement;
    expect(pop.style.maxHeight).toBe("120px");
  });
});
