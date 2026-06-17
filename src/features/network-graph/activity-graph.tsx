// ──────────────────────────────────────────────
// 手順フローグラフ（ノードエディタ的なリンク）
//
// 方針（2026-06-16 改訂 5）:
//   関係図ビュー（view.tsx）と**完全に同じ Cytoscape** で描く（見た目を一致させる）。
//   ノード/エッジスタイル・ELK レイアウトは view.tsx の cyStyles / applyElkLayout を流用。
//   このビューは手順ノードと手順依存（wasInformedBy）だけを描く。output entity は関係図側。
//
//   編集:
//   - 追加: cytoscape-edgehandles のドラッグ接続 → informed_by を書き込む
//   - 削除: 手順依存エッジをクリック（informed_by リンクが裏にあるものだけ削除可能）
// ──────────────────────────────────────────────

import { useEffect, useRef, useState } from "react";
import cytoscape from "cytoscape";
import edgehandles from "cytoscape-edgehandles";
import { Trash2 } from "lucide-react";
import { cyStyles, applyElkLayout } from "../prov-generator/view";
import { t } from "../../i18n";

// edgehandles の登録（重複防止）
let ehRegistered = false;
function ensureEdgehandles() {
  if (ehRegistered) return;
  cytoscape.use(edgehandles);
  ehRegistered = true;
}

export type ActivityNode = {
  id: string; // blockId
  name: string; // 連番プレフィックス除去済みの activity 名
  phase?: "plan" | "result";
};

/** 手順間の依存（A が産み B が使う＝ B wasInformedBy A）。from=A / to=B で下向きに流す。 */
export type StepEdge = {
  id: string;
  from: string; // 生成側 activity（blockId）
  to: string; // 使用側 activity（blockId）
  /** 裏に informed_by リンクがあり、このビューから削除できるか */
  deletable?: boolean;
};

export type ActivityGraphProps = {
  activities: ActivityNode[];
  steps: StepEdge[];
  /** 手順 A（産）→ 手順 B（使）のドラッグ接続 */
  onConnectSteps?: (producer: string, consumer: string) => void;
  /** 手順エッジ削除（deletable なものだけ呼ばれる） */
  onRemoveStep?: (stepId: string) => void;
};

// edgehandles / 削除ホバーのスタイル（cyStyles に追記）
const EH_STYLES: cytoscape.StylesheetStyle[] = [
  {
    selector: ".eh-handle",
    style: {
      "background-color": "#5b8fb9",
      width: 10,
      height: 10,
      shape: "ellipse",
      "border-width": 2,
      "border-color": "#ffffff",
      "border-opacity": 1,
    },
  },
  {
    selector: ".eh-preview, .eh-ghost-edge",
    style: {
      "line-color": "#5b8fb9",
      "target-arrow-color": "#5b8fb9",
      "target-arrow-shape": "triangle",
      "line-style": "dashed",
      width: 2,
    },
  },
  // 削除可能なエッジにホバーしたら赤くして「クリックで削除」を示す
  {
    selector: "edge.del-hover",
    style: {
      "line-color": "#c26356",
      "target-arrow-color": "#c26356",
      width: 3.5,
      "z-index": 20,
    },
  },
];

export function ActivityGraph({
  activities,
  steps,
  onConnectSteps,
  onRemoveStep,
}: ActivityGraphProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const cyRef = useRef<cytoscape.Core | null>(null);
  // 最新のコールバックを ref 経由で参照（cy 再初期化を避ける）
  const cbRef = useRef({ onConnectSteps, onRemoveStep });
  cbRef.current = { onConnectSteps, onRemoveStep };

  // 削除メニュー（エッジクリックで開く小ポップオーバー）
  const [delMenu, setDelMenu] = useState<{ stepId: string; x: number; y: number } | null>(null);

  // ── 初期化（マウント時のみ）──
  useEffect(() => {
    if (!containerRef.current) return;
    ensureEdgehandles();

    const cy = cytoscape({
      container: containerRef.current,
      style: [...cyStyles, ...EH_STYLES],
      minZoom: 0.2,
      maxZoom: 4,
      wheelSensitivity: 0.3,
    });
    cyRef.current = cy;

    const eh = (cy as any).edgehandles({
      hoverDelay: 120,
      snap: true,
      canConnect: (source: any, target: any) =>
        source.isNode() &&
        target.isNode() &&
        !source.same(target) &&
        source.edgesTo(target).length === 0,
      edgeParams: () => ({ data: { label: "wasInformedBy" } }),
    });

    // ドラッグ接続完了 → プレビューを消し、informed_by 書き込みは親に委ねる
    cy.on("ehcomplete", (_evt: any, source: any, target: any, added: any) => {
      added.remove();
      cbRef.current.onConnectSteps?.(source.id(), target.id());
    });

    // 削除可能なエッジ: クリックで削除メニューを開く（即削除はしない）、ホバーで赤表示
    cy.on("tap", "edge", (evt) => {
      const edge = evt.target;
      if (!edge.data("deletable")) return;
      const p = edge.renderedMidpoint();
      setDelMenu({ stepId: edge.id(), x: p.x, y: p.y });
    });
    cy.on("mouseover", "edge", (evt) => {
      const edge = evt.target;
      if (edge.data("deletable")) {
        edge.addClass("del-hover");
        if (containerRef.current) containerRef.current.style.cursor = "pointer";
      }
    });
    cy.on("mouseout", "edge", (evt) => {
      evt.target.removeClass("del-hover");
      if (containerRef.current) containerRef.current.style.cursor = "";
    });
    // 背景タップ / パン / ズームでメニューを閉じる
    cy.on("tap", (evt) => {
      if (evt.target === cy) setDelMenu(null);
    });
    cy.on("pan zoom", () => setDelMenu(null));

    return () => {
      eh.destroy();
      cy.destroy();
      cyRef.current = null;
    };
  }, []);

  // ── 要素同期（activities / steps 変化時に再構築 → ELK 再レイアウト）──
  useEffect(() => {
    const cy = cyRef.current;
    if (!cy) return;
    setDelMenu(null); // グラフが変わったら位置がずれるのでメニューを閉じる
    cy.batch(() => {
      cy.elements().remove();
      cy.add(
        activities.map((a) => ({
          group: "nodes" as const,
          data: { id: a.id, label: a.name, subtype: "prov:Activity", type: "prov:Activity" },
        })),
      );
      cy.add(
        steps
          .filter((s) => cy.getElementById(s.from).length && cy.getElementById(s.to).length)
          .map((s) => ({
            group: "edges" as const,
            data: {
              id: s.id,
              source: s.from,
              target: s.to,
              label: "wasInformedBy",
              deletable: s.deletable ?? false,
            },
          })),
      );
    });
    void applyElkLayout(cy);
  }, [activities, steps]);

  return (
    <div style={{ position: "relative", width: "100%", height: "100%" }}>
      <div
        ref={containerRef}
        style={{ width: "100%", height: "100%", background: "#fafdf7", borderRadius: 8 }}
      />

      {/* 削除メニュー（エッジクリックで開く。即削除しないことで誤操作を防ぐ） */}
      {delMenu && (
        <div
          style={{
            position: "absolute",
            left: delMenu.x,
            top: delMenu.y,
            transform: "translate(-50%, -50%)",
            zIndex: 30,
            background: "#ffffff",
            border: "1px solid #d5e0d7",
            borderRadius: 8,
            boxShadow: "0 4px 14px rgba(0,0,0,0.12)",
            padding: 4,
          }}
          onClick={(e) => e.stopPropagation()}
        >
          <button
            onClick={() => {
              cbRef.current.onRemoveStep?.(delMenu.stepId);
              setDelMenu(null);
            }}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              padding: "5px 10px",
              fontSize: 12,
              fontWeight: 600,
              color: "#c26356",
              background: "transparent",
              border: "none",
              borderRadius: 6,
              cursor: "pointer",
              whiteSpace: "nowrap",
            }}
            onMouseEnter={(e) => (e.currentTarget.style.background = "#fef2f2")}
            onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
          >
            <Trash2 size={14} /> {t("activityGraph.deleteStep")}
          </button>
        </div>
      )}

      {/* 空状態のときだけ控えめに使い方を示す（つなぎが 1 本でもあれば隠す） */}
      {steps.length === 0 && (
        <div
          style={{
            position: "absolute",
            bottom: 10,
            left: 0,
            right: 0,
            textAlign: "center",
            fontSize: 12,
            color: "#8fa394", // text-tertiary（design.md）
            pointerEvents: "none",
          }}
        >
          {t("activityGraph.dragHint")}
        </div>
      )}
    </div>
  );
}
