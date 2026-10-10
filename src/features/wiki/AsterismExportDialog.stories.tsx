// Asterism 向けの書き出しダイアログ — 既定 / 対象 0 件 / 基底 IRI 未設定

import type { Meta, StoryObj } from "@storybook/react-vite";
import { AsterismExportDialog } from "./AsterismExportDialog";
import type { AsterismSettings } from "../settings/store";
import type { WikiMeta } from "../../lib/document-types";

const meta: Meta = {
  title: "Molecules/AsterismExportDialog",
  parameters: { layout: "fullscreen" },
};
export default meta;

type Story = StoryObj;

const noop = () => {};

const asterism = {
  vocabBaseIri: "https://example.org/vocab#",
  claimBaseIri: "https://example.org/graphium/claim/",
  typeSlugs: { observation: "", interpretation: "", rule: "rule", judgment: "judgment" },
} as AsterismSettings;

const claim = (extra: Partial<WikiMeta>): WikiMeta =>
  ({ kind: "claim", ...extra }) as WikiMeta;

const items = [
  { id: "c1", title: "採用する手法を決めた", meta: claim({ asterism: { typeSlug: "judgment" } }) },
  { id: "c2", title: "条件を満たすと結果が変わる", meta: claim({ asterism: { typeSlug: "rule" } }) },
  { id: "c3", title: "型の無い知見", meta: claim({}) },
];

/** 既定: 型付きだけが対象。型なしは除外件数に出る */
export const Default: Story = {
  render: () => (
    <AsterismExportDialog
      items={items}
      asterism={asterism}
      onExport={noop}
      onCancel={noop}
    />
  ),
};

/** 対象 0 件: 書き出しボタンは押せない */
export const NoTargets: Story = {
  render: () => (
    <AsterismExportDialog
      items={[items[2]]}
      asterism={asterism}
      onExport={noop}
      onCancel={noop}
    />
  ),
};

/** claimBaseIri 未設定: 赤字の注意と設定への導線が出て、書き出しボタンは押せない */
export const NoClaimBaseIri: Story = {
  render: () => (
    <AsterismExportDialog
      items={items}
      asterism={{ ...asterism, claimBaseIri: "" }}
      onExport={noop}
      onOpenSettings={noop}
      onCancel={noop}
    />
  ),
};
