// @vitest-environment jsdom
// 取り込みの区画の切り替えのテスト

import { describe, it, expect, vi, afterEach } from "vitest";
import { render, fireEvent, cleanup, screen } from "@testing-library/react";
import { LocaleProvider } from "../../i18n";
import { IntakeSectionTabs } from "./IntakeSectionTabs";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => cleanup());

function setup(value: "files" | "conversations") {
  const onChange = vi.fn();
  render(
    <LocaleProvider>
      <IntakeSectionTabs value={value} onChange={onChange} />
    </LocaleProvider>,
  );
  return { onChange, tabs: screen.getAllByRole("tab") };
}

describe("IntakeSectionTabs", () => {
  it("選ばれたタブだけ aria-selected が true で、ほかは tabIndex が -1", () => {
    const { tabs } = setup("conversations");
    expect(tabs).toHaveLength(2);
    expect(tabs[0].getAttribute("aria-selected")).toBe("false");
    expect(tabs[1].getAttribute("aria-selected")).toBe("true");
    expect(tabs[0].tabIndex).toBe(-1);
    expect(tabs[1].tabIndex).toBe(0);
  });

  it("クリックで onChange に値が渡る", () => {
    const { onChange, tabs } = setup("files");
    fireEvent.click(tabs[1]);
    expect(onChange).toHaveBeenCalledWith("conversations");
  });

  it("左右の矢印・Home・End で移動する", () => {
    const { onChange, tabs } = setup("files");
    fireEvent.keyDown(tabs[0], { key: "ArrowRight" });
    expect(onChange).toHaveBeenLastCalledWith("conversations");
    fireEvent.keyDown(tabs[0], { key: "ArrowLeft" });
    expect(onChange).toHaveBeenLastCalledWith("conversations");
    fireEvent.keyDown(tabs[1], { key: "Home" });
    expect(onChange).toHaveBeenLastCalledWith("files");
    fireEvent.keyDown(tabs[0], { key: "End" });
    expect(onChange).toHaveBeenLastCalledWith("conversations");
  });
});
