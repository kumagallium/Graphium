import { describe, expect, it } from "vitest";
import {
  FREE_PROVIDERS,
  isCatalogStale,
  latestCheckedAt,
  needsAccountId,
  pickInitialModel,
  providerName,
  providerText,
  resolveApiBase,
} from "./catalog";

describe("FREE_PROVIDERS（providers.json）", () => {
  it("英語名の順に並ぶ（手で並べて優先を作らない）", () => {
    const names = FREE_PROVIDERS.map((p) => p.name);
    expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b, "en")));
  });

  it("全社が同じ項目の文言を日英とも持つ", () => {
    for (const p of FREE_PROVIDERS) {
      for (const lang of ["en", "ja"] as const) {
        for (const field of ["amount", "training", "signup"] as const) {
          expect(p.text[lang][field], `${p.id}.${lang}.${field}`).toBeTruthy();
        }
      }
    }
  });

  it("URL は https・id は重ならない・学習の区分と確認日は決まった形", () => {
    expect(new Set(FREE_PROVIDERS.map((p) => p.id)).size).toBe(FREE_PROVIDERS.length);
    for (const p of FREE_PROVIDERS) {
      expect(p.apiBase.startsWith("https://"), p.id).toBe(true);
      expect(p.signupUrl.startsWith("https://"), p.id).toBe(true);
      expect(["no", "yes", "depends"]).toContain(p.training);
      expect(p.checkedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });
});

describe("providerName", () => {
  it("英語の画面では英語名、日本語の画面では nameJa があればそれ", () => {
    const sakura = FREE_PROVIDERS.find((p) => p.id === "sakura-ai-engine")!;
    expect(providerName(sakura, "en")).toBe("Sakura AI Engine");
    expect(providerName(sakura, "ja")).toBe("さくらのAI Engine");
    const cf = FREE_PROVIDERS.find((p) => p.id === "cloudflare-workers-ai")!;
    expect(providerName(cf, "ja")).toBe(cf.name);
  });

  it("英語名は ASCII だけ（英語の画面に日本語が混ざらない）", () => {
    for (const p of FREE_PROVIDERS) expect(p.name, p.id).toMatch(/^[\x20-\x7e]+$/);
  });
});

describe("providerText", () => {
  it("ja 以外は英語", () => {
    const p = FREE_PROVIDERS[0];
    expect(providerText(p, "ja")).toBe(p.text.ja);
    expect(providerText(p, "en")).toBe(p.text.en);
  });
});

describe("resolveApiBase", () => {
  const template = "https://api.example.com/accounts/{accountId}/ai/v1";
  it("アカウント ID を埋める", () => {
    expect(needsAccountId(template)).toBe(true);
    expect(resolveApiBase(template, " abc123 ")).toBe("https://api.example.com/accounts/abc123/ai/v1");
  });
  it("未入力なら空（そのまま登録させない）", () => {
    expect(resolveApiBase(template, "  ")).toBe("");
  });
  it("URL に紛れる文字は符号化する", () => {
    expect(resolveApiBase(template, "a/b?c")).toBe("https://api.example.com/accounts/a%2Fb%3Fc/ai/v1");
  });
  it("埋める部分が無ければそのまま", () => {
    expect(resolveApiBase("https://x.example/v1", "")).toBe("https://x.example/v1");
  });
});

describe("pickInitialModel", () => {
  it("カタログのモデルが一覧にあればそれ", () => {
    expect(pickInitialModel(["a", "b", "c"], "b")).toBe("b");
  });
  it("廃止・改名で一覧に無ければ先頭に戻す", () => {
    expect(pickInitialModel(["a", "b"], "gone")).toBe("a");
    expect(pickInitialModel(["a"], "")).toBe("a");
    expect(pickInitialModel([], "b")).toBe("");
  });
});

describe("isCatalogStale", () => {
  it("180 日を過ぎたら古い", () => {
    expect(isCatalogStale("2026-10-22", new Date("2027-04-19T00:00:00Z"))).toBe(false);
    expect(isCatalogStale("2026-10-22", new Date("2027-04-21T00:00:00Z"))).toBe(true);
  });
  it("日付が読めなければ古い扱い", () => {
    expect(isCatalogStale("", new Date())).toBe(true);
  });
  it("一覧の確認日は一番新しいもの", () => {
    expect(latestCheckedAt(FREE_PROVIDERS)).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});
