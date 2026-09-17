// POST /api/wiki/check-sources の route レベルテスト
// LLM は呼ばない範囲（入力バリデーション・モデル未登録 degrade）だけを検証する。
// 判定ロジック本体（プロンプト構築・パース・quote 照合）は
// src/server/services/source-check.test.ts で LLM をモックして検証する。

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "../app.js";
import { setDataDir, setServerMode } from "../config/models.js";

let dir: string;

beforeEach(() => {
  // models.json を実データディレクトリから隔離する — このテストは「モデル未登録」を
  // 検証するので、開発者のローカル環境に登録済みモデルがあっても影響を受けない。
  dir = mkdtempSync(join(tmpdir(), "graphium-check-sources-test-"));
  setDataDir(dir);
  setServerMode("node");
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("POST /api/wiki/check-sources", () => {
  const validBody = {
    source: { id: "note-1", kind: "note", text: "焼結温度を上げると粒成長が進んだ。" },
    claims: [{ id: "claim-1", title: "A", body: "焼結温度が高いほど粒成長が進む。" }],
  };

  it("source.text が無ければ 400", async () => {
    const app = createApp({ mode: "node" });
    const res = await app.request("http://localhost/api/wiki/check-sources", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ source: { id: "n1", kind: "note", text: "" }, claims: validBody.claims }),
    });
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.result).toBeNull();
  });

  it("claims が空配列なら 400", async () => {
    const app = createApp({ mode: "node" });
    const res = await app.request("http://localhost/api/wiki/check-sources", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ source: validBody.source, claims: [] }),
    });
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.result).toBeNull();
  });

  it("モデル未登録 → HTTP 200 で result:null + code:NO_MODEL_REGISTERED に degrade する", async () => {
    const app = createApp({ mode: "node" });
    const res = await app.request("http://localhost/api/wiki/check-sources", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(validBody),
    });
    // 例外で落とさず 200 + result:null + code（world-grounding の /check と同じ流儀）
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.result).toBeNull();
    expect(json.code).toBe("NO_MODEL_REGISTERED");
  });
});
