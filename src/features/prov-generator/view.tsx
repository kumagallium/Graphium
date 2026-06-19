// ──────────────────────────────────────────────
// PROVグラフ可視化（Cytoscape.js + ELK レイアウト）
//
// Phase 3: ProvJsonLd 埋め込み形式からノード・エッジを抽出
//
// design.md ラベル色パレット準拠:
//   Activity  = 楕円・落ち着いた青 (#5b8fb9)
//   Entity    = 丸四角・ブランドグリーン (#4B7A52)
//   Result    = 丸四角・テラコッタ (#c26356)
//   Parameter = ダイヤ・落ち着いたアンバー (#c08b3e)
// ──────────────────────────────────────────────

import { useEffect, useRef, useState, useCallback } from "react";
import { createPortal } from "react-dom";
import cytoscape from "cytoscape";
import type { ProvJsonLd, ProvJsonLdNode, ProvAttribute } from "./generator";
import { extractRelations, type FlatRelation } from "./generator";
import { Network, Workflow } from "lucide-react";
import { ActivityGraphEditor } from "../network-graph/activity-graph-editor";
import { t, getDisplayLabelName } from "../../i18n";
import { getActiveProvider } from "../../lib/storage/registry";
import { applyElkLayout, cyStyles, THEME } from "./cy-graph";

/**
 * 動画 URL から最初の数百ミリ秒のフレームを canvas に書き出して
 * data URL で返す。Cytoscape の background-image は静止画しか扱えないため、
 * 動画ノードのサムネイルは事前にラスタ化する必要がある。
 */
async function captureVideoFrame(videoUrl: string, seekSeconds = 0.1): Promise<string | null> {
  return new Promise((resolve) => {
    const video = document.createElement("video");
    video.crossOrigin = "anonymous";
    video.muted = true;
    video.playsInline = true;
    video.preload = "auto";
    video.src = videoUrl;

    const cleanup = () => {
      video.src = "";
      video.removeAttribute("src");
      video.load();
    };

    const onError = () => {
      cleanup();
      resolve(null);
    };

    video.addEventListener("loadedmetadata", () => {
      try {
        video.currentTime = Math.min(seekSeconds, Math.max(0, (video.duration || 0) - 0.05));
      } catch {
        onError();
      }
    });

    video.addEventListener("seeked", () => {
      try {
        const w = video.videoWidth || 160;
        const h = video.videoHeight || 90;
        const canvas = document.createElement("canvas");
        // サムネイルなのでロングサイドを 200 程度に縮小
        const scale = Math.min(1, 200 / Math.max(w, h));
        canvas.width = Math.max(1, Math.round(w * scale));
        canvas.height = Math.max(1, Math.round(h * scale));
        const ctx = canvas.getContext("2d");
        if (!ctx) { onError(); return; }
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        const dataUrl = canvas.toDataURL("image/jpeg", 0.7);
        cleanup();
        resolve(dataUrl);
      } catch {
        onError();
      }
    });

    video.addEventListener("error", onError);
    // タイムアウト（メタデータが取れない壊れた URL に備える）
    setTimeout(() => onError(), 5000);
  });
}

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


// ── ホバーイベント設定 ──

function setupHoverEffects(cy: cytoscape.Core) {
  cy.on("mouseover", "node", (evt) => {
    const node = evt.target;
    const neighborhood = node.neighborhood();

    cy.elements().addClass("faded");

    node.removeClass("faded").addClass("hover");
    neighborhood.removeClass("faded");
    neighborhood.nodes().addClass("hover-neighbor");
    neighborhood.edges().addClass("hover-connected");
  });

  cy.on("mouseout", "node", () => {
    cy.elements().removeClass("faded hover hover-neighbor hover-connected");
  });
}

// ── グラフコンポーネント ──

function CytoscapeGraph({
  doc,
  height = 450,
}: {
  doc: ProvJsonLd;
  height?: number;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const cyRef = useRef<cytoscape.Core | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;

    const elements = provToCytoscapeElements(doc);
    if (elements.length === 0) return;

    const cy = cytoscape({
      container: containerRef.current,
      elements,
      style: cyStyles,
      layout: { name: "preset" },
      userZoomingEnabled: true,
      userPanningEnabled: true,
      boxSelectionEnabled: false,
      wheelSensitivity: 0.3,
      minZoom: 0.2,
      maxZoom: 4,
    });

    cyRef.current = cy;

    setupHoverEffects(cy);

    let cancelled = false;

    // サムネイル URL を Blob URL / 動画フレームに変換して Cytoscape に反映
    // - local-media:// や Drive URL はアクティブなストレージプロバイダ経由で blob URL に変換
    // - 純粋な http(s) URL は fetch でフォールバック
    // - 動画は最初のフレームを canvas でキャプチャして data URL にする
    const thumbnailNodes = cy.nodes("[thumbnailUrl]");
    const blobUrls: string[] = [];
    if (thumbnailNodes.length > 0) {
      // 順次取得（429 レート制限を回避）
      (async () => {
        const provider = getActiveProvider();
        for (const node of thumbnailNodes.toArray()) {
          if (cancelled) break;
          const url = node.data("thumbnailUrl") as string;
          if (!url) continue;
          if (url.startsWith("data:")) continue;
          const mediaType = node.data("thumbnailMediaType") as string | undefined;

          // 1) 元 URL → ブラウザが直接読める URL（blob: もしくは元の http(s)）
          let resolvedUrl: string | null = null;
          if (url.startsWith("blob:")) {
            resolvedUrl = url;
          } else {
            try {
              const fileId = provider.extractFileId(url);
              if (fileId) {
                resolvedUrl = await provider.getMediaBlobUrl(fileId);
              }
            } catch {
              // プロバイダ解決失敗 → fetch フォールバックに進む
            }
            if (!resolvedUrl) {
              try {
                const res = await fetch(url);
                if (!res.ok) continue;
                const blob = await res.blob();
                resolvedUrl = URL.createObjectURL(blob);
                blobUrls.push(resolvedUrl);
              } catch {
                continue;
              }
            }
          }

          // 2) 動画は最初のフレームを canvas で抜く（背景画像は静止画である必要がある）
          let finalUrl: string | null = resolvedUrl;
          if (mediaType === "video") {
            try {
              finalUrl = await captureVideoFrame(resolvedUrl);
            } catch {
              finalUrl = null;
            }
          }

          if (!cancelled && finalUrl) {
            cy.batch(() => { node.data("thumbnailUrl", finalUrl); });
          }
        }
        if (!cancelled) {
          cy.style().update();
        }
      })();
    }

    cy.layout({ name: "breadthfirst", directed: true, spacingFactor: 1.5 } as any).run();
    cy.fit(undefined, 20);
    applyElkLayout(cy).then(() => {
      if (!cancelled) cy.fit(undefined, 20);
    }).catch((err) => {
      console.warn("[PROV] ELK レイアウト失敗（breadthfirst を維持）:", err);
    });

    return () => {
      cancelled = true;
      // Blob URL を解放
      for (const url of blobUrls) {
        URL.revokeObjectURL(url);
      }
      cy.destroy();
      cyRef.current = null;
    };
  }, [doc]);

  return (
    <div
      ref={containerRef}
      style={{
        width: "100%",
        height,
        background: THEME.background,
      }}
    />
  );
}

/**
 * PROVドキュメントの可視化パネル
 */
export function ProvGraphPanel({ doc }: { doc: ProvJsonLd | null }) {
  const [expanded, setExpanded] = useState(false);
  // PROV グラフ（静的・全体）と Activity 編集グラフ（手順のつなぎ替え）の切替
  const [view, setView] = useState<"prov" | "edit">("prov");

  useEffect(() => {
    if (!expanded) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setExpanded(false);
    };
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [expanded]);

  if (!doc) {
    return (
      <div style={panelStyle}>
        <div style={{ padding: 16, color: "#9ca3af", fontSize: 13 }}>
          {t("provPanel.noLabelsMessage")}
        </div>
      </div>
    );
  }

  // 統計情報の計算
  const relations = extractRelations(doc);
  const attrCount = doc["@graph"].reduce((sum, n) => {
    let count = 0;
    if (n["graphium:attributes"]) count += (n["graphium:attributes"] as ProvAttribute[]).length;
    const STATS_EXCLUDED = ["graphium:blockId", "graphium:attributes", "graphium:warnings", "graphium:entityType", "graphium:mediaType", "graphium:mediaUrl", "graphium:phase"];
    for (const key of Object.keys(n)) {
      if (key.startsWith("graphium:") && !STATS_EXCLUDED.includes(key) && typeof n[key as `graphium:${string}`] === "string") count++;
    }
    return sum + count;
  }, 0);

  const legendBar = (
    <div style={legendBarStyle}>
      <LegendDot color={THEME.activity.bg} shape="circle" label={getDisplayLabelName("procedure")} />
      <LegendDot color={THEME.entity.bg} shape="square" label={getDisplayLabelName("material")} />
      <LegendDot color={THEME.tool.bg} shape="diamond" label={getDisplayLabelName("tool")} />
      <LegendDot color={THEME.result.bg} shape="square" label={getDisplayLabelName("output")} />
      <LegendDot color={THEME.parameter.bg} shape="square" label={getDisplayLabelName("attribute")} />

      <span style={{ marginLeft: "auto", display: "flex", gap: 8, alignItems: "center" }}>
        <span style={{ color: "#9ca3af" }}>
          {t("provPanel.graphStats", { nodes: String(doc["@graph"].length + attrCount), relations: String(relations.length + attrCount) })}
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

  const viewToggle = (
    <div style={{ display: "flex", gap: 4, padding: "6px 12px 0" }}>
      <button
        onClick={() => setView("prov")}
        style={viewToggleBtnStyle(view === "prov")}
        title={t("provPanel.viewProv")}
      >
        <Network size={13} /> {t("provPanel.viewProv")}
      </button>
      <button
        onClick={() => setView("edit")}
        style={viewToggleBtnStyle(view === "edit")}
        title={t("provPanel.viewFlow")}
      >
        <Workflow size={13} /> {t("provPanel.viewFlow")}
      </button>
    </div>
  );

  return (
    <>
      <div style={panelStyle}>
        {viewToggle}
        {view === "prov" ? (
          <>
            {legendBar}
            <CytoscapeGraph doc={doc} />
          </>
        ) : (
          <div style={{ height: 440 }}>
            <ActivityGraphEditor doc={doc} />
          </div>
        )}
      </div>

      {/* 拡大モーダル */}
      {expanded && createPortal(
        <div style={modalOverlayStyle} onClick={() => setExpanded(false)}>
          <div style={modalContentStyle} onClick={(e) => e.stopPropagation()}>
            {legendBar}
            <CytoscapeGraph doc={doc} height={window.innerHeight - 120} />
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

function viewToggleBtnStyle(active: boolean): React.CSSProperties {
  return {
    display: "inline-flex",
    alignItems: "center",
    gap: 4,
    padding: "3px 10px",
    fontSize: 12,
    fontWeight: 600,
    background: active ? THEME.activity.bg : THEME.muted,
    color: active ? "#ffffff" : THEME.mutedFg,
    border: `1px solid ${active ? THEME.activity.bg : THEME.border}`,
    borderRadius: 6,
    cursor: "pointer",
  };
}

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
