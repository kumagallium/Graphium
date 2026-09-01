import { describe, it, expect, afterEach, vi } from "vitest";
import urlApp, { isBlockedProxyTarget } from "./url.js";

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

    it("content-length が上限超なら 413 で弾く", async () => {
      vi.spyOn(globalThis, "fetch").mockResolvedValue(
        new Response("PNGDATA", {
          status: 200,
          headers: { "content-type": "image/png", "content-length": String(64 * 1024 * 1024) },
        }) as Response,
      );
      const res = await urlApp.request(
        "/image-proxy?url=" + encodeURIComponent("https://example.com/huge.png"),
      );
      expect(res.status).toBe(413);
    });

    it("nosniff を付けて返す", async () => {
      vi.spyOn(globalThis, "fetch").mockResolvedValue(
        new Response("PNGDATA", {
          status: 200,
          headers: { "content-type": "image/png" },
        }) as Response,
      );
      const res = await urlApp.request(
        "/image-proxy?url=" + encodeURIComponent("https://example.com/fig.png"),
      );
      expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    });
  });

  // Reader 本文の <img> が自動で image-proxy を叩くようになったので、記事側が
  // LAN / メタデータエンドポイント宛の URL を仕込んでも sidecar が代理で叩かないこと。
  describe("GET /image-proxy — SSRF ガード", () => {
    it("プライベート宛はネットワークに出る前に 403 で弾く", async () => {
      const spy = vi.spyOn(globalThis, "fetch");
      for (const target of [
        "http://127.0.0.1:3001/api/url/image-proxy?url=x",
        "http://localhost:8080/x.png",
        "http://192.168.1.1/admin",
        "http://10.0.0.5/x.png",
        "http://172.16.3.4/x.png",
        "http://169.254.169.254/latest/meta-data/",
        "http://[::1]/x.png",
        // 10 進表記も WHATWG URL parser が 127.0.0.1 に正規化するので素通りしない
        "http://2130706433/x.png",
      ]) {
        const res = await urlApp.request("/image-proxy?url=" + encodeURIComponent(target));
        expect(res.status, target).toBe(403);
      }
      expect(spy).not.toHaveBeenCalled();
    });

    it("公開ホストからプライベート宛へリダイレクトされたら 403（fetch 後の最終 URL で判定）", async () => {
      vi.spyOn(globalThis, "fetch").mockResolvedValue(
        Object.defineProperty(
          new Response("PNGDATA", { status: 200, headers: { "content-type": "image/png" } }),
          "url",
          { value: "http://169.254.169.254/latest/meta-data/" },
        ) as Response,
      );
      const res = await urlApp.request(
        "/image-proxy?url=" + encodeURIComponent("https://redirector.example.com/x.png"),
      );
      expect(res.status).toBe(403);
    });
  });

  describe("isBlockedProxyTarget", () => {
    it("公開ホストは通す", () => {
      for (const ok of [
        "https://cdn.example.com/a.jpg",
        "https://1.1.1.1/a.jpg",
        "http://203.0.113.9/a.jpg",
        "https://[2606:4700::1111]/a.jpg",
      ]) {
        expect(isBlockedProxyTarget(ok), ok).toBe(false);
      }
    });

    it("ループバック / プライベート / リンクローカル / マルチキャストを弾く", () => {
      for (const ng of [
        "http://localhost/a",
        "http://app.localhost/a",
        "http://127.0.0.1/a",
        "http://0.0.0.0/a",
        "http://10.1.2.3/a",
        "http://100.64.0.1/a",
        "http://169.254.169.254/a",
        "http://172.31.255.255/a",
        "http://192.168.0.1/a",
        "http://239.1.1.1/a",
        "http://255.255.255.255/a",
        "http://[::1]/a",
        "http://[fd00::1]/a",
        "http://[fe80::1]/a",
        "http://[::ffff:127.0.0.1]/a",
      ]) {
        expect(isBlockedProxyTarget(ng), ng).toBe(true);
      }
    });

    it("URL として解釈できない文字列は弾く", () => {
      expect(isBlockedProxyTarget("")).toBe(true);
      expect(isBlockedProxyTarget("not a url")).toBe(true);
    });
  });
});
