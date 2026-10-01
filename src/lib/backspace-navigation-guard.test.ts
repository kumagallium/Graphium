// @vitest-environment jsdom
// 文字を書けない場所の Backspace で「前の画面へ戻る」既定動作だけを止める回帰ガード
import { afterEach, describe, expect, it } from "vitest";
import { installBackspaceNavigationGuard, isTextEditingTarget } from "./backspace-navigation-guard";

function press(target: Element, key = "Backspace"): KeyboardEvent {
  const e = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, composed: true });
  target.dispatchEvent(e);
  return e;
}

describe("isTextEditingTarget", () => {
  it("文字入力欄・textarea・contenteditable は書ける場所", () => {
    const input = document.createElement("input");
    expect(isTextEditingTarget(input)).toBe(true);
    const search = document.createElement("input");
    search.type = "search";
    expect(isTextEditingTarget(search)).toBe(true);
    expect(isTextEditingTarget(document.createElement("textarea"))).toBe(true);
    const ce = document.createElement("div");
    ce.contentEditable = "true";
    // jsdom は isContentEditable を実装しないので、ブラウザと同じ値を与える
    Object.defineProperty(ce, "isContentEditable", { value: true });
    expect(isTextEditingTarget(ce)).toBe(true);
  });

  it("ボタン・チェックボックス・読み取り専用・本文以外は書けない場所", () => {
    expect(isTextEditingTarget(null)).toBe(false);
    expect(isTextEditingTarget(document.body)).toBe(false);
    expect(isTextEditingTarget(document.createElement("button"))).toBe(false);
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    expect(isTextEditingTarget(checkbox)).toBe(false);
    const ro = document.createElement("input");
    ro.readOnly = true;
    expect(isTextEditingTarget(ro)).toBe(false);
    const disabled = document.createElement("textarea");
    disabled.disabled = true;
    expect(isTextEditingTarget(disabled)).toBe(false);
  });
});

describe("installBackspaceNavigationGuard", () => {
  let uninstall: (() => void) | null = null;
  afterEach(() => {
    uninstall?.();
    uninstall = null;
    document.body.innerHTML = "";
  });

  it("本文以外の Backspace は既定動作を止める（WebKit の「戻る」を起こさない）", () => {
    uninstall = installBackspaceNavigationGuard();
    const button = document.createElement("button");
    document.body.appendChild(button);
    expect(press(button).defaultPrevented).toBe(true);
    expect(press(document.body).defaultPrevented).toBe(true);
  });

  it("入力欄の Backspace は止めない（文字を消せる）", () => {
    uninstall = installBackspaceNavigationGuard();
    const input = document.createElement("input");
    document.body.appendChild(input);
    expect(press(input).defaultPrevented).toBe(false);
  });

  it("Backspace 以外のキーには触らない", () => {
    uninstall = installBackspaceNavigationGuard();
    expect(press(document.body, "Delete").defaultPrevented).toBe(false);
    expect(press(document.body, "a").defaultPrevented).toBe(false);
  });

  it("外せば元に戻る", () => {
    installBackspaceNavigationGuard()();
    expect(press(document.body).defaultPrevented).toBe(false);
  });
});
