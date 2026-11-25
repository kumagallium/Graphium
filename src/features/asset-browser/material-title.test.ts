// 素材の題の読み取り（URL はページを /url/reader で取り直す）

import { describe, it, expect, vi, afterEach } from "vitest";
import { readUrlPageTitle } from "./material-title";

vi.mock("../../lib/platform", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../lib/platform")>()),
  apiBase: () => "/api",
}));

const respond = (status: number, body: unknown) =>
  vi.fn().mockResolvedValue(new Response(JSON.stringify(body), { status }));

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("readUrlPageTitle", () => {
  it("/url/reader の題を返す（空白は詰める）", async () => {
    const fetchMock = respond(200, { title: "  電子ノートの\n始め方 ", textContent: "x" });
    vi.stubGlobal("fetch", fetchMock);
    expect(await readUrlPageTitle("https://example.com/a")).toBe("電子ノートの 始め方");
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/url/reader",
      expect.objectContaining({ method: "POST", body: JSON.stringify({ url: "https://example.com/a" }) }),
    );
  });

  it("http(s) 以外は取りに行かない", async () => {
    const fetchMock = respond(200, { title: "x" });
    vi.stubGlobal("fetch", fetchMock);
    expect(await readUrlPageTitle("file:///etc/passwd")).toBeUndefined();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("PDF の URL・読み取れないページ・題が空なら undefined", async () => {
    vi.stubGlobal("fetch", respond(200, { kind: "pdf", url: "https://example.com/a.pdf" }));
    expect(await readUrlPageTitle("https://example.com/a.pdf")).toBeUndefined();
    vi.stubGlobal("fetch", respond(422, { error: "unreadable" }));
    expect(await readUrlPageTitle("https://example.com/b")).toBeUndefined();
    vi.stubGlobal("fetch", respond(200, { title: "" }));
    expect(await readUrlPageTitle("https://example.com/c")).toBeUndefined();
  });

  it("取得に失敗したら例外（呼び出し側が「読めなかった」を出す）", async () => {
    vi.stubGlobal("fetch", respond(502, { error: "Upstream failed" }));
    await expect(readUrlPageTitle("https://example.com/d")).rejects.toThrow("Upstream failed");
  });
});
