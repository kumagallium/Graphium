// @vitest-environment jsdom
// useGraphCarryOver のテスト — グラフビューの描画 effect と同じ形（本体で take、
// cleanup で keep してから破棄）で組み直しを繰り返し、次のグラフが何を受け取るかを見る
import { describe, it, expect } from "vitest";
import { useEffect } from "react";
import { renderHook } from "@testing-library/react";
import { useGraphCarryOver, type GraphCarryOver } from "./use-graph-layout";

function fakeCy(x: number) {
  return {
    nodes: () => [{ id: () => "a", position: () => ({ x, y: 0 }), hasClass: () => false }],
    zoom: () => 1.5,
    pan: () => ({ x: 10, y: 20 }),
    width: () => 300,
    height: () => 200,
  };
}

type Props = { renderKey: number; resetSeq: number; layoutRunning?: boolean };

function mountGraphView(initialProps: Props) {
  const seen: Array<GraphCarryOver | null> = [];
  const view = renderHook(
    (p: Props) => {
      const carryOver = useGraphCarryOver(p.resetSeq);
      useEffect(() => {
        seen.push(carryOver.take());
        const cy = fakeCy(p.renderKey * 100);
        return () => carryOver.keep(cy as never, !(p.layoutRunning ?? false));
        // eslint-disable-next-line react-hooks/exhaustive-deps
      }, [p.renderKey, p.resetSeq]);
    },
    { initialProps },
  );
  return { seen, rerender: view.rerender };
}

describe("useGraphCarryOver（組み直しをまたいで座標を渡す）", () => {
  it("組み直したグラフは、直前のグラフの座標と視点を受け取る", () => {
    const { seen, rerender } = mountGraphView({ renderKey: 1, resetSeq: 0 });
    rerender({ renderKey: 2, resetSeq: 0 });
    // 1 回目は引き継ぐものが無い。2 回目は 1 回目のグラフ（x=100）を受け取る。
    // effect 本体で「既存インスタンスがあれば控える」形だと、cleanup が先に破棄して
    // ref を空にしているので、ここが null のまま（＝毎回ランダム配置から並べ直す）になる
    expect(seen).toEqual([
      null,
      {
        positions: { a: { x: 100, y: 0 } },
        viewport: { zoom: 1.5, pan: { x: 10, y: 20 }, w: 300, h: 200 },
      },
    ]);
  });

  it("自動レイアウトの途中で組み直されたら引き継がない（並べ始めの重なった座標を渡さない）", () => {
    const { seen, rerender } = mountGraphView({ renderKey: 1, resetSeq: 0, layoutRunning: true });
    rerender({ renderKey: 2, resetSeq: 0, layoutRunning: false });
    expect(seen).toEqual([null, null]);
    // 並べ終わったグラフからの組み直しは、また引き継ぐ
    rerender({ renderKey: 3, resetSeq: 0, layoutRunning: false });
    expect(seen[2]?.positions).toEqual({ a: { x: 200, y: 0 } });
  });

  it("自動配置に戻した直後の組み直しでは引き継がない（cleanup が控え直しても捨てる）", () => {
    const { seen, rerender } = mountGraphView({ renderKey: 1, resetSeq: 0 });
    rerender({ renderKey: 1, resetSeq: 1 });
    expect(seen).toEqual([null, null]);
    // その次の組み直しからは、また引き継ぐ
    rerender({ renderKey: 2, resetSeq: 1 });
    expect(seen[2]?.positions).toEqual({ a: { x: 100, y: 0 } });
  });
});
