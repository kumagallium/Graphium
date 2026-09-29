// @vitest-environment jsdom
// チップの右端の上限を取る入れ物の探し方
import { describe, it, expect, afterEach } from "vitest";
import { findChipContainerRight } from "./table-chip-container";
import { TABLE_CHIP_CONTAINER_INSET } from "./table-chip-position";

/** getBoundingClientRect の right だけ差し替える（jsdom は寸法を持たない） */
function withRight<T extends HTMLElement>(el: T, right: number): T {
  el.getBoundingClientRect = () => ({ right, left: 0, top: 0, bottom: 0, width: 0, height: 0, x: 0, y: 0, toJSON() {} }) as DOMRect;
  return el;
}
function div(cls: string, parent?: HTMLElement): HTMLElement {
  const el = document.createElement("div");
  el.className = cls;
  parent?.appendChild(el);
  return el;
}

afterEach(() => {
  document.body.innerHTML = "";
});

describe("findChipContainerRight", () => {
  it("ステップのカードの中の表 → カードの右の罫線（1px）の内側から数 px", () => {
    const wrapper = div("");
    wrapper.setAttribute("data-label-wrapper", "");
    const editor = div("bn-editor", wrapper);
    const rootGroup = div("bn-block-group", editor);
    const stepOuter = div("bn-block-outer", rootGroup);
    const card = withRight(div("bn-block", stepOuter), 530);
    div("react-renderer node-step", card);
    const innerGroup = withRight(div("bn-block-group", card), 522);
    const tableOuter = div("bn-block-outer", innerGroup);
    document.body.appendChild(wrapper);
    expect(findChipContainerRight(tableOuter, 999)).toBe(530 - 1 - TABLE_CHIP_CONTAINER_INSET);
  });

  it("入れ物のブロックグループ（本文直下ではない）の中の表 → そのグループの右端から数 px", () => {
    const wrapper = div("");
    wrapper.setAttribute("data-label-wrapper", "");
    const editor = div("bn-editor", wrapper);
    const rootGroup = div("bn-block-group", editor);
    const parentBlock = div("bn-block", rootGroup);
    const nested = withRight(div("bn-block-group", parentBlock), 640);
    const tableOuter = div("bn-block-outer", nested);
    document.body.appendChild(wrapper);
    expect(findChipContainerRight(tableOuter, 999)).toBe(640 - TABLE_CHIP_CONTAINER_INSET);
  });

  it("本文直下の表 → 入れ物は無いので fallbackRight（本文枠の右端）", () => {
    const wrapper = div("");
    wrapper.setAttribute("data-label-wrapper", "");
    const editor = div("bn-editor", wrapper);
    const rootGroup = withRight(div("bn-block-group", editor), 700);
    const tableOuter = div("bn-block-outer", rootGroup);
    document.body.appendChild(wrapper);
    expect(findChipContainerRight(tableOuter, 999)).toBe(999);
  });
});
