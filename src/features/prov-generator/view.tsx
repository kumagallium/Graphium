// ──────────────────────────────────────────────
// 手順グラフのパネル。
//
// 表示は React Flow のフロービュー 1 本（step カード + Entity ノード）。
// かつては cytoscape の「手順（全体）」と 2 タブだったが、フロービューが
// Entity もパラメータも描くようになり「ステップのみ」ではなくなったため統合した。
//
// provToCytoscapeElements は PDF 書き出し（features/pdf-export）が使うので残す。
// ──────────────────────────────────────────────

import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import cytoscape from "cytoscape";
import type { ProvJsonLd, ProvJsonLdNode, ProvAttribute } from "./generator";
import { extractRelations } from "./generator";
import { ActivityGraphEditor } from "../network-graph/activity-graph-editor";
import { provDocToFlowGraph } from "../network-graph/activity-graph-adapter";
import { t, getDisplayLabelName } from "../../i18n";
import { THEME } from "./cy-graph";


// 後方互換
type ProvDocument = ProvJsonLd;

/**
 * ノードのサブタイプを判定（Entity を材料・ツール・結果に分離）
 */
function getNodeSubtype(node: ProvJsonLdNode): string {
  if (node["@type"] === "prov:Entity") {
    if (node["@id"].startsWith("param_")) return "parameter";
    if (node["@id"].startsWith("result_")) return "result";
    if (node["graphium:entityType"] === "tool") return "tool";
    return "entity"; // material またはサブタイプなし
  }
  return node["@type"];
}

/**
 * ProvJsonLd → Cytoscape elements 変換
 * Phase 3: 埋め込み関係からエッジを抽出
 */
export function provToCytoscapeElements(doc: ProvJsonLd): cytoscape.ElementDefinition[] {
  const elements: cytoscape.ElementDefinition[] = [];
  const nodeIdSet = new Set(doc["@graph"].map((n) => n["@id"]));

  // 予約済み graphium: キー（ビュー表示対象外）
  const RESERVED_KEYS = new Set([
    "graphium:blockId", "graphium:attributes", "graphium:warnings", "graphium:entityType",
    "graphium:mediaType", "graphium:mediaUrl",
    // Phase D-2: graphium:phase はメタ情報なのでノードとして描画しない
    "graphium:phase",
  ]);

  // メディアタイプ別のラベルプレフィックス
  const MEDIA_LABEL_PREFIX: Record<string, string> = {
    audio: "\u266B ",  // ♫
    video: "\u25B6 ",  // ▶
    pdf: "\uD83D\uDCC4 ",  // 📄
    file: "\uD83D\uDCCE ",  // 📎
  };

  let attrNodeIdx = 0;
  let edgeIdx = 0;

  /** メディア URL → サムネイル URL を解決（画像・動画のみ、音声等はサムネイルなし） */
  function resolveThumbUrl(url: string, type?: string): string | undefined {
    if (type === "audio" || type === "file") return undefined;
    return url.includes("googleusercontent.com")
      ? url.replace(/=s\d+$/, "=s80")
      : url;
  }

  // ノード
  for (const node of doc["@graph"]) {
    let label = node["rdfs:label"];

    // メディア Entity の場合はサムネイル URL をノードデータに付与
    const mediaUrl = node["graphium:mediaUrl"] as string | undefined;
    const mediaType = node["graphium:mediaType"] as string | undefined;
    let thumbnailUrl: string | undefined;
    if (mediaUrl) {
      thumbnailUrl = resolveThumbUrl(mediaUrl, mediaType);
      // サムネイルがないメディアにはラベルにプレフィックスを付ける
      if (!thumbnailUrl && mediaType && MEDIA_LABEL_PREFIX[mediaType]) {
        label = MEDIA_LABEL_PREFIX[mediaType] + label;
      }
    }

    elements.push({
      data: {
        id: node["@id"],
        label,
        type: node["@type"],
        subtype: getNodeSubtype(node),
        ...(thumbnailUrl ? { thumbnailUrl } : {}),
        ...(thumbnailUrl && mediaType ? { thumbnailMediaType: mediaType } : {}),
      },
    });

    // ── graphium: key-value プロパティ → ダイヤモンドノード ──
    for (const key of Object.keys(node)) {
      if (key.startsWith("graphium:") &&
          !RESERVED_KEYS.has(key) &&
          typeof node[key as `graphium:${string}`] === "string") {
        const shortKey = key.replace("graphium:", "");
        const value = node[key as `graphium:${string}`] as string;
        const attrId = `attr_${node["@id"]}_${attrNodeIdx++}`;

        // パラメータ値が画像 URL かチェック
        const isImageUrl = /\.(png|jpe?g|gif|webp|svg|bmp)/i.test(value) ||
          value.includes("googleusercontent.com/d/");
        let attrThumbnailUrl: string | undefined;
        if (isImageUrl) {
          attrThumbnailUrl = value.includes("googleusercontent.com")
            ? value.replace(/=s\d+$/, "=s80")
            : value;
        }

        elements.push({
          data: {
            id: attrId,
            label: isImageUrl ? shortKey : `${shortKey}: ${value}`,
            type: "graphium:Attribute",
            subtype: "parameter",
            ...(attrThumbnailUrl ? { thumbnailUrl: attrThumbnailUrl } : {}),
          },
        });
        // エッジ: 親ノード → 属性ノード（フロー順方向）
        elements.push({
          data: {
            id: `edge-${edgeIdx++}`,
            source: node["@id"],
            target: attrId,
            label: "hasAttribute",
          },
        });
      }
    }

    // ── graphium:attributes 配列 → ダイヤモンドノード ──
    if (node["graphium:attributes"]) {
      for (const attr of node["graphium:attributes"] as ProvAttribute[]) {
        const attrId = `attr_${node["@id"]}_${attrNodeIdx++}`;

        // 属性にメディア URL がある場合はサムネイル表示
        const attrMediaUrl = attr["graphium:mediaUrl"];
        const attrMediaType = attr["graphium:mediaType"];
        let attrThumbUrl: string | undefined;
        let attrLabel = attr["rdfs:label"];
        if (attrMediaUrl) {
          attrThumbUrl = resolveThumbUrl(attrMediaUrl, attrMediaType);
          if (!attrThumbUrl && attrMediaType && MEDIA_LABEL_PREFIX[attrMediaType]) {
            attrLabel = MEDIA_LABEL_PREFIX[attrMediaType] + attrLabel;
          }
        }

        elements.push({
          data: {
            id: attrId,
            label: attrLabel,
            ...(attrThumbUrl && attrMediaType ? { thumbnailMediaType: attrMediaType } : {}),
            type: "graphium:Attribute",
            subtype: "parameter",
            ...(attrThumbUrl ? { thumbnailUrl: attrThumbUrl } : {}),
          },
        });
        elements.push({
          data: {
            id: `edge-${edgeIdx++}`,
            source: node["@id"],
            target: attrId,
            label: "hasAttribute",
          },
        });
      }
    }
  }

  // エッジ: 埋め込み PROV 関係から抽出
  const relations = extractRelations(doc);

  for (const rel of relations) {
    if (!nodeIdSet.has(rel.from) || !nodeIdSet.has(rel.to)) {
      continue;
    }

    const relLabel = rel["@type"].replace("prov:", "").replace("graphium:", "");

    // 全リレーションを反転（PROV来歴方向 → 実験フロー順方向）
    const source = rel.to;
    const target = rel.from;

    elements.push({
      data: {
        id: `edge-${edgeIdx++}`,
        source,
        target,
        label: relLabel,
      },
    });
  }

  return elements;
}


/**
 * PROVドキュメントの可視化パネル
 */
export function ProvGraphPanel({
  doc,
  editorRef,
}: {
  doc: ProvJsonLd | null;
  /** メインエディタへの参照。フロービューのノード操作（追加・リネーム・削除）に使う */
  editorRef?: { current: any };
}) {
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    if (!expanded) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setExpanded(false);
    };
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [expanded]);

  // 統計はフロービューが実際に描くもの（step / Entity / エッジ）で数える。
  // パラメータはノードではなく各ノードの属性行なので数に含めない。
  const flow = useMemo(() => provDocToFlowGraph(doc), [doc]);

  const legendBar = (
    <div style={legendBarStyle}>
      <LegendDot color={THEME.activity.bg} shape="circle" label={getDisplayLabelName("procedure")} />
      <LegendDot color={THEME.entity.bg} shape="square" label={getDisplayLabelName("material")} />
      <LegendDot color={THEME.tool.bg} shape="diamond" label={getDisplayLabelName("tool")} />
      <LegendDot color={THEME.result.bg} shape="square" label={getDisplayLabelName("output")} />

      <span style={{ marginLeft: "auto", display: "flex", gap: 8, alignItems: "center" }}>
        <span style={{ color: "var(--color-text-tertiary)" }}>
          {t("provPanel.graphStats", {
            nodes: String(flow.steps.length + flow.entities.length),
            relations: String(flow.edges.length),
          })}
        </span>
        <button
          onClick={() => setExpanded(!expanded)}
          style={expandBtnStyle}
          title={expanded ? t("common.close") : t("provPanel.expandView")}
        >
          {expanded ? "✕" : "⤢"}
        </button>
      </span>
    </div>
  );

  return (
    <>
      <div style={panelStyle}>
        {legendBar}
        {/* 拡大中はモーダル側だけを描く（React Flow を二重に走らせない） */}
        {!expanded && (
          <div style={{ height: 620 }}>
            <ActivityGraphEditor doc={doc} editorRef={editorRef} />
          </div>
        )}
      </div>

      {/* 拡大モーダル */}
      {expanded && createPortal(
        <div style={modalOverlayStyle} onClick={() => setExpanded(false)}>
          <div style={modalContentStyle} onClick={(e) => e.stopPropagation()}>
            {legendBar}
            <div style={{ height: window.innerHeight - 120 }}>
              <ActivityGraphEditor doc={doc} editorRef={editorRef} tableLayout="side" />
            </div>
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}

// ── 凡例ドット ──

function LegendDot({ color, shape, label }: { color: string; shape: "circle" | "square" | "diamond"; label: string }) {
  const dotStyle: React.CSSProperties = {
    display: "inline-block",
    width: 10,
    height: 10,
    marginRight: 3,
    verticalAlign: "middle",
    background: color,
    ...(shape === "circle" ? { borderRadius: "50%" } : {}),
    ...(shape === "square" ? { borderRadius: 2 } : {}),
    ...(shape === "diamond" ? { borderRadius: 1, transform: "rotate(45deg) scale(0.8)" } : {}),
  };

  return (
    <span>
      <span style={dotStyle} />
      {label}
    </span>
  );
}

// ── スタイル定数 ──

const panelStyle: React.CSSProperties = {
  border: `1px solid ${THEME.border}`,
  borderRadius: 8,
  background: THEME.background,
  overflow: "hidden",
};

const legendBarStyle: React.CSSProperties = {
  display: "flex",
  gap: 12,
  padding: "6px 12px",
  borderBottom: `1px solid ${THEME.muted}`,
  fontSize: 10,
  color: THEME.mutedFg,
  alignItems: "center",
};

const expandBtnStyle: React.CSSProperties = {
  padding: "2px 6px",
  fontSize: 14,
  lineHeight: 1,
  background: THEME.muted,
  border: `1px solid ${THEME.border}`,
  borderRadius: 4,
  cursor: "pointer",
  color: THEME.mutedFg,
};


const modalOverlayStyle: React.CSSProperties = {
  position: "fixed",
  inset: 0,
  zIndex: 9999,
  background: "rgba(0, 0, 0, 0.5)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
};

const modalContentStyle: React.CSSProperties = {
  width: "calc(100vw - 64px)",
  height: "calc(100dvh - 64px)",
  background: THEME.background,
  borderRadius: 12,
  border: `1px solid ${THEME.border}`,
  overflow: "hidden",
  display: "flex",
  flexDirection: "column",
};
