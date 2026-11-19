import { describe, expect, it } from "vitest";
import {
  buildWebCsp,
  cspPlugin,
  findInlineScripts,
  injectCspMeta,
  isAppEntryHtml,
  scriptHash,
  shouldInjectCsp,
} from "./vite-csp-plugin";

const HTML = `<!doctype html><html><head>
<meta charset="UTF-8" />
<title>x</title>
<script>window.a = 1;</script>
<script type="module" src="/a.js"></script>
<script type="application/json">{"x":1}</script>
</head><body></body></html>`;

describe("vite-csp-plugin", () => {
  it("CSP を入れるのはアプリの入口 2 つだけ（Storybook の iframe.html などには入れない）", () => {
    expect(isAppEntryHtml("/index.html")).toBe(true);
    expect(isAppEntryHtml("/app/index.html")).toBe(true);
    expect(isAppEntryHtml("app/index.html")).toBe(true);
    expect(isAppEntryHtml("/iframe.html")).toBe(false);
    expect(isAppEntryHtml("/manual/index.html")).toBe(false);
    expect(isAppEntryHtml("/ns/index.html")).toBe(false);
  });

  it("インラインスクリプトのハッシュが script-src に入る", () => {
    const csp = buildWebCsp(["window.a = 1;"]);
    expect(csp).toContain(scriptHash("window.a = 1;"));
    expect(csp).toMatch(/script-src 'self' 'wasm-unsafe-eval' https:\/\/accounts\.google\.com\/gsi\/client 'sha256-/);
    expect(csp).not.toMatch(/script-src[^;]*'unsafe-inline'/);
  });

  it("src 付き・実行されない型のスクリプトはハッシュ対象外", () => {
    expect(findInlineScripts(HTML)).toEqual(["window.a = 1;"]);
  });

  it("meta が 1 つだけ charset の直後に入る（再実行しても増えない）", () => {
    const once = injectCspMeta(HTML);
    expect(once.match(/Content-Security-Policy/g)).toHaveLength(1);
    expect(once.indexOf("Content-Security-Policy")).toBeGreaterThan(once.indexOf("charset"));
    expect(once.indexOf("Content-Security-Policy")).toBeLessThan(once.indexOf("<title>"));
    expect(injectCspMeta(once).match(/Content-Security-Policy/g)).toHaveLength(1);
  });

  it("upgrade-insecure-requests と frame-ancestors は入れない", () => {
    const csp = buildWebCsp();
    expect(csp).not.toContain("upgrade-insecure-requests");
    expect(csp).not.toContain("frame-ancestors");
  });

  it("Tauri のビルドでは入れない", () => {
    expect(shouldInjectCsp({ TAURI_ENV_PLATFORM: "darwin" })).toBe(false);
    expect(shouldInjectCsp({})).toBe(true);
  });

  it("PDF プレビュー用に object-src と frame-src は blob: を許可する", () => {
    expect(buildWebCsp()).toMatch(/object-src blob:(;|$)/);
    expect(buildWebCsp()).toMatch(/frame-src https:\/\/accounts\.google\.com\/gsi\/ blob:(;|$)/);
  });

  it("ビルド時だけ動く（dev には入らない）", () => {
    expect(cspPlugin().apply).toBe("build");
  });
});
