// findModelsWithMissingApiKey の挙動テスト
//
// Keychain ダウングレード罠の早期発見ロジック（/api/health で
// "keys-missing" を返すための判定）が、典型ケースで正しく動くことを保証する。
// Keychain そのものは macOS のシステム CLI に依存するので、ここでは
// non-keychain（ファイルベース）の経路だけを検証する。

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  findModelsWithMissingApiKey,
  setDataDir,
  setServerMode,
} from "./models.js";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "graphium-models-test-"));
  setDataDir(dir);
  setServerMode("node");
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("findModelsWithMissingApiKey", () => {
  it("returns empty when no models are registered", () => {
    expect(findModelsWithMissingApiKey()).toEqual([]);
  });

  it("returns empty when all models have an apiKey on disk", () => {
    writeFileSync(
      join(dir, "models.json"),
      JSON.stringify([
        {
          id: "m1",
          name: "claude-sonnet",
          provider: "anthropic",
          modelId: "claude-sonnet",
          apiKey: "sk-anthropic-...",
          apiBase: null,
          createdAt: "2026-05-26T00:00:00Z",
        },
      ]),
    );
    expect(findModelsWithMissingApiKey()).toEqual([]);
  });

  it("flags models with no apiKey field (Keychain downgrade trap)", () => {
    // Keychain 有効版で起動 → 移行で apiKey フィールドが models.json から削除された
    // 状態を再現。Keychain 非対応版（=このテスト環境）が起動するとここに該当する。
    writeFileSync(
      join(dir, "models.json"),
      JSON.stringify([
        {
          id: "m1",
          name: "gpt-oss-120b",
          provider: "openai-compatible",
          modelId: "gpt-oss-120b",
          apiBase: "https://api.ai.sakura.ad.jp/v1",
          createdAt: "2026-05-04T07:12:33Z",
        },
        {
          id: "m2",
          name: "claude-opus-4-7",
          provider: "anthropic",
          modelId: "claude-opus-4-7",
          apiBase: null,
          createdAt: "2026-04-24T10:06:42Z",
        },
      ]),
    );
    expect(findModelsWithMissingApiKey()).toEqual([
      { id: "m1", name: "gpt-oss-120b", provider: "openai-compatible" },
      { id: "m2", name: "claude-opus-4-7", provider: "anthropic" },
    ]);
  });

  it("flags only the models that are missing a key (mixed state)", () => {
    writeFileSync(
      join(dir, "models.json"),
      JSON.stringify([
        {
          id: "m1",
          name: "broken",
          provider: "anthropic",
          modelId: "x",
          // apiKey 欠落
          apiBase: null,
          createdAt: "2026-05-26T00:00:00Z",
        },
        {
          id: "m2",
          name: "ok",
          provider: "anthropic",
          modelId: "y",
          apiKey: "sk-...",
          apiBase: null,
          createdAt: "2026-05-26T00:00:00Z",
        },
        {
          id: "m3",
          name: "also-broken",
          provider: "openai",
          modelId: "z",
          apiKey: "", // 明示的空文字も broken 扱い
          apiBase: null,
          createdAt: "2026-05-26T00:00:00Z",
        },
      ]),
    );
    const out = findModelsWithMissingApiKey();
    expect(out).toEqual([
      { id: "m1", name: "broken", provider: "anthropic" },
      { id: "m3", name: "also-broken", provider: "openai" },
    ]);
  });

  it("does not flag claude-subscription models (keyless by design)", () => {
    // claude-subscription は Claude Code のサブスク認証を使い API キーを持たない。
    // 空キーでも事故ではないので警告対象に含めてはいけない。
    writeFileSync(
      join(dir, "models.json"),
      JSON.stringify([
        {
          id: "m1",
          name: "Opus-latest",
          provider: "claude-subscription",
          modelId: "opus",
          apiKey: "",
          apiBase: null,
          createdAt: "2026-06-19T00:00:00Z",
        },
        {
          id: "m2",
          name: "broken-anthropic",
          provider: "anthropic",
          modelId: "claude-opus-4-8",
          apiKey: "",
          apiBase: null,
          createdAt: "2026-06-19T00:00:00Z",
        },
      ]),
    );
    // subscription は除外、空キーの anthropic だけ flag される
    expect(findModelsWithMissingApiKey()).toEqual([
      { id: "m2", name: "broken-anthropic", provider: "anthropic" },
    ]);
  });

  it("returns empty in vercel mode regardless of file contents", () => {
    setServerMode("vercel");
    writeFileSync(
      join(dir, "models.json"),
      JSON.stringify([
        {
          id: "m1",
          name: "stale",
          provider: "anthropic",
          modelId: "x",
          apiBase: null,
          createdAt: "2026-05-26T00:00:00Z",
        },
      ]),
    );
    // Vercel モードはヘッダ経由でキーが渡る前提なので、ファイル上の欠落は
    // ユーザー警告の対象にしない。
    expect(findModelsWithMissingApiKey()).toEqual([]);
  });
});
