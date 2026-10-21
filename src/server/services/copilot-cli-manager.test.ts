import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { EventEmitter } from "node:events";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { setDataDir } from "../config/models.js";
import { createCopilotCliManager, parseLoginLine } from "./copilot-cli-manager.js";
import { managedCopilotCliDir, managedCopilotCliRoot } from "./copilot-cli-location.js";

let work: string;
let archive: Buffer;
let archiveSha: string;

beforeEach(() => {
  work = mkdtempSync(join(tmpdir(), "copilot-mgr-"));
  setDataDir(join(work, "data"));
  // 「copilot 1.0.101」と答えるだけの実行ファイルを tar.gz にする
  const src = join(work, "src");
  mkdirSync(src);
  writeFileSync(join(src, "copilot"), '#!/bin/sh\necho "GitHub Copilot CLI 1.0.101"\n');
  execFileSync("tar", ["-czf", join(work, "a.tar.gz"), "-C", src, "copilot"]);
  archive = readFileSync(join(work, "a.tar.gz"));
  archiveSha = createHash("sha256").update(archive).digest("hex");
});

afterEach(() => {
  rmSync(work, { recursive: true, force: true });
});

function okFetch(body: Buffer): typeof fetch {
  return (async () =>
    new Response(new Uint8Array(body), {
      headers: { "content-length": String(body.length) },
    })) as unknown as typeof fetch;
}

function makeManager(over: Parameters<typeof createCopilotCliManager>[0] = {}) {
  return createCopilotCliManager({
    platform: "linux",
    arch: "x64",
    assets: { "linux-x64": { asset: "copilot-linux-x64.tar.gz", sha256: archiveSha } },
    baseUrl: "https://example.invalid/dl",
    fetch: okFetch(archive),
    resolveCli: async () => undefined,
    ...over,
  });
}

describe("copilot-cli-manager 取得", () => {
  it("正常に取得・展開し --version を確かめて置く", async () => {
    const m = makeManager();
    m.startInstall();
    expect((await m.getStatus()).cli).toBe("installing");
    await m.installDone();
    const bin = join(managedCopilotCliDir("1.0.101"), "copilot");
    expect(existsSync(bin)).toBe(true);
    expect((await m.getStatus()).installError).toBeNull();
    // アーカイブ・一時ディレクトリは残らない
    expect(readdirSync(managedCopilotCliRoot())).toEqual(["1.0.101"]);
  });

  it("sha256 が合わなければ .part を消してエラーにする", async () => {
    const m = makeManager({
      assets: { "linux-x64": { asset: "x.tar.gz", sha256: "0".repeat(64) } },
    });
    m.startInstall();
    await m.installDone();
    expect((await m.getStatus()).installError).toMatch(/checksum/);
    expect(readdirSync(managedCopilotCliRoot())).toEqual([]);
  });

  it("--version に版番号が無ければ置かずにエラーにする", async () => {
    const m = makeManager({ runVersion: async () => "something else 0.0.1" });
    m.startInstall();
    await m.installDone();
    expect((await m.getStatus()).installError).toMatch(/version/i);
    expect(existsSync(managedCopilotCliDir("1.0.101"))).toBe(false);
  });

  it("書き込み先に書けなくても落ちずに失敗として終わる", async () => {
    // .part の場所をディレクトリにして書き込みを必ず失敗させる（EISDIR。ENOSPC / EACCES と同じ error 経路）
    mkdirSync(join(managedCopilotCliRoot(), "copilot-linux-x64.tar.gz.part"), { recursive: true });
    const m = makeManager();
    m.startInstall();
    await m.installDone();
    const st = await m.getStatus();
    expect(st.cli).toBe("missing");
    expect(st.installError).toBeTruthy();
  });

  it("キャンセルは失敗扱いにせず状態を戻す", async () => {
    const hang: typeof fetch = ((_u: string, init?: RequestInit) =>
      new Promise((_res, rej) => {
        init?.signal?.addEventListener("abort", () => rej(new DOMException("aborted", "AbortError")));
      })) as unknown as typeof fetch;
    const m = makeManager({ fetch: hang });
    m.startInstall();
    expect(() => m.startInstall()).toThrowError(/already/);
    m.cancelInstall();
    await m.installDone();
    const st = (await m.getStatus());
    expect(st.cli).toBe("missing");
    expect(st.installError).toBeNull();
    expect(readdirSync(managedCopilotCliRoot())).toEqual([]);
  });

  it("対応外のプラットフォームは installable=false で取得を断る", async () => {
    const m = makeManager({ arch: "ia32" });
    expect((await m.getStatus()).installable).toBe(false);
    expect(() => m.startInstall()).toThrowError(/cannot be downloaded/);
  });
});

describe("copilot-cli-manager ログイン", () => {
  function fakeSpawn() {
    const children: (EventEmitter & { stdout: PassThrough; stderr: PassThrough; exitCode: number | null; kill: () => void; args: string[]; env: unknown })[] = [];
    const spawn = ((_cmd: string, args: string[], opts: { env: unknown }) => {
      const c = Object.assign(new EventEmitter(), {
        stdout: new PassThrough(),
        stderr: new PassThrough(),
        exitCode: null as number | null,
        args,
        env: opts.env,
        kill() {
          c.exitCode = 143;
          c.emit("close", 143);
        },
      });
      children.push(c);
      return c;
    }) as never;
    return { spawn, children };
  }
  const tick = () => new Promise((r) => setTimeout(r, 10));

  it("device の 1 行からコードと URL を拾う", () => {
    expect(
      parseLoginLine(
        "To authenticate, visit https://github.com/login/device and enter code ABCD-1234",
        "device",
      ),
    ).toEqual({ userCode: "ABCD-1234", verificationUri: "https://github.com/login/device" });
    expect(parseLoginLine("Waiting for authorization...", "device")).toEqual({});
    expect(parseLoginLine("Open https://github.com/login/oauth/x?a=1.", "web").verificationUri)
      .toBe("https://github.com/login/oauth/x?a=1");
  });

  it("出力を読んで waiting → succeeded になる", async () => {
    const { spawn, children } = fakeSpawn();
    const m = makeManager({ spawn, resolveCli: async () => ({ path: "/x/copilot", source: "managed" }) });
    await m.startLogin("device");
    expect(children[0].args).toEqual(["login", "--device-code"]);
    children[0].stdout.write("To authenticate, visit https://github.com/login/device and enter code ABCD-1234\n");
    await tick();
    expect((await m.getStatus()).login).toMatchObject({ state: "waiting", userCode: "ABCD-1234" });
    await expect(m.startLogin("device")).rejects.toThrow(/already/);
    children[0].exitCode = 0;
    children[0].emit("close", 0);
    expect((await m.getStatus()).login.state).toBe("succeeded");
  });

  it("非 0 終了は failed で最後の行を error にする", async () => {
    const { spawn, children } = fakeSpawn();
    const m = makeManager({ spawn, resolveCli: async () => ({ path: "/x/copilot", source: "detected" }) });
    await m.startLogin("web");
    children[0].stderr.write("Login failed: denied\n");
    await tick();
    children[0].exitCode = 1;
    children[0].emit("close", 1);
    expect((await m.getStatus()).login).toMatchObject({ state: "failed", error: "Login failed: denied" });
  });

  it("mode を変えると前を止めて新しく始め、前の終了で状態が壊れない", async () => {
    const { spawn, children } = fakeSpawn();
    const m = makeManager({ spawn, resolveCli: async () => ({ path: "/x/copilot", source: "detected" }) });
    await m.startLogin("web");
    await m.startLogin("device");
    expect(children).toHaveLength(2);
    expect((await m.getStatus()).login).toMatchObject({ state: "waiting", mode: "device" });
    m.cancelLogin();
    expect((await m.getStatus()).login.state).toBe("idle");
  });

  it("spawn が同期 throw したら failed になる", async () => {
    const spawn = (() => {
      throw new Error("EACCES");
    }) as never;
    const m = makeManager({ spawn, resolveCli: async () => ({ path: "/x/copilot", source: "detected" }) });
    await m.startLogin("web");
    expect((await m.getStatus()).login).toMatchObject({ state: "failed", error: "EACCES" });
  });

  it("CLI が無ければ COPILOT_CLI_MISSING", async () => {
    const m = makeManager();
    await expect(m.startLogin("web")).rejects.toThrow(/not installed/);
  });
});
