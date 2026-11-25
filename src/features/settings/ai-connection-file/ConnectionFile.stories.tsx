// 接続を配るファイルの、書き出しと読み込みの画面

import type { Meta, StoryObj } from "@storybook/react-vite";
import { ConnectionFileExport, type ExportableGroup } from "./ConnectionFileExport";
import { ConnectionFileImport } from "./ConnectionFileImport";
import { buildConnectionFile } from "./format";

const frame = (Story: () => React.ReactElement) => (
  <div className="w-[560px] rounded-lg border border-primary/30 bg-primary/5 p-4">
    <Story />
  </div>
);

const meta: Meta = {
  title: "Molecules/ConnectionFile",
  decorators: [frame],
};
export default meta;

const noop = () => {};
const LAB: ExportableGroup = {
  id: "lab",
  label: "OpenAI Compatible (http://lab-ws.example.test:8000/v1)",
  provider: "openai-compatible",
  apiBase: "http://lab-ws.example.test:8000/v1",
  models: [
    { name: "研究室のサーバー", modelId: "local-model-a" },
    { name: "研究室のサーバー（大）", modelId: "local-model-b" },
  ],
};
const OPENAI: ExportableGroup = {
  id: "openai",
  label: "OpenAI",
  provider: "openai",
  apiBase: null,
  models: [{ name: "OpenAI", modelId: "gpt-example" }],
};

/** 書き出し: 研究室のサーバーをキーなしで配る */
export const Export: StoryObj = {
  render: () => <ConnectionFileExport groups={[LAB, OPENAI]} defaultFrom="熊谷" save={async () => true} onClose={noop} />,
};

/** 書き出し: 配れる接続が無いとき（GitHub Copilot・ChatGPT のプランだけ） */
export const ExportNothing: StoryObj = {
  render: () => <ConnectionFileExport groups={[]} save={async () => true} onClose={noop} />,
};

/** 読み込み: ファイルを選ぶ前 */
export const ImportPick: StoryObj = {
  render: () => <ConnectionFileImport existing={[]} importModels={async () => {}} keylessPlaceholder="local" onBack={noop} />,
};

/** 読み込み: キーの無いファイル（研究室の中の http）。送り先と http の注意を見せる */
export const ImportKeyless: StoryObj = {
  render: () => (
    <ConnectionFileImport
      existing={[]}
      importModels={async () => {}}
      keylessPlaceholder="local"
      onBack={noop}
      initialFile={buildConnectionFile({ provider: LAB.provider, apiBase: LAB.apiBase, models: LAB.models, from: "熊谷" })}
    />
  ),
};

/** 読み込み: 暗号化したキー入り。1 つは登録済みなのでとばす */
export const ImportEncryptedPartlyAdded: StoryObj = {
  render: () => (
    <ConnectionFileImport
      existing={[{ name: "前に読み込んだもの", provider: "openai-compatible", apiBase: "https://lab-ws.example.test/v1", modelId: "local-model-a" }]}
      importModels={async () => {}}
      keylessPlaceholder="local"
      onBack={noop}
      initialFile={buildConnectionFile({
        provider: LAB.provider,
        apiBase: "https://lab-ws.example.test/v1",
        models: LAB.models,
        from: "熊谷",
        key: { encrypted: { alg: "AES-GCM", kdf: "PBKDF2-SHA256", iterations: 600_000, salt: "c2FsdA==", iv: "aXY=", data: "ZGF0YQ==" } },
      })}
    />
  ),
};
