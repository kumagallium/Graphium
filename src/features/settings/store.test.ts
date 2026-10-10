// @vitest-environment jsdom
// web モード（localStorage レジストリ）のモデル一覧の挙動テスト。
//
// 撤去済みプロバイダ（claude-subscription）のエントリが読み込み時に取り除かれ、
// localStorage にも書き戻されること（サーバー側 models.json の purge と対をなす）。
// これが無いと、旧バージョンで登録したモデルが「登録済みモデル」「既存プロバイダー」に
// 出続け、使うたびに失敗する。

import { beforeEach, describe, expect, it } from "vitest";
import { applyColorMode, getLLMModels, addLLMModel, loadSettings, normalizeAsterismSettings, DEFAULT_CLAIM_BASE_IRI, isAtomLayerEnabled, isClaimsEnabled, isWorldGroundingEnabled, isAutoFullCheckEnabled, isAsterismEnabled, isAutoGroundingEnabled, getInsightModel, getInsightModelName, followModelRename, followModelDeletion, mapModelNameSettings, isMissingModelName, isUnsupportedEmbeddingModelName, MODEL_NAME_SETTING_KEYS, DUPLICATE_MODEL_NAME_ERROR, getDefaultLLMModel, getChatSynthesisLLMModel, getInsightLLMModel, getEmbeddingLLMModel, getGroundingLLMModel, type LLMModelConfig } from "./store";

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

describe("features — AI 機能の表示切り替え（初回起動は OFF、既存ユーザーは ON）", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("保存済み設定が無い（初回起動）場合は claims/insights/worldGrounding/autoFullCheck すべて false になる", () => {
    expect(loadSettings().features).toEqual({ claims: false, insights: false, worldGrounding: false, autoFullCheck: false, asterism: false });
    expect(isClaimsEnabled()).toBe(false);
    expect(isAtomLayerEnabled()).toBe(false);
    expect(isWorldGroundingEnabled()).toBe(false);
    expect(isAutoFullCheckEnabled()).toBe(false);
  });

  it("保存済み設定はあるが features キーが無い（この版より前から使っているユーザー）場合は autoFullCheck 以外 true になる", () => {
    localStorage.setItem("graphium-settings", JSON.stringify({ latinFont: "" }));
    expect(loadSettings().features).toEqual({ claims: true, insights: true, worldGrounding: true, autoFullCheck: false, asterism: false });
    expect(isClaimsEnabled()).toBe(true);
    expect(isAtomLayerEnabled()).toBe(true);
    expect(isWorldGroundingEnabled()).toBe(true);
    // autoFullCheck だけは既存ユーザーでもオプトイン（黙って AI 呼び出しを増やさない）
    expect(isAutoFullCheckEnabled()).toBe(false);
  });

  it("features が無い（キーごと欠落）場合も既定 ON に倒れる", () => {
    localStorage.setItem("graphium-settings", JSON.stringify({}));
    expect(loadSettings().features).toEqual({ claims: true, insights: true, worldGrounding: true, autoFullCheck: false, asterism: false });
  });

  it("features があればその値に従う", () => {
    localStorage.setItem(
      "graphium-settings",
      JSON.stringify({ features: { claims: true, insights: false, worldGrounding: false, autoFullCheck: false } }),
    );
    expect(loadSettings().features).toEqual({ claims: true, insights: false, worldGrounding: false, autoFullCheck: false, asterism: false });
    localStorage.setItem(
      "graphium-settings",
      JSON.stringify({ features: { claims: true, insights: true, worldGrounding: true, autoFullCheck: true } }),
    );
    expect(loadSettings().features).toEqual({ claims: true, insights: true, worldGrounding: true, autoFullCheck: true, asterism: false });
  });

  it("claims が OFF のときは insights の保存値に関わらず false に倒れる（洞察は知見から作るため）", () => {
    localStorage.setItem(
      "graphium-settings",
      JSON.stringify({ features: { claims: false, insights: true, worldGrounding: true } }),
    );
    expect(loadSettings().features).toEqual({ claims: false, insights: false, worldGrounding: true, autoFullCheck: false, asterism: false });
    expect(isClaimsEnabled()).toBe(false);
    expect(isAtomLayerEnabled()).toBe(false);
    expect(isWorldGroundingEnabled()).toBe(true);
  });

  it("autoFullCheck は claims/insights とは独立に決まる（マスタースイッチ依存が無い）", () => {
    localStorage.setItem(
      "graphium-settings",
      JSON.stringify({ features: { claims: false, insights: false, worldGrounding: false, autoFullCheck: true } }),
    );
    expect(isAutoFullCheckEnabled()).toBe(true);
    expect(isClaimsEnabled()).toBe(false);
  });

  it("claims が ON なら insights は独立に決まる", () => {
    localStorage.setItem(
      "graphium-settings",
      JSON.stringify({ features: { claims: true, insights: false, worldGrounding: true } }),
    );
    expect(isClaimsEnabled()).toBe(true);
    expect(isAtomLayerEnabled()).toBe(false);
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

describe("insightModel — 洞察専用モデルの代替順（insightModel → chatSynthesisModel → default）", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("insightModel も chatSynthesisModel も未設定なら空文字（default にフォールバック）", () => {
    localStorage.setItem("graphium-settings", JSON.stringify({}));
    expect(getInsightModel()).toBe("");
    expect(getInsightModelName()).toBe("");
  });

  it("insightModel が空でも chatSynthesisModel があればそれを使う（既存ユーザーの挙動を変えない）", () => {
    localStorage.setItem("graphium-settings", JSON.stringify({ chatSynthesisModel: "gpt-5" }));
    expect(getInsightModel()).toBe("");
    expect(getInsightModelName()).toBe("gpt-5");
  });

  it("insightModel が設定されていれば chatSynthesisModel より優先する", () => {
    localStorage.setItem(
      "graphium-settings",
      JSON.stringify({ chatSynthesisModel: "gpt-5", insightModel: "claude-opus-5" }),
    );
    expect(getInsightModel()).toBe("claude-opus-5");
    expect(getInsightModelName()).toBe("claude-opus-5");
  });
});

describe("モデルの改名・削除への追従（設定はモデルを表示名で覚えている）", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("名前で覚えている項目は 5 つ（既定・チャット・埋め込み・照合・洞察）", () => {
    expect([...MODEL_NAME_SETTING_KEYS].sort()).toEqual(
      ["chatSynthesisModel", "embeddingModel", "groundingModel", "insightModel", "model"],
    );
  });

  it("改名: 古い名前を覚えている項目だけ新しい名前にする", () => {
    expect(followModelRename("GPT", "GPT", "GPT (work)", ["Claude"])).toBe("GPT (work)");
    expect(followModelRename("Claude", "GPT", "GPT (work)", ["Claude"])).toBe("Claude");
    expect(followModelRename("", "GPT", "GPT (work)", ["Claude"])).toBe("");
  });

  it("改名: 同じ名前のモデルがほかにも残るなら変えない（設定はそちらを指し続ける）", () => {
    expect(followModelRename("GPT", "GPT", "GPT (work)", ["GPT", "Claude"])).toBe("GPT");
  });

  it("改名: 新しい名前がほかのモデルと同じなら変えない（先に並ぶ別のモデルに黙って入れ替わるため）", () => {
    expect(followModelRename("GPT", "GPT", "Claude", ["Claude"])).toBe("GPT");
  });

  it("削除: 削除したモデルを覚えている項目は空（その項目の既定）に戻す", () => {
    expect(followModelDeletion("GPT", "GPT", ["Claude"])).toBe("");
    expect(followModelDeletion("Claude", "GPT", ["Claude"])).toBe("Claude");
  });

  it("削除: 同じ名前のモデルがほかにも残るなら変えない", () => {
    expect(followModelDeletion("GPT", "GPT", ["GPT"])).toBe("GPT");
  });

  it("5 項目すべてに当て、ほかの設定と保存形式（名前の文字列）はそのまま", () => {
    localStorage.setItem(
      "graphium-settings",
      JSON.stringify({
        model: "GPT",
        chatSynthesisModel: "GPT",
        embeddingModel: "Embed",
        groundingModel: "GPT",
        insightModel: "Claude",
        disabledTools: ["web_search"],
      }),
    );
    const before = loadSettings();
    const after = mapModelNameSettings(before, (v) => followModelRename(v, "GPT", "GPT (work)", ["Claude", "Embed"]));
    expect(after).toMatchObject({
      model: "GPT (work)",
      chatSynthesisModel: "GPT (work)",
      embeddingModel: "Embed",
      groundingModel: "GPT (work)",
      insightModel: "Claude",
      disabledTools: ["web_search"],
    });
    // 元のオブジェクトは書き換えない
    expect(before.model).toBe("GPT");
  });

  it("何も変わらなければ同じオブジェクトを返す（呼び出し側は保存を省ける）", () => {
    const settings = loadSettings();
    expect(mapModelNameSettings(settings, (v) => followModelDeletion(v, "GPT", []))).toBe(settings);
  });

  it("見つからない名前: 一覧に無い名前だけ。空は対象外", () => {
    expect(isMissingModelName("Deleted model", ["GPT", "Claude"])).toBe(true);
    expect(isMissingModelName("GPT", ["GPT", "Claude"])).toBe(false);
    expect(isMissingModelName("", ["GPT"])).toBe(false);
  });

  it("見つからない名前: 一覧を読めていない（null）・1 件も無いときは判定しない（保存で設定を消さない）", () => {
    expect(isMissingModelName("GPT", null)).toBe(false);
    expect(isMissingModelName("GPT", [])).toBe(false);
  });
});

describe("isUnsupportedEmbeddingModelName", () => {
  const availableNames = ["GPT (OpenAI)", "Claude (Anthropic)"];
  const embeddingCapableNames = ["GPT (OpenAI)"];

  it("空は対象外", () => {
    expect(isUnsupportedEmbeddingModelName("", embeddingCapableNames, availableNames)).toBe(false);
  });

  it("埋め込みに使えるモデルの中にあれば false", () => {
    expect(isUnsupportedEmbeddingModelName("GPT (OpenAI)", embeddingCapableNames, availableNames)).toBe(false);
  });

  it("一覧のどのモデルにも無い名前は false（isMissingModelName の表示を優先する）", () => {
    expect(isUnsupportedEmbeddingModelName("Deleted model", embeddingCapableNames, availableNames)).toBe(false);
  });

  it("一覧にはあるが埋め込みに使えない種類なら true", () => {
    expect(isUnsupportedEmbeddingModelName("Claude (Anthropic)", embeddingCapableNames, availableNames)).toBe(true);
  });

  it("一覧を読めていない（null）ときは判定しない", () => {
    expect(isUnsupportedEmbeddingModelName("Claude (Anthropic)", null, availableNames)).toBe(false);
  });

  it("埋め込みに使えるモデルが 0 件でも、一覧にあるモデルなら判定する", () => {
    // isMissingModelName と違い、embeddingCapableNames の空配列はガードにならない
    expect(isUnsupportedEmbeddingModelName("Claude (Anthropic)", [], availableNames)).toBe(true);
  });
});

describe("addLLMModel — 表示名の重複", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("同じ名前のモデルが既にあれば断る", () => {
    addLLMModel({ name: "GPT", provider: "openai", modelId: "gpt-4o", apiKey: "k", apiBase: null });
    expect(() =>
      addLLMModel({ name: "GPT", provider: "anthropic", modelId: "claude", apiKey: "k2", apiBase: null }),
    ).toThrowError(DUPLICATE_MODEL_NAME_ERROR);
    // 断ったので 1 件のまま
    expect(getLLMModels()).toHaveLength(1);
  });

  it("違う名前なら追加できる", () => {
    addLLMModel({ name: "GPT", provider: "openai", modelId: "gpt-4o", apiKey: "k", apiBase: null });
    addLLMModel({ name: "Claude", provider: "anthropic", modelId: "claude", apiKey: "k2", apiBase: null });
    expect(getLLMModels()).toHaveLength(2);
  });
});

describe("getXxxLLMModel — 空・ある・見つからない・回り道の先が見つからない（Web 版で古いモデル名のとき黙って別のモデルへ回さない）", () => {
  const model = (name: string): LLMModelConfig => ({
    id: name,
    name,
    provider: "openai-compatible",
    modelId: name,
    apiKey: "key",
    apiBase: null,
  });

  beforeEach(() => {
    localStorage.clear();
  });

  function setModels(models: LLMModelConfig[]): void {
    localStorage.setItem(LLM_MODELS_KEY, JSON.stringify(models));
  }

  function setSettings(settings: Record<string, unknown>): void {
    localStorage.setItem("graphium-settings", JSON.stringify(settings));
  }

  describe("getDefaultLLMModel（settings.model）", () => {
    it("空: 先頭のモデルにフォールバックする（初回起動時の既存挙動）", () => {
      setModels([model("First"), model("Second")]);
      setSettings({ model: "" });
      expect(getDefaultLLMModel()?.name).toBe("First");
    });

    it("ある: 一致するモデルを返す", () => {
      setModels([model("First"), model("Second")]);
      setSettings({ model: "Second" });
      expect(getDefaultLLMModel()?.name).toBe("Second");
    });

    it("見つからない: 名前があるのに一覧に無い（改名・削除後の古い名前）→ undefined（先頭へ回さない）", () => {
      setModels([model("First"), model("Second")]);
      setSettings({ model: "Deleted" });
      expect(getDefaultLLMModel()).toBeUndefined();
    });

    it("モデルが 1 件も無い: 今のまま undefined", () => {
      setModels([]);
      setSettings({ model: "Anything" });
      expect(getDefaultLLMModel()).toBeUndefined();
    });
  });

  describe("getChatSynthesisLLMModel（chatSynthesisModel → default）", () => {
    it("空: default にフォールバックする", () => {
      setModels([model("Default")]);
      setSettings({ model: "Default", chatSynthesisModel: "" });
      expect(getChatSynthesisLLMModel()?.name).toBe("Default");
    });

    it("ある: 一致するモデルを返す（default とは別でよい）", () => {
      setModels([model("Default"), model("Chat")]);
      setSettings({ model: "Default", chatSynthesisModel: "Chat" });
      expect(getChatSynthesisLLMModel()?.name).toBe("Chat");
    });

    it("見つからない: chatSynthesisModel が古い名前 → undefined（default へ回さない）", () => {
      setModels([model("Default")]);
      setSettings({ model: "Default", chatSynthesisModel: "Deleted" });
      expect(getChatSynthesisLLMModel()).toBeUndefined();
    });

    it("回り道の先が見つからない: chatSynthesisModel が空で、default（settings.model）も古い名前 → undefined", () => {
      setModels([model("Other")]);
      setSettings({ model: "Deleted", chatSynthesisModel: "" });
      expect(getChatSynthesisLLMModel()).toBeUndefined();
    });
  });

  describe("getInsightLLMModel（insightModel → chatSynthesis → default）", () => {
    it("空: チャットモデル（さらに空なら default）にフォールバックする", () => {
      setModels([model("Default")]);
      setSettings({ model: "Default", chatSynthesisModel: "", insightModel: "" });
      expect(getInsightLLMModel()?.name).toBe("Default");
    });

    it("ある: 一致するモデルを返す", () => {
      setModels([model("Default"), model("Insight")]);
      setSettings({ model: "Default", insightModel: "Insight" });
      expect(getInsightLLMModel()?.name).toBe("Insight");
    });

    it("見つからない: insightModel が古い名前 → undefined（チャットモデルへ回さない）", () => {
      setModels([model("Default")]);
      setSettings({ model: "Default", insightModel: "Deleted" });
      expect(getInsightLLMModel()).toBeUndefined();
    });

    it("回り道の先が見つからない: insightModel が空で、チャットモデルの古い名前 → undefined", () => {
      setModels([model("Default")]);
      setSettings({ model: "Default", chatSynthesisModel: "Deleted", insightModel: "" });
      expect(getInsightLLMModel()).toBeUndefined();
    });
  });

  describe("getGroundingLLMModel（groundingModel → chatSynthesis → default）", () => {
    it("空: チャットモデル（さらに空なら default）にフォールバックする", () => {
      setModels([model("Default")]);
      setSettings({ model: "Default", chatSynthesisModel: "", groundingModel: "" });
      expect(getGroundingLLMModel()?.name).toBe("Default");
    });

    it("ある: 一致するモデルを返す", () => {
      setModels([model("Default"), model("Grounding")]);
      setSettings({ model: "Default", groundingModel: "Grounding" });
      expect(getGroundingLLMModel()?.name).toBe("Grounding");
    });

    it("見つからない: groundingModel が古い名前 → undefined（チャットモデルへ回さない）", () => {
      setModels([model("Default")]);
      setSettings({ model: "Default", groundingModel: "Deleted" });
      expect(getGroundingLLMModel()).toBeUndefined();
    });

    it("回り道の先が見つからない: groundingModel が空で、チャットモデルの古い名前 → undefined", () => {
      setModels([model("Default")]);
      setSettings({ model: "Default", chatSynthesisModel: "Deleted", groundingModel: "" });
      expect(getGroundingLLMModel()).toBeUndefined();
    });
  });

  describe("getEmbeddingLLMModel（embeddingModel → default）", () => {
    it("空: default にフォールバックする", () => {
      setModels([model("Default")]);
      setSettings({ model: "Default", embeddingModel: "" });
      expect(getEmbeddingLLMModel()?.name).toBe("Default");
    });

    it("ある: 一致するモデルを返す", () => {
      setModels([model("Default"), model("Embed")]);
      setSettings({ model: "Default", embeddingModel: "Embed" });
      expect(getEmbeddingLLMModel()?.name).toBe("Embed");
    });

    it("見つからない: embeddingModel が古い名前 → undefined（default へ回さない）", () => {
      setModels([model("Default")]);
      setSettings({ model: "Default", embeddingModel: "Deleted" });
      expect(getEmbeddingLLMModel()).toBeUndefined();
    });

    it("回り道の先が見つからない: embeddingModel が空で、default（settings.model）も古い名前 → undefined", () => {
      setModels([model("Other")]);
      setSettings({ model: "Deleted", embeddingModel: "" });
      expect(getEmbeddingLLMModel()).toBeUndefined();
    });
  });
});

describe("loadSettings: newNotesOnA4（新しいノートを A4 の幅で始める）", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("未保存・項目なしの古い設定・壊れた値は OFF", () => {
    expect(loadSettings().newNotesOnA4).toBe(false);
    localStorage.setItem("graphium-settings", JSON.stringify({ model: "x" }));
    expect(loadSettings().newNotesOnA4).toBe(false);
    localStorage.setItem("graphium-settings", JSON.stringify({ newNotesOnA4: "yes" }));
    expect(loadSettings().newNotesOnA4).toBe(false);
  });

  it("true を保存すれば ON で読める", () => {
    localStorage.setItem("graphium-settings", JSON.stringify({ newNotesOnA4: true }));
    expect(loadSettings().newNotesOnA4).toBe(true);
  });
});

describe("features.asterism — Asterism 連携トグル（オプトイン）", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("初回起動・features キー無し・キー欠損のいずれも false", () => {
    expect(loadSettings().features?.asterism).toBe(false);
    localStorage.setItem("graphium-settings", JSON.stringify({}));
    expect(loadSettings().features?.asterism).toBe(false);
    localStorage.setItem("graphium-settings", JSON.stringify({ features: { claims: true } }));
    expect(loadSettings().features?.asterism).toBe(false);
    expect(isAsterismEnabled()).toBe(false);
  });

  it("boolean 以外は false に倒し、true はそのまま読む", () => {
    localStorage.setItem("graphium-settings", JSON.stringify({ features: { asterism: "yes" } }));
    expect(loadSettings().features?.asterism).toBe(false);
    localStorage.setItem("graphium-settings", JSON.stringify({ features: { asterism: true } }));
    expect(loadSettings().features?.asterism).toBe(true);
    expect(isAsterismEnabled()).toBe(true);
  });
});

describe("asterism — Asterism 連携の受け口設定", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  const EMPTY = {
    vocabBaseIri: "",
    claimBaseIri: DEFAULT_CLAIM_BASE_IRI,
    typeSlugs: { observation: "", interpretation: "", rule: "", judgment: "" },
  };

  it("設定なし・キー欠損は全て空の既定", () => {
    expect(loadSettings().asterism).toEqual(EMPTY);
    localStorage.setItem("graphium-settings", JSON.stringify({ model: "x" }));
    expect(loadSettings().asterism).toEqual(EMPTY);
  });

  it("claimBaseIri は既定が Graphium の base。キー欠損・非文字列は既定、明示的な空は空のまま", () => {
    expect(loadSettings().asterism.claimBaseIri).toBe(DEFAULT_CLAIM_BASE_IRI);
    expect(normalizeAsterismSettings({ claimBaseIri: "" }).claimBaseIri).toBe("");
    expect(normalizeAsterismSettings({ claimBaseIri: 1 }).claimBaseIri).toBe(DEFAULT_CLAIM_BASE_IRI);
    expect(normalizeAsterismSettings({}).claimBaseIri).toBe(DEFAULT_CLAIM_BASE_IRI);
  });

  it("部分的に壊れた値から復元し、前後空白を trim する", () => {
    expect(
      normalizeAsterismSettings({
        vocabBaseIri: "  https://example.org/vocab#  ",
        claimBaseIri: "  https://example.org/claim/ ",
        typeSlugs: { observation: 1, rule: " rule ", judgment: null },
      }),
    ).toEqual({
      vocabBaseIri: "https://example.org/vocab#",
      claimBaseIri: "https://example.org/claim/",
      typeSlugs: { observation: "", interpretation: "", rule: "rule", judgment: "" },
    });
    expect(normalizeAsterismSettings({ typeSlugs: "oops" })).toEqual(EMPTY);
    expect(normalizeAsterismSettings(null)).toEqual(EMPTY);
  });

  it("保存済みの asterism を loadSettings が正規化して返す", () => {
    localStorage.setItem(
      "graphium-settings",
      JSON.stringify({ asterism: { vocabBaseIri: " https://a.example/# ", typeSlugs: { rule: " r " } } }),
    );
    expect(loadSettings().asterism.vocabBaseIri).toBe("https://a.example/#");
    expect(loadSettings().asterism.typeSlugs.rule).toBe("r");
  });

  it("MODEL_NAME_SETTING_KEYS に asterism は含まれない", () => {
    expect((MODEL_NAME_SETTING_KEYS as readonly string[]).includes("asterism")).toBe(false);
  });
});
