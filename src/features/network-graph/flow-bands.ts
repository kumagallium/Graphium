// 工程フローの帯（表ごとのグループ）を、中の工程ノードから組み立てる純関数。
//
// 帯は React Flow の親ノード（parentId）にしない。工程ノードはいつも絶対座標で持ち、
// 帯の位置と大きさは「中の工程を囲む矩形 + 余白」として後から決める。こうすると
// 手で動かした座標をそのまま保存・復元でき（保存は絶対座標前提）、帯は動かした
// ノードに付いてくる。ELK の入れ子レイアウトは自動配置のときだけ使い、結果の
// 相対座標はその場で絶対座標に直す（toAbsoluteLayout）。

import type { ElkLayoutPosition } from "./elk-flow-layout";

/** 帯の内側の余白。上は表名の分だけ広い（elk-flow-layout.ts の elk.padding と同じ値） */
export const BAND_PADDING = { top: 40, left: 16, bottom: 16, right: 16 } as const;

/** 実測前のノードの仮の大きさ（ELK に渡す既定値と同じ） */
const FALLBACK_SIZE = { width: 180, height: 48 };

type FlowNodeLike = {
  id: string;
  type?: string;
  position: { x: number; y: number };
  measured?: { width?: number; height?: number };
  style?: { width?: unknown; height?: unknown };
};

/**
 * 帯ノード（type "band"）の位置と大きさを、bandOf が返す所属ノードの外接矩形に合わせる。
 * 変わらなかった帯はオブジェクトをそのまま返し、どの帯も変わらなければ配列ごとそのまま返す
 * （ドラッグ中に毎フレーム呼ぶため、無駄な再描画を起こさない）。所属ノードが無い帯は触らない。
 */
export function fitBandsToMembers<T extends FlowNodeLike>(
  nodes: T[],
  bandOf: (node: T) => string | null,
): T[] {
  const bounds = new Map<string, { minX: number; minY: number; maxX: number; maxY: number }>();
  for (const n of nodes) {
    if (n.type === "band") continue;
    const band = bandOf(n);
    if (!band) continue;
    const w = n.measured?.width ?? FALLBACK_SIZE.width;
    const h = n.measured?.height ?? FALLBACK_SIZE.height;
    const b = bounds.get(band);
    if (!b) {
      bounds.set(band, { minX: n.position.x, minY: n.position.y, maxX: n.position.x + w, maxY: n.position.y + h });
    } else {
      b.minX = Math.min(b.minX, n.position.x);
      b.minY = Math.min(b.minY, n.position.y);
      b.maxX = Math.max(b.maxX, n.position.x + w);
      b.maxY = Math.max(b.maxY, n.position.y + h);
    }
  }

  let changed = false;
  const next = nodes.map((n) => {
    if (n.type !== "band") return n;
    const b = bounds.get(n.id);
    if (!b) return n;
    const x = b.minX - BAND_PADDING.left;
    const y = b.minY - BAND_PADDING.top;
    const width = b.maxX - b.minX + BAND_PADDING.left + BAND_PADDING.right;
    const height = b.maxY - b.minY + BAND_PADDING.top + BAND_PADDING.bottom;
    const same =
      Math.abs(n.position.x - x) < 0.5 &&
      Math.abs(n.position.y - y) < 0.5 &&
      typeof n.style?.width === "number" &&
      typeof n.style?.height === "number" &&
      Math.abs((n.style.width as number) - width) < 0.5 &&
      Math.abs((n.style.height as number) - height) < 0.5;
    if (same) return n;
    changed = true;
    return { ...n, position: { x, y }, style: { ...(n.style ?? {}), width, height } } as T;
  });
  return changed ? next : nodes;
}

/**
 * ELK の結果（入れ子の子は親からの相対座標）を、すべて絶対座標に直す。
 * parentOf はノード id → 帯ノード id（帯に属さないなら null）。
 */
export function toAbsoluteLayout(
  positions: Map<string, ElkLayoutPosition>,
  parentOf: (id: string) => string | null,
): Map<string, ElkLayoutPosition> {
  const result = new Map<string, ElkLayoutPosition>();
  for (const [id, pos] of positions) {
    const parent = parentOf(id);
    const parentPos = parent ? positions.get(parent) : undefined;
    result.set(id, parentPos ? { ...pos, x: parentPos.x + pos.x, y: parentPos.y + pos.y } : pos);
  }
  return result;
}
