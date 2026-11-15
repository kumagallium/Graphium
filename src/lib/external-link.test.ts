// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { installExternalLinkHandler, isSameOriginHref, openExternalUrl } from "./external-link";

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

describe("installExternalLinkHandler: 許可リスト外のスキーム", () => {
  const click = (html: string) => {
    (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {};
    installExternalLinkHandler();
    document.body.innerHTML = html;
    const ev = new MouseEvent("click", { bubbles: true, cancelable: true, button: 0 });
    document.getElementById("a")!.dispatchEvent(ev);
    return ev;
  };

  it("smb: / file: / ms-msdt: / javascript: は遷移させない", () => {
    for (const h of ["smb://h/s", "file:///etc/passwd", "ms-msdt:/id x", " JaVa\tScript:alert(1)"]) {
      expect(click(`<a id="a" href="${h}">x</a>`).defaultPrevented, h).toBe(true);
    }
  });

  it("相対・# 始まり・mailto・blob:・data: は素通し", () => {
    vi.spyOn(window, "open").mockImplementation(() => null);
    for (const h of ["#top", "/Graphium/manual/", "x.html", "mailto:a@e.example", "blob:http://localhost/abc", "data:text/plain,x"]) {
      expect(click(`<a id="a" href="${h}">x</a>`).defaultPrevented, h).toBe(false);
    }
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

describe("isSameOriginHref（アプリ自身を指す絶対 URL は素通しする）", () => {
  it("同じスキーム・ホストなら true（「リンクをコピー」が作る tauri://localhost/…#note/<id>）", () => {
    expect(isSameOriginHref("tauri://localhost/index.html#note/abc", "tauri://localhost/index.html")).toBe(true);
    expect(isSameOriginHref("http://tauri.localhost/#note/abc", "http://tauri.localhost/")).toBe(true);
  });

  it("別のスキーム・別のホスト・解釈できない値は false", () => {
    expect(isSameOriginHref("smb://localhost/share", "tauri://localhost/")).toBe(false);
    expect(isSameOriginHref("tauri://evil.example/x", "tauri://localhost/")).toBe(false);
    expect(isSameOriginHref("file:///etc/passwd", "tauri://localhost/")).toBe(false);
    expect(isSameOriginHref("not a url", "tauri://localhost/")).toBe(false);
  });
});
