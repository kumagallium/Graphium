// 全ノードグラフ（Obsidian 風グローバルグラフ）の Storybook。
//
// 本番コンポーネント（global-graph-view.tsx）をサンプル NoteGraphData で描画する。
// 見た目の真実の源は本番コンポーネント側にあり、ここはその確認用。
//   - ノード色 = kind（external / note / summary / claim / atom / synthesis）
//   - エッジ線種 = relation（derived=実線緑 / used=実線グレー / reference=破線青）
//   - レイアウト切替（有機的 force ⇄ 列）。列モードは参照を既定で隠す。

import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { GlobalGraphView, GlobalGraphCanvas } from "./global-graph-view";
import type { NoteNode, NoteEdge, NoteGraphData } from "./graph-builder";

// ── サンプルデータ（熱電材料の研究を題材にした砂時計） ──
// 実 NoteGraphData の形（NoteNode + relation 付き NoteEdge）でそのまま用意する。

const NODES: NoteNode[] = [
  // 原料（外部ソース）
  { id: "pdf:ext1", title: "先行研究A.pdf", isCurrent: false, hop: 0, external: "pdf" },
  { id: "url:ext2", title: "arXiv:2401.xxxx", isCurrent: false, hop: 0, external: "url" },
  { id: "document:ext3", title: "実験プロトコル.docx", isCurrent: false, hop: 0, external: "document" },
  { id: "chat:ext4", title: "AI Chat", isCurrent: false, hop: 0, external: "chat" },
  // ノート（noteContexts は「文脈で色分け」モードと絞り込みチップで使う）
  { id: "n1", title: "アニール条件の検討", isCurrent: false, hop: 0, noteContexts: ["実験A"] },
  { id: "n2", title: "Cu系試料の作製", isCurrent: false, hop: 0, noteContexts: ["実験A", "実験B"] },
  { id: "n3", title: "XRD測定メモ", isCurrent: false, hop: 0, noteContexts: ["実験A"] },
  { id: "n4", title: "ゼーベック係数の測定", isCurrent: false, hop: 0, noteContexts: ["実験B"] },
  { id: "n5", title: "文献まとめ（A論文）", isCurrent: false, hop: 0 },
  { id: "n6", title: "異常データの考察", isCurrent: false, hop: 0, noteContexts: ["実験B"] },
  { id: "n7", title: "再現性チェック", isCurrent: false, hop: 0 },
  // Claim（主張）
  { id: "c1", title: "高温アニールで相純度が上がる", isCurrent: false, hop: 0, isWiki: true, wikiKind: "claim" },
  { id: "c2", title: "Cu過剰でn型化する", isCurrent: false, hop: 0, isWiki: true, wikiKind: "claim" },
  { id: "c3", title: "粒径が熱伝導を支配する", isCurrent: false, hop: 0, isWiki: true, wikiKind: "claim" },
  { id: "c4", title: "測定誤差は接触抵抗由来", isCurrent: false, hop: 0, isWiki: true, wikiKind: "claim" },
  { id: "c5", title: "ロット間ばらつきが大きい", isCurrent: false, hop: 0, isWiki: true, wikiKind: "claim" },
  // Atom（原子＝砂時計の首）
  { id: "a1", title: "アニール温度→相純度", isCurrent: false, hop: 0, isWiki: true, wikiKind: "atom" },
  { id: "a2", title: "ドープでキャリア型が反転", isCurrent: false, hop: 0, isWiki: true, wikiKind: "atom" },
  { id: "a3", title: "粒界散乱がκを下げる", isCurrent: false, hop: 0, isWiki: true, wikiKind: "atom" },
  // 統合
  { id: "s1", title: "要約: Cu系熱電材料の作製指針", isCurrent: false, hop: 0, isWiki: true, wikiKind: "summary" },
  { id: "y1", title: "統合: 高ZTへの設計方針", isCurrent: false, hop: 0, isWiki: true, wikiKind: "synthesis" },
];

const EDGES: NoteEdge[] = [
  // 派生・参照（ノート → ノート: 手順の連鎖と実験間の繋がり。
  // 文脈モードはノート層のみ表示なので、この層内のエッジが俯瞰の骨格になる）
  { source: "n2", target: "n1", relation: "derived" },
  { source: "n1", target: "n3", relation: "derived" },
  { source: "n2", target: "n4", relation: "derived" },
  { source: "n4", target: "n6", relation: "derived" },
  { source: "n5", target: "n1", relation: "reference" },
  // 素材利用（外部ソース → ノート）
  { source: "pdf:ext1", target: "n5", relation: "used" },
  { source: "url:ext2", target: "n5", relation: "used" },
  { source: "url:ext2", target: "n4", relation: "used" },
  { source: "document:ext3", target: "n2", relation: "used" },
  { source: "chat:ext4", target: "n6", relation: "used" },
  // 派生（ノート → Claim）
  { source: "n1", target: "c1", relation: "derived" },
  { source: "n3", target: "c1", relation: "derived" },
  { source: "n2", target: "c2", relation: "derived" },
  { source: "n4", target: "c2", relation: "derived" },
  { source: "n3", target: "c3", relation: "derived" },
  { source: "n6", target: "c4", relation: "derived" },
  { source: "n7", target: "c5", relation: "derived" },
  { source: "n2", target: "c5", relation: "derived" },
  // 派生（Claim → Atom：砂時計の首へ収束）
  { source: "c1", target: "a1", relation: "derived" },
  { source: "c2", target: "a2", relation: "derived" },
  { source: "c3", target: "a3", relation: "derived" },
  // 派生（ノート → Summary、Atom → Synthesis：首から再発散）
  { source: "n1", target: "s1", relation: "derived" },
  { source: "n2", target: "s1", relation: "derived" },
  { source: "a1", target: "y1", relation: "derived" },
  { source: "a2", target: "y1", relation: "derived" },
  { source: "a3", target: "y1", relation: "derived" },
  // 参照（knowledge link：破線）
  { source: "c1", target: "n5", relation: "reference" },
  { source: "a2", target: "c2", relation: "reference" },
  { source: "c5", target: "c2", relation: "reference" },
  { source: "y1", target: "s1", relation: "reference" },
];

const SAMPLE: NoteGraphData = { nodes: NODES, edges: EDGES };

// ── 大規模サンプル（クラスタリング検証用: ノート29・文脈4種・未分類・跨ぎノート） ──
// 文脈モードはノート層のみを見るので、ここはノートだけで構成する。
// 実験A(7) → 実験B(6) のハンドオフ、シミュレーション(5)・文献調査(4) の支援、
// 未分類(6, うち3つは孤立)、実験A+B の跨ぎノート(1) を含む。

function note(id: string, title: string, ctx?: string[]): NoteNode {
  return { id, title, isCurrent: false, hop: 0, noteContexts: ctx };
}

const LARGE_NODES: NoteNode[] = [
  // 実験A: Cu系焼結（手順の連鎖）
  note("a1", "原料秤量メモ", ["実験A"]),
  note("a2", "ボールミル混合条件", ["実験A"]),
  note("a3", "焼結温度 900℃ の検討", ["実験A"]),
  note("a4", "焼結温度 950℃ の検討", ["実験A"]),
  note("a5", "XRD 相同定（焼結後）", ["実験A"]),
  note("a6", "SEM 組織観察", ["実験A"]),
  note("a7", "相対密度の測定", ["実験A"]),
  // 実験B: 輸送特性測定
  note("b1", "ゼーベック係数測定（室温）", ["実験B"]),
  note("b2", "高温ゼーベック測定", ["実験B"]),
  note("b3", "電気伝導度測定", ["実験B"]),
  note("b4", "ホール測定メモ", ["実験B"]),
  note("b5", "レーザーフラッシュ熱伝導率", ["実験B"]),
  note("b6", "ZT 算出と考察", ["実験B"]),
  // シミュレーション
  note("s1", "VASP 構造最適化", ["シミュレーション"]),
  note("s2", "バンド構造計算", ["シミュレーション"]),
  note("s3", "フォノン分散計算", ["シミュレーション"]),
  note("s4", "キャリア濃度依存性の計算", ["シミュレーション"]),
  note("s5", "計算と実験の比較メモ", ["シミュレーション"]),
  // 文献調査
  note("r1", "Cu系熱電の先行研究整理", ["文献調査"]),
  note("r2", "焼結手法のレビュー", ["文献調査"]),
  note("r3", "バンド計算手法の調査", ["文献調査"]),
  note("r4", "測定プロトコル文献メモ", ["文献調査"]),
  // 跨ぎノート（実験A→実験B の受け渡し）
  note("x1", "試料受け渡しリスト", ["実験A", "実験B"]),
  // 未分類（u2〜u4 は孤立）
  note("u1", "研究テーマの構想"),
  note("u2", "学会発表の構成案"),
  note("u3", "装置予約の覚え書き"),
  note("u4", "ミーティング議事メモ"),
  note("u5", "論文アウトライン"),
  note("u6", "今後の実験計画"),
];

const LARGE_EDGES: NoteEdge[] = [
  // 実験A 内の手順連鎖
  { source: "a1", target: "a2", relation: "derived" },
  { source: "a2", target: "a3", relation: "derived" },
  { source: "a3", target: "a4", relation: "derived" },
  { source: "a3", target: "a5", relation: "derived" },
  { source: "a4", target: "a5", relation: "derived" },
  { source: "a5", target: "a6", relation: "derived" },
  { source: "a5", target: "a7", relation: "derived" },
  // 実験B 内
  { source: "b1", target: "b2", relation: "derived" },
  { source: "b3", target: "b4", relation: "derived" },
  { source: "b1", target: "b6", relation: "derived" },
  { source: "b3", target: "b6", relation: "derived" },
  { source: "b5", target: "b6", relation: "derived" },
  // シミュレーション内
  { source: "s1", target: "s2", relation: "derived" },
  { source: "s1", target: "s3", relation: "derived" },
  { source: "s2", target: "s4", relation: "derived" },
  { source: "s4", target: "s5", relation: "derived" },
  // クラスタ間: 実験A → 実験B（試料完成→測定、跨ぎノート経由も）
  { source: "a7", target: "b1", relation: "derived" },
  { source: "a4", target: "x1", relation: "derived" },
  { source: "x1", target: "b1", relation: "derived" },
  // クラスタ間: 計算⇄実験・文献の支援
  { source: "b6", target: "s5", relation: "derived" },
  { source: "s5", target: "a3", relation: "reference" },
  { source: "r1", target: "u1", relation: "reference" },
  { source: "r2", target: "a2", relation: "reference" },
  { source: "r3", target: "s1", relation: "reference" },
  { source: "r4", target: "b1", relation: "reference" },
  // 構想・まとめ（未分類との接続）
  { source: "u1", target: "a1", relation: "derived" },
  { source: "b6", target: "u5", relation: "reference" },
  { source: "b6", target: "u6", relation: "derived" },
];

const LARGE: NoteGraphData = { nodes: LARGE_NODES, edges: LARGE_EDGES };

const ALL_LAYERS = new Set(["source", "note", "crystal", "synth"] as const);

const meta: Meta = {
  title: "Graph/Global Graph",
  parameters: { layout: "fullscreen" },
};
export default meta;

// 本番ビュー（ツールバー・凡例・トグル込み）。実アプリでは <main> 内に描画される想定。
export const View: StoryObj = {
  name: "全体グラフビュー（本番UI）",
  render: () => {
    function Demo() {
      const [open, setOpen] = useState(true);
      const [picked, setPicked] = useState<string | null>(null);
      if (!open) {
        return (
          <button
            onClick={() => { setOpen(true); setPicked(null); }}
            style={{ margin: 24, padding: "8px 16px", borderRadius: 8, border: "1px solid #d5e0d7", cursor: "pointer" }}
          >
            全体グラフを開く{picked ? `（前回選択: ${picked}）` : ""}
          </button>
        );
      }
      // 実アプリではサイドバーが左に残る。ここでは高さを与えて content-area を模す。
      return (
        <div style={{ height: "100vh" }}>
          <GlobalGraphView
            data={SAMPLE}
            onSelectNote={(id) => setPicked(id)}
            onOpenMedia={(id) => console.log("openMedia", id)}
            onClose={() => setOpen(false)}
          />
        </div>
      );
    }
    return <Demo />;
  },
};

// キャンバス単体（有機的レイアウト）
export const CanvasForce: StoryObj = {
  name: "キャンバス: 有機的（force）",
  render: () => (
    <div style={{ padding: 16 }}>
      <GlobalGraphCanvas data={SAMPLE} visibleLayers={new Set(ALL_LAYERS)} height={560} />
    </div>
  ),
};

// キャンバス単体（文脈タグ色モード）。色 = noteContexts 先頭タグの名前ハッシュ色、
// タグ無しは淡いセージ。本番の文脈モードは既定でノート層のみ表示（原料・結晶は
// 文脈を持てないため）なので、ここも note 層だけを渡す。
export const CanvasContextColors: StoryObj = {
  name: "キャンバス: 文脈タグ色",
  render: () => (
    <div style={{ padding: 16 }}>
      <GlobalGraphCanvas
        data={SAMPLE}
        visibleLayers={new Set(["note"] as const)}
        colorMode="context"
        height={560}
      />
    </div>
  ),
};

// キャンバス単体（文脈クラスター）。同じ noteContexts のノードを不可視ハブ経由で
// 引き寄せ、クラスターとして固まらせる。ノート層のみ（本番の文脈モード既定）。
export const CanvasContextCluster: StoryObj = {
  name: "キャンバス: 文脈クラスター",
  render: () => (
    <div style={{ padding: 16 }}>
      <GlobalGraphCanvas
        data={SAMPLE}
        visibleLayers={new Set(["note"] as const)}
        colorMode="context"
        clusterByContext
        height={560}
      />
    </div>
  ),
};

// 大規模データでのクラスタリング検証。「文脈で寄せる」をトグルで ON/OFF して
// 素の force レイアウトとの差を見比べられる。ノート29・文脈4種・跨ぎ1・孤立3。
export const CanvasContextClusterLarge: StoryObj = {
  name: "キャンバス: 文脈クラスター（大規模）",
  render: () => {
    function Demo() {
      const [cluster, setCluster] = useState(true);
      return (
        <div style={{ padding: 16 }}>
          <label
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              fontSize: 12,
              marginBottom: 8,
              cursor: "pointer",
            }}
          >
            <input
              type="checkbox"
              checked={cluster}
              onChange={(e) => setCluster(e.target.checked)}
            />
            文脈で寄せる
          </label>
          <GlobalGraphCanvas
            data={LARGE}
            visibleLayers={new Set(["note"] as const)}
            colorMode="context"
            clusterByContext={cluster}
            height={620}
          />
        </div>
      );
    }
    return <Demo />;
  },
};

// キャンバス単体（検索強調）。ヒット = 琥珀色の太枠 + フルラベル、他はフェード。
// レイアウトは動かさない（クラス操作のみ）。
export const CanvasSearch: StoryObj = {
  name: "キャンバス: 検索強調",
  render: () => (
    <div style={{ padding: 16 }}>
      <GlobalGraphCanvas
        data={SAMPLE}
        visibleLayers={new Set(ALL_LAYERS)}
        searchQuery="測定"
        height={560}
      />
    </div>
  ),
};
