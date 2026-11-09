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
    // 名乗る（どのアプリからの要求か、局が分かるように）
    expect(init.headers["User-Agent"]).toMatch(/^Graphium\/\S+ \(\+https:\/\/github\.com\/kumagallium\/Graphium\)$/);
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

describe("OpenTimestamps のルート", () => {
  afterEach(() => __setSealDepsForTest(undefined));
  const req = (path: string, init?: RequestInit) => sealApp.request(path, init);
  const postJson = (path: string, body: unknown) =>
    req(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const noSleep = { sleep: async () => {} };

  it("提出は登録簿のカレンダーにだけ送り、届いた応答だけ返す", async () => {
    const fetchSpy = vi.fn(async (url: string, _init?: RequestInit) =>
      url.startsWith("https://a.pool.opentimestamps.org")
        ? new Response(new Uint8Array([0xf0, 1, 2]), { status: 200 })
        : new Response("", { status: 500 }),
    );
    __setSealDepsForTest({ fetch: fetchSpy as any, ...noSleep });
    const res = await postJson("/ots/submit", { hash });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.responses).toEqual([{ calendar: "https://a.pool.opentimestamps.org", body: "8AEC" }]);
    expect(fetchSpy.mock.calls.map((c) => c[0]).sort()).toEqual([
      "https://a.pool.eternitywall.com/digest",
      "https://a.pool.opentimestamps.org/digest",
      "https://b.pool.opentimestamps.org/digest",
    ]);
    for (const c of fetchSpy.mock.calls) expect(c[1]?.redirect).toBe("error");
  });

  it("確定の取得は登録簿にないカレンダーを断る", async () => {
    const fetchSpy = vi.fn();
    __setSealDepsForTest({ fetch: fetchSpy as any, ...noSleep });
    const res = await postJson("/ots/upgrade", { calendar: "https://evil.example", commitment: "ab" });
    expect(res.status).toBe(400);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("確定の取得: 404 は確定待ち、200 は中身を返す", async () => {
    let n = 0;
    __setSealDepsForTest({
      fetch: vi.fn(async () => (n++ === 0 ? new Response("", { status: 404 }) : new Response(new Uint8Array([0]), { status: 200 }))) as any,
      ...noSleep,
    });
    const cal = "https://alice.btc.calendar.opentimestamps.org";
    expect(await (await postJson("/ots/upgrade", { calendar: cal, commitment: "abcd" })).json()).toEqual({ status: "pending" });
    expect(await (await postJson("/ots/upgrade", { calendar: cal, commitment: "abcd" })).json()).toEqual({ status: "upgraded", body: "AA==" });
  });

  it("ブロックヘッダはハッシュと照合してから返し、合わなければ次の取得先へ", async () => {
    const header =
      "000000201b9f358f5d101e27a0cd6089f972bcd0efc877b1f6ca1400000000000000000039780753a0e7785eea0fabafa8fbef1ef2539d26f6cbf3beac738a1de0e74f3c69e5ff5aa9ec4317826c0349";
    // ブロック 523364 の本物のハッシュ（ヘッダの二重 SHA-256 を逆順にしたもの）
    const realHash = "0000000000000000000f49c7974b6428fda85bf90c481bca914dc1a9adebe764";
    const fetchSpy = vi.fn(async (url: string, _init?: RequestInit) => {
      if (url.includes("blockstream")) {
        return url.endsWith("/header") ? new Response(header) : new Response("f".repeat(64));
      }
      return url.endsWith("/header") ? new Response(header) : new Response(realHash);
    });
    __setSealDepsForTest({ fetch: fetchSpy as any, ...noSleep });
    const res = await req("/btc-header/523364");
    const body = await res.json();
    // blockstream 側はハッシュがヘッダと合わないので弾き、mempool 側の結果を使う
    expect(res.status).toBe(200);
    expect(body.sources).toEqual(["https://mempool.space/api"]);
    expect(body.header).toBe(header);
    expect(body.hash).toBe(realHash);
  });
});

describe("ブロックヘッダの守り", () => {
  afterEach(() => __setSealDepsForTest(undefined));
  const header =
    "000000201b9f358f5d101e27a0cd6089f972bcd0efc877b1f6ca1400000000000000000039780753a0e7785eea0fabafa8fbef1ef2539d26f6cbf3beac738a1de0e74f3c69e5ff5aa9ec4317826c0349";
  const realHash = "0000000000000000000f49c7974b6428fda85bf90c481bca914dc1a9adebe764";

  it("2 か所とも同じブロックなら返す", async () => {
    __setSealDepsForTest({
      fetch: vi.fn(async (url: string) => (url.endsWith("/header") ? new Response(header) : new Response(realHash))) as any,
      sleep: async () => {},
    });
    const res = await sealApp.request("/btc-header/523364");
    expect(res.status).toBe(200);
    expect((await res.json()).sources).toHaveLength(2);
  });

  it("作業証明が成り立たないヘッダは返さない", async () => {
    // merkle root を書き換えたヘッダ（ハッシュは書き換え後のものを返す取得先を装う）
    const forged = header.slice(0, 72) + "00".repeat(32) + header.slice(136);
    const { createHash } = await import("node:crypto");
    const h1 = createHash("sha256").update(Buffer.from(forged, "hex")).digest();
    const forgedHash = Buffer.from(createHash("sha256").update(h1).digest()).reverse().toString("hex");
    __setSealDepsForTest({
      fetch: vi.fn(async (url: string) => (url.endsWith("/header") ? new Response(forged) : new Response(forgedHash))) as any,
      sleep: async () => {},
    });
    const res = await sealApp.request("/btc-header/523364");
    expect(res.status).toBe(502);
    expect((await res.json()).message).toMatch(/作業証明/);
  });
});
