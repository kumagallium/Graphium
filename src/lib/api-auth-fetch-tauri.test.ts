// @vitest-environment jsdom
// デスクトップ版（Tauri）: アプリが起動ごとに作る合言葉を API への fetch にだけ付ける。
//
// 不変条件:
// - 合言葉は、相手が自分の sidecar（合言葉を知っている）と確かめられてから付ける
// - 確かめる要求（/api/health?challenge=…）には合言葉を付けない
// - 確かめられない相手（3001 を握った別のプログラム）には、合言葉も要求の中身も送らない
// - dataDir や version を真似た応答でも、証明が無ければ自分の sidecar にならない
import { createHmac, webcrypto } from "node:crypto";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const invokeMock = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({ invoke: (...a: unknown[]) => invokeMock(...a) }));
vi.mock("./platform", () => ({
  isTauri: () => true,
  apiBase: () => "http://127.0.0.1:3001/api",
}));

import {
  __resetTauriApiTokenForTest,
  getVerifiedTauriApiToken,
  invalidateTauriSidecarVerification,
  probeTauriSidecar,
  withApiAuth,
} from "./api-auth-fetch";

const PREFIX = "graphium-sidecar-proof-v1:";
const HEALTH = "http://127.0.0.1:3001/api/health";

function urlOf(input: RequestInfo | URL): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.href;
  return (input as Request).url;
}

type Call = { url: string; init?: RequestInit };

/**
 * 3001 の相手の偽物。sidecarToken を知っている相手は challenge に正しい証明を返す。
 * null のときは「合言葉を知らない相手」（別のプログラム）として、証明なしの応答を返す。
 */
function makeBase(opts: { sidecarToken: string | null; forged?: Record<string, unknown>; status?: number }) {
  const calls: Call[] = [];
  const base = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = urlOf(input);
    calls.push({ url, init });
    if (url.startsWith(`${HEALTH}?challenge=`)) {
      const challenge = new URL(url).searchParams.get("challenge") ?? "";
      const body: Record<string, unknown> = { status: "healthy", pid: 4242, desktop: true, ...opts.forged };
      if (opts.sidecarToken) {
        body.proof = createHmac("sha256", opts.sidecarToken).update(PREFIX + challenge, "utf8").digest("hex");
      }
      return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
    }
    return new Response("ok", { status: opts.status ?? 200 });
  });
  const tokenOf = (c: Call) => new Headers(c.init?.headers).get("x-graphium-token");
  const apiCalls = () => calls.filter((c) => !c.url.startsWith(`${HEALTH}?challenge=`));
  const probeCalls = () => calls.filter((c) => c.url.startsWith(`${HEALTH}?challenge=`));
  return { base: base as unknown as typeof fetch, calls, tokenOf, apiCalls, probeCalls };
}

describe("withApiAuth（Tauri）", () => {
  beforeAll(() => {
    // jsdom には crypto.subtle が無いことがある。Node の WebCrypto を使う
    if (!globalThis.crypto?.subtle) {
      Object.defineProperty(globalThis, "crypto", { value: webcrypto, configurable: true });
    }
  });
  beforeEach(() => {
    invokeMock.mockReset();
    __resetTauriApiTokenForTest();
    localStorage.clear();
  });

  it("自分の sidecar と確かめてから合言葉を付ける。確かめる要求には合言葉を付けない", async () => {
    invokeMock.mockResolvedValue("tok-1");
    const m = makeBase({ sidecarToken: "tok-1" });
    const f = withApiAuth(m.base);
    await f("http://127.0.0.1:3001/api/models");
    await f(new URL("http://127.0.0.1:3001/api/models"));
    await f(new Request("http://127.0.0.1:3001/api/x", { headers: { "X-Other": "1" } }));
    await f("http://127.0.0.1:3001/api/y", { headers: [["A", "b"]] });
    // 確かめるのは最初の 1 回だけ
    expect(m.probeCalls()).toHaveLength(1);
    expect(m.tokenOf(m.probeCalls()[0])).toBeNull();
    expect(m.probeCalls()[0].url).toMatch(/\?challenge=[0-9a-f]{64}$/);
    const api = m.apiCalls();
    expect(api).toHaveLength(4);
    for (const c of api) expect(m.tokenOf(c)).toBe("tok-1");
    expect(new Headers(api[2].init?.headers).get("x-other")).toBe("1");
    expect(new Headers(api[3].init?.headers).get("a")).toBe("b");
    expect(invokeMock).toHaveBeenCalledTimes(1);
    expect(invokeMock).toHaveBeenCalledWith("get_api_token");
  });

  it("合言葉を知らない相手には、合言葉も要求も送らない", async () => {
    invokeMock.mockResolvedValue("tok-1");
    const m = makeBase({ sidecarToken: null });
    const f = withApiAuth(m.base);
    await expect(f("http://127.0.0.1:3001/api/agent/run", { method: "POST", body: "secret note" })).rejects.toBeInstanceOf(
      TypeError,
    );
    expect(m.apiCalls()).toHaveLength(0);
    for (const c of m.calls) expect(m.tokenOf(c)).toBeNull();
  });

  it("別の合言葉で動く相手（別の起動の Graphium）も、自分の sidecar にしない", async () => {
    invokeMock.mockResolvedValue("tok-1");
    const m = makeBase({ sidecarToken: "another-launch" });
    await expect(withApiAuth(m.base)("http://127.0.0.1:3001/api/models")).rejects.toBeInstanceOf(TypeError);
    expect(m.apiCalls()).toHaveLength(0);
  });

  it("dataDir・version を真似た応答でも、証明が無ければ送らない", async () => {
    invokeMock.mockResolvedValue("tok-1");
    const m = makeBase({ sidecarToken: null, forged: { dataDir: "/data/server-data", version: "1.2.3", proof: "00" } });
    await expect(withApiAuth(m.base)("http://127.0.0.1:3001/api/models")).rejects.toBeInstanceOf(TypeError);
    expect(m.apiCalls()).toHaveLength(0);
  });

  it("確かめられなかったあとで sidecar が立てば、次の要求で確かめ直して送る", async () => {
    invokeMock.mockResolvedValue("tok-1");
    const down = vi.fn(async () => {
      throw new TypeError("connection refused");
    }) as unknown as typeof fetch;
    await expect(withApiAuth(down)("http://127.0.0.1:3001/api/models")).rejects.toBeInstanceOf(TypeError);
    const m = makeBase({ sidecarToken: "tok-1" });
    await withApiAuth(m.base)("http://127.0.0.1:3001/api/models");
    expect(m.tokenOf(m.apiCalls()[0])).toBe("tok-1");
  });

  it("合言葉が通らなかった（401）ら、次の要求で確かめ直す", async () => {
    invokeMock.mockResolvedValue("tok-1");
    const m = makeBase({ sidecarToken: "tok-1", status: 401 });
    const f = withApiAuth(m.base);
    await f("http://127.0.0.1:3001/api/models");
    await f("http://127.0.0.1:3001/api/models");
    expect(m.probeCalls()).toHaveLength(2);
  });

  it("止めた・入れ替えたあとは確かめ直す", async () => {
    invokeMock.mockResolvedValue("tok-1");
    const m = makeBase({ sidecarToken: "tok-1" });
    const f = withApiAuth(m.base);
    await f("http://127.0.0.1:3001/api/models");
    invalidateTauriSidecarVerification();
    await f("http://127.0.0.1:3001/api/models");
    expect(m.probeCalls()).toHaveLength(2);
  });

  it("つながらなくなったあとに別の相手が現れても、合言葉は渡らない", async () => {
    invokeMock.mockResolvedValue("tok-1");
    const real = makeBase({ sidecarToken: "tok-1" });
    // 同じ包み（= 同じ画面）の向こうで、相手が 本物 → 落ちた → 別のプログラム と入れ替わる
    let current: typeof fetch = real.base;
    const f = withApiAuth(((input: RequestInfo | URL, init?: RequestInit) => current(input, init)) as typeof fetch);
    await f("http://127.0.0.1:3001/api/models");
    current = (async () => {
      throw new TypeError("connection refused");
    }) as unknown as typeof fetch;
    await expect(f("http://127.0.0.1:3001/api/models")).rejects.toBeInstanceOf(TypeError);
    const squatter = makeBase({ sidecarToken: null });
    current = squatter.base;
    await expect(f("http://127.0.0.1:3001/api/models", { method: "POST", body: "note" })).rejects.toBeInstanceOf(TypeError);
    expect(squatter.apiCalls()).toHaveLength(0);
    for (const c of squatter.calls) expect(squatter.tokenOf(c)).toBeNull();
  });

  it("確かめた結果は短い時間しか使い回さない（黙って入れ替わった相手に気づく）", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      invokeMock.mockResolvedValue("tok-1");
      const real = makeBase({ sidecarToken: "tok-1" });
      let current: typeof fetch = real.base;
      const f = withApiAuth(((input: RequestInfo | URL, init?: RequestInit) => current(input, init)) as typeof fetch);
      await f("http://127.0.0.1:3001/api/models");
      await f("http://127.0.0.1:3001/api/models");
      expect(real.probeCalls()).toHaveLength(1);
      // 時間が経ったあと、相手が別のプログラムに替わっている
      vi.setSystemTime(Date.now() + 60_000);
      const squatter = makeBase({ sidecarToken: null });
      current = squatter.base;
      await expect(f("http://127.0.0.1:3001/api/models")).rejects.toBeInstanceOf(TypeError);
      expect(squatter.apiCalls()).toHaveLength(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("確認の途中で捨てられたら、その確認の結果は控えない", async () => {
    invokeMock.mockResolvedValue("tok-1");
    const m = makeBase({ sidecarToken: "tok-1" });
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => {
      release = r;
    });
    const slow = (async (input: RequestInfo | URL, init?: RequestInit) => {
      await gate;
      return m.base(input, init);
    }) as typeof fetch;
    const pending = probeTauriSidecar(slow);
    // 確認が返る前に、止めた・入れ替えた
    invalidateTauriSidecarVerification();
    release();
    expect((await pending).own).toBe(true);
    // 控えは復活していない: 次の要求はもう一度確かめる
    await withApiAuth(m.base)("http://127.0.0.1:3001/api/models");
    expect(m.probeCalls()).toHaveLength(2);
  });

  it("捨てたあとに来た要求は、捨てる前に始まった確認に相乗りしない", async () => {
    invokeMock.mockResolvedValue("tok-1");
    const real = makeBase({ sidecarToken: "tok-1" });
    const squatter = makeBase({ sidecarToken: null });
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => {
      release = r;
    });
    let first = true;
    // 最初の確認だけ、本物が答える前で止めておく。そのあとの相手は別のプログラム
    const f = withApiAuth((async (input: RequestInfo | URL, init?: RequestInit) => {
      if (first) {
        first = false;
        await gate;
        return real.base(input, init);
      }
      return squatter.base(input, init);
    }) as typeof fetch);
    const a = f("http://127.0.0.1:3001/api/a");
    // 確認が返る前に sidecar が止まった
    invalidateTauriSidecarVerification();
    const b = f("http://127.0.0.1:3001/api/b", { method: "POST", body: "note" });
    release();
    // 2 つをまとめて待つ（片方を待つ間にもう片方が先に失敗しても、未処理の失敗にしない）
    const [ra, rb] = await Promise.allSettled([a, b]);
    expect(ra.status).toBe("rejected");
    expect(rb.status).toBe("rejected");
    expect((ra as PromiseRejectedResult).reason).toBeInstanceOf(TypeError);
    expect((rb as PromiseRejectedResult).reason).toBeInstanceOf(TypeError);
    expect(squatter.apiCalls()).toHaveLength(0);
    for (const c of squatter.calls) expect(squatter.tokenOf(c)).toBeNull();
  });

  it("呼び出し側が取り消しただけ（AbortError）では、確かめた結果を捨てない", async () => {
    invokeMock.mockResolvedValue("tok-1");
    const m = makeBase({ sidecarToken: "tok-1" });
    let abortNext = false;
    const f = withApiAuth((async (input: RequestInfo | URL, init?: RequestInit) => {
      if (abortNext && !urlOf(input).includes("?challenge=")) {
        abortNext = false;
        throw new DOMException("aborted", "AbortError");
      }
      return m.base(input, init);
    }) as typeof fetch);
    await f("http://127.0.0.1:3001/api/a");
    abortNext = true;
    await expect(f("http://127.0.0.1:3001/api/b")).rejects.toMatchObject({ name: "AbortError" });
    await f("http://127.0.0.1:3001/api/c");
    expect(m.probeCalls()).toHaveLength(1);
  });

  it("応答しない相手を待ち続けない（確認の要求には上限がある）", async () => {
    invokeMock.mockResolvedValue("tok-1");
    vi.useFakeTimers();
    try {
      const hang = ((_input: RequestInfo | URL, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
        })) as typeof fetch;
      const p = probeTauriSidecar(hang);
      await vi.advanceTimersByTimeAsync(3100);
      expect(await p).toEqual({ reachable: false, ok: false, own: false, body: null });
    } finally {
      vi.useRealTimers();
    }
  });

  it("同時に来た要求は、確かめる要求を 1 本にまとめる", async () => {
    invokeMock.mockResolvedValue("tok-1");
    const m = makeBase({ sidecarToken: "tok-1" });
    const f = withApiAuth(m.base);
    await Promise.all([f("http://127.0.0.1:3001/api/a"), f("http://127.0.0.1:3001/api/b"), f("http://127.0.0.1:3001/api/c")]);
    expect(m.probeCalls()).toHaveLength(1);
    expect(m.apiCalls()).toHaveLength(3);
  });

  it("ほかのオリジン・API 以外には付けず、確かめもしない", async () => {
    invokeMock.mockResolvedValue("tok-1");
    const m = makeBase({ sidecarToken: "tok-1" });
    const f = withApiAuth(m.base);
    await f("https://evil.example/api/x");
    await f("http://127.0.0.1:3002/api/x");
    await f("http://127.0.0.1:3001/other");
    expect(m.calls).toHaveLength(3);
    for (const c of m.calls) expect(m.tokenOf(c)).toBeNull();
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it("設定画面の合言葉（localStorage）より、アプリの合言葉を使う", async () => {
    localStorage.setItem("graphium_server_token", "self-host");
    invokeMock.mockResolvedValue("tok-1");
    const m = makeBase({ sidecarToken: "tok-1" });
    await withApiAuth(m.base)("http://127.0.0.1:3001/api/x");
    expect(m.tokenOf(m.apiCalls()[0])).toBe("tok-1");
  });

  it("呼び出し側が付けた X-Graphium-Token より、アプリの合言葉を優先する", async () => {
    invokeMock.mockResolvedValue("tok-1");
    const m = makeBase({ sidecarToken: "tok-1" });
    await withApiAuth(m.base)("http://127.0.0.1:3001/api/x", { headers: { "X-Graphium-Token": "stale" } });
    expect(m.tokenOf(m.apiCalls()[0])).toBe("tok-1");
  });

  it("body 付きの Request・FormData・signal を壊さない", async () => {
    invokeMock.mockResolvedValue("tok-1");
    const m = makeBase({ sidecarToken: "tok-1" });
    const f = withApiAuth(m.base);
    const req = new Request("http://127.0.0.1:3001/api/x", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Other": "1" },
      body: "{}",
    });
    await f(req);
    const h = new Headers(m.apiCalls()[0].init?.headers);
    expect(h.get("content-type")).toBe("application/json");
    expect(h.get("x-other")).toBe("1");
    const fd = new FormData();
    fd.append("a", "b");
    const ac = new AbortController();
    await f("http://127.0.0.1:3001/api/y", { method: "POST", body: fd, signal: ac.signal });
    expect(m.apiCalls()[1].init?.body).toBe(fd);
    expect(m.apiCalls()[1].init?.signal).toBe(ac.signal);
    expect(new Headers(m.apiCalls()[1].init?.headers).has("content-type")).toBe(false);
  });

  it("get_api_token が失敗したら送らない。次の要求で再試行する", async () => {
    invokeMock.mockRejectedValueOnce(new Error("early")).mockResolvedValue("tok-2");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const m = makeBase({ sidecarToken: "tok-2" });
    const f = withApiAuth(m.base);
    await expect(f("http://127.0.0.1:3001/api/x")).rejects.toBeInstanceOf(TypeError);
    expect(m.apiCalls()).toHaveLength(0);
    await f("http://127.0.0.1:3001/api/x");
    expect(m.tokenOf(m.apiCalls()[0])).toBe("tok-2");
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});

describe("probeTauriSidecar / getVerifiedTauriApiToken", () => {
  beforeEach(() => {
    invokeMock.mockReset();
    __resetTauriApiTokenForTest();
  });

  it("自分の sidecar: own。合言葉を返す", async () => {
    invokeMock.mockResolvedValue("tok-1");
    const m = makeBase({ sidecarToken: "tok-1" });
    expect(await probeTauriSidecar(m.base)).toMatchObject({ reachable: true, ok: true, own: true });
    vi.stubGlobal("fetch", m.base);
    expect(await getVerifiedTauriApiToken()).toBe("tok-1");
    vi.unstubAllGlobals();
  });

  it("合言葉を知らない相手: reachable だが own でない。合言葉は返さない", async () => {
    invokeMock.mockResolvedValue("tok-1");
    const m = makeBase({ sidecarToken: null });
    expect(await probeTauriSidecar(m.base)).toMatchObject({ reachable: true, ok: true, own: false });
    vi.stubGlobal("fetch", m.base);
    expect(await getVerifiedTauriApiToken()).toBeNull();
    vi.unstubAllGlobals();
  });

  it("応答なし: reachable でない", async () => {
    invokeMock.mockResolvedValue("tok-1");
    const down = vi.fn(async () => {
      throw new TypeError("connection refused");
    }) as unknown as typeof fetch;
    expect(await probeTauriSidecar(down)).toEqual({ reachable: false, ok: false, own: false, body: null });
  });
});
