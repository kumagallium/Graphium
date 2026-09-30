// @vitest-environment jsdom
// 用紙（A4 の幅で書く表示）のときの margin バッジの置き場の回帰ガード。
// 用紙があるときは本文枠の右端ではなく用紙の右端 - 8px を基準にし、1 文字の形（compact）にする。
// 用紙が無いときは従来どおり枠の右端 - 8px・ラベル全文。

import { describe, it, expect, afterEach } from "vitest";
import { cleanup, render, waitFor } from "@testing-library/react";
import { useEffect } from "react";
import { LabelStoreProvider, useLabelStore } from "./store";
import { LinkStoreProvider } from "../block-link/store";
import { ProvIndicatorLayer } from "./prov-indicator";
import { LocaleProvider } from "../../i18n";
import { PAPER_SHEET_ATTR } from "../../lib/pane-layout";

const rect = (left: number, right: number, top = 0, bottom = 20): DOMRect =>
  ({ left, right, top, bottom, width: right - left, height: bottom - top, x: left, y: top, toJSON() {} }) as DOMRect;

/** ラベルを 1 件入れるだけの補助 */
function SeedLabel({ blockId, label }: { blockId: string; label: string }) {
  const { setLabel } = useLabelStore();
  useEffect(() => setLabel(blockId, label), [blockId, label, setLabel]);
  return null;
}

function setup(withSheet: boolean) {
  const wrapper = document.createElement("div");
  wrapper.setAttribute("data-label-wrapper", "");
  wrapper.getBoundingClientRect = () => rect(0, 1000, 0, 600);
  if (withSheet) {
    const sheet = document.createElement("div");
    sheet.setAttribute(PAPER_SHEET_ATTR, "");
    sheet.getBoundingClientRect = () => rect(100, 800, 0, 600);
    wrapper.appendChild(sheet);
  }
  const outer = document.createElement("div");
  outer.setAttribute("data-id", "b1");
  outer.setAttribute("data-node-type", "blockOuter");
  const content = document.createElement("div");
  content.className = "bn-block-content";
  content.setAttribute("data-content-type", "paragraph");
  content.getBoundingClientRect = () => rect(120, 780, 100, 120);
  outer.appendChild(content);
  wrapper.appendChild(outer);
  document.body.appendChild(wrapper);

  render(
    <LocaleProvider>
    <LabelStoreProvider>
      <LinkStoreProvider>
        <SeedLabel blockId="b1" label="[Procedure]" />
        <ProvIndicatorLayer wrapperEl={wrapper} />
      </LinkStoreProvider>
    </LabelStoreProvider>
    </LocaleProvider>,
  );
  return wrapper;
}

async function findBadge(wrapper: HTMLElement): Promise<HTMLElement> {
  return waitFor(() => {
    const el = wrapper.querySelector<HTMLElement>('[data-prov-label-anchor="b1"]');
    if (!el) throw new Error("badge not rendered");
    return el;
  });
}

// jsdom には ResizeObserver が無い（位置計算の購読に要る。測定自体は getBoundingClientRect の差し替えで行う）
globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver;

describe("ProvIndicatorLayer の用紙基準", () => {
  afterEach(() => {
    cleanup();
    document.body.innerHTML = "";
  });

  it("用紙があるとき、バッジは用紙の右端 - 8px に置かれ 1 文字の形になる", async () => {
    const badge = await findBadge(setup(true));
    expect(badge.style.left).toBe("792px");
    expect(badge.style.minWidth).toBe("20px"); // compact の印
    expect((badge.textContent ?? "").length).toBe(1);
  });

  it("用紙が無いとき、バッジは枠の右端 - 8px に置かれラベル全文を出す", async () => {
    const badge = await findBadge(setup(false));
    expect(badge.style.left).toBe("992px");
    expect(badge.style.minWidth).toBe("");
    expect((badge.textContent ?? "").length).toBeGreaterThan(1);
  });
});
