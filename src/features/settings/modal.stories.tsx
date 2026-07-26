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
];

/**
 * AI タブは `/api/health` が返らないとバックエンド未接続の CTA だけを出し、
 * モデル一覧や MCP を描画しない。Storybook にバックエンドは無いので、
 * 「接続できている」ときの見た目を確認したいストーリーでは fetch を差し替える。
 * 触るのは /api のみで、他はそのまま元の fetch に流す。
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
  initialTab,
  wikiSummaries,
}: {
  seedModels?: boolean;
  initialTab?: string;
  wikiSummaries?: WikiSummaryForSettings[];
}) {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let restoreFetch: (() => void) | undefined;
    if (seedModels) {
      localStorage.setItem(LLM_MODELS_KEY, JSON.stringify(SAMPLE_MODELS));
      restoreFetch = installApiStub();
    } else {
      localStorage.removeItem(LLM_MODELS_KEY);
    }
    setReady(true);
    return () => {
      localStorage.removeItem(LLM_MODELS_KEY);
      restoreFetch?.();
    };
  }, [seedModels]);

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
