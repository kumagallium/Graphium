// ──────────────────────────────────────────────
// graph-layout.ts を React から使うためのフックと、Cytoscape への配線。
//
// ビュー側がやることは 3 つだけ:
//   1. ready を待ってからグラフを組む（保存済みの座標を最初の描画で使うため）
//   2. 保存済み座標があるノードは preset、無いノードだけ自動レイタウトに流す
//   3. ドラッグが終わったら現在の座標を保存する
// ──────────────────────────────────────────────

import { useCallback, useEffect, useRef, useState } from "react";
import type cytoscape from "cytoscape";
import {
  clearGraphLayout,
  ensureGraphLayouts,
  getGraphLayout,
  hasGraphLayout,
  saveGraphLayout,
  type GraphLayoutPositions,
} from "./graph-layout";

/**
 * 範囲選択ヒントを出した回数（端末ごと・グラフ横断）。
 *
 * shift + 背景ドラッグは、知らなければ絶対に見つからない操作。かといって常設の
 * 説明文を置くと邪魔になる（手順フロービューの「常設の説明文は置かない」方針）。
 * そこで**ノードを動かした直後**に下中央へ出す — ノードを動かした人は
 * 「並べ替えたい人」なので、まさにその情報が要る場面にいる。
 *
 * 一度きりだと、ノードを動かすのに集中していて見落とすと二度と出会えない。
 * かといって毎回出すとうるさいので、数回で打ち切る。
 */
const SELECTION_HINT_KEY = "graphium:graphSelectionHintSeen";

/** 何回まで出すか */
const SELECTION_HINT_MAX = 3;

/** ヒントを出しておく時間。読み切って理解するには 6 秒では短い */
const SELECTION_HINT_MS = 9000;

export type UseGraphLayoutResult = {
  /** appdata の読み込みが済んだか。false の間はグラフを組まない */
  ready: boolean;
  /** 保存済みの座標。無ければ null */
  positions: GraphLayoutPositions | null;
  /** 現在の座標を保存する */
  save: (positions: GraphLayoutPositions) => void;
  /** 自動レイアウトに戻す */
  reset: () => void;
  /** 保存済みの配置を持っているか（リセットボタンの出し分け用） */
  hasSaved: boolean;
  /**
   * リセットのたびに増える番号。ビューの再構築 effect の依存に入れることで、
   * 「保存を捨てた直後に自動レイアウトを流し直す」を明示的に起こす。
   */
  resetSeq: number;
  /** 範囲選択のヒントを今出すべきか（ノードを動かした直後、上限回数まで） */
  showSelectionHint: boolean;
};

/**
 * scope が null のときは何もしない（スコープを特定できない文脈＝保存しない）。
 */
export function useGraphLayout(scope: string | null): UseGraphLayoutResult {
  const [ready, setReady] = useState(false);
  const [resetSeq, setResetSeq] = useState(0);
  const [showSelectionHint, setShowSelectionHint] = useState(false);
  // 保存済みの有無だけは表示に使うので state に持つ
  const [hasSaved, setHasSaved] = useState(false);

  useEffect(() => {
    if (!scope) {
      setReady(true);
      setHasSaved(false);
      return;
    }
    let cancelled = false;
    setReady(false);
    void ensureGraphLayouts().then(() => {
      if (cancelled) return;
      setHasSaved(hasGraphLayout(scope));
      setReady(true);
    });
    return () => {
      cancelled = true;
    };
  }, [scope]);

  const save = useCallback(
    (positions: GraphLayoutPositions) => {
      if (!scope) return;
      saveGraphLayout(scope, positions);
      setHasSaved(hasGraphLayout(scope));
      // 動かした人に、まとめて動かす方法を知らせる（上限回数まで）
      try {
        const shown = Number(localStorage.getItem(SELECTION_HINT_KEY) ?? "0");
        if (!Number.isFinite(shown) || shown < SELECTION_HINT_MAX) {
          localStorage.setItem(SELECTION_HINT_KEY, String((Number.isFinite(shown) ? shown : 0) + 1));
          setShowSelectionHint(true);
        }
      } catch {
        // プライベートモード等で読み書きできなくても保存自体は続ける
      }
    },
    [scope],
  );

  const reset = useCallback(() => {
    if (!scope) return;
    clearGraphLayout(scope);
    setHasSaved(false);
    setResetSeq((n) => n + 1);
  }, [scope]);

  // 出しっぱなしにはしない
  useEffect(() => {
    if (!showSelectionHint) return;
    const id = setTimeout(() => setShowSelectionHint(false), SELECTION_HINT_MS);
    return () => clearTimeout(id);
  }, [showSelectionHint]);

  // ready になってから読む（ensureGraphLayouts 前は必ず null）
  const positions = ready && scope ? getGraphLayout(scope) : null;

  return { ready, positions, save, reset, hasSaved, resetSeq, showSelectionHint };
}

/**
 * Cytoscape インスタンスにドラッグ保存を配線する。返り値は解除関数。
 *
 * `dragfree` はノード（複数選択なら選択集合すべて）のドラッグが終わった時に
 * 発火する。その時点の全ノード座標を丸ごと保存する — 一部だけ保存すると、
 * 次に開いたとき「動かしたノードだけ元の位置、他は自動レイアウトで別の場所」
 * という混ざった状態になってしまう。
 */
export function attachCytoscapeLayoutPersistence(
  cy: cytoscape.Core,
  save: (positions: GraphLayoutPositions) => void,
): () => void {
  const handler = () => {
    const positions: GraphLayoutPositions = {};
    cy.nodes().forEach((node) => {
      // 不可視のダミーノードは保存しない。全体グラフの cluster-hub は
      // レイアウト計算のためだけに存在し、ユーザーには見えない
      if (node.hasClass("cluster-hub")) return;
      const p = node.position();
      positions[node.id()] = { x: p.x, y: p.y };
    });
    save(positions);
  };
  cy.on("dragfree", "node", handler);
  return () => {
    cy.off("dragfree", "node", handler);
  };
}

/**
 * ユーザーがノードを掴んだら、走っている自動レイアウトを止める。返り値は解除関数。
 *
 * fcose は 600〜800ms かけてノードを動かし続けるアニメーションで、その最中に
 * ドラッグしても**アニメーションが勝って元の位置へ引き戻す**。ノートを開いた直後は
 * ノートの読み込み完了に合わせてグラフが組み直されるので、ちょうどこの時間帯に
 * 手を出すことになり「動かしたのに戻る」が起きる。
 *
 * 掴んだ時点でユーザーの意思の方が新しいので、レイアウトには引き下がってもらう。
 */
export function stopLayoutOnGrab(
  cy: cytoscape.Core,
  layout: { stop: () => void },
): () => void {
  let stopped = false;
  // `grab`（掴んだ瞬間）ではなく `drag`（実際に動いた）で判定する。grab は
  // ナビゲーション目的の単なるクリックでも発火するため、それでレイアウトを
  // 止めると「クリックしただけで並びが途中で固まる」ことになる
  const handler = () => {
    if (stopped) return;
    stopped = true;
    layout.stop();
  };
  cy.on("drag", "node", handler);
  return () => {
    cy.off("drag", "node", handler);
  };
}

/** ノードとして配置の対象になるか（エッジと不可視のダミーは除く） */
function isPlaceableNode(el: cytoscape.ElementDefinition): boolean {
  // エッジは source を持つ
  if (el.data.source) return false;
  // 全体グラフの cluster-hub はレイアウト計算のためだけの不可視ノード
  if (typeof el.classes === "string" && el.classes.includes("cluster-hub")) return false;
  return true;
}

/**
 * 保存済み座標を Cytoscape の要素定義に適用し、「まだ座標を持たないノード」を返す。
 *
 * 全ノードが保存済みなら自動レイアウトは流さない（`preset` のまま）。一部だけ
 * 保存済みなら、新しく増えたノードだけを自動レイアウトの対象にする —
 * こうしないと、ノートに 1 つ素材を足しただけで手で整えた並びが全部崩れる。
 */
export function applySavedPositions(
  elements: cytoscape.ElementDefinition[],
  positions: GraphLayoutPositions | null,
): { unplacedIds: string[]; placedCount: number } {
  if (!positions) {
    return {
      unplacedIds: elements.filter(isPlaceableNode).map((el) => String(el.data.id)),
      placedCount: 0,
    };
  }
  const unplacedIds: string[] = [];
  let placedCount = 0;
  for (const el of elements) {
    if (!isPlaceableNode(el)) continue;
    const id = String(el.data.id);
    const saved = positions[id];
    if (saved) {
      el.position = { x: saved.x, y: saved.y };
      placedCount += 1;
    } else {
      unplacedIds.push(id);
    }
  }
  return { unplacedIds, placedCount };
}

/**
 * 新しく増えたノードを、保存済みノードの重心から少しずらした位置に仮置きする。
 * ここを原点 (0,0) のままにすると、既存の並びから遠く離れた場所に固まって
 * 画面外に出てしまう。
 */
export function seedUnplacedNodes(
  cy: cytoscape.Core,
  unplacedIds: string[],
): void {
  if (unplacedIds.length === 0) return;
  const placed = cy.nodes().filter((n) => !unplacedIds.includes(n.id()));
  if (placed.length === 0) return;
  const bb = placed.boundingBox();
  const cx = (bb.x1 + bb.x2) / 2;
  const cy0 = (bb.y1 + bb.y2) / 2;
  const radius = Math.max(bb.w, bb.h) / 2 + 80;
  unplacedIds.forEach((id, i) => {
    const node = cy.getElementById(id);
    if (node.length === 0) return;
    const angle = (i / unplacedIds.length) * Math.PI * 2;
    node.position({ x: cx + Math.cos(angle) * radius, y: cy0 + Math.sin(angle) * radius });
  });
}

/**
 * React Flow 版のノード仮置き。手順フローは上から下へ読むグラフなので、
 * 保存に無い新しいノードは既存の並びの「下」に横並びで置く
 * （Cytoscape の周辺グラフが外周に置くのと同じ趣旨で、向きだけ違う）。
 */
export function seedUnplacedFlowNodes<T extends { id: string; position: { x: number; y: number } }>(
  nodes: T[],
  positions: GraphLayoutPositions,
): T[] {
  const unplaced = nodes.filter((n) => !positions[n.id]);
  if (unplaced.length === 0) return nodes;
  const placed = nodes.filter((n) => positions[n.id]);
  if (placed.length === 0) return nodes;
  const bottom = Math.max(...placed.map((n) => positions[n.id].y));
  const left = Math.min(...placed.map((n) => positions[n.id].x));
  const seeded = new Map<string, { x: number; y: number }>();
  unplaced.forEach((n, i) => {
    seeded.set(n.id, { x: left + i * 220, y: bottom + 160 });
  });
  return nodes.map((n) => {
    const p = seeded.get(n.id);
    return p ? { ...n, position: p } : n;
  });
}
