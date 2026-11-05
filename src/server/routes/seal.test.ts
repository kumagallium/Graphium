import { describe, it, expect, afterEach, vi } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import sealApp, { __setSealDepsForTest, MIN_INTERVAL_MS } from "./seal.js";

const here = dirname(fileURLToPath(import.meta.url));
const sampleTsr = readFileSync(join(here, "../../features/version-seal/__fixtures__/freetsa-sample.tsr"));

const post = (body: unknown) =>
  sealApp.request("/rfc3161", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

const hash = "a".repeat(64);

describe("POST /api/seal/rfc3161", () => {
  afterEach(() => __setSealDepsForTest(undefined));

  it("ハッシュの形が違えば 400（局へは送らない）", async () => {
    const fetchSpy = vi.fn();
    __setSealDepsForTest({ fetch: fetchSpy as any });
    expect((await post({ hash: "abc" })).status).toBe(400);
    expect((await post({ hash: "A".repeat(64) })).status).toBe(400);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("登録簿に無い局は 400。URL は受け取らない", async () => {
    const fetchSpy = vi.fn();
    __setSealDepsForTest({ fetch: fetchSpy as any });
    const res = await post({ hash, tsa: "https://evil.example/tsr" });
    expect(res.status).toBe(400);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("登録簿の URL へ、リダイレクトに従わずに送る", async () => {
    const fetchSpy = vi.fn().mockRejectedValue(new Error("offline"));
    __setSealDepsForTest({ fetch: fetchSpy as any });
    const res = await post({ hash });
    expect(res.status).toBe(502);
    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe("https://freetsa.org/tsr");
    expect(init.redirect).toBe("error");
    expect(init.headers["Content-Type"]).toBe("application/timestamp-query");
  });

  it("応答の種類が違えば 502", async () => {
    __setSealDepsForTest({
      fetch: vi.fn().mockResolvedValue(new Response("<html>", { headers: { "content-type": "text/html" } })) as any,
    });
    const res = await post({ hash });
    expect(res.status).toBe(502);
  });

  it("送った要求への答えでない受領書は返さない", async () => {
    __setSealDepsForTest({
      fetch: vi.fn().mockResolvedValue(
        new Response(sampleTsr, { headers: { "content-type": "application/timestamp-reply" } }),
      ) as any,
    });
    const res = await post({ hash });
    expect(res.status).toBe(502);
    expect((await res.json()).message).toMatch(/ハッシュ/);
  });

  it("大きすぎる応答は読まずに 502", async () => {
    __setSealDepsForTest({
      fetch: vi.fn().mockResolvedValue(
        new Response(new Uint8Array(100 * 1024), { headers: { "content-type": "application/timestamp-reply" } }),
      ) as any,
    });
    const res = await post({ hash });
    expect(res.status).toBe(502);
    expect((await res.json()).message).toMatch(/大きすぎ/);
  });

  it("同じ局へは 15 秒の間隔を空ける", async () => {
    let now = 1_000_000;
    const sleeps: number[] = [];
    __setSealDepsForTest({
      fetch: vi.fn().mockRejectedValue(new Error("offline")) as any,
      now: () => now,
      sleep: async (ms) => {
        sleeps.push(ms);
        now += ms;
      },
    });
    await post({ hash });
    now += 1_000;
    await post({ hash });
    expect(sleeps).toEqual([MIN_INTERVAL_MS - 1_000]);
  });
});
