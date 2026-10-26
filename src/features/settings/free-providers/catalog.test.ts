import { describe, expect, it } from "vitest";
import {
  FREE_PROVIDERS,
  isCatalogStale,
  latestCheckedAt,
  needsAccountId,
  pickConnectModel,
  CLOUD_PROVIDERS,
  hasFreeTier,
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

describe("pickConnectModel", () => {
  it("一覧にあれば preferred", () => {
    expect(pickConnectModel(["a", "b", "c"], { preferred: "b" })).toBe("b");
  });
  it("チャットに使えないモデル（埋め込み・音声・画像など）は選ばない", () => {
    expect(pickConnectModel(["text-embedding-3-large", "whisper-1", "dall-e-3", "gpt-5.6-luna"])).toBe("gpt-5.6-luna");
  });
  it("preferred が廃止・改名で無ければ、ふだん使いの系統のうち名前の新しいもの（数字は数として比べる）", () => {
    expect(pickConnectModel(["o4-mini", "gpt-4o", "gpt-5.6-luna", "gpt-10-x"], { preferred: "gone", preferPattern: "^gpt-\\d" })).toBe("gpt-10-x");
    expect(pickConnectModel(["claude-opus-5", "claude-sonnet-4-5", "claude-sonnet-5"], { preferPattern: "sonnet" })).toBe("claude-sonnet-5");
  });
  it("系統にも合わなければ一覧の先頭。全部チャット以外なら元の一覧から", () => {
    expect(pickConnectModel(["x", "y"], { preferPattern: "flash" })).toBe("x");
    expect(pickConnectModel(["text-embedding-3-small"])).toBe("text-embedding-3-small");
    expect(pickConnectModel([], { preferred: "b" })).toBe("");
  });
  it("壊れた正規表現でも落ちない", () => {
    expect(pickConnectModel(["a", "b"], { preferPattern: "(" })).toBe("a");
  });
});

describe("CLOUD_PROVIDERS", () => {
  it("無料枠の無い接続先も英語名の順に混ざり、FREE_PROVIDERS はそれを除いたもの", () => {
    const names = CLOUD_PROVIDERS.map((p) => p.name);
    expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b, "en")));
    expect(CLOUD_PROVIDERS.some((p) => !hasFreeTier(p))).toBe(true);
    expect(FREE_PROVIDERS.every(hasFreeTier)).toBe(true);
    expect(FREE_PROVIDERS.length).toBe(CLOUD_PROVIDERS.filter(hasFreeTier).length);
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
