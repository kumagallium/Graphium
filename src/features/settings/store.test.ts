// @vitest-environment jsdom
// web モード（localStorage レジストリ）のモデル一覧の挙動テスト。
//
// 撤去済みプロバイダ（claude-subscription）のエントリが読み込み時に取り除かれ、
// localStorage にも書き戻されること（サーバー側 models.json の purge と対をなす）。
// これが無いと、旧バージョンで登録したモデルが「登録済みモデル」「既存プロバイダー」に
// 出続け、使うたびに失敗する。

import { beforeEach, describe, expect, it } from "vitest";
import { applyColorMode, getLLMModels, addLLMModel, loadSettings, normalizeAsterismSettings, fillAsterismRecommendedIfEmpty, DEFAULT_CLAIM_BASE_IRI, ASTERISM_RECOMMENDED, isAtomLayerEnabled, isClaimsEnabled, isWorldGroundingEnabled, isAutoFullCheckEnabled, isAsterismEnabled, getMeetingSettings, setMeetingSettings, getMeetingAiModelName, isAutoGroundingEnabled, getStandardModelName, getPreciseModelName, migrateModelTiers, followModelRename, followModelDeletion, mapModelNameSettings, isMissingModelName, isUnsupportedEmbeddingModelName, MODEL_NAME_SETTING_KEYS, DUPLICATE_MODEL_NAME_ERROR, getDefaultLLMModel, getChatSynthesisLLMModel, getPreciseLLMModel, getStandardLLMModel, getEmbeddingLLMModel, getGroundingLLMModel, type LLMModelConfig } from "./store";

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
    expect(loadSettings().features).toEqual({ claims: false, insights: false, worldGrounding: false, autoFullCheck: false, asterism: false, sourceSummaries: false });
    expect(isClaimsEnabled()).toBe(false);
    expect(isAtomLayerEnabled()).toBe(false);
    expect(isWorldGroundingEnabled()).toBe(false);
    expect(isAutoFullCheckEnabled()).toBe(false);
  });

  it("保存済み設定はあるが features キーが無い（この版より前から使っているユーザー）場合は autoFullCheck 以外 true になる", () => {
    localStorage.setItem("graphium-settings", JSON.stringify({ latinFont: "" }));
    expect(loadSettings().features).toEqual({ claims: true, insights: true, worldGrounding: true, autoFullCheck: false, asterism: false, sourceSummaries: false });
    expect(isClaimsEnabled()).toBe(true);
    expect(isAtomLayerEnabled()).toBe(true);
    expect(isWorldGroundingEnabled()).toBe(true);
    // autoFullCheck だけは既存ユーザーでもオプトイン（黙って AI 呼び出しを増やさない）
    expect(isAutoFullCheckEnabled()).toBe(false);
  });

  it("features が無い（キーごと欠落）場合も既定 ON に倒れる", () => {
    localStorage.setItem("graphium-settings", JSON.stringify({}));
    expect(loadSettings().features).toEqual({ claims: true, insights: true, worldGrounding: true, autoFullCheck: false, asterism: false, sourceSummaries: false });
  });

  it("features があればその値に従う", () => {
    localStorage.setItem(
      "graphium-settings",
      JSON.stringify({ features: { claims: true, insights: false, worldGrounding: false, autoFullCheck: false } }),
    );
    expect(loadSettings().features).toEqual({ claims: true, insights: false, worldGrounding: false, autoFullCheck: false, asterism: false, sourceSummaries: false });
    localStorage.setItem(
      "graphium-settings",
      JSON.stringify({ features: { claims: true, insights: true, worldGrounding: true, autoFullCheck: true } }),
    );
    expect(loadSettings().features).toEqual({ claims: true, insights: true, worldGrounding: true, autoFullCheck: true, asterism: false, sourceSummaries: false });
  });

  it("claims が OFF のときは insights の保存値に関わらず false に倒れる（洞察は知見から作るため）", () => {
    localStorage.setItem(
      "graphium-settings",
      JSON.stringify({ features: { claims: false, insights: true, worldGrounding: true } }),
    );
    expect(loadSettings().features).toEqual({ claims: false, insights: false, worldGrounding: true, autoFullCheck: false, asterism: false, sourceSummaries: false });
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

describe("難しさ別の 3 段（デフォルト → 標準 → 精密）", () => {
  beforeEach(() => {
    localStorage.clear();
  });
  const save = (v: Record<string, unknown>) =>
    localStorage.setItem("graphium-settings", JSON.stringify({ modelTiersV1: true, ...v }));

  it("標準も精密も空ならデフォルト、それも空なら空文字（サーバーの既定）", () => {
    save({});
    expect(getStandardModelName()).toBe("");
    expect(getPreciseModelName()).toBe("");
    save({ model: "small" });
    expect(getStandardModelName()).toBe("small");
    expect(getPreciseModelName()).toBe("small");
  });

  it("精密が空なら標準に落ちる（デフォルトまで下がらない）", () => {
    save({ model: "small", standardModel: "mid" });
    expect(getStandardModelName()).toBe("mid");
    expect(getPreciseModelName()).toBe("mid");
  });

  it("精密を決めれば精密だけが変わる", () => {
    save({ model: "small", standardModel: "mid", preciseModel: "strong" });
    expect(getStandardModelName()).toBe("mid");
    expect(getPreciseModelName()).toBe("strong");
  });
});

describe("migrateModelTiers — 機能ごとの割り当てから 3 段へ（1 回だけ）", () => {
  const base = { model: "", chatSynthesisModel: "", insightModel: "", meetingAiModel: "", standardModel: "", preciseModel: "", modelTiersV1: false };

  it("何も決めていない人は何も変わらない", () => {
    expect(migrateModelTiers(base)).toEqual({ ...base, modelTiersV1: true });
  });

  it("デフォルトだけ決めていた人は、デフォルトのまま（全段がそのモデル）", () => {
    expect(migrateModelTiers({ ...base, model: "A" })).toMatchObject({ model: "A", standardModel: "", preciseModel: "" });
  });

  it("チャットを別にしていた人: 軽い処理はチャットのモデル、標準と精密（手順・計画）は元のデフォルト", () => {
    const m = migrateModelTiers({ ...base, model: "cheap", chatSynthesisModel: "chat" });
    expect(m).toMatchObject({ model: "chat", chatSynthesisModel: "", standardModel: "cheap", preciseModel: "" });
  });

  it("洞察モデルを決めていた人は、それが精密の段になる", () => {
    const m = migrateModelTiers({ ...base, model: "cheap", chatSynthesisModel: "chat", insightModel: "opus" });
    expect(m).toMatchObject({ model: "chat", standardModel: "cheap", preciseModel: "opus", insightModel: "" });
  });

  it("清書と要約の専用モデルはそのまま残す", () => {
    expect(migrateModelTiers({ ...base, model: "A", meetingAiModel: "M" }).meetingAiModel).toBe("M");
  });

  it("移し替え済みなら何もしない", () => {
    const done = { ...base, model: "X", chatSynthesisModel: "Y", modelTiersV1: true };
    expect(migrateModelTiers(done)).toBe(done);
  });

  it("読み込み時に移し替わり、チャットの使うモデルは変わらない", () => {
    localStorage.setItem("graphium-settings", JSON.stringify({ model: "cheap", chatSynthesisModel: "chat" }));
    const s = loadSettings();
    expect(s.model).toBe("chat");
    expect(s.standardModel).toBe("cheap");
    expect(s.modelTiersV1).toBe(true);
  });
});

describe("モデルの改名・削除への追従（設定はモデルを表示名で覚えている）", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("名前で覚えている項目は 8 つ（3 段・チャット・埋め込み・照合・旧洞察・音声ノートの清書と要約）", () => {
    expect([...MODEL_NAME_SETTING_KEYS].sort()).toEqual(
      ["chatSynthesisModel", "embeddingModel", "groundingModel", "insightModel", "meetingAiModel", "model", "preciseModel", "standardModel"],
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

  it("名前で覚えている項目すべてに当て、ほかの設定と保存形式（名前の文字列）はそのまま", () => {
    localStorage.setItem(
      "graphium-settings",
      JSON.stringify({
        modelTiersV1: true,
        model: "GPT",
        standardModel: "GPT",
        preciseModel: "Claude",
        chatSynthesisModel: "GPT",
        embeddingModel: "Embed",
        groundingModel: "GPT",
        disabledTools: ["web_search"],
      }),
    );
    const before = loadSettings();
    const after = mapModelNameSettings(before, (v) => followModelRename(v, "GPT", "GPT (work)", ["Claude", "Embed"]));
    expect(after).toMatchObject({
      model: "GPT (work)",
      standardModel: "GPT (work)",
      preciseModel: "Claude",
      chatSynthesisModel: "GPT (work)",
      embeddingModel: "Embed",
      groundingModel: "GPT (work)",
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
    // 3 段へ移し替え済みの形で置く（移し替えそのものは migrateModelTiers のテストで見る）
    localStorage.setItem("graphium-settings", JSON.stringify({ modelTiersV1: true, ...settings }));
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

  describe("getStandardLLMModel / getPreciseLLMModel（精密 → 標準 → default）", () => {
    it("空: 精密は標準、標準は default に落ちる", () => {
      setModels([model("Default"), model("Mid")]);
      setSettings({ model: "Default", standardModel: "Mid", preciseModel: "" });
      expect(getStandardLLMModel()?.name).toBe("Mid");
      expect(getPreciseLLMModel()?.name).toBe("Mid");
    });

    it("ある: 一致するモデルを返す", () => {
      setModels([model("Default"), model("Strong")]);
      setSettings({ model: "Default", preciseModel: "Strong" });
      expect(getPreciseLLMModel()?.name).toBe("Strong");
      expect(getStandardLLMModel()?.name).toBe("Default");
    });

    it("見つからない: preciseModel が古い名前 → undefined（下の段へ黙って回さない）", () => {
      setModels([model("Default")]);
      setSettings({ model: "Default", preciseModel: "Deleted" });
      expect(getPreciseLLMModel()).toBeUndefined();
    });
  });

  describe("getGroundingLLMModel（いつも default。v0.125 で専用の選択欄を外した）", () => {
    it("古い設定に groundingModel が残っていても読まず、default を使う", () => {
      setModels([model("Default"), model("Grounding")]);
      setSettings({ model: "Default", groundingModel: "Grounding" });
      expect(getGroundingLLMModel()?.name).toBe("Default");
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

  const EMPTY = { vocabBaseIri: "", claimBaseIri: "", typeSlugs: { observation: "", interpretation: "", rule: "", judgment: "" } };

  it("推奨値の中身", () => {
    expect(ASTERISM_RECOMMENDED).toEqual({
      vocabBaseIri: "https://kumagallium.github.io/asterism/vocab/shared#",
      claimBaseIri: DEFAULT_CLAIM_BASE_IRI,
      typeSlugs: { observation: "sosa:Observation", interpretation: "interpretation", rule: "rule", judgment: "judgment" },
    });
  });

  it("設定なし・キー欠損は推奨値が既定", () => {
    expect(loadSettings().asterism).toEqual(ASTERISM_RECOMMENDED);
    localStorage.setItem("graphium-settings", JSON.stringify({ model: "x" }));
    expect(loadSettings().asterism).toEqual(ASTERISM_RECOMMENDED);
  });

  it("文字列 \"\" は利用者が消した状態として尊重し、キー欠損・非文字列は推奨値", () => {
    expect(normalizeAsterismSettings({ claimBaseIri: "" }).claimBaseIri).toBe("");
    expect(normalizeAsterismSettings({ vocabBaseIri: "", typeSlugs: { rule: "" } })).toEqual({
      ...ASTERISM_RECOMMENDED,
      vocabBaseIri: "",
      typeSlugs: { ...ASTERISM_RECOMMENDED.typeSlugs, rule: "" },
    });
    expect(normalizeAsterismSettings({ claimBaseIri: 1 }).claimBaseIri).toBe(DEFAULT_CLAIM_BASE_IRI);
    expect(normalizeAsterismSettings({}).claimBaseIri).toBe(DEFAULT_CLAIM_BASE_IRI);
  });

  it("語・型を全て空にして保存したら、再読み込みでも空のまま尊重される", () => {
    localStorage.setItem(
      "graphium-settings",
      JSON.stringify({
        asterism: {
          vocabBaseIri: "",
          claimBaseIri: "https://example.org/claim/",
          typeSlugs: { observation: "", interpretation: "", rule: "", judgment: "" },
        },
      }),
    );
    expect(loadSettings().asterism).toEqual({
      vocabBaseIri: "",
      claimBaseIri: "https://example.org/claim/",
      typeSlugs: { observation: "", interpretation: "", rule: "", judgment: "" },
    });
  });

  it("部分的に壊れた値は推奨値で補い、前後空白を trim する", () => {
    expect(
      normalizeAsterismSettings({
        vocabBaseIri: "  https://example.org/vocab#  ",
        claimBaseIri: "  https://example.org/claim/ ",
        typeSlugs: { observation: 1, rule: " rule2 ", judgment: null },
      }),
    ).toEqual({
      vocabBaseIri: "https://example.org/vocab#",
      claimBaseIri: "https://example.org/claim/",
      typeSlugs: { observation: "sosa:Observation", interpretation: "interpretation", rule: "rule2", judgment: "judgment" },
    });
    expect(normalizeAsterismSettings({ typeSlugs: "oops" })).toEqual(ASTERISM_RECOMMENDED);
    expect(normalizeAsterismSettings(null)).toEqual(ASTERISM_RECOMMENDED);
    expect(EMPTY.claimBaseIri).toBe("");
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

describe("fillAsterismRecommendedIfEmpty", () => {
  const empty = { vocabBaseIri: "", claimBaseIri: "", typeSlugs: { observation: "", interpretation: "", rule: "", judgment: "" } };
  it("語が全部空なら推奨値で埋める（知見の基底も既定に）", () => {
    const r = fillAsterismRecommendedIfEmpty(empty);
    expect(r.vocabBaseIri).toBe(ASTERISM_RECOMMENDED.vocabBaseIri);
    expect(r.typeSlugs).toEqual(ASTERISM_RECOMMENDED.typeSlugs);
    expect(r.claimBaseIri).toBe(ASTERISM_RECOMMENDED.claimBaseIri);
  });
  it("語が 1 つでも入っていれば触らない（空の知見の基底だけ既定に）", () => {
    const mine = { ...empty, typeSlugs: { ...empty.typeSlugs, rule: "my_rule" } };
    const r = fillAsterismRecommendedIfEmpty(mine);
    expect(r.typeSlugs.rule).toBe("my_rule");
    expect(r.typeSlugs.judgment).toBe("");
    expect(r.claimBaseIri).toBe(ASTERISM_RECOMMENDED.claimBaseIri);
  });
  it("利用者が入れた知見の基底は残す", () => {
    const r = fillAsterismRecommendedIfEmpty({ ...empty, claimBaseIri: "https://example.net/c/" });
    expect(r.claimBaseIri).toBe("https://example.net/c/");
  });
});

describe("会議の文字起こし設定", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("清書と要約のモデル: 専用 → 精密 → 標準 → デフォルトの順に選ぶ（チャットには落とさない）", () => {
    const base = JSON.parse(JSON.stringify(loadSettings()));
    const save = (patch: Record<string, unknown>) =>
      localStorage.setItem("graphium-settings", JSON.stringify({ ...base, ...patch }));
    save({ model: "Default", chatSynthesisModel: "", meetingAiModel: "" });
    expect(getMeetingAiModelName()).toBe("Default");
    save({ model: "Default", chatSynthesisModel: "Chat", meetingAiModel: "" });
    expect(getMeetingAiModelName()).toBe("Default");
    save({ model: "Default", preciseModel: "Precise", meetingAiModel: "" });
    expect(getMeetingAiModelName()).toBe("Precise");
    save({ model: "Default", chatSynthesisModel: "Chat", meetingAiModel: "Strong" });
    expect(getMeetingAiModelName()).toBe("Strong");
    expect(getMeetingSettings().aiModel).toBe("Strong");
  });

  it("清書と要約のモデルも setter で保存でき、ほかの設定を壊さない", () => {
    setMeetingSettings({ meetingVocabulary: "熱電" });
    setMeetingSettings({ meetingAiModel: "Strong" });
    expect(getMeetingSettings()).toMatchObject({ vocabulary: "熱電", aiModel: "Strong" });
  });

  it("必ず伏せる語も setter で保存できる", () => {
    setMeetingSettings({ meetingMaskTerms: "田中, 佐藤" });
    expect(getMeetingSettings().maskTerms).toBe("田中, 佐藤");
  });

  it("未保存なら large-v3-turbo / auto / ON", () => {
    expect(getMeetingSettings()).toEqual({ modelSize: "large-v3-turbo", language: "auto", liveTranscribe: true, vocabulary: "", aiModel: "", maskTerms: "" });
  });

  it("保存済み設定に項目が無い（既存ユーザー）・壊れた値は small（旧既定）に倒れる", () => {
    localStorage.setItem("graphium-settings", JSON.stringify({ model: "x", meetingModelSize: "huge", meetingLanguage: 3 }));
    expect(getMeetingSettings()).toEqual({ modelSize: "small", language: "auto", liveTranscribe: true, vocabulary: "", aiModel: "", maskTerms: "" });
  });

  it("保存済みの small は small のまま・用語は保存される", () => {
    localStorage.setItem("graphium-settings", JSON.stringify({ meetingModelSize: "small" }));
    setMeetingSettings({ meetingVocabulary: "熱電, ZT" });
    expect(getMeetingSettings()).toMatchObject({ modelSize: "small", vocabulary: "熱電, ZT" });
  });

  it("setter は他の設定を壊さず 1 項目ずつ保存する", () => {
    localStorage.setItem("graphium-settings", JSON.stringify({ model: "keep" }));
    setMeetingSettings({ meetingModelSize: "base" });
    setMeetingSettings({ meetingLiveTranscribe: false });
    expect(getMeetingSettings()).toEqual({ modelSize: "base", language: "auto", liveTranscribe: false, vocabulary: "", aiModel: "", maskTerms: "" });
    expect(loadSettings().model).toBe("keep");
  });
});

describe("features.sourceSummaries — 資料の要約ページ（オプトイン）", () => {
  it("キーが無い既存ユーザーも false（取り込みの AI 呼び出しを黙って増やさない）。保存値があればそれに従う", () => {
    localStorage.setItem("graphium-settings", JSON.stringify({ features: { claims: true } }));
    expect(loadSettings().features?.sourceSummaries).toBe(false);
    localStorage.setItem("graphium-settings", JSON.stringify({ features: { claims: true, sourceSummaries: true } }));
    expect(loadSettings().features?.sourceSummaries).toBe(true);
  });
});
