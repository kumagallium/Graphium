// @vitest-environment jsdom
// スマホで開く URL の決定ロジックのテスト。
//
// 対象の不変条件:
// - web では「いま配信されている場所」から組み立てる（セルフホストや LAN でも
//   スマホから実際に届く URL になる）
// - デスクトップアプリ（Tauri）では location が外から開けないので公開 URL に落とす

import { describe, it, expect, afterEach } from "vitest";
import { getMobileAppUrl, GRAPHIUM_PUBLIC_APP_URL } from "./app-url";

afterEach(() => {
  delete (window as unknown as Record<string, unknown>).__TAURI__;
});

describe("getMobileAppUrl", () => {
  it("builds the URL from the serving origin in web mode", () => {
    // jsdom の既定 origin は http://localhost:3000
    const url = getMobileAppUrl();
    expect(url.startsWith(window.location.origin)).toBe(true);
    expect(url.endsWith("app/")).toBe(true);
  });

  it("falls back to the public app URL inside the desktop app (tauri: has no reachable origin)", () => {
    (window as unknown as Record<string, unknown>).__TAURI__ = {};
    expect(getMobileAppUrl()).toBe(GRAPHIUM_PUBLIC_APP_URL);
  });

  it("points at the app entry, not the landing page", () => {
    expect(GRAPHIUM_PUBLIC_APP_URL).toBe("https://kumagallium.github.io/Graphium/app/");
  });
});
