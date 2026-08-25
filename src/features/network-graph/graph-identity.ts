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
 * 形が変わる組み直しをまとめるための待ち時間。ノートを開くと、ノート本体 →
 * 周辺ノート → 素材インデックス → PROV 再生成、と読み込みが数百 ms 間隔で続き、
 * そのたびにグラフが育つ。1 回ごとに並べ直すと配置替えの連打に見えるので、
 * 変化が静まってから 1 回で組む。
 */
const STRUCTURE_DEBOUNCE_MS = 450;

/**
 * 「今このグラフを組み直してよいか」まで含めたキー。2 つの事情で組み直しを待たせる:
 *
 * 1. **ドラッグ中**。組み直されると Cytoscape のインスタンスごと破棄されて
 *    `dragfree`（＝保存のきっかけ）が永久に来ず、「動かしたのに元へ戻った」になる。
 *    ドラッグが終わってから最新の中身で組み直す。
 * 2. **形が変わる変化の連打**（読み込み中）。1 回ごとに組んで並べ直すと
 *    配置替えが何度も走って見える。静まるまで待って 1 回で組む。
 *    形が変わらない変化（ラベル・件数）は待たせない — どうせ並べ直さないので、
 *    組み直しても見た目は動かない。
 *
 * `endDrag` は必ず保存の**後**に呼ぶこと（保存前に呼ぶと、保存されていない座標で
 * 組み直してしまい、結局同じ症状になる）。
 */
export function useGraphRenderKey(
  dataKey: string,
  structureKey: string,
): {
  renderKey: string;
  beginDrag: () => void;
  endDrag: () => void;
} {
  const [renderKey, setRenderKey] = useState(dataKey);
  const draggingRef = useRef(false);
  const latestKeyRef = useRef(dataKey);
  latestKeyRef.current = dataKey;
  const latestStructureRef = useRef(structureKey);
  latestStructureRef.current = structureKey;
  // いま画面に出ているグラフの形
  const renderedStructureRef = useRef(structureKey);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const commit = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    renderedStructureRef.current = latestStructureRef.current;
    setRenderKey(latestKeyRef.current);
  }, []);

  useEffect(() => {
    if (draggingRef.current) return;
    // 形が同じなら即時（並べ直しは起きないので、待たせる理由が無い）
    if (structureKey === renderedStructureRef.current) {
      commit();
      return;
    }
    // 形が変わった: 静まるのを待って 1 回で組む。さらに変化が来たら待ち直す
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      if (!draggingRef.current) commit();
    }, STRUCTURE_DEBOUNCE_MS);
  }, [dataKey, structureKey, commit]);

  // アンマウント時に待ちを捨てる
  useEffect(
    () => () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    },
    [],
  );

  const beginDrag = useCallback(() => {
    draggingRef.current = true;
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const endDrag = useCallback(() => {
    draggingRef.current = false;
    // ドラッグ中に溜まった変化をここで反映する
    commit();
  }, [commit]);

  return { renderKey, beginDrag, endDrag };
}
