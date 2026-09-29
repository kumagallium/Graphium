// cytoscape の fit を、下端に重ねて出す案内の帯（GraphSelectionHint）を避けて行う。
//
// cy.fit(undefined, padding) は全周一律の余白しか取れない。案内は下端から 10px の
// 位置に高さ約 16px で重なる（帯は下端から 10〜26px）ので、padding 20 だと下端に来た
// ノード・ラベルが帯に 6px 食い込む。高さの低い枠（縦に 284px 前後）では縦方向が
// fit の制約になり、下端のノードが常に帯に掛かる。
// 案内が出ているときだけ下の余白を広げて置き、出ていないときは cy.fit と同じ結果にする。

/** 案内（GraphSelectionHint）の帯を避けるための下端からの距離（px）。帯の上端 26px + 隙間 6px */
export const SELECTION_HINT_CLEARANCE = 32;

export type FitBox = { x1: number; y1: number; x2: number; y2: number };

export type FitViewportInput = {
  /** fit したい範囲（モデル座標。cy.elements().boundingBox() の値） */
  bb: FitBox;
  /** コンテナの幅・高さ（cy.width() / cy.height()） */
  width: number;
  height: number;
  /** 全周の余白（px） */
  padding: number;
  /** 下端から空けておく距離（px）。padding より小さければ padding が効く */
  bottomClearance?: number;
  minZoom: number;
  maxZoom: number;
};

/**
 * fit 後の視点。cytoscape の fit と同じ式（拡大率は範囲が収まる最大値を
 * minZoom〜maxZoom に丸め、範囲の中心を余白を除いた領域の中心に置く）で、
 * 下の余白だけ bottomClearance まで広げる。計算できないときは null。
 */
export function computeFitViewport({
  bb,
  width,
  height,
  padding,
  bottomClearance = 0,
  minZoom,
  maxZoom,
}: FitViewportInput): { zoom: number; pan: { x: number; y: number } } | null {
  const bbW = bb.x2 - bb.x1;
  const bbH = bb.y2 - bb.y1;
  if (
    ![bb.x1, bb.y1, bb.x2, bb.y2, width, height].every(Number.isFinite) ||
    width <= 0 ||
    height <= 0 ||
    bbW <= 0 ||
    bbH <= 0
  ) {
    return null;
  }
  const bottomPad = Math.max(padding, bottomClearance);
  const availW = width - 2 * padding;
  const availH = height - padding - bottomPad;
  if (availW <= 0 || availH <= 0) return null;
  let zoom = Math.min(availW / bbW, availH / bbH);
  zoom = Math.min(zoom, maxZoom);
  zoom = Math.max(zoom, minZoom);
  // 余白を除いた領域 [padding, width-padding] × [padding, height-bottomPad] の中心に範囲の中心を置く
  const regionCenterX = width / 2;
  const regionCenterY = (padding + (height - bottomPad)) / 2;
  return {
    zoom,
    pan: {
      x: regionCenterX - (zoom * (bb.x1 + bb.x2)) / 2,
      y: regionCenterY - (zoom * (bb.y1 + bb.y2)) / 2,
    },
  };
}

/** cytoscape のインスタンスのうち、ここで使う部分だけ */
type FitTarget = {
  fit: (eles?: any, padding?: number) => unknown;
  viewport: (opts: { zoom: number; pan: { x: number; y: number } }) => unknown;
  elements: () => { boundingBox: () => FitBox };
  width: () => number;
  height: () => number;
  minZoom: () => number;
  maxZoom: () => number;
};

/**
 * cy.fit(undefined, padding) の代わり。案内の帯が出ている（hintVisible）ときだけ、
 * 下端の余白を帯のぶん広げて置く。出ていない・計算できないときは今までの cy.fit。
 */
export function fitAvoidingHint(cy: FitTarget, padding: number, hintVisible: boolean): void {
  if (!hintVisible) {
    cy.fit(undefined, padding);
    return;
  }
  const next = computeFitViewport({
    bb: cy.elements().boundingBox(),
    width: cy.width(),
    height: cy.height(),
    padding,
    bottomClearance: SELECTION_HINT_CLEARANCE,
    minZoom: cy.minZoom(),
    maxZoom: cy.maxZoom(),
  });
  if (!next) {
    cy.fit(undefined, padding);
    return;
  }
  cy.viewport(next);
}
