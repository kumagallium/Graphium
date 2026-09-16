// 設定モーダルのストーリー
//
// 実物の SettingsModal を描画する。以前はここに静的モック（MockSettingsModal）を
// 置いていたが、実装とつながりが無いため設定画面の見た目を Storybook で検証できず、
// 余白・文字サイズの崩れを取りこぼしていた（#599 / #600 / #602）。
//
// web モードのモデル一覧は localStorage（graphium-llm-models）から読むので、
// バックエンド無しでも decorator で seed すれば密な AI タブを再現できる。

import type { Meta, StoryObj } from "@storybook/react-vite";
import { useEffect, useState } from "react";
import { SettingsModal, type WikiSummaryForSettings } from "./modal";

const LLM_MODELS_KEY = "graphium-llm-models";
const SETTINGS_KEY = "graphium-settings";

/** 表示確認用のダミーモデル。API キーはダミーで、実際の呼び出しには使わない。 */
const SAMPLE_MODELS = [
  { id: "m1", name: "Claude Sonnet 5", provider: "anthropic", modelId: "claude-sonnet-5", apiKey: "dummy", apiBase: null, rate: { input: 3, output: 15, currency: "usd" } },
  { id: "m2", name: "Claude Opus 5", provider: "anthropic", modelId: "claude-opus-5", apiKey: "dummy", apiBase: null, rate: { input: 15, output: 75, currency: "usd" } },
  { id: "m3", name: "ローカル LLM", provider: "openai-compatible", modelId: "gpt-oss-120b", apiKey: "dummy", apiBase: "http://127.0.0.1:9999/v1" },
];

const SAMPLE_WIKIS: WikiSummaryForSettings[] = [
  { id: "w1", title: "析出強化のメカニズム", kind: "claim" },
  { id: "w2", title: "時効処理の温度依存性", kind: "summary" },
  { id: "w3", title: "転位と粒界の相互作用", kind: "atom" },
  { id: "w4", title: "析出強化", kind: "topic" },
];

/**
 * 使用量タブ用のダミー記録（GET /api/usage の応答）。
 * バケットは「今日」から遡って切られるので日付は固定せず実行時点からの相対で作る
 * （固定日付だと日が経つとグラフが空になる）。量は決め打ちにして、開くたびに見た目を変えない。
 */
function buildSampleUsage() {
  const DAY_MS = 24 * 60 * 60 * 1000;
  const now = Date.now();
  // cost を持たないもの（ローカル LLM）は内訳で「—」になる
  const mix = [
    { feature: "agent.chat", provider: "anthropic", modelId: "claude-sonnet-5", tokens: 42_000, cost: 0.31 },
    { feature: "wiki.ingest", provider: "anthropic", modelId: "claude-opus-5", tokens: 18_000, cost: 0.62 },
    { feature: "wiki.atomize", provider: "openai-compatible", modelId: "gpt-oss-120b", tokens: 26_000 },
    { feature: "embedding", provider: "openai", modelId: "text-embedding-3-small", tokens: 9_000, cost: 0.0002 },
  ];
  const raw = [];
  // raw は実サーバーの保持期間（直近 90 日）に揃える。短いと月表示でサマリとの間に空白の月が出る
  for (let d = 0; d < 90; d++) {
    for (const [i, m] of mix.entries()) {
      if ((d + i) % 3 === 0) continue; // 日ごとに使う機能をばらつかせる
      const scale = 1 + ((d * 7 + i * 3) % 5) / 2;
      const totalTokens = Math.round(m.tokens * scale);
      const inputTokens = Math.round(totalTokens * 0.8);
      raw.push({
        ts: new Date(now - d * DAY_MS).toISOString(),
        feature: m.feature,
        provider: m.provider,
        modelId: m.modelId,
        inputTokens,
        outputTokens: totalTokens - inputTokens,
        totalTokens,
        ...(m.cost !== undefined ? { cost: m.cost * scale, costCurrency: "usd" } : {}),
      });
    }
  }
  // 90 日より古い期間は月次サマリで返る（月・年表示だけが通る経路）
  const summary = [4, 5, 6].map((monthsAgo) => {
    const d = new Date(now);
    d.setUTCDate(1);
    d.setUTCMonth(d.getUTCMonth() - monthsAgo);
    return {
      month: d.toISOString().slice(0, 7),
      feature: "agent.chat",
      provider: "anthropic",
      modelId: "claude-sonnet-5",
      callCount: 120,
      inputTokens: 900_000,
      outputTokens: 220_000,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      reasoningTokens: 0,
      totalTokens: 1_120_000,
      costByCurrency: { usd: 6 },
    };
  });
  return { raw, summary, mode: "node" };
}

/**
 * AI タブは `/api/health` が返らないとバックエンド未接続の CTA だけを出し、
 * モデル一覧や MCP を描画しない。Storybook にバックエンドは無いので、
 * 「接続できている」ときの見た目を確認したいストーリーでは fetch を差し替える。
 * 触るのは /api のみで、他はそのまま元の fetch に流す。
 *
 * 未知の /api には `{}` を返す。応答の形を前提に描画するタブ（使用量など）は、
 * 汎用分岐より前に実物と同じ形の分岐を置くこと。
 */
function installApiStub(): () => void {
  const original = window.fetch;
  window.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const json = (body: unknown) =>
      new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });

    if (url.includes("/api/health")) return json({ status: "ok", components: { llm: "ok", storage: "ok" } });
    if (url.includes("/api/tools")) return json({ tools: [] });
    if (url.includes("/api/models")) return json({ models: [], default: "" });
    // /api/usage/recalculate は "/api/usage" も含むので先に判定する
    if (url.includes("/api/usage/recalculate")) return json({ total: 0, recalculated: 0, skipped: 0 });
    if (url.includes("/api/usage")) return json(buildSampleUsage());
    if (url.includes("/api/")) return json({});
    return original(input as RequestInfo, init);
  }) as typeof window.fetch;
  return () => {
    window.fetch = original;
  };
}

/**
 * モーダルは開いたまま固定して見せる（閉じると何も残らないため）。
 * seedModels を指定したストーリーだけ localStorage と API スタブを用意し、
 * 他のストーリーに漏れないようアンマウント時に片付ける。
 */
function SettingsModalHarness({
  seedModels = false,
  stubApi,
  seedFeaturesOff = false,
  initialTab,
  wikiSummaries,
}: {
  seedModels?: boolean;
  /** バックエンドに繋がっている見た目にする（既定は seedModels に従う）。
      モデル未登録のまま AI タブの「まだ使えません」を見たいときだけ明示する。 */
  stubApi?: boolean;
  /** features.insights / features.worldGrounding を両方 OFF にして開く（マスタースイッチの畳み確認用） */
  seedFeaturesOff?: boolean;
  initialTab?: string;
  wikiSummaries?: WikiSummaryForSettings[];
}) {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let restoreFetch: (() => void) | undefined;
    if (seedModels) {
      localStorage.setItem(LLM_MODELS_KEY, JSON.stringify(SAMPLE_MODELS));
    } else {
      localStorage.removeItem(LLM_MODELS_KEY);
    }
    if (stubApi ?? seedModels) restoreFetch = installApiStub();
    if (seedFeaturesOff) {
      localStorage.setItem(
        SETTINGS_KEY,
        JSON.stringify({ features: { insights: false, worldGrounding: false } }),
      );
    } else {
      // 初回起動（保存済み設定なし）は features が既定 OFF になったため、
      // 「行の密度」を確認したいストーリーでは既存ユーザー相当（features ON）を明示的に seed する。
      localStorage.setItem(
        SETTINGS_KEY,
        JSON.stringify({ features: { insights: true, worldGrounding: true } }),
      );
    }
    setReady(true);
    return () => {
      localStorage.removeItem(LLM_MODELS_KEY);
      localStorage.removeItem(SETTINGS_KEY);
      restoreFetch?.();
    };
  }, [seedModels, stubApi, seedFeaturesOff]);

  // localStorage を整えてからマウントする（SettingsModal は初回描画で読むため）
  if (!ready) return null;

  return (
    <div style={{ minHeight: 720 }}>
      <SettingsModal
        isOpen
        onClose={() => {}}
        initialTab={initialTab}
        wikiSummaries={wikiSummaries}
        onRegenerateWiki={async () => ({ ok: true })}
        onReembedAllWikis={async (onProgress) => onProgress(3, 3)}
      />
    </div>
  );
}

const meta = {
  title: "Organisms/SettingsModal",
  component: SettingsModalHarness,
  parameters: { layout: "fullscreen" },
} satisfies Meta<typeof SettingsModalHarness>;

export default meta;
type Story = StoryObj<typeof meta>;

/** モデル未登録の初期状態。表示・言語タブのセクション余白（24px）を確認する。 */
export const Default: Story = {
  args: {},
};

/** モデル登録済みの AI タブ。行の密度と長い表示名の折り返しを確認する。 */
export const AiWithModels: Story = {
  args: { seedModels: true, initialTab: "ai" },
};

/**
 * 初めて AI タブを開いた状態（モデル未登録・バックエンドは動いている）。
 * 設定を並べる前に「まだ使えません」と次の一手が出ることを確認する。
 */
export const AiNotConfigured: Story = {
  args: { initialTab: "ai", stubApi: true },
};

/**
 * 洞察・世界照合の両マスタースイッチを OFF にした状態。
 * 自動照合トグル・専用モデル・スキャン予算が畳まれ、照合データタブも消えることを確認する。
 */
export const AiFeaturesOff: Story = {
  args: { seedModels: true, initialTab: "ai", seedFeaturesOff: true },
};

/**
 * 使用量タブ。API スタブのダミー記録で、日/月/年の棒グラフと機能 × モデルの内訳を確認する
 * （スタブが `{}` を返していた頃は `raw is not iterable` で描画ごと落ちていた）。
 */
export const Usage: Story = {
  args: { initialTab: "usage", stubApi: true },
};

/** ストレージタブ。見出し → 説明文 → コントロールの縦リズムを確認する。 */
export const Storage: Story = {
  args: { initialTab: "storage" },
};

/**
 * ナレッジ管理タブ。wikiSummaries があるときだけ出る Re-embed カードを含む
 * （i18n 化した文言の見た目はここでしか確認できない）。
 */
export const Maintenance: Story = {
  args: { seedModels: true, initialTab: "maintenance", wikiSummaries: SAMPLE_WIKIS },
};
