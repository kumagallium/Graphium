// PROVグラフパネルのストーリー
// ProvGraphPanel の各状態を確認する

import type { Meta, StoryObj } from "@storybook/react-vite";
import { Component, type ReactNode } from "react";
import { ProvGraphPanel } from "./view";
import type { ProvDocument } from "./generator";

// ── エラーバウンダリ（Cytoscape/ELK の初期化エラーを吸収） ──
class ErrorBoundary extends Component<
  { children: ReactNode },
  { error: Error | null }
> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  render() {
    if (this.state.error) {
      return (
        <div style={{ padding: 16, color: "#c26356", fontSize: 13, fontFamily: "'Inter', system-ui, sans-serif" }}>
          <strong>描画エラー:</strong> {this.state.error.message}
        </div>
      );
    }
    return this.props.children;
  }
}

function Safe({ children }: { children: ReactNode }) {
  return <ErrorBoundary>{children}</ErrorBoundary>;
}

const meta: Meta = { title: "ProvGenerator/ProvGraphPanel", parameters: { layout: "padded" } };
export default meta;

// ── @context 共通 ──
const ctx = {
  prov: "http://www.w3.org/ns/prov#",
  matprov: "http://example.org/matprov#",
  eureco: "http://example.org/eureco#",
};

// ── モック ProvDocument ──
const simpleProv: ProvDocument = {
  "@context": ctx,
  "@graph": [
    { "@id": "act:seal", "@type": "prov:Activity", label: "封入する", blockId: "b1" },
    { "@id": "act:anneal", "@type": "prov:Activity", label: "アニールする", blockId: "b2" },
    { "@id": "ent:cu-powder", "@type": "prov:Entity", label: "Cu粉末", blockId: "b3" },
    { "@id": "ent:sealed-cu", "@type": "prov:Entity", label: "封入されたCu粉末", blockId: "b4" },
    { "@id": "param:temp", "@type": "matprov:Parameter", label: "昇温速度", blockId: "b5", params: { value: "5℃/min" } },
  ],
  relations: [
    { "@type": "prov:used", from: "act:seal", to: "ent:cu-powder" },
    { "@type": "prov:wasGeneratedBy", from: "ent:sealed-cu", to: "act:seal" },
    { "@type": "prov:wasInformedBy", from: "act:anneal", to: "act:seal" },
    { "@type": "matprov:parameter", from: "act:anneal", to: "param:temp" },
  ],
  warnings: [],
};

const provWithWarnings: ProvDocument = {
  "@context": ctx,
  "@graph": simpleProv["@graph"],
  relations: simpleProv.relations,
  warnings: [
    { type: "unknown-label", message: "ブロック block-5 のラベル [メモ] は未知のラベルです", blockId: "block-5" },
    { type: "broken-link", message: "前手順リンク先 block-9 が見つかりません", blockId: "block-7" },
  ],
};

const provWithSamples: ProvDocument = {
  "@context": ctx,
  "@graph": [
    { "@id": "act:anneal", "@type": "prov:Activity", label: "アニールする", blockId: "b1" },
    { "@id": "ent:cu-powder", "@type": "prov:Entity", label: "Cu粉末", blockId: "b2" },
    { "@id": "act:anneal-A", "@type": "prov:Activity", label: "アニールする", blockId: "b3", sampleId: "sample_A", params: { temp: "600℃", time: "24h" } },
    { "@id": "act:anneal-B", "@type": "prov:Activity", label: "アニールする", blockId: "b4", sampleId: "sample_B", params: { temp: "700℃", time: "24h" } },
    { "@id": "ent:result-A", "@type": "prov:Entity", label: "アニール品", blockId: "b5", sampleId: "sample_A" },
    { "@id": "ent:result-B", "@type": "prov:Entity", label: "アニール品", blockId: "b6", sampleId: "sample_B" },
  ],
  relations: [
    { "@type": "prov:used", from: "act:anneal-A", to: "ent:cu-powder" },
    { "@type": "prov:used", from: "act:anneal-B", to: "ent:cu-powder" },
    { "@type": "prov:wasGeneratedBy", from: "ent:result-A", to: "act:anneal-A" },
    { "@type": "prov:wasGeneratedBy", from: "ent:result-B", to: "act:anneal-B" },
  ],
  warnings: [],
};

// 空状態
export const Empty: StoryObj = {
  name: "空状態（doc = null）",
  render: () => <Safe><ProvGraphPanel doc={null} /></Safe>,
};

// グラフ表示
export const SimpleGraph: StoryObj = {
  name: "シンプルなグラフ",
  render: () => (
    <Safe>
      <div style={{ maxWidth: 800 }}>
        <ProvGraphPanel doc={simpleProv} />
      </div>
    </Safe>
  ),
};

// 警告あり
export const WithWarnings: StoryObj = {
  name: "警告あり",
  render: () => (
    <Safe>
      <div style={{ maxWidth: 800 }}>
        <ProvGraphPanel doc={provWithWarnings} />
      </div>
    </Safe>
  ),
};

// 試料別分離
export const WithSamples: StoryObj = {
  name: "試料別グラフ",
  render: () => (
    <Safe>
      <div style={{ maxWidth: 800 }}>
        <ProvGraphPanel doc={provWithSamples} />
      </div>
    </Safe>
  ),
};
