// MCP の資料取得が、この PC 内・LAN・メタデータ宛（リダイレクト先を含む）へ出ないことの回帰テスト

import { describe, expect, it, vi } from "vitest";

import { assertPublicUrl, fetchPublicUrlText, isBlockedIp } from "./public-url-fetch";

const publicLookup = async () => [{ address: "93.184.216.34" }];

describe("isBlockedIp", () => {
  it("ループバック・プライベート・リンクローカル・メタデータを止める", () => {
    for (const ip of ["127.0.0.1", "10.0.0.5", "172.16.0.1", "172.31.255.1", "192.168.0.1", "169.254.169.254", "0.0.0.0", "100.64.0.1", "::1", "fe80::1", "fd00::1", "::ffff:127.0.0.1", "::ffff:a9fe:a9fe"]) {
      expect(isBlockedIp(ip), ip).toBe(true);
    }
  });
  it("IPv6 で v4 や内側を包む形も止める（互換・NAT64・6to4・SIIT・サイトローカル）", () => {
    for (const ip of ["::127.0.0.1", "::7f00:1", "64:ff9b::7f00:1", "64:ff9b::a00:1", "2002:7f00:1::", "2002:a9fe:a9fe::", "::ffff:0:127.0.0.1", "fec0::1", "192.0.0.1", "198.18.0.1", "198.19.255.1"]) {
      expect(isBlockedIp(ip), ip).toBe(true);
    }
  });
  it("IPv6 の公開アドレス（v4 を包む形を含む）は通す", () => {
    for (const ip of ["64:ff9b::5db8:d822", "2002:5db8:d822::", "::ffff:5db8:d822", "2001:db8::1"]) expect(isBlockedIp(ip), ip).toBe(false);
  });
  it("公開アドレスは通す", () => {
    for (const ip of ["93.184.216.34", "8.8.8.8", "172.32.0.1", "2606:4700:4700::1111"]) expect(isBlockedIp(ip), ip).toBe(false);
  });
});

describe("assertPublicUrl", () => {
  it("IP リテラル・別表記・localhost を止める", async () => {
    for (const u of ["http://127.0.0.1/", "http://169.254.169.254/latest/meta-data/", "http://[::1]/", "http://localhost:3001/api", "http://2130706433/", "http://0x7f.0.0.1/", "http://192.168.0.1/", "http://foo.localhost/"]) {
      await expect(assertPublicUrl(u, publicLookup), u).rejects.toThrow();
    }
  });
  it("内側の IP に解決されるホスト名を止める", async () => {
    await expect(assertPublicUrl("https://evil.example/", async () => [{ address: "10.1.2.3" }])).rejects.toThrow();
    await expect(assertPublicUrl("https://evil.example/", async () => [{ address: "93.184.216.34" }, { address: "127.0.0.1" }])).rejects.toThrow();
  });
  it("公開のホストは通す", async () => {
    await expect(assertPublicUrl("https://example.com/a", publicLookup)).resolves.toBeUndefined();
  });
});

describe("fetchPublicUrlText", () => {
  const html = "<html><head><title>T</title></head><body><article><p>" + "本文です。".repeat(120) + "</p></article></body></html>";

  it("リダイレクト先が内側なら、そこへは取りに行かない", async () => {
    const calls: string[] = [];
    const fetchFn = vi.fn(async (url: string | URL | Request) => {
      calls.push(String(url));
      return new Response(null, { status: 302, headers: { location: "http://169.254.169.254/latest/meta-data/" } });
    }) as unknown as typeof fetch;
    await expect(fetchPublicUrlText("https://example.com/x", { fetchFn, lookup: publicLookup })).rejects.toThrow(/取得しません/);
    expect(calls).toEqual(["https://example.com/x"]);
  });

  it("公開の宛先どうしのリダイレクトは追って本文を返す", async () => {
    const fetchFn = vi.fn(async (url: string | URL | Request) => {
      if (String(url) === "https://example.com/short") return new Response(null, { status: 301, headers: { location: "https://example.com/full" } });
      return new Response(html, { status: 200, headers: { "content-type": "text/html" } });
    }) as unknown as typeof fetch;
    const r = await fetchPublicUrlText("https://example.com/short", { fetchFn, lookup: publicLookup });
    expect(r.text).toContain("本文です");
  });

  it("リダイレクトの回数に上限がある", async () => {
    const fetchFn = vi.fn(async () => new Response(null, { status: 302, headers: { location: "https://example.com/loop" } })) as unknown as typeof fetch;
    await expect(fetchPublicUrlText("https://example.com/loop", { fetchFn, lookup: publicLookup })).rejects.toThrow(/多すぎ/);
  });
});
