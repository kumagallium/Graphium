// ショートカット表示の OS 分岐を固定する。
// テスト実行環境（Node）の navigator.platform は実行 OS を返すので、必ず stub してから判定する。

import { afterEach, describe, expect, it, vi } from "vitest";
import { formatShortcut, isMacLike, shortcutKeycaps } from "./shortcut-label";

function stubPlatform(platform: string) {
  vi.stubGlobal("navigator", { platform });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("isMacLike", () => {
  it.each(["MacIntel", "iPhone", "iPad"])("%s は mac 扱い", (platform) => {
    stubPlatform(platform);
    expect(isMacLike()).toBe(true);
  });

  it.each(["Win32", "Linux x86_64", ""])("%s は mac 扱いしない", (platform) => {
    stubPlatform(platform);
    expect(isMacLike()).toBe(false);
  });
});

describe("formatShortcut", () => {
  it("mac は記号を詰めて並べる", () => {
    stubPlatform("MacIntel");
    expect(formatShortcut(["mod", "K"])).toBe("⌘K");
    expect(formatShortcut(["mod", "shift", "S"])).toBe("⌘⇧S");
    expect(formatShortcut(["mod", "alt", "S"])).toBe("⌘⌥S");
  });

  it("mac は macSeparator で区切れる", () => {
    stubPlatform("MacIntel");
    expect(formatShortcut(["mod", "shift", "M"], { macSeparator: "+" })).toBe("⌘+⇧+M");
    expect(formatShortcut(["mod", "Enter"], { macSeparator: "+" })).toBe("⌘+Enter");
  });

  it("Windows / Linux は名前を + で繋ぎ、macSeparator は無視する", () => {
    stubPlatform("Win32");
    expect(formatShortcut(["mod", "K"])).toBe("Ctrl+K");
    expect(formatShortcut(["mod", "alt", "S"])).toBe("Ctrl+Alt+S");
    expect(formatShortcut(["mod", "shift", "M"], { macSeparator: "" })).toBe("Ctrl+Shift+M");
    expect(formatShortcut(["mod", "\\"], { macSeparator: "+" })).toBe("Ctrl+\\");
  });
});

describe("shortcutKeycaps", () => {
  it("mac はキーごとにキャップを分ける", () => {
    stubPlatform("MacIntel");
    expect(shortcutKeycaps(["mod", "shift", "M"])).toEqual(["⌘", "⇧", "M"]);
  });

  it("Windows / Linux は 1 キャップに畳む", () => {
    stubPlatform("Linux x86_64");
    expect(shortcutKeycaps(["mod", "shift", "M"])).toEqual(["Ctrl+Shift+M"]);
  });
});
