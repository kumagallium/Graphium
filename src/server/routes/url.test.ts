import { describe, it, expect, afterEach, vi } from "vitest";
import urlApp from "./url.js";

// Hono の app.request() でサーバ無しにルートを検証する。
// 外部 fetch は globalThis.fetch を spy して差し替える。
describe("url routes", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("POST /reader — PDF シグナル", () => {
    it("content-type が application/pdf の URL は 200 { kind: 'pdf' } を返す（エラーにしない）", async () => {
      vi.spyOn(globalThis, "fetch").mockResolvedValue(
        new Response("", {
          status: 200,
          headers: { "content-type": "application/pdf" },
        }) as Response,
      );
      const res = await urlApp.request("/reader", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: "https://example.com/paper.pdf" }),
      });
      expect(res.status).toBe(200);
      expect(await res.json()).toMatchObject({ kind: "pdf", url: "https://example.com/paper.pdf" });
    });
  });

  describe("GET /pdf-proxy", () => {
    it("上流の PDF をそのまま application/pdf でストリームする", async () => {
      vi.spyOn(globalThis, "fetch").mockResolvedValue(
        new Response("%PDF-1.7 mock body", {
          status: 200,
          headers: { "content-type": "application/pdf", "content-length": "18" },
        }) as Response,
      );
      const res = await urlApp.request(
        "/pdf-proxy?url=" + encodeURIComponent("https://example.com/paper.pdf"),
      );
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toContain("application/pdf");
      expect(await res.text()).toContain("%PDF-1.7");
    });

    it("http(s) でない url クエリは 400 で弾く", async () => {
      const res = await urlApp.request(
        "/pdf-proxy?url=" + encodeURIComponent("ftp://example.com/paper.pdf"),
      );
      expect(res.status).toBe(400);
    });

    it("url クエリが無ければ 400", async () => {
      const res = await urlApp.request("/pdf-proxy");
      expect(res.status).toBe(400);
    });

    it("PDF でない content-type（HTML エラーページ等）は 415 で弾き、汎用プロキシへの転用を防ぐ", async () => {
      vi.spyOn(globalThis, "fetch").mockResolvedValue(
        new Response("<html>not a pdf</html>", {
          status: 200,
          headers: { "content-type": "text/html" },
        }) as Response,
      );
      const res = await urlApp.request(
        "/pdf-proxy?url=" + encodeURIComponent("https://example.com/notpdf"),
      );
      expect(res.status).toBe(415);
    });

    it("上流が non-2xx なら 502 を返す", async () => {
      vi.spyOn(globalThis, "fetch").mockResolvedValue(
        new Response("", { status: 404 }) as Response,
      );
      const res = await urlApp.request(
        "/pdf-proxy?url=" + encodeURIComponent("https://example.com/missing.pdf"),
      );
      expect(res.status).toBe(502);
    });
  });

  describe("GET /image-proxy", () => {
    it("上流の画像をそのまま content-type を保ってストリームする", async () => {
      vi.spyOn(globalThis, "fetch").mockResolvedValue(
        new Response("PNGDATA", {
          status: 200,
          headers: { "content-type": "image/png", "content-length": "7" },
        }) as Response,
      );
      const res = await urlApp.request(
        "/image-proxy?url=" + encodeURIComponent("https://example.com/fig.png"),
      );
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toContain("image/png");
      expect(await res.text()).toContain("PNGDATA");
    });

    it("http(s) でない url クエリは 400 で弾く", async () => {
      const res = await urlApp.request(
        "/image-proxy?url=" + encodeURIComponent("data:image/png;base64,AAAA"),
      );
      expect(res.status).toBe(400);
    });

    it("url クエリが無ければ 400", async () => {
      const res = await urlApp.request("/image-proxy");
      expect(res.status).toBe(400);
    });

    it("画像でない content-type（HTML エラーページ等）は 415 で弾き、汎用プロキシへの転用を防ぐ", async () => {
      vi.spyOn(globalThis, "fetch").mockResolvedValue(
        new Response("<html>not an image</html>", {
          status: 200,
          headers: { "content-type": "text/html" },
        }) as Response,
      );
      const res = await urlApp.request(
        "/image-proxy?url=" + encodeURIComponent("https://example.com/notimage"),
      );
      expect(res.status).toBe(415);
    });

    it("上流が non-2xx なら 502 を返す", async () => {
      vi.spyOn(globalThis, "fetch").mockResolvedValue(
        new Response("", { status: 404 }) as Response,
      );
      const res = await urlApp.request(
        "/image-proxy?url=" + encodeURIComponent("https://example.com/missing.png"),
      );
      expect(res.status).toBe(502);
    });
  });
});
