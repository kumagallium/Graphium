// 全体グラフの島の名前（重ね書き）と、島の中身を出すパネル。
//
// 名前は cytoscape のノードにせず HTML で重ねる。ノードにすると配置（fcose）・
// 重なり解消・件数「表示 n / 全体 m」・保存配置のすべてに巻き込まれるため。
// 位置は描画（render: パン・ズーム・ドラッグ・配置のアニメ）に合わせて取り直す。

import { useEffect, useRef, useState } from "react";
import type cytoscape from "cytoscape";
import { Crosshair, X } from "lucide-react";
import { useT } from "../../i18n";
import type { GraphKind } from "./graph-kind";
import type { IslandMemberRef, IslandSummary } from "./island-summary";

/** 島の名前に使うタイトルの長さ（超えたら … で切る） */
const LABEL_MAX_CHARS = 18;
/** 島の画面上の幅がこれ未満なら名前を出さない（引きすぎて島が点になったとき） */
const MIN_RENDERED_WIDTH = 28;
/** 位置の取り直しの間引き（ms）。rAF は隠れたタブで止まるので setTimeout */
const UPDATE_INTERVAL_MS = 50;

interface LabelPos {
  id: string;
  text: string;
  x: number;
  y: number;
}

/** 名前の幅の見積もり（px）。全角 11px・半角 6.5px＋左右の余白。DOM を測らずに重なりを判定するため */
export function estimateLabelWidth(text: string): number {
  let w = 18;
  for (const ch of text) w += ch.charCodeAt(0) > 0xff ? 11 : 6.5;
  return Math.min(w, 220);
}

/**
 * 名前どうしの重なりを除く。並び順（大きい島が先）に置いていき、先に置いた名前と
 * 重なるものは出さない（重なった名前はクリックを奪い合い、どちらも読めない）。
 * x は中央、y は下端（島の上端の少し上）。
 */
export function dropOverlappingLabels<T extends { text: string; x: number; y: number }>(labels: T[], height = 20, gap = 4): T[] {
  const placed: { l: number; r: number; t: number; b: number }[] = [];
  const kept: T[] = [];
  for (const lab of labels) {
    const w = estimateLabelWidth(lab.text);
    const box = { l: lab.x - w / 2 - gap, r: lab.x + w / 2 + gap, t: lab.y - height - gap, b: lab.y + gap };
    if (placed.some((p) => box.l < p.r && p.l < box.r && box.t < p.b && p.t < box.b)) continue;
    placed.push(box);
    kept.push(lab);
  }
  return kept;
}

/** 島の上端の中央（画面座標）。見えているメンバーが無ければ null */
export function islandAnchor(cy: cytoscape.Core, memberIds: string[]): { x: number; y: number; w: number } | null {
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  for (const id of memberIds) {
    const n = cy.getElementById(id);
    if (n.empty() || n.hasClass("filtered-out")) continue;
    const p = n.position();
    const half = (Number(n.data("size")) || 10) / 2;
    if (p.x - half < minX) minX = p.x - half;
    if (p.x + half > maxX) maxX = p.x + half;
    if (p.y - half < minY) minY = p.y - half;
  }
  if (!Number.isFinite(minY)) return null;
  const zoom = cy.zoom();
  const pan = cy.pan();
  return {
    x: ((minX + maxX) / 2) * zoom + pan.x,
    y: minY * zoom + pan.y,
    w: (maxX - minX) * zoom,
  };
}

function shorten(s: string): string {
  return s.length > LABEL_MAX_CHARS ? `${s.slice(0, LABEL_MAX_CHARS - 1)}…` : s;
}

function labelText(island: IslandSummary, t: ReturnType<typeof useT>): string | null {
  if (island.unislanded) return t("globalGraph.island.unislandedLabel", { n: String(island.topSources.length) });
  const head = island.representatives[0];
  if (!head) return null;
  const more = island.focusCount - 1;
  return more > 0
    ? t("globalGraph.island.labelMore", { title: shorten(head.title), n: String(more) })
    : shorten(head.title);
}

export function IslandLabelsOverlay({
  cy,
  islands,
  selectedId,
  onSelect,
}: {
  /** 配置が終わった cy。配置中・未構築は null（ランダムな初期位置に名前を出さない） */
  cy: cytoscape.Core | null;
  islands: IslandSummary[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  const t = useT();
  const tRef = useRef(t);
  tRef.current = t;
  const [positions, setPositions] = useState<LabelPos[]>([]);

  useEffect(() => {
    if (!cy || islands.length === 0) {
      setPositions([]);
      return;
    }
    let timer: ReturnType<typeof setTimeout> | null = null;
    const update = () => {
      timer = null;
      const next: LabelPos[] = [];
      for (const island of islands) {
        const a = islandAnchor(cy, island.anchorIds);
        if (!a || a.w < MIN_RENDERED_WIDTH) continue;
        const text = labelText(island, tRef.current);
        if (text) next.push({ id: island.id, text, x: a.x, y: a.y - 6 });
      }
      setPositions(dropOverlappingLabels(next));
    };
    const schedule = () => {
      if (!timer) timer = setTimeout(update, UPDATE_INTERVAL_MS);
    };
    update();
    cy.on("render", schedule);
    return () => {
      cy.off("render", schedule);
      if (timer) clearTimeout(timer);
    };
  }, [cy, islands]);

  const byId = new Map(islands.map((s) => [s.id, s]));
  return (
    <div style={{ position: "absolute", inset: 0, pointerEvents: "none", overflow: "hidden", zIndex: 3 }}>
      {positions.map((p) => {
        const island = byId.get(p.id);
        if (!island) return null;
        const loose = !!island.unislanded;
        const selected = selectedId === island.id;
        return (
          <button
            key={p.id}
            data-island-label={island.id}
            onClick={() => onSelect(island.id)}
            data-tooltip={loose ? t("globalGraph.island.unislandedHint") : t("globalGraph.island.labelHint")}
            style={{
              position: "absolute",
              left: p.x,
              top: p.y,
              transform: "translate(-50%, -100%)",
              pointerEvents: "auto",
              maxWidth: 220,
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
              padding: "2px 8px",
              fontSize: 11,
              lineHeight: "16px",
              color: selected ? "#fff" : "var(--color-muted-foreground)",
              background: selected ? "#4b7a52" : "var(--color-card)",
              border: `1px ${loose ? "dashed" : "solid"} ${selected ? "#4b7a52" : "var(--color-border)"}`,
              borderRadius: 999,
              boxShadow: "0 1px 3px rgba(30, 20, 10, 0.08)",
              cursor: "pointer",
            }}
          >
            {p.text}
          </button>
        );
      })}
    </div>
  );
}

/** パネルの件数に出す種類と並び */
const COUNT_KINDS: GraphKind[] = ["topic", "claim", "atom", "note", "external", "synthesis"];

export function IslandPanel({
  island,
  grouping,
  onClose,
  onOpen,
  onFocus,
}: {
  island: IslandSummary;
  /** 島の分け方。説明文と見出しを切り替える（note はノート中心のつながりの島） */
  grouping: "content" | "connection" | "note";
  onClose: () => void;
  onOpen: (member: IslandMemberRef) => void;
  /** この島に寄る（全メンバーが収まるように視点を合わせる） */
  onFocus: () => void;
}) {
  const t = useT();
  const kindLabel = (k: GraphKind): string => {
    switch (k) {
      case "note":
        return t("globalGraph.kind.note");
      case "external":
        return t("globalGraph.kind.external");
      default:
        return t(`knowledge.kind.${k}` as any);
    }
  };
  const counts = COUNT_KINDS.filter((k) => (island.counts[k] ?? 0) > 0);
  const head = island.representatives[0];
  const loose = !!island.unislanded;
  const section = (title: string, members: IslandMemberRef[], showLinks = true) =>
    members.length > 0 && (
      <div style={{ marginTop: 12 }}>
        <div style={{ fontSize: 11, color: "var(--color-text-tertiary)", marginBottom: 4 }}>{title}</div>
        <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
          {members.map((m) => (
            <li key={m.id}>
              <button
                onClick={() => onOpen(m)}
                data-tooltip={m.title}
                className="hover:bg-muted"
                style={{
                  display: "flex",
                  width: "100%",
                  alignItems: "baseline",
                  gap: 6,
                  padding: "3px 6px",
                  fontSize: 12,
                  textAlign: "left",
                  borderRadius: 4,
                  background: "transparent",
                  border: "none",
                  cursor: "pointer",
                  color: "var(--color-foreground)",
                }}
              >
                <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {m.title}
                </span>
                {showLinks && (
                  <span style={{ fontSize: 10, color: "var(--color-text-tertiary)" }}>
                    {t("globalGraph.island.links", { n: String(m.score) })}
                  </span>
                )}
              </button>
            </li>
          ))}
        </ul>
      </div>
    );

  return (
    <div
      data-island-panel={island.id}
      style={{
        position: "absolute",
        top: 8,
        right: 8,
        bottom: 8,
        width: 280,
        maxWidth: "calc(100% - 16px)",
        overflowY: "auto",
        padding: 12,
        zIndex: 5,
        background: "var(--color-card)",
        border: "1px solid var(--color-border)",
        borderRadius: 8,
        boxShadow: "0 4px 12px rgba(30, 20, 10, 0.12)",
      }}
    >
      <div style={{ display: "flex", alignItems: "flex-start", gap: 6 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 11, color: "var(--color-text-tertiary)" }}>
            {loose ? t("globalGraph.island.unislandedKicker") : t("globalGraph.island.title")}
          </div>
          <div style={{ fontSize: 14, fontWeight: 600, color: "var(--color-foreground)", wordBreak: "break-word" }}>
            {loose ? t("globalGraph.island.unislandedTitle") : head?.title}
          </div>
        </div>
        <button
          onClick={onClose}
          aria-label={t("common.close")}
          style={{ background: "transparent", border: "none", cursor: "pointer", color: "var(--color-text-tertiary)" }}
        >
          <X size={14} />
        </button>
      </div>
      <p style={{ margin: "6px 0 0", fontSize: 11, lineHeight: 1.6, color: "var(--color-muted-foreground)" }}>
        {loose
          ? t("globalGraph.island.unislandedExplain")
          : grouping === "content"
          ? t("globalGraph.island.explainContent")
          : grouping === "connection"
            ? t("globalGraph.island.explainCrystal")
            : t("globalGraph.island.explainNote")}
      </p>
      <div style={{ display: "flex", flexWrap: "wrap", gap: "2px 10px", marginTop: 8, fontSize: 11, color: "var(--color-muted-foreground)" }}>
        {counts.map((k) => (
          <span key={k}>
            {kindLabel(k)} {island.counts[k]}
          </span>
        ))}
      </div>
      <button
        onClick={onFocus}
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 4,
          marginTop: 10,
          padding: "3px 8px",
          fontSize: 12,
          color: "var(--color-muted-foreground)",
          background: "transparent",
          border: "1px solid var(--color-border)",
          borderRadius: 6,
          cursor: "pointer",
        }}
      >
        <Crosshair size={12} />
        {loose ? t("globalGraph.island.unislandedFocus") : t("globalGraph.island.focus")}
      </button>
      {section(
        grouping === "content"
          ? t("globalGraph.island.typicalTopics")
          : grouping === "connection"
            ? t("globalGraph.island.centralTopics")
            : t("globalGraph.island.centralNotes"),
        island.representatives,
        island.rankedBy === "links",
      )}
      {section(loose ? t("globalGraph.island.unislandedSources") : t("globalGraph.island.topSources"), island.topSources)}
    </div>
  );
}
