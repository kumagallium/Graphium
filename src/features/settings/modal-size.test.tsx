// @vitest-environment jsdom
// 設定モーダルの寸法（H-1）。
//
// 高さの低い画面で本文が 200px 台に縮まないよう、モーダルの高さを画面の高さ - 2rem まで
// 使う。ただし Modal 既定の max-h-[85dvh] が残っていると h を広げても 85dvh で頭が
// 打たれるので、最終的なクラスに 85dvh が残らないことを、実際の Modal を描いて確かめる。

import { describe, it, expect, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
import { Modal } from "@ui/modal";
import { SETTINGS_MODAL_CLASS } from "./modal";

afterEach(() => cleanup());

describe("設定モーダルの寸法", () => {
  it("Modal 既定の max-h-[85dvh] を上書きし、高さの式が画面の高さ - 2rem になる", () => {
    render(
      <Modal open onClose={() => {}} className={SETTINGS_MODAL_CLASS}>
        <span data-testid="body" />
      </Modal>,
    );
    const el = document.querySelector('[data-modal-portal="true"] > div:last-child') as HTMLElement;
    expect(el).not.toBeNull();
    const classes = el.className.split(/\s+/);
    expect(classes).toContain("h-[min(calc(100dvh-2rem),48rem)]");
    expect(classes).toContain("max-h-[calc(100dvh-2rem)]");
    // 既定の 85dvh が残っていると、低い画面で高さが縮んだまま
    expect(classes).not.toContain("max-h-[85dvh]");
    expect(el.className).not.toMatch(/85dvh/);
  });

  it("幅は従来どおり（最も広いタブに合わせた 48rem・画面幅 - 2rem）", () => {
    expect(SETTINGS_MODAL_CLASS).toContain("w-[min(48rem,calc(100vw-2rem))]");
  });
});
