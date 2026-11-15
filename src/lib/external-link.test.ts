// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { installExternalLinkHandler, openExternalUrl } from "./external-link";

afterEach(() => {
  vi.restoreAllMocks();
  delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__;
  document.body.innerHTML = "";
});

describe("openExternalUrl の入口検査（監査 #37）", () => {
  it("javascript: / data: / file: は開かない", async () => {
    const open = vi.spyOn(window, "open").mockImplementation(() => null);
    for (const u of ["javascript:alert(1)", "data:text/html,x", "file:///etc/passwd", "smb://h/s"]) {
      await openExternalUrl(u);
    }
    expect(open).not.toHaveBeenCalled();
  });

  it("https は開く", async () => {
    const open = vi.spyOn(window, "open").mockImplementation(() => null);
    await openExternalUrl("https://example.com/");
    expect(open).toHaveBeenCalledTimes(1);
  });
});

describe("installExternalLinkHandler: SVG の <a>（監査 #96）", () => {
  it("xlink:href のみの SVG <a> も横取りされ、メインウィンドウは遷移しない", () => {
    (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {};
    vi.spyOn(window, "open").mockImplementation(() => null);
    installExternalLinkHandler();
    document.body.innerHTML = `<svg><a xlink:href="https://attacker.example/signin"><rect id="r" width="9" height="9"/></a></svg>`;
    const ev = new MouseEvent("click", { bubbles: true, cancelable: true, button: 0 });
    document.getElementById("r")!.dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(true);
  });

  it("SVG の <a href=javascript:> は遷移させない", () => {
    (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {};
    installExternalLinkHandler();
    document.body.innerHTML = `<svg><a href="java&#9;script:alert(1)"><rect id="r2" width="9" height="9"/></a></svg>`;
    const ev = new MouseEvent("click", { bubbles: true, cancelable: true, button: 0 });
    document.getElementById("r2")!.dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(true);
  });
});
