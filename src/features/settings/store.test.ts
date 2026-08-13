// @vitest-environment jsdom
// web モード（localStorage レジストリ）のモデル一覧の挙動テスト。
//
// 撤去済みプロバイダ（claude-subscription）のエントリが読み込み時に取り除かれ、
// localStorage にも書き戻されること（サーバー側 models.json の purge と対をなす）。
// これが無いと、旧バージョンで登録したモデルが「登録済みモデル」「既存プロバイダー」に
// 出続け、使うたびに失敗する。

import { beforeEach, describe, expect, it } from "vitest";
import { getLLMModels } from "./store";

const LLM_MODELS_KEY = "graphium-llm-models";

describe("getLLMModels — 撤去済みプロバイダの purge", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("claude-subscription のエントリは一覧から取り除かれ、localStorage からも消える", () => {
    localStorage.setItem(
      LLM_MODELS_KEY,
      JSON.stringify([
        {
          id: "a",
          name: "Claude（サブスクリプション）",
          provider: "claude-subscription",
          modelId: "sonnet",
          apiKey: "",
          apiBase: null,
        },
        {
          id: "b",
          name: "gpt-oss-120b",
          provider: "openai-compatible",
          modelId: "gpt-oss-120b",
          apiKey: "key",
          apiBase: "https://api.ai.sakura.ad.jp/v1",
        },
      ]),
    );
    const models = getLLMModels();
    expect(models.map((m) => m.id)).toEqual(["b"]);
    const stored = JSON.parse(localStorage.getItem(LLM_MODELS_KEY) ?? "[]") as {
      id: string;
    }[];
    expect(stored.map((m) => m.id)).toEqual(["b"]);
  });

  it("該当エントリが無ければ localStorage を書き換えない", () => {
    const raw = JSON.stringify([
      {
        id: "b",
        name: "copilot",
        provider: "copilot-subscription",
        modelId: "default",
        apiKey: "",
        apiBase: null,
      },
    ]);
    localStorage.setItem(LLM_MODELS_KEY, raw);
    expect(getLLMModels()).toHaveLength(1);
    expect(localStorage.getItem(LLM_MODELS_KEY)).toBe(raw);
  });
});
