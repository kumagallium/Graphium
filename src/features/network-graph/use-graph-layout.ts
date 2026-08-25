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
 * 範囲選択を使ったことがあるか（端末ごと・グラフ横断）。
 *
 * shift + 背景ドラッグは、知らなければ絶対に見つからない操作。数秒で消える案内は
 * ノードを動かすことに集中している最中に出るので、そもそも目に入らない。
 *
 * そこで手順フローの「まだエッジが 1 本も無いときだけ、つなぎ方を下中央に薄く出す」
 * と同じ形にする — **条件が続く限り出しっぱなし、条件が消えたら出さない**:
 *
 *   出す条件 = ノードを動かせるグラフで、まだ範囲選択を使ったことがない
 *
 * 一度でもまとめて動かせば用は済むので、以後どのグラフでも出ない。
 * 「手で並べた人にだけ出す」という絞りは入れない — その条件だと、並べたことの
 * ないグラフでは案内が出ず、ユーザーには出たり出なかったりに見える（実際に
 * 「出ていない」と報告された）。1 行の薄い文字なので常設で邪魔にならない。
 */
const SELECTION_LEARNED_KEY = "graphium:graphSelectionLearned";

function readSelectionLearned(): boolean {
  try {
    return localStorage.getItem(SELECTION_LEARNED_KEY) === "1";
  } catch {
    // プライベートモード等で読めなければ、案内は出す側に倒す
    return false;
  }
}

export type UseGraphLayoutResult = {
  /** appdata の読み込みが済んだか。false の間はグラフを組まない */
  ready: boolean;
  /** 保存済みの座標。無ければ null */
  positions: GraphLayoutPositions | null;
  /**
   * 現在の座標を保存する。
   * movedMultiple: 複数ノードをまとめて動かしたか（＝範囲選択を使えた）。
   * これが来たらヒントの役目は終わりなので、以後は出さない。
   */
  save: (positions: GraphLayoutPositions, movedMultiple?: boolean) => void;
  /** 自動レイアウトに戻す */
  reset: () => void;
  /** 保存済みの配置を持っているか（リセットボタンの出し分け用） */
  hasSaved: boolean;
  /**
   * リセットのたびに増える番号。ビューの再構築 effect の依存に入れることで、
   * 「保存を捨てた直後に自動レイアウトを流し直す」を明示的に起こす。
   */
  resetSeq: number;
  /** 範囲選択の案内を出すべきか（動かせるグラフで、まだ範囲選択を使っていない） */
  showSelectionHint: boolean;
};

/**
 * scope が null のときは何もしない（スコープを特定できない文脈＝保存しない）。
 */
export function useGraphLayout(scope: string | null): UseGraphLayoutResult {
  const [ready, setReady] = useState(false);
  const [resetSeq, setResetSeq] = useState(0);
  const [selectionLearned, setSelectionLearned] = useState(readSelectionLearned);
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
    (positions: GraphLayoutPositions, movedMultiple = false) => {
      if (!scope) return;
      saveGraphLayout(scope, positions);
      setHasSaved(hasGraphLayout(scope));
      // まとめて動かせた＝もう知っている。ここで案内は役目を終える
      if (movedMultiple && !selectionLearned) {
        setSelectionLearned(true);
        try {
          localStorage.setItem(SELECTION_LEARNED_KEY, "1");
        } catch {
          // プライベートモード等で書けなくても、このセッション中は消えたままにする
        }
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

  // ready になってから読む（ensureGraphLayouts 前は必ず null）
  const positions = ready && scope ? getGraphLayout(scope) : null;

  // 動かせるグラフ（scope あり）で、まだ範囲選択を知らない人にだけ出す
  const showSelectionHint = !!scope && !selectionLearned;

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
/**
 * 今のノード座標を控える。不可視のダミーノード（全体グラフの cluster-hub は
 * レイアウト計算のためだけに存在する）は含めない。
 */
export function captureCytoscapePositions(cy: cytoscape.Core): GraphLayoutPositions {
  const positions: GraphLayoutPositions = {};
  cy.nodes().forEach((node) => {
    if (node.hasClass("cluster-hub")) return;
    const p = node.position();
    positions[node.id()] = { x: p.x, y: p.y };
  });
  return positions;
}

export function attachCytoscapeLayoutPersistence(
  cy: cytoscape.Core,
  save: (positions: GraphLayoutPositions, movedMultiple: boolean) => void,
): () => void {
  const handler = () => {
    // 選択が 2 つ以上あれば、掴んだ 1 つと一緒に全部動いている
    // （Cytoscape は選択集合をまとめて動かす）＝範囲選択を使えた人
    save(captureCytoscapePositions(cy), cy.nodes(":selected").length > 1);
  };
  cy.on("dragfree", "node", handler);
  return () => {
    cy.off("dragfree", "node", handler);
  };
}

/**
 * 選択中ノードの集合を囲む矩形を、グラフの上に重ねて描く。返り値は解除関数。
 *
 * React Flow は複数選択すると選択グループを囲む矩形が残る。Cytoscape には
 * 相当する表示が無く、同じ操作をしても「選択が続いているのか」が読めない。
 * 選択ノードの renderedBoundingBox を毎フレーム追いかける DOM 要素で揃える。
 *
 * 見た目は app.css の `.react-flow__nodesselection-rect`（React Flow 側）と
 * 対で管理する。
 */
export function attachSelectionBoundsOverlay(cy: cytoscape.Core): () => void {
  const container = cy.container();
  if (!container) return () => {};
  const el = document.createElement("div");
  el.dataset.graphSelectionBounds = "true";
  Object.assign(el.style, {
    position: "absolute",
    pointerEvents: "none",
    zIndex: "4",
    display: "none",
    background: "rgba(75, 122, 82, 0.08)",
    border: "1px dashed #4b7a52",
    borderRadius: "4px",
  } satisfies Partial<CSSStyleDeclaration>);
  // Cytoscape はコンテナを position: relative にするので、この子は重なって描ける
  container.appendChild(el);

  let raf = 0;
  const update = () => {
    raf = 0;
    const sel = cy.nodes(":selected");
    if (sel.length < 2) {
      el.style.display = "none";
      return;
    }
    const bb = sel.renderedBoundingBox({ includeLabels: false, includeOverlays: false } as any);
    const pad = 10;
    el.style.display = "block";
    el.style.left = `${bb.x1 - pad}px`;
    el.style.top = `${bb.y1 - pad}px`;
    el.style.width = `${bb.w + pad * 2}px`;
    el.style.height = `${bb.h + pad * 2}px`;
  };
  const schedule = () => {
    if (!raf) raf = requestAnimationFrame(update);
  };
  // render はパン・ズーム・ドラッグ・選択変更のすべてで発火する。raf で 1 フレーム
  // 1 回に間引かれるので、毎回スタイルを書き直しても負荷にはならない
  cy.on("render", schedule);
  return () => {
    cy.off("render", schedule);
    if (raf) cancelAnimationFrame(raf);
    el.remove();
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
