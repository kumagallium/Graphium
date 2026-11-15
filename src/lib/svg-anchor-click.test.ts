// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { interceptSvgAnchorClick } from "./svg-anchor-click";

afterEach(() => {
  vi.restoreAllMocks();
  document.body.innerHTML = "";
});

function click(id: string) {
  const ev = { target: document.getElementById(id), defaultPrevented: false, preventDefault: vi.fn() };
  interceptSvgAnchorClick(ev);
  return ev;
}

describe("Reader 本文の SVG <a>", () => {
  it("xlink:href の https は既定の遷移を止めて新しいタブで開く", () => {
    const open = vi.spyOn(window, "open").mockImplementation(() => null);
    document.body.innerHTML = `<svg><a xlink:href="https://attacker.example/signin"><rect id="r" width="9" height="9"/></a></svg>`;
    const ev = click("r");
    expect(ev.preventDefault).toHaveBeenCalled();
    expect(open).toHaveBeenCalledTimes(1);
  });

  it("javascript: は遷移も実行もしない", () => {
    const open = vi.spyOn(window, "open").mockImplementation(() => null);
    document.body.innerHTML = `<svg><a href="java&#9;script:alert(1)"><rect id="r" width="9" height="9"/></a></svg>`;
    const ev = click("r");
    expect(ev.preventDefault).toHaveBeenCalled();
    expect(open).not.toHaveBeenCalled();
  });

  it("HTML の <a> には触らない", () => {
    document.body.innerHTML = `<p><a href="https://example.com"><span id="s">x</span></a></p>`;
    expect(click("s").preventDefault).not.toHaveBeenCalled();
  });
});
