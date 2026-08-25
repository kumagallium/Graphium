// ──────────────────────────────────────────────
// グラフを「作り直すべきか」を中身で判定するためのキー。
//
// グラフデータは元ファイルが読み込まれるたびに作り直されるため、中身が 1 文字も
// 変わっていなくてもオブジェクトの参照は変わる。それを描画 effect の依存にすると、
// ノートを保存するたび・素材インデックスが更新されるたびにグラフが destroy →
// 再構築 → 自動レイアウトのアニメーション、となってノードが飛び回る。
//
// 中身をそのままキーにすれば、参照が変わっても中身が同じ限り作り直さない。
// ──────────────────────────────────────────────

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

/**
 * 値の中身から安定したキーを作る。中身が同じなら同じ文字列が返る。
 *
 * 描画 effect の依存にはこのキーを渡し、値そのものはクロージャから読む
 * （キーが同じなら中身も同じなので、前回の値を読んでも等価）。
 */
export function useGraphDataKey(value: unknown): string {
  return useMemo(() => {
    try {
      return JSON.stringify(value) ?? "";
    } catch {
      // 循環参照など stringify できない形が来たら、毎回違うキーを返して
      // 従来どおり作り直す側に倒す（描画が止まるより作り直す方がまだ良い）
      return String(Math.random());
    }
  }, [value]);
}

/**
 * グラフの**形**だけを表すキー（どのノードが、どう繋がっているか）。
 *
 * 中身のキー（useGraphDataKey）はラベル・件数・属性の変化でも変わるが、それは
 * 並べ直す理由にならない。名前が 1 文字変わっただけで自動レイアウトが走ると、
 * ノートを開いた直後や入力のたびにノードが飛び回る。
 *
 * 形が同じなら位置はそのまま、形が変わったときだけ並べ直す — という判断に使う。
 */
export function graphStructureKey(
  nodeIds: Iterable<string>,
  edges: Iterable<{ source: string; target: string }>,
): string {
  const ids = [...nodeIds];
  const links = [...edges].map((e) => `${e.source}>${e.target}`);
  // 並び順の揺れでキーが変わらないよう、両方ソートしてから畳む
  return `${ids.slice().sort().join("|")}//${links.sort().join("|")}`;
}

export function useGraphStructureKey(
  nodeIds: Iterable<string>,
  edges: Iterable<{ source: string; target: string }>,
): string {
  const key = graphStructureKey(nodeIds, edges);
  return useMemo(() => key, [key]);
}

/**
 * 「今このグラフを組み直してよいか」まで含めたキー。
 *
 * ドラッグの最中にグラフが組み直されると、Cytoscape のインスタンスごと破棄されて
 * `dragfree`（＝保存のきっかけ）が永久に来ない。ユーザーから見ると「動かしたのに
 * 元の場所へ戻った」になる。ノートを開いた直後はノートが順々に読み込まれてグラフが
 * 何度も育つので、ちょうどこの窓に入りやすい。
 *
 * 中身が変わったこと自体は正しいので、**捨てるのではなく遅らせる**。ドラッグが
 * 終わってから最新の中身で組み直す。
 *
 * `endDrag` は必ず保存の**後**に呼ぶこと（保存前に呼ぶと、保存されていない座標で
 * 組み直してしまい、結局同じ症状になる）。
 */
export function useGraphRenderKey(dataKey: string): {
  renderKey: string;
  beginDrag: () => void;
  endDrag: () => void;
} {
  const [renderKey, setRenderKey] = useState(dataKey);
  const draggingRef = useRef(false);
  const latestRef = useRef(dataKey);
  latestRef.current = dataKey;

  useEffect(() => {
    if (draggingRef.current) return;
    setRenderKey(dataKey);
  }, [dataKey]);

  const beginDrag = useCallback(() => {
    draggingRef.current = true;
  }, []);

  const endDrag = useCallback(() => {
    draggingRef.current = false;
    // ドラッグ中に溜まった変化をここで反映する
    setRenderKey(latestRef.current);
  }, []);

  return { renderKey, beginDrag, endDrag };
}
