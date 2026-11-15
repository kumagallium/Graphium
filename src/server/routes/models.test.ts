// モデル追加・更新の表示名重複チェック。
// 表示名は一意という前提で名前引き（header-model.ts の resolveModelConfig 等）が動くため、
// 重複を作れてしまうと、選んだつもりのないモデルが動く事故になる。

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setDataDir, setServerMode } from "../config/models.js";
import app from "./models.js";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "graphium-models-route-test-"));
  setDataDir(dir);
  setServerMode("node");
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

async function post(body: unknown) {
  const res = await app.request("/", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

async function put(id: string, body: unknown) {
  const res = await app.request(`/${id}`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

const NEW_MODEL = {
  model_name: "My Model",
  provider: "anthropic",
  model_id: "claude-sonnet",
  api_key: "sk-xxx",
};

describe("POST /api/models — 表示名の重複", () => {
  it("同じ名前のモデルが既にあれば 400", async () => {
    const first = await post(NEW_MODEL);
    expect(first.status).toBe(201);

    const second = await post(NEW_MODEL);
    expect(second.status).toBe(400);
    expect(String(second.body.error)).toContain("already has this name");
    // code はクライアントが日英を判定するための機械可読トークン（文言そのものではない）
    expect(second.body.code).toBe("DUPLICATE_MODEL_NAME");
  });

  it("違う名前なら通る", async () => {
    await post(NEW_MODEL);
    const second = await post({ ...NEW_MODEL, model_name: "Another Model" });
    expect(second.status).toBe(201);
  });

  it("前後の空白だけが違う名前も重複として断る", async () => {
    await post(NEW_MODEL);
    const second = await post({ ...NEW_MODEL, model_name: "  My Model  " });
    expect(second.status).toBe(400);
  });
});

describe("PUT /api/models/:id — 表示名の重複", () => {
  it("改名した先を別のモデルが持っていれば 400", async () => {
    await post(NEW_MODEL);
    const second = await post({ ...NEW_MODEL, model_name: "Another Model" });
    const secondId = String(second.body.id);

    const res = await put(secondId, { model_name: "My Model" });
    expect(res.status).toBe(400);
    expect(String(res.body.error)).toContain("already has this name");
    expect(res.body.code).toBe("DUPLICATE_MODEL_NAME");
  });

  it("名前を変えない PUT（API キーだけ更新）は通る", async () => {
    const first = await post(NEW_MODEL);
    const id = String(first.body.id);
    const res = await put(id, { model_name: "My Model", api_key: "sk-new" });
    expect(res.status).toBe(200);
  });

  it("モデルが見つからなければ 404", async () => {
    const res = await put("does-not-exist", { model_name: "X" });
    expect(res.status).toBe(404);
  });
});

describe("保存済みキーを別の接続先へ送らない", () => {
  const OWN = { ...NEW_MODEL, model_name: "Own", provider: "openai", api_key: "sk-saved", api_base: "https://api.example.com/v1" };

  async function create(extra: Record<string, unknown> = {}) {
    const r = await post({ ...OWN, ...extra });
    expect(r.status).toBe(201);
    return String(r.body.id);
  }
  async function available(body: unknown) {
    const res = await app.request("/available", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    return { status: res.status, body: (await res.json()) as Record<string, unknown> };
  }

  it("available: source_model_id と別オリジンの api_base → 外へ送らず 400", async () => {
    const id = await create();
    const fetchMock = vi.fn(async () => new Response("{}"));
    vi.stubGlobal("fetch", fetchMock);
    try {
      const r = await available({ source_model_id: id, api_base: "https://attacker.example" });
      expect(r.status).toBe(400);
      expect(r.body.code).toBe("API_KEY_REENTRY_REQUIRED");
      expect(fetchMock).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("available: 別オリジンでも要求にキーがあればそのキーを使い、保存済みキーは送らない", async () => {
    const id = await create();
    const fetchMock = vi.fn(async (_u: unknown, _i?: unknown) => new Response(JSON.stringify({ data: [] }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    try {
      await available({ source_model_id: id, api_base: "https://other.example/v1", api_key: "sk-typed" });
      const sent = JSON.stringify(fetchMock.mock.calls);
      expect(sent).not.toContain("sk-saved");
      expect(sent).toContain("sk-typed");
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("available: 同じオリジンなら保存済みキーを使える", async () => {
    const id = await create();
    const fetchMock = vi.fn(async (_u: unknown, _i?: unknown) => new Response(JSON.stringify({ data: [] }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    try {
      await available({ source_model_id: id, api_base: "https://api.example.com/v2" });
      expect(JSON.stringify(fetchMock.mock.calls)).toContain("sk-saved");
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("available: http(s) の絶対 URL として読めない api_base は別オリジン扱いで 400", async () => {
    const id = await create();
    const fetchMock = vi.fn(async () => new Response("{}"));
    vi.stubGlobal("fetch", fetchMock);
    try {
      for (const base of ["//attacker.example/v1", "attacker.example", "   "]) {
        const r = await available({ source_model_id: id, api_base: base });
        expect(r.status, base).toBe(400);
        expect(r.body.code, base).toBe("API_KEY_REENTRY_REQUIRED");
      }
      expect(fetchMock).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("POST /・PUT: 読めない api_base も別オリジン扱いで 400", async () => {
    const id = await create();
    const p = await post({ model_name: "Copy2", provider: "openai", model_id: "x", source_model_id: id, api_base: "//attacker.example/v1" });
    expect(p.status).toBe(400);
    expect(p.body.code).toBe("API_KEY_REENTRY_REQUIRED");
    const u = await put(id, { api_base: "attacker.example" });
    expect(u.status).toBe(400);
    expect(u.body.code).toBe("API_KEY_REENTRY_REQUIRED");
  });

  it("POST /: source_model_id と別オリジンの api_base → 400、保存もされない", async () => {
    const id = await create();
    const r = await post({ model_name: "Copy", provider: "openai", model_id: "x", source_model_id: id, api_base: "https://attacker.example" });
    expect(r.status).toBe(400);
    expect(r.body.code).toBe("API_KEY_REENTRY_REQUIRED");
  });

  it("PUT: キー無しで別オリジンへ変えると 400。同じオリジン・キー同時送信・空は通る", async () => {
    const id = await create();
    const bad = await put(id, { api_base: "https://attacker.example" });
    expect(bad.status).toBe(400);
    expect(bad.body.code).toBe("API_KEY_REENTRY_REQUIRED");
    expect((await put(id, { api_base: "https://api.example.com/v1/" })).status).toBe(200);
    expect((await put(id, { api_base: "https://other.example", api_key: "sk-new" })).status).toBe(200);
    expect((await put(id, { api_base: "" })).status).toBe(200);
  });

  it("キーの要らない接続先（ダミーキー）・サブスク型は対象外", async () => {
    const local = await create({ model_name: "Local", api_key: "local", api_base: "http://localhost:11434/v1" });
    expect((await put(local, { api_base: "http://192.168.0.5:11434/v1" })).status).toBe(200);
    const sub = await post({ model_name: "Cop", provider: "copilot-subscription", model_id: "default", api_base: process.execPath });
    expect(sub.status).toBe(201);
    expect((await put(String(sub.body.id), { api_base: process.execPath })).status).toBe(200);
  });
});

describe("copilot-subscription の api_base（CLI のパス）", () => {
  const sub = (api_base: string) =>
    post({ model_name: "Cop", provider: "copilot-subscription", model_id: "default", api_base });

  it("実在しない・相対・UNC・スクリプト・データフォルダ内のファイルは 400", async () => {
    const inData = join(dir, "media", "x.bin");
    mkdirSync(join(dir, "media"), { recursive: true });
    writeFileSync(inData, "#!/bin/sh\n", { mode: 0o755 });
    const script = join(tmpdir(), `graphium-cli-test-${process.pid}.js`);
    writeFileSync(script, "// js");
    try {
      for (const p of ["/no/such/copilot", "copilot", "\\\\host\\share\\x.exe", "//host/share/x", script, inData, dir]) {
        const r = await sub(p);
        expect(r.status, p).toBe(400);
        expect(r.body.code).toBe("COPILOT_CLI_PATH_INVALID");
      }
    } finally {
      rmSync(script, { force: true });
    }
  });

  it("npm 版（.js への symlink）の保存済みパスは、PUT で同じ値を送り直しても 200", async () => {
    const lib = mkdtempSync(join(tmpdir(), "graphium-npm-copilot-"));
    try {
      const loader = join(lib, "npm-loader.js");
      writeFileSync(loader, "#!/bin/sh\n", { mode: 0o755 });
      const bin = join(lib, "copilot");
      symlinkSync(loader, bin);
      const created = await sub(bin);
      expect(created.status).toBe(201);
      const r = await put(String(created.body.id), { model_name: "Cop", api_base: bin });
      expect(r.status).toBe(200);
    } finally {
      rmSync(lib, { recursive: true, force: true });
    }
  });

  it("実在する実行ファイルの絶対パスは通る。空は自動検出", async () => {
    expect((await sub(process.execPath)).status).toBe(201);
    const empty = await post({ model_name: "Cop2", provider: "copilot-subscription", model_id: "default" });
    expect(empty.status).toBe(201);
  });
});

describe.skipIf(process.platform === "win32")("models.json は本人だけが読める権限で書く", () => {
  it("新規作成も、緩い権限で残っていた既存ファイルも 0o600 になる", async () => {
    const { statSync, chmodSync } = await import("node:fs");
    const file = join(dir, "models.json");
    await post(NEW_MODEL);
    expect(statSync(file).mode & 0o777).toBe(0o600);
    chmodSync(file, 0o644);
    await post({ ...NEW_MODEL, model_name: "Second" });
    expect(statSync(file).mode & 0o777).toBe(0o600);
  });
});
