// ノート間ネットワークグラフのストーリー
// NetworkGraphPanel の各状態を Storybook で確認する

import type { Meta, StoryObj } from "@storybook/react-vite";
import { Component, type ReactNode } from "react";
import { NetworkGraphPanel } from "./view";
import type { NoteGraphData } from "./graph-builder";

// ── エラーバウンダリ（Cytoscape 初期化エラーを吸収） ──
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
        <div style={{ padding: 16, color: "#c26356", fontSize: 13 }}>
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

const meta: Meta = {
  title: "Organisms/NetworkGraph",
  parameters: { layout: "padded" },
};
export default meta;

// ── モックデータ ──

// シンプルな3ノート（直線的な派生関係）
const simpleGraph: NoteGraphData = {
  nodes: [
    { id: "note-1", title: "Cu粉末のアニール実験", isCurrent: true, hop: 0 },
    { id: "note-2", title: "アニール温度の最適化", isCurrent: false, hop: 1 },
    { id: "note-3", title: "粉末の前処理手順", isCurrent: false, hop: 1 },
  ],
  edges: [
    { source: "note-3", target: "note-1" },
    { source: "note-1", target: "note-2" },
  ],
};

// 複数ホップ（2ホップ先まで表示）
const multiHopGraph: NoteGraphData = {
  nodes: [
    { id: "note-1", title: "Cu粉末のアニール実験", isCurrent: true, hop: 0 },
    { id: "note-2", title: "アニール温度の最適化", isCurrent: false, hop: 1 },
    { id: "note-3", title: "粉末の前処理手順", isCurrent: false, hop: 1 },
    { id: "note-4", title: "XRD 測定結果", isCurrent: false, hop: 1 },
    { id: "note-5", title: "温度プロファイル設計", isCurrent: false, hop: 2 },
    { id: "note-6", title: "Cu原料の調達記録", isCurrent: false, hop: 2 },
    { id: "note-7", title: "SEM 観察記録", isCurrent: false, hop: 2 },
  ],
  edges: [
    { source: "note-3", target: "note-1" },
    { source: "note-1", target: "note-2" },
    { source: "note-1", target: "note-4" },
    { source: "note-2", target: "note-5" },
    { source: "note-6", target: "note-3" },
    { source: "note-4", target: "note-7" },
  ],
};

// 分岐が多いグラフ（ハブ型）
const hubGraph: NoteGraphData = {
  nodes: [
    { id: "hub", title: "焼結実験マスターノート", isCurrent: true, hop: 0 },
    { id: "a", title: "温度条件の検討", isCurrent: false, hop: 1 },
    { id: "b", title: "圧力条件の検討", isCurrent: false, hop: 1 },
    { id: "c", title: "粉末粒度の影響", isCurrent: false, hop: 1 },
    { id: "d", title: "雰囲気ガスの比較", isCurrent: false, hop: 1 },
    { id: "e", title: "SPS vs HP 比較", isCurrent: false, hop: 1 },
    { id: "f", title: "温度1200℃の詳細", isCurrent: false, hop: 2 },
    { id: "g", title: "温度1400℃の詳細", isCurrent: false, hop: 2 },
  ],
  edges: [
    { source: "hub", target: "a" },
    { source: "hub", target: "b" },
    { source: "hub", target: "c" },
    { source: "hub", target: "d" },
    { source: "hub", target: "e" },
    { source: "a", target: "f" },
    { source: "a", target: "g" },
  ],
};

// 空状態
const emptyGraph: NoteGraphData = { nodes: [], edges: [] };

// ── ストーリーコンテナ ──
const noop = () => {};

function Container({ children, height = 400 }: { children: ReactNode; height?: number }) {
  return (
    <Safe>
      <div style={{ width: 600, height, border: "1px solid #d5e0d7", borderRadius: 8, overflow: "hidden" }}>
        {children}
      </div>
    </Safe>
  );
}

// ── ストーリー ──

export const Empty: StoryObj = {
  name: "空状態（派生関係なし）",
  render: () => (
    <Container>
      <NetworkGraphPanel data={emptyGraph} onNavigate={noop} />
    </Container>
  ),
};

export const Simple: StoryObj = {
  name: "シンプル（3ノート）",
  render: () => (
    <Container>
      <NetworkGraphPanel data={simpleGraph} onNavigate={noop} />
    </Container>
  ),
};

export const MultiHop: StoryObj = {
  name: "2ホップ（7ノート）",
  render: () => (
    <Container height={500}>
      <NetworkGraphPanel data={multiHopGraph} onNavigate={noop} />
    </Container>
  ),
};

export const Hub: StoryObj = {
  name: "ハブ型（分岐が多い）",
  render: () => (
    <Container height={500}>
      <NetworkGraphPanel data={hubGraph} onNavigate={noop} />
    </Container>
  ),
};
