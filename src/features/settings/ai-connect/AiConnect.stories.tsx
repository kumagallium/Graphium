// AI のつなぎ先を選ぶ画面と、選んだ後の入力画面（試作）。合意を取るためのストーリー

import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { FREE_PROVIDERS } from "../free-providers/catalog";
import { ConnectChooserView } from "./ConnectChooserView";
import { KeyConnectView, type KeyConnectPhase } from "./KeyConnectView";

const frame = (Story: () => React.ReactElement) => (
  <div className="w-[560px] rounded-lg border border-primary/30 bg-primary/5 p-4">
    <Story />
  </div>
);

const meta: Meta = {
  title: "Molecules/AiConnect",
  decorators: [frame],
};
export default meta;

const noop = () => {};
const chooserArgs = {
  freeProviders: FREE_PROVIDERS,
  onConnectCopilot: noop,
  onPickFree: noop,
  onPickKeyProvider: noop,
  onPickLocal: noop,
  onPickCustom: noop,
  onOpenSignup: noop,
  onOpenComparison: noop,
};

/** 1 枚目: どこにつなぐかを選ぶ（すべて畳んだ状態） */
export const Chooser: StoryObj = { render: () => <ConnectChooserView {...chooserArgs} /> };

/** 1 枚目: 「API キーを持っている」を開いたところ */
export const ChooserKeyOpen: StoryObj = { render: () => <ConnectChooserView {...chooserArgs} initialOpen="key" /> };

/** 1 枚目: 「無料枠のある接続先」を開いたところ */
export const ChooserFreeOpen: StoryObj = { render: () => <ConnectChooserView {...chooserArgs} initialOpen="free" /> };

const OPENAI_MODELS = ["gpt-5.6-terra", "gpt-5.6-luna", "gpt-5.6-sol", "gpt-oss-120b"];

function KeyForm({ phase, advanced = false, apiKey = "" }: { phase: KeyConnectPhase; advanced?: boolean; apiKey?: string }) {
  const [key, setKey] = useState(apiKey);
  return (
    <KeyConnectView
      providerName="OpenAI"
      keyHelpUrl="https://platform.openai.com/api-keys"
      apiKey={key}
      apiBase="https://api.openai.com/v1"
      displayName={phase.kind === "ready" ? phase.selected : ""}
      phase={phase}
      onApiKeyChange={setKey}
      onApiBaseChange={noop}
      onModelChange={noop}
      onDisplayNameChange={noop}
      onOpenKeyHelp={noop}
      onBack={noop}
      onAdd={noop}
      initialAdvancedOpen={advanced}
    />
  );
}

/** 2 枚目: キーを貼る前（URL・モデルは「詳しい設定」に畳んである） */
export const FormIdle: StoryObj = { render: () => <KeyForm phase={{ kind: "idle" }} /> };

/** 2 枚目: キーを貼った直後、自動で確かめている */
export const FormChecking: StoryObj = { render: () => <KeyForm phase={{ kind: "checking" }} apiKey="sk-test-1234567890" /> };

/** 2 枚目: つながった。おすすめを選んであり、「追加する」が押せる */
export const FormReady: StoryObj = {
  render: () => <KeyForm phase={{ kind: "ready", models: OPENAI_MODELS, selected: "gpt-5.6-luna" }} apiKey="sk-test-1234567890" />,
};

/** 2 枚目: つながった後に「詳しい設定」を開いたところ */
export const FormReadyAdvanced: StoryObj = {
  render: () => (
    <KeyForm phase={{ kind: "ready", models: OPENAI_MODELS, selected: "gpt-5.6-luna" }} apiKey="sk-test-1234567890" advanced />
  ),
};

/** 2 枚目: キーが違ったとき */
export const FormError: StoryObj = {
  render: () => (
    <KeyForm phase={{ kind: "error", message: "キーが正しくないようです。コピーし直して貼ってください。" }} apiKey="sk-wrong" />
  ),
};

/** 2 枚目: Cloudflare（アカウント ID も要る） */
export const FormCloudflare: StoryObj = {
  render: () => (
    <KeyConnectView
      providerName="Cloudflare Workers AI"
      keyHelpUrl="https://dash.cloudflare.com/profile/api-tokens"
      needsAccountId
      apiKey=""
      accountId=""
      apiBase=""
      displayName=""
      phase={{ kind: "idle" }}
      onApiKeyChange={noop}
      onAccountIdChange={noop}
      onApiBaseChange={noop}
      onModelChange={noop}
      onDisplayNameChange={noop}
      onOpenKeyHelp={noop}
      onBack={noop}
      onAdd={noop}
    />
  ),
};

/** 2 枚目: このパソコンで動かす（キーの欄は無い） */
export const FormLocal: StoryObj = {
  render: () => (
    <KeyConnectView
      providerName="LM Studio"
      keyHelpUrl=""
      keyless
      apiKey=""
      apiBase="http://localhost:1234/v1"
      displayName="qwen3.6-35b-a3b"
      phase={{ kind: "ready", models: ["qwen3.6-35b-a3b", "gemma-4-31b-qat"], selected: "qwen3.6-35b-a3b" }}
      onApiKeyChange={noop}
      onApiBaseChange={noop}
      onModelChange={noop}
      onDisplayNameChange={noop}
      onOpenKeyHelp={noop}
      onBack={noop}
      onAdd={noop}
    />
  ),
};
