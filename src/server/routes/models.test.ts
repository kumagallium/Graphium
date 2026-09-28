// モデル追加・更新の表示名重複チェック。
// 表示名は一意という前提で名前引き（header-model.ts の resolveModelConfig 等）が動くため、
// 重複を作れてしまうと、選んだつもりのないモデルが動く事故になる。

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
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
