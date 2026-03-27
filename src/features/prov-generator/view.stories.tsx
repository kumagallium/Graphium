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

const meta: Meta = { title: "Organisms/ProvGenerator", parameters: { layout: "padded" } };
export default meta;

// ── @context 共通 ──
const ctx = {
  prov: "http://www.w3.org/ns/prov#",
  provnote: "https://provnote.app/ns#",
};

// ── モック ProvDocument ──
// ノード ID の prefix で Entity サブタイプを区別:
//   entity_ → [使用したもの]（ブランドグリーン）
//   result_ → [結果]（テラコッタ）
const simpleProv: ProvDocument = {
  "@context": ctx,
  "@graph": [
    { "@id": "activity_b1", "@type": "prov:Activity", label: "封入する", blockId: "b1" },
    { "@id": "activity_b2", "@type": "prov:Activity", label: "アニールする", blockId: "b2" },
    { "@id": "entity_b3", "@type": "prov:Entity", label: "Cu粉末", blockId: "b3" },
    { "@id": "result_b4", "@type": "prov:Entity", label: "封入されたCu粉末", blockId: "b4" },
    { "@id": "param_b5", "@type": "prov:Entity", label: "昇温速度", blockId: "b5", params: { value: "5℃/min" } },
  ],
  relations: [
    { "@type": "prov:used", from: "activity_b1", to: "entity_b3" },
    { "@type": "prov:wasGeneratedBy", from: "result_b4", to: "activity_b1" },
    { "@type": "prov:wasInformedBy", from: "activity_b2", to: "activity_b1" },
    { "@type": "provnote:hasAttribute", from: "activity_b2", to: "param_b5" },
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
    { "@id": "entity_b2", "@type": "prov:Entity", label: "Cu粉末", blockId: "b2" },
    { "@id": "activity_b1__sample_A", "@type": "prov:Activity", label: "アニールする", blockId: "b3", sampleId: "sample_A", params: { temp: "600℃", time: "24h" } },
    { "@id": "activity_b1__sample_B", "@type": "prov:Activity", label: "アニールする", blockId: "b4", sampleId: "sample_B", params: { temp: "700℃", time: "24h" } },
    { "@id": "result_b5", "@type": "prov:Entity", label: "アニール品", blockId: "b5", sampleId: "sample_A" },
    { "@id": "result_b6", "@type": "prov:Entity", label: "アニール品", blockId: "b6", sampleId: "sample_B" },
  ],
  relations: [
    { "@type": "prov:used", from: "activity_b1__sample_A", to: "entity_b2" },
    { "@type": "prov:used", from: "activity_b1__sample_B", to: "entity_b2" },
    { "@type": "prov:wasGeneratedBy", from: "result_b5", to: "activity_b1__sample_A" },
    { "@type": "prov:wasGeneratedBy", from: "result_b6", to: "activity_b1__sample_B" },
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
