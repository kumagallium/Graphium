// PROVグラフパネルのストーリー
// ProvGraphPanel の各状態を確認する（Phase 3: ProvJsonLd 形式）

import type { Meta, StoryObj } from "@storybook/react-vite";
import { Component, type ReactNode } from "react";
import { ProvGraphPanel } from "./view";
import type { ProvJsonLd } from "./generator";

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
  prov: "http://www.w3.org/ns/prov#" as const,
  provnote: "https://provnote.app/ns#" as const,
  rdfs: "http://www.w3.org/2000/01/rdf-schema#" as const,
  xsd: "http://www.w3.org/2001/XMLSchema#" as const,
};

// ── モック ProvJsonLd ──
const simpleProv: ProvJsonLd = {
  "@context": ctx,
  "@graph": [
    {
      "@id": "activity_b1",
      "@type": "prov:Activity",
      "rdfs:label": "封入する",
      "provnote:blockId": "b1",
      "prov:used": [{ "@id": "entity_b3" }],
    },
    {
      "@id": "activity_b2",
      "@type": "prov:Activity",
      "rdfs:label": "アニールする",
      "provnote:blockId": "b2",
      "provnote:attributes": [
        { "rdfs:label": "昇温速度 5℃/min", "provnote:blockId": "b5" },
      ],
    },
    {
      "@id": "entity_b3",
      "@type": "prov:Entity",
      "rdfs:label": "Cu粉末",
      "provnote:blockId": "b3",
    },
    {
      "@id": "result_b4",
      "@type": "prov:Entity",
      "rdfs:label": "封入されたCu粉末",
      "provnote:blockId": "b4",
      "prov:wasGeneratedBy": { "@id": "activity_b1" },
    },
  ],
};

const provWithWarnings: ProvJsonLd = {
  "@context": ctx,
  "@graph": simpleProv["@graph"],
  "provnote:warnings": [
    { type: "unknown-label", message: "ブロック block-5 のラベル [メモ] は未知のラベルです", blockId: "block-5" },
    { type: "broken-link", message: "前手順リンク先 block-9 が見つかりません", blockId: "block-7" },
  ],
};

// テーブル構造化属性の例
const provWithStructuredTable: ProvJsonLd = {
  "@context": ctx,
  "@graph": [
    {
      "@id": "activity_step1",
      "@type": "prov:Activity",
      "rdfs:label": "混合する",
      "provnote:blockId": "step1",
      "prov:used": [{ "@id": "entity_table1_Cu粉末" }, { "@id": "entity_table1_Zn粉末" }],
    },
    {
      "@id": "entity_table1_Cu粉末",
      "@type": "prov:Entity",
      "rdfs:label": "Cu粉末",
      "provnote:blockId": "table1",
      "provnote:量": "1g",
      "provnote:純度": "99.9%",
    },
    {
      "@id": "entity_table1_Zn粉末",
      "@type": "prov:Entity",
      "rdfs:label": "Zn粉末",
      "provnote:blockId": "table1",
      "provnote:量": "0.5g",
      "provnote:純度": "99.5%",
    },
  ],
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

// テーブル構造化属性
export const WithStructuredTable: StoryObj = {
  name: "構造化属性テーブル",
  render: () => (
    <Safe>
      <div style={{ maxWidth: 800 }}>
        <ProvGraphPanel doc={provWithStructuredTable} />
      </div>
    </Safe>
  ),
};
