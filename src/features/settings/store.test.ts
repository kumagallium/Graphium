// @vitest-environment jsdom
// web モード（localStorage レジストリ）のモデル一覧の挙動テスト。
//
// 撤去済みプロバイダ（claude-subscription）のエントリが読み込み時に取り除かれ、
// localStorage にも書き戻されること（サーバー側 models.json の purge と対をなす）。
// これが無いと、旧バージョンで登録したモデルが「登録済みモデル」「既存プロバイダー」に
// 出続け、使うたびに失敗する。

import { beforeEach, describe, expect, it } from "vitest";
import { applyColorMode, getLLMModels, loadSettings, isAtomLayerEnabled, isWorldGroundingEnabled, isAutoGroundingEnabled } from "./store";

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

describe("colorMode — 読みやすさ（色）設定", () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.removeAttribute("data-color-mode");
  });

  it("未知の値は ''（デフォルト）に倒れる", () => {
    localStorage.setItem("graphium-settings", JSON.stringify({ colorMode: "neon" }));
    expect(loadSettings().colorMode).toBe("");
  });

  it("有効な値は保持される", () => {
    localStorage.setItem("graphium-settings", JSON.stringify({ colorMode: "high-contrast" }));
    expect(loadSettings().colorMode).toBe("high-contrast");
  });

  it("未設定（既存ユーザーの settings JSON）は '' になる", () => {
    localStorage.setItem("graphium-settings", JSON.stringify({ latinFont: "" }));
    expect(loadSettings().colorMode).toBe("");
  });

  it("applyColorMode は html（:root）に data-color-mode を付け外しする", () => {
    applyColorMode("white-paper");
    expect(document.documentElement.getAttribute("data-color-mode")).toBe("white-paper");
    // body ではなく :root に付ける（@theme の --color-* は :root で解決されるため、
    // body への再宣言では届かない — 詳細は store.ts の applyColorMode の JSDoc）
    expect(document.body.getAttribute("data-color-mode")).toBeNull();
    applyColorMode("");
    expect(document.documentElement.getAttribute("data-color-mode")).toBeNull();
  });
});

describe("features — AI 機能の表示切り替え（既定 ON）", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("未保存（旧バージョンの settings JSON）は両方 true になる", () => {
    localStorage.setItem("graphium-settings", JSON.stringify({ latinFont: "" }));
    expect(loadSettings().features).toEqual({ insights: true, worldGrounding: true });
    expect(isAtomLayerEnabled()).toBe(true);
    expect(isWorldGroundingEnabled()).toBe(true);
  });

  it("features が無い（キーごと欠落）場合も既定 ON に倒れる", () => {
    localStorage.setItem("graphium-settings", JSON.stringify({}));
    expect(loadSettings().features).toEqual({ insights: true, worldGrounding: true });
  });

  it("明示的に false を保存すればそれぞれ独立に反映される", () => {
    localStorage.setItem(
      "graphium-settings",
      JSON.stringify({ features: { insights: false, worldGrounding: true } }),
    );
    expect(isAtomLayerEnabled()).toBe(false);
    expect(isWorldGroundingEnabled()).toBe(true);
  });

  it("壊れた値（boolean 以外）は既定 ON にフォールバックする", () => {
    localStorage.setItem(
      "graphium-settings",
      JSON.stringify({ features: { insights: "yes", worldGrounding: null } }),
    );
    expect(isAtomLayerEnabled()).toBe(true);
    expect(isWorldGroundingEnabled()).toBe(true);
  });

  it("旧 experimental.atomLayer は features.insights に影響しない（死んだフィールド）", () => {
    localStorage.setItem(
      "graphium-settings",
      JSON.stringify({ experimental: { atomLayer: false, synthesis: false, autoGrounding: false } }),
    );
    expect(isAtomLayerEnabled()).toBe(true);
  });

  it("worldGrounding OFF のときは自動照合トグルが ON でも isAutoGroundingEnabled は false", () => {
    localStorage.setItem(
      "graphium-settings",
      JSON.stringify({
        features: { insights: true, worldGrounding: false },
        experimental: { atomLayer: false, synthesis: false, autoGrounding: true },
      }),
    );
    expect(isAutoGroundingEnabled()).toBe(false);
  });
});
