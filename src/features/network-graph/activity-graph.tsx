// ──────────────────────────────────────────────
// Activity グラフ（ノートエディタ的なリンク試作）
//
// 目的: activity（手順見出し）間の operation リンクを、
//   余白ラベル → パネル → モーダル選択ではなく、
//   グラフ上でノードからノードへドラッグして引けるようにする UX 検証。
//
// 既存の network-graph/view.tsx（ノート間グラフ）と同じ cytoscape を土台にし、
// ドラッグ接続は cytoscape-edgehandles 拡張で実現する。
// activity↔activity の関係は informed_by（前手順）が主・reproduction_of（再現）が従。
// ──────────────────────────────────────────────

import { useEffect, useRef, useState, useCallback } from "react";
import cytoscape from "cytoscape";
import type { Core } from "cytoscape";
import edgehandles from "cytoscape-edgehandles";
import type { EdgeHandlesInstance } from "cytoscape-edgehandles";
import { ensureCytoscapePlugins } from "../../lib/cytoscape-setup";
import { LINK_TYPE_META, type ProvLinkType } from "../block-link/link-types";

// edgehandles の登録（重複防止）
let ehRegistered = false;
function ensureEdgehandles() {
  if (ehRegistered) return;
  cytoscape.use(edgehandles);
  ehRegistered = true;
}

// ── テーマカラー（design.md / view.tsx 準拠）──
const NODE_COLOR = "#4B7A52"; // ブランドグリーン
const NODE_BORDER = "#3d6844";
const BG_COLOR = "#fafdf7";

/** activity↔activity で選べる関係種（ドロップ時のピッカー候補） */
const ACTIVITY_RELATIONS: { type: ProvLinkType; label: string; hint: string }[] = [
  { type: "informed_by", label: "前の手順", hint: "wasInformedBy（順序）" },
  { type: "reproduction_of", label: "再現・追試", hint: "wasDerivedFrom（実験↔実験）" },
];

export type ActivityNode = {
  /** blockId */
  id: string;
  /** 連番プレフィックス除去済みの activity 名 */
  name: string;
  phase?: "plan" | "result";
};

export type ActivityEdge = {
  id: string;
  source: string; // sourceBlockId
  target: string; // targetBlockId
  type: ProvLinkType;
};

export type ActivityGraphProps = {
  activities: ActivityNode[];
  edges: ActivityEdge[];
  /** ドラッグ接続 → 関係種選択が確定したとき */
  onCreateEdge?: (source: string, target: string, type: ProvLinkType) => void;
  /** エッジクリックで削除 */
  onRemoveEdge?: (edgeId: string) => void;
};

/** ドロップ時に表示する関係種ピッカーの状態 */
type PendingLink = {
  source: string;
  target: string;
  x: number;
  y: number;
} | null;

export function ActivityGraph({
  activities,
  edges,
  onCreateEdge,
  onRemoveEdge,
}: ActivityGraphProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const cyRef = useRef<Core | null>(null);
  const ehRef = useRef<EdgeHandlesInstance | null>(null);
  const [pending, setPending] = useState<PendingLink>(null);

  // 最新のコールバックを ref 経由で参照（cy 再初期化を避ける）
  const cbRef = useRef({ onRemoveEdge });
  cbRef.current = { onRemoveEdge };

  // ── 初期化（マウント時のみ）──
  useEffect(() => {
    if (!containerRef.current) return;
    ensureCytoscapePlugins();
    ensureEdgehandles();

    const cy = cytoscape({
      container: containerRef.current,
      style: [
        {
          selector: "node",
          style: {
            "background-color": NODE_COLOR,
            "border-width": 2,
            "border-color": NODE_BORDER,
            shape: "round-rectangle",
            label: "data(name)",
            color: "#ffffff",
            "font-size": 12,
            "text-valign": "center",
            "text-halign": "center",
            "text-wrap": "wrap",
            "text-max-width": "92px",
            width: 108,
            height: 44,
          },
        },
        {
          selector: "edge",
          style: {
            width: 2.5,
            "line-color": "data(color)",
            "target-arrow-color": "data(color)",
            "target-arrow-shape": "triangle",
            "curve-style": "bezier",
            label: "data(label)",
            "font-size": 9,
            color: "data(color)",
            "text-background-color": BG_COLOR,
            "text-background-opacity": 1,
            "text-background-padding": "2px",
          },
        },
        // edgehandles のハンドル・プレビュー
        {
          selector: ".eh-handle",
          style: {
            "background-color": "#5b8fb9",
            width: 12,
            height: 12,
            shape: "ellipse",
            "border-width": 2,
            "border-color": "#ffffff",
          },
        },
        {
          selector: ".eh-ghost-edge, .eh-preview",
          style: {
            "line-color": "#5b8fb9",
            "target-arrow-color": "#5b8fb9",
            "target-arrow-shape": "triangle",
            "line-style": "dashed",
          },
        },
      ],
      layout: { name: "preset" }, // 初期は親から渡された位置 / 後で fcose
      minZoom: 0.4,
      maxZoom: 2.5,
    });
    cyRef.current = cy;

    const eh = cy.edgehandles({
      hoverDelay: 120,
      snap: true,
      canConnect: (source, target) =>
        !source.same(target) &&
        target.edgesWith(source).length === 0, // 既存リンクの重複を防ぐ（簡易）
      edgeParams: () => ({ data: {} }),
    });
    ehRef.current = eh;

    // ドラッグ接続が完了したら、自動追加されたプレビューエッジは消し、
    // 関係種ピッカーを開く（確定は親に委ねる）
    cy.on("ehcomplete", (_event, source, target, addedEdge) => {
      addedEdge.remove();
      const rect = containerRef.current?.getBoundingClientRect();
      const rp = target.renderedPosition();
      setPending({
        source: source.id(),
        target: target.id(),
        x: (rect?.left ?? 0) + rp.x,
        y: (rect?.top ?? 0) + rp.y,
      });
    });

    // エッジクリックで削除
    cy.on("tap", "edge", (event) => {
      const id = event.target.id();
      cbRef.current.onRemoveEdge?.(id);
    });

    return () => {
      eh.destroy();
      cy.destroy();
      cyRef.current = null;
      ehRef.current = null;
    };
  }, []);

  // ── ノード同期（activities 変化時にレイアウト）──
  useEffect(() => {
    const cy = cyRef.current;
    if (!cy) return;
    cy.batch(() => {
      cy.nodes().remove();
      cy.add(
        activities.map((a) => ({
          group: "nodes" as const,
          data: { id: a.id, name: a.name, phase: a.phase },
        })),
      );
    });
    cy.layout({
      name: "fcose",
      // @ts-expect-error fcose 拡張オプション
      animate: true,
      randomize: true,
      idealEdgeLength: 110,
      nodeSeparation: 90,
    }).run();
  }, [activities]);

  // ── エッジ同期（edges 変化時、レイアウトはし直さない）──
  useEffect(() => {
    const cy = cyRef.current;
    if (!cy) return;
    cy.batch(() => {
      cy.edges().remove();
      cy.add(
        edges
          .filter((e) => cy.getElementById(e.source).length && cy.getElementById(e.target).length)
          .map((e) => {
            const meta = LINK_TYPE_META[e.type];
            return {
              group: "edges" as const,
              data: {
                id: e.id,
                source: e.source,
                target: e.target,
                color: meta?.color ?? "#5b8fb9",
                label: meta?.provDM ?? e.type,
              },
            };
          }),
      );
    });
  }, [edges]);

  const confirmRelation = useCallback(
    (type: ProvLinkType) => {
      if (pending) onCreateEdge?.(pending.source, pending.target, type);
      setPending(null);
    },
    [pending, onCreateEdge],
  );

  return (
    <div style={{ position: "relative", width: "100%", height: "100%" }}>
      <div
        ref={containerRef}
        style={{
          width: "100%",
          height: "100%",
          backgroundColor: BG_COLOR,
          borderRadius: 8,
        }}
      />
      {/* 操作ヒント */}
      <div
        style={{
          position: "absolute",
          top: 10,
          left: 12,
          fontSize: 12,
          color: "#6b7f6e",
          pointerEvents: "none",
        }}
      >
        ノードの上にカーソルを置き、青いハンドルから別の手順へドラッグしてつなぎます
      </div>

      {/* ドロップ時の関係種ピッカー */}
      {pending && (
        <>
          {/* 外側クリックでキャンセル */}
          <div
            style={{ position: "fixed", inset: 0, zIndex: 40 }}
            onClick={() => setPending(null)}
          />
          <div
            style={{
              position: "fixed",
              left: pending.x,
              top: pending.y,
              transform: "translate(-50%, 10px)",
              zIndex: 41,
              background: "#ffffff",
              border: "1px solid #d9e2dc",
              borderRadius: 8,
              boxShadow: "0 6px 20px rgba(0,0,0,0.12)",
              padding: 6,
              minWidth: 180,
            }}
          >
            <div style={{ fontSize: 11, color: "#8a978d", padding: "2px 8px 6px" }}>
              関係を選ぶ
            </div>
            {ACTIVITY_RELATIONS.map((r) => (
              <button
                key={r.type}
                onClick={() => confirmRelation(r.type)}
                style={{
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "flex-start",
                  width: "100%",
                  textAlign: "left",
                  padding: "6px 8px",
                  border: "none",
                  borderRadius: 6,
                  background: "transparent",
                  cursor: "pointer",
                }}
                onMouseEnter={(e) => (e.currentTarget.style.background = "#f1f6f1")}
                onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
              >
                <span
                  style={{
                    fontSize: 13,
                    color: LINK_TYPE_META[r.type].color,
                    fontWeight: 600,
                  }}
                >
                  {r.label}
                </span>
                <span style={{ fontSize: 10, color: "#9aa7a0" }}>{r.hint}</span>
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
