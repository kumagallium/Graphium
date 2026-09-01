// Reader 本文画像の URL 変換テスト
//
// サーバー（url-reader.ts の sanitizeReaderHtml）は本文の <img src> と
// インライン SVG の <image href> を、ルート相対の /api/url/image-proxy?url=... で返す。
// クライアントの役目は 2 つだけ:
//   1. 描画前に apiBase() 基準の URL に解決する（Tauri では 127.0.0.1:3001）
//   2. 「Graphium に保存」に渡すときは元のリモート URL に戻す。戻さないと
//      note-app 側がプロキシ URL をさらにプロキシに包み、ファイル名の導出も壊れる
//
// この 2 つは互いの逆関数なので、往復が壊れないことをここで固定する。

import { describe, it, expect } from "vitest";
import { resolveProxiedImageSrc, unwrapProxiedImageUrl } from "./reader-image-src";

const REMOTE = "https://cdn.example.com/photo.jpg?w=800&h=600";
const ROOT_RELATIVE = `/api/url/image-proxy?url=${encodeURIComponent(REMOTE)}`;

describe("resolveProxiedImageSrc", () => {
  it("Tauri の apiBase（絶対 URL）に解決する", () => {
    const out = resolveProxiedImageSrc(
      `<p>x</p><img src="${ROOT_RELATIVE}" loading="lazy">`,
      "http://127.0.0.1:3001/api",
    );
    expect(out).toContain(
      `src="http://127.0.0.1:3001/api/url/image-proxy?url=${encodeURIComponent(REMOTE)}"`,
    );
  });

  it("Web の apiBase（/api）では実質 no-op", () => {
    const html = `<img src="${ROOT_RELATIVE}">`;
    expect(resolveProxiedImageSrc(html, "/api")).toBe(html);
  });

  it("本文中の複数画像をすべて置換する", () => {
    const html = `<img src="${ROOT_RELATIVE}"><p>間の文</p><img src="${ROOT_RELATIVE}">`;
    const out = resolveProxiedImageSrc(html, "http://127.0.0.1:3001/api");
    expect(out.split("http://127.0.0.1:3001/api/url/image-proxy").length - 1).toBe(2);
    expect(out).toContain("<p>間の文</p>");
  });

  it("属性値でない同じ文字列（本文の散文）は書き換えない", () => {
    const html = "<p>/api/url/image-proxy?url=... という話</p>";
    expect(resolveProxiedImageSrc(html, "http://127.0.0.1:3001/api")).toBe(html);
  });

  it("インライン SVG の <image href> も解決する（SVG は src を解釈しない）", () => {
    const out = resolveProxiedImageSrc(
      `<svg width="600" height="300"><image href="${ROOT_RELATIVE}" width="600" height="300"/></svg>`,
      "http://127.0.0.1:3001/api",
    );
    expect(out).toContain(
      `href="http://127.0.0.1:3001/api/url/image-proxy?url=${encodeURIComponent(REMOTE)}"`,
    );
  });

  it("同じ本文の <img src> と SVG <image href> を両方まとめて解決する", () => {
    const out = resolveProxiedImageSrc(
      `<img src="${ROOT_RELATIVE}"><svg><image href="${ROOT_RELATIVE}"/></svg>`,
      "http://127.0.0.1:3001/api",
    );
    expect(out.split("http://127.0.0.1:3001/api/url/image-proxy").length - 1).toBe(2);
    expect(out).not.toContain('="/api/url/image-proxy');
  });

  it("プロキシパス以外の href（本文リンク）は触らない", () => {
    const html = '<a href="https://example.com/source">出典</a>';
    expect(resolveProxiedImageSrc(html, "http://127.0.0.1:3001/api")).toBe(html);
  });
});

describe("unwrapProxiedImageUrl", () => {
  it("Tauri の絶対プロキシ URL から元のリモート URL を取り出す", () => {
    expect(
      unwrapProxiedImageUrl(
        `http://127.0.0.1:3001/api/url/image-proxy?url=${encodeURIComponent(REMOTE)}`,
      ),
    ).toBe(REMOTE);
  });

  it("Web のルート相対プロキシ URL からも取り出す", () => {
    expect(unwrapProxiedImageUrl(ROOT_RELATIVE)).toBe(REMOTE);
  });

  it("プロキシ URL でなければそのまま返す", () => {
    expect(unwrapProxiedImageUrl("https://cdn.example.com/direct.jpg")).toBe(
      "https://cdn.example.com/direct.jpg",
    );
    expect(unwrapProxiedImageUrl("data:image/gif;base64,R0lGODlh")).toBe(
      "data:image/gif;base64,R0lGODlh",
    );
  });

  it("復号できない壊れた値は元の文字列を返す（例外を投げない）", () => {
    const broken = "http://127.0.0.1:3001/api/url/image-proxy?url=%E0%A4%A";
    expect(unwrapProxiedImageUrl(broken)).toBe(broken);
  });

  it("resolve → unwrap の往復で元の URL に戻る", () => {
    const resolved = resolveProxiedImageSrc(
      `<img src="${ROOT_RELATIVE}">`,
      "http://127.0.0.1:3001/api",
    );
    const src = /src="([^"]+)"/.exec(resolved)?.[1] ?? "";
    expect(unwrapProxiedImageUrl(src)).toBe(REMOTE);
  });
});
