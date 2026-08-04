// ──────────────────────────────────────────────
// 手順フローグラフ（ノードエディタ的なリンク）
//
// 方針（2026-06-16 改訂 5）:
//   関係図ビュー（view.tsx）と**完全に同じ Cytoscape** で描く（見た目を一致させる）。
//   ノード/エッジスタイル・ELK レイアウトは view.tsx の cyStyles / applyElkLayout を流用。
//   このビューは手順ノードと手順依存（wasInformedBy）だけを描く。output entity は関係図側。
//
//   編集:
//   - 接続: cytoscape-edgehandles のドラッグ接続 → informed_by を書き込む
//   - 接続削除: 手順依存エッジをクリック（informed_by リンクが裏にあるものだけ削除可能）
//   - ノード操作: 手順ノードをクリック → ポップオーバー（リネーム / 本文へ / 削除）。
//     ツールバーの「+ 手順」で新しい手順を追加。
//     いずれもコールバックで親（ActivityGraphEditor）に委ね、このコンポーネント自身は
//     ドキュメントを知らない（グラフは blocks+links からの投影、という一方向を保つ）。
// ──────────────────────────────────────────────

import { useEffect, useRef, useState, type CSSProperties } from "react";
import cytoscape from "cytoscape";
import edgehandles from "cytoscape-edgehandles";
import { FileText, Plus, Trash2 } from "lucide-react";
import { cyStyles, applyElkLayout } from "../prov-generator/cy-graph";
import { useImeEnterGuard } from "../../hooks/use-ime-enter-guard";
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

/** onConnectSteps の戻り値。error が "cycle_detected" なら循環で拒否されたことを表示する */
export type ConnectResult = { error: string | null };

export type ActivityGraphProps = {
  activities: ActivityNode[];
  steps: StepEdge[];
  /** 手順 A（産）→ 手順 B（使）のドラッグ接続。拒否理由を返すと画面に表示する */
  onConnectSteps?: (producer: string, consumer: string) => ConnectResult | void;
  /** 手順エッジ削除（deletable なものだけ呼ばれる） */
  onRemoveStep?: (stepId: string) => void;
  /** ツールバーの「+ 手順」。省略時はボタンを出さない */
  onAddActivity?: () => void;
  /** ノードポップオーバーでのリネーム確定 */
  onRenameActivity?: (blockId: string, title: string) => void;
  /** ノードポップオーバーからの削除（step の中身ごと消える） */
  onDeleteActivity?: (blockId: string) => void;
  /** ノードポップオーバーの「本文へ」（エディタの該当 step へスクロール） */
  onJumpToBlock?: (blockId: string) => void;
  /** 削除確認に出す「中身のブロック数」。省略時は 0 扱い（確認なしで削除） */
  getStepContentCount?: (blockId: string) => number;
};

// edgehandles / 接続ハンドル / 削除ホバーのスタイル（cyStyles に追記）
const EH_STYLES: cytoscape.StylesheetStyle[] = [
  // 各手順に常時表示する接続ポート（丸）。上=入力（白抜き）、下=出力（塗り・掴んで接続）。
  {
    selector: ".porthandle",
    style: {
      width: 12,
      height: 12,
      shape: "ellipse",
      "border-width": 2,
      "border-color": "#5b8fb9",
      "border-opacity": 1,
      opacity: 1,
      "z-index": 100,
      events: "yes",
    },
  },
  { selector: ".porthandle.out", style: { "background-color": "#5b8fb9" } }, // 出力（塗り・掴んで接続）
  {
    selector: ".porthandle.out.handle-hover",
    style: { width: 16, height: 16, "background-color": "#4a7da6", "border-color": "#4a7da6" },
  },
  // ドラッグ中のプレビュー線（エッジにだけ当てる。ノードに当てると幅が潰れるため）
  {
    selector: "edge.eh-ghost-edge, edge.eh-preview",
    style: {
      "line-color": "#5b8fb9",
      "target-arrow-color": "#5b8fb9",
      "target-arrow-shape": "triangle",
      "line-style": "dashed",
      width: 2,
    },
  },
  // ドロップ候補ノードのハイライト（横幅は変えず、枠だけ強調）
  {
    selector: "node.eh-presumptive-target, node.eh-target",
    style: { "border-width": 4, "border-color": "#5b8fb9" },
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
  onAddActivity,
  onRenameActivity,
  onDeleteActivity,
  onJumpToBlock,
  getStepContentCount,
}: ActivityGraphProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const cyRef = useRef<cytoscape.Core | null>(null);
  // 最新のコールバックを ref 経由で参照（cy 再初期化を避ける）
  const cbRef = useRef({
    onConnectSteps,
    onRemoveStep,
    onRenameActivity,
    onDeleteActivity,
    onJumpToBlock,
    getStepContentCount,
  });
  cbRef.current = {
    onConnectSteps,
    onRemoveStep,
    onRenameActivity,
    onDeleteActivity,
    onJumpToBlock,
    getStepContentCount,
  };

  // 削除メニュー（エッジクリックで開く小ポップオーバー）
  const [delMenu, setDelMenu] = useState<{ stepId: string; x: number; y: number } | null>(null);
  // ノードメニュー（手順クリックで開く。リネーム / 本文へ / 削除）
  const [nodeMenu, setNodeMenu] = useState<{
    blockId: string;
    title: string;
    contentCount: number;
    x: number;
    y: number;
  } | null>(null);
  // 循環でドラッグ接続を拒否したときの警告（黙って消えると壊れて見えるため）。0 = 非表示
  const [cycleWarnAt, setCycleWarnAt] = useState(0);

  useEffect(() => {
    if (!cycleWarnAt) return;
    const id = setTimeout(() => setCycleWarnAt(0), 3000);
    return () => clearTimeout(id);
  }, [cycleWarnAt]);

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
      autoungrabify: true, // ノードは動かさない（自動レイアウト）。ドラッグは接続専用
    });
    cyRef.current = cy;

    // ポート（porthandle）に当たったら、その手順ノードに解決する
    const resolveActivity = (ele: any) =>
      ele.hasClass("porthandle") ? cy.getElementById(ele.data("handleFor")) : ele;

    const eh = (cy as any).edgehandles({
      snap: true,
      canConnect: (source: any, target: any) => {
        const s = resolveActivity(source);
        const t = resolveActivity(target);
        return (
          s.nonempty() &&
          t.nonempty() &&
          s.isNode() &&
          t.isNode() &&
          !s.same(t) &&
          s.edgesTo(t).length === 0
        );
      },
      edgeParams: () => ({ data: { label: "wasInformedBy" } }),
    });

    // 出力ポート（下の塗り丸）を掴んだら、その手順から接続を開始する
    cy.on("tapstart", ".porthandle.out", (evt) => {
      const act = cy.getElementById(evt.target.data("handleFor"));
      if (act.nonempty()) eh.start(act);
    });
    cy.on("mouseover", ".porthandle.out", (evt) => {
      evt.target.addClass("handle-hover");
      if (containerRef.current) containerRef.current.style.cursor = "crosshair";
    });
    cy.on("mouseout", ".porthandle.out", (evt) => {
      evt.target.removeClass("handle-hover");
      if (containerRef.current) containerRef.current.style.cursor = "";
    });

    // ドラッグ接続完了 → プレビューを消し、informed_by 書き込みは親に委ねる
    cy.on("ehcomplete", (_evt: any, source: any, target: any, added: any) => {
      added.remove();
      const src = resolveActivity(source).id();
      const tgt = resolveActivity(target).id();
      if (src && tgt && src !== tgt) {
        const res = cbRef.current.onConnectSteps?.(src, tgt);
        // store が循環（DAG 違反）で拒否したときは理由をその場に出す
        if (res && res.error === "cycle_detected") setCycleWarnAt(Date.now());
      }
    });

    // 手順ノードをクリック → ノードメニュー（リネーム / 本文へ / 削除）。
    // porthandle は type を持たないのでこのセレクタには当たらない。
    cy.on("tap", 'node[type = "prov:Activity"]', (evt) => {
      const cbs = cbRef.current;
      if (!cbs.onRenameActivity && !cbs.onDeleteActivity && !cbs.onJumpToBlock) return;
      const node = evt.target;
      const p = node.renderedPosition();
      const h = node.renderedOuterHeight() || 60;
      setDelMenu(null);
      // パネル端で見切れないよう、メニューの概算サイズでコンテナ内に収める
      const MENU_W = 200;
      const MENU_H = 92;
      const cw = containerRef.current?.clientWidth ?? Number.MAX_SAFE_INTEGER;
      const ch = containerRef.current?.clientHeight ?? Number.MAX_SAFE_INTEGER;
      setNodeMenu({
        blockId: node.id(),
        title: node.data("label") ?? "",
        contentCount: cbs.getStepContentCount?.(node.id()) ?? 0,
        x: Math.min(Math.max(p.x, MENU_W / 2 + 4), Math.max(MENU_W / 2 + 4, cw - MENU_W / 2 - 4)),
        y: Math.min(p.y + h / 2 + 6, Math.max(4, ch - MENU_H)),
      });
    });

    // 削除可能なエッジ: クリックで削除メニューを開く（即削除はしない）、ホバーで赤表示
    cy.on("tap", "edge", (evt) => {
      const edge = evt.target;
      if (!edge.data("deletable")) return;
      const p = edge.renderedMidpoint();
      setNodeMenu(null);
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
      if (evt.target === cy) {
        setDelMenu(null);
        setNodeMenu(null);
      }
    });
    cy.on("pan zoom", () => {
      setDelMenu(null);
      setNodeMenu(null);
    });

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
    setNodeMenu(null);
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
    void applyElkLayout(cy).then(() => {
      if (cy.destroyed()) return;
      // レイアウト確定後、各手順の下に出力ポート（丸）を置く（掴んで接続）
      cy.remove(".porthandle");
      const handles = cy.nodes('[type = "prov:Activity"]').map((n) => ({
        group: "nodes" as const,
        data: { id: `__ho_${n.id()}`, handleFor: n.id() },
        classes: "porthandle out",
        position: { x: n.position("x"), y: n.position("y") + (n.outerHeight() || 60) / 2 + 2 },
        grabbable: false,
        selectable: false,
      }));
      cy.add(handles);
    });
  }, [activities, steps]);

  return (
    <div style={{ position: "relative", width: "100%", height: "100%" }}>
      <div
        ref={containerRef}
        style={{ width: "100%", height: "100%", background: "#fafdf7", borderRadius: 8 }}
      />

      {/* ツールバー: 新しい手順の追加（文書側に step ブロックが増える） */}
      {onAddActivity && (
        <button
          onClick={onAddActivity}
          title={t("activityGraph.addStep")}
          style={{
            position: "absolute",
            top: 8,
            right: 8,
            zIndex: 20,
            display: "inline-flex",
            alignItems: "center",
            gap: 4,
            padding: "4px 10px",
            fontSize: 12,
            fontWeight: 600,
            color: "#5b8fb9",
            background: "#ffffff",
            border: "1px solid #d5e0d7",
            borderRadius: 6,
            cursor: "pointer",
          }}
          onMouseEnter={(e) => (e.currentTarget.style.background = "#f0f5ef")}
          onMouseLeave={(e) => (e.currentTarget.style.background = "#ffffff")}
        >
          <Plus size={13} /> {t("activityGraph.addStep")}
        </button>
      )}

      {/* 循環でドラッグ接続を拒否したときの警告 */}
      {cycleWarnAt !== 0 && (
        <div
          style={{
            position: "absolute",
            top: 8,
            left: "50%",
            transform: "translateX(-50%)",
            zIndex: 25,
            background: "#fef2f2",
            color: "#c26356",
            border: "1px solid #c26356",
            borderRadius: 6,
            padding: "4px 10px",
            fontSize: 12,
            fontWeight: 600,
            whiteSpace: "nowrap",
            pointerEvents: "none",
          }}
        >
          {t("step.cycleBlocked")}
        </div>
      )}

      {/* ノードメニュー（手順クリックで開く。リネーム / 本文へ / 削除） */}
      {nodeMenu && (
        <StepNodeMenu
          key={nodeMenu.blockId}
          blockId={nodeMenu.blockId}
          initialTitle={nodeMenu.title}
          contentCount={nodeMenu.contentCount}
          x={nodeMenu.x}
          y={nodeMenu.y}
          onRename={onRenameActivity}
          onDelete={onDeleteActivity}
          onJump={onJumpToBlock}
          onClose={() => setNodeMenu(null)}
        />
      )}

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

// ── ノードメニュー ──
//
// リネームは Enter で確定・Escape / 外側クリックで破棄（blur 確定はしない —
// パン操作などでフォーカスが外れただけで書き換わる事故を防ぐ）。
// グラフのラベルは連番プレフィックス除去済みなので、値が変わったときだけ
// 書き戻す（開いて Enter しただけで本文のタイトルが変わらないように）。

const nodeMenuBtnStyle = (danger: boolean): CSSProperties => ({
  display: "inline-flex",
  alignItems: "center",
  gap: 5,
  padding: "5px 10px",
  fontSize: 12,
  fontWeight: 600,
  color: danger ? "#c26356" : "#5b8fb9",
  background: "transparent",
  border: "none",
  borderRadius: 6,
  cursor: "pointer",
  whiteSpace: "nowrap",
});

function StepNodeMenu({
  blockId,
  initialTitle,
  contentCount,
  x,
  y,
  onRename,
  onDelete,
  onJump,
  onClose,
}: {
  blockId: string;
  initialTitle: string;
  contentCount: number;
  x: number;
  y: number;
  onRename?: (blockId: string, title: string) => void;
  onDelete?: (blockId: string) => void;
  onJump?: (blockId: string) => void;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState(initialTitle);
  const [confirming, setConfirming] = useState(false);
  const { compositionHandlers, isImeKey } = useImeEnterGuard();

  const commitRename = () => {
    const v = draft.trim();
    if (v && v !== initialTitle) onRename?.(blockId, v);
  };

  return (
    <div
      style={{
        position: "absolute",
        left: x,
        top: y,
        transform: "translateX(-50%)",
        zIndex: 30,
        background: "#ffffff",
        border: "1px solid #d5e0d7",
        borderRadius: 8,
        boxShadow: "0 4px 14px rgba(0,0,0,0.12)",
        padding: 6,
        display: "flex",
        flexDirection: "column",
        gap: 4,
        minWidth: 180,
      }}
      onClick={(e) => e.stopPropagation()}
    >
      {onRename ? (
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          autoFocus
          onFocus={(e) => e.target.select()}
          aria-label={t("activityGraph.stepName")}
          {...compositionHandlers}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !isImeKey(e)) {
              commitRename();
              onClose();
            } else if (e.key === "Escape") {
              // 拡大モーダル等の Escape ハンドラ（document）まで届かせない
              e.stopPropagation();
              onClose();
            }
          }}
          style={{
            padding: "5px 8px",
            fontSize: 12,
            fontWeight: 600,
            border: "1px solid #d5e0d7",
            borderRadius: 6,
            outline: "none",
            minWidth: 170,
          }}
        />
      ) : (
        <div style={{ padding: "5px 8px", fontSize: 12, fontWeight: 600 }}>{initialTitle}</div>
      )}
      <div style={{ display: "flex", gap: 2 }}>
        {onJump && (
          <button
            onClick={() => {
              onJump(blockId);
              onClose();
            }}
            style={nodeMenuBtnStyle(false)}
            onMouseEnter={(e) => (e.currentTarget.style.background = "#f0f5ef")}
            onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
          >
            <FileText size={13} /> {t("activityGraph.jumpToText")}
          </button>
        )}
        {onDelete &&
          (confirming ? (
            <button
              onClick={() => {
                onDelete(blockId);
                onClose();
              }}
              style={{ ...nodeMenuBtnStyle(true), background: "#fef2f2" }}
            >
              <Trash2 size={13} /> {t("activityGraph.deleteNodeConfirm", { n: String(contentCount) })}
            </button>
          ) : (
            <button
              onClick={() => {
                // 中身がある step は 1 クリックで消さない（グラフからは中身が見えないため）
                if (contentCount > 0) {
                  setConfirming(true);
                } else {
                  onDelete(blockId);
                  onClose();
                }
              }}
              style={{ ...nodeMenuBtnStyle(true), marginLeft: "auto" }}
              onMouseEnter={(e) => (e.currentTarget.style.background = "#fef2f2")}
              onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
            >
              <Trash2 size={13} /> {t("activityGraph.deleteNode")}
            </button>
          ))}
      </div>
    </div>
  );
}
