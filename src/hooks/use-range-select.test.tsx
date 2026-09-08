// @vitest-environment jsdom
// use-range-select のテスト
// Shift+クリックの範囲選択（アンカー・baseline・伸縮・アンカーの破棄）と、
// 既存のドラッグ範囲選択（閾値・モード・mouseup 後の click 抑制）が壊れていないことを検証する。
// React の合成イベントは jsdom で作れないので、hook にはイベント風オブジェクトを渡す。

import { describe, expect, it } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useState } from "react";
import type { MouseEvent as ReactMouseEvent } from "react";
import { useRangeSelect } from "./use-range-select";

// React 18 の act() 警告を抑止（テストランナーが act 環境であることを明示）
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// 参照が変わると「並びが変わった」扱いになるので、モジュール定数として固定しておく
const IDS = ["a", "b", "c", "d", "e", "f"];
/** 並べ替え後の一覧を模す別の配列（参照も並びも変わる） */
const RESORTED = ["f", "e", "d", "c", "b", "a"];

/** 選択状態を持った状態で hook を使う、呼び出し側 4 画面と同じ形の入れ物 */
function useHarness(orderedIds: string[]) {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const range = useRangeSelect(orderedIds, selectedIds, setSelectedIds);
  return { selectedIds, setSelectedIds, range };
}

type Harness = ReturnType<typeof useHarness>;
type Result = { current: Harness };

function setup(orderedIds: string[] = IDS) {
  return renderHook(({ ids }) => useHarness(ids), { initialProps: { ids: orderedIds } });
}

/** mousedown ハンドラに渡すイベント風オブジェクト */
function mouseDownEvent(
  opts: { shiftKey?: boolean; button?: number; x?: number; y?: number } = {},
): ReactMouseEvent {
  return {
    button: opts.button ?? 0,
    shiftKey: opts.shiftKey ?? false,
    clientX: opts.x ?? 0,
    clientY: opts.y ?? 0,
    // 対話要素ガードは target?.closest() を見るだけなので、null なら素通しになる
    target: null,
    preventDefault: () => {},
    stopPropagation: () => {},
  } as unknown as ReactMouseEvent;
}

/** 選択された id を一覧の並び順に並べた配列（比較しやすくするため） */
const selectedInOrder = (h: Harness, ids: string[] = IDS) =>
  ids.filter((id) => h.selectedIds.has(id));

/** window に本物の mousemove / mouseup を流す（hook が window で待ち受けているため） */
const move = (x: number, y: number) =>
  act(() => {
    window.dispatchEvent(new MouseEvent("mousemove", { clientX: x, clientY: y }));
  });
const up = () =>
  act(() => {
    window.dispatchEvent(new MouseEvent("mouseup"));
  });

/** チェックボックスを 1 回クリックする（mousedown → mouseup。実機と同じくボタンを離すところまで） */
function clickCheckbox(result: Result, index: number, opts: { shiftKey?: boolean } = {}) {
  act(() => result.current.range.onCheckboxMouseDown(mouseDownEvent(opts), index));
  up();
}

/** requestAnimationFrame 1 フレーム分待つ（click 抑制フラグの解除を見るため） */
const nextFrame = () =>
  act(
    () =>
      new Promise<void>((resolve) => {
        requestAnimationFrame(() => resolve());
      }),
  );

describe("useRangeSelect / Shift+クリック", () => {
  it("チェックボックスのアンカーから Shift+クリックで範囲が選ばれる", () => {
    const { result } = setup();

    clickCheckbox(result, 1);
    expect(selectedInOrder(result.current)).toEqual(["b"]);

    clickCheckbox(result, 4, { shiftKey: true });
    expect(selectedInOrder(result.current)).toEqual(["b", "c", "d", "e"]);
    // Shift 範囲はその場で確定するので、ドラッグには入らない
    expect(result.current.range.isDragging).toBe(false);
  });

  it("続けて Shift+クリックすると同じアンカーから範囲が縮む", () => {
    const { result } = setup();

    clickCheckbox(result, 1);
    clickCheckbox(result, 4, { shiftKey: true });
    expect(selectedInOrder(result.current)).toEqual(["b", "c", "d", "e"]);

    // アンカーは 1 のまま。baseline から組み直すので d / e は外れる
    clickCheckbox(result, 2, { shiftKey: true });
    expect(selectedInOrder(result.current)).toEqual(["b", "c"]);
  });

  it("アンカーより手前を Shift+クリックしても範囲になる", () => {
    const { result } = setup();

    clickCheckbox(result, 3);
    clickCheckbox(result, 1, { shiftKey: true });
    expect(selectedInOrder(result.current)).toEqual(["b", "c", "d"]);
  });

  it("Shift 範囲は既にあった選択を残したまま足す", () => {
    const { result } = setup();

    // 離れた 2 件を個別に選ぶ。アンカーは後にトグルした 4
    clickCheckbox(result, 0);
    clickCheckbox(result, 4);
    clickCheckbox(result, 5, { shiftKey: true });
    expect(selectedInOrder(result.current)).toEqual(["a", "e", "f"]);
  });

  it("行を普通にクリックしただけではアンカーが立たない", () => {
    const { result } = setup();

    // ドラッグせずに mousedown → mouseup（＝行を開くクリック）
    act(() => result.current.range.onRowMouseDown(mouseDownEvent(), 0));
    up();
    expect(selectedInOrder(result.current)).toEqual([]);
    // 行クリックは開く操作なので、その click は抑制されない
    expect(result.current.range.shouldSuppressClick()).toBe(false);

    // アンカーが無いので Shift+クリックしても範囲にはならず、ドラッグ待ちに戻るだけ
    act(() => result.current.range.onRowMouseDown(mouseDownEvent({ shiftKey: true }), 3));
    expect(selectedInOrder(result.current)).toEqual([]);
    expect(result.current.range.shouldSuppressClick()).toBe(false);
  });

  it("行の Shift+クリックは範囲を足し、直後の click を 1 回だけ抑制する", async () => {
    const { result } = setup();

    clickCheckbox(result, 1);
    await nextFrame();
    // チェックボックス側の抑制は解けている
    expect(result.current.range.shouldSuppressClick()).toBe(false);

    act(() => result.current.range.onRowMouseDown(mouseDownEvent({ shiftKey: true }), 3));
    expect(selectedInOrder(result.current)).toEqual(["b", "c", "d"]);
    // 行の Shift+クリックは「開く」ではないので、この click は握りつぶす
    expect(result.current.range.shouldSuppressClick()).toBe(true);
    expect(result.current.range.isDragging).toBe(false);

    // 次フレームで解除され、以降の click は通る
    await nextFrame();
    expect(result.current.range.shouldSuppressClick()).toBe(false);
  });

  it("選択が空になるとアンカーが消え、Shift+クリックは単独トグルに戻る", () => {
    const { result } = setup();

    clickCheckbox(result, 1);
    // 同じ行をもう一度押して選択を空にする（remove モード）
    clickCheckbox(result, 1);
    expect(selectedInOrder(result.current)).toEqual([]);

    clickCheckbox(result, 4, { shiftKey: true });
    expect(selectedInOrder(result.current)).toEqual(["e"]);
  });

  it("外から選択を空にされてもアンカーが消える", () => {
    const { result } = setup();

    clickCheckbox(result, 1);
    // 一括操作のあとの「選択解除」を模す
    act(() => result.current.setSelectedIds(new Set()));

    clickCheckbox(result, 4, { shiftKey: true });
    expect(selectedInOrder(result.current)).toEqual(["e"]);
  });

  it("外から選択を丸ごと差し替えられてもアンカーが消える（すべて選択の直後の Shift+クリックで縮まない）", () => {
    const { result } = setup();

    clickCheckbox(result, 1);
    // 列ヘッダの「すべて選択」を模す（フックを通らない差し替え）
    act(() => result.current.setSelectedIds(new Set(IDS)));
    expect(selectedInOrder(result.current)).toEqual(IDS);

    // 古いアンカー（index 1）が残っていれば b〜e だけに縮むはず。
    // 差し替えでアンカーは捨てられ、単独トグルとして "e" が外れるだけになる
    clickCheckbox(result, 4, { shiftKey: true });
    expect(selectedInOrder(result.current)).toEqual(IDS.filter((id) => id !== "e"));
  });

  it("並び順が変わるとアンカーが消える（index の意味が変わるため）", () => {
    const { result, rerender } = setup();

    clickCheckbox(result, 1);
    expect(selectedInOrder(result.current)).toEqual(["b"]);

    // 並べ替え・絞り込みで一覧が組み直された状態
    rerender({ ids: RESORTED });

    // 新しい並びの先頭（"f"）を Shift+クリック。
    // アンカーが残っていたら "f" から "e" まで巻き込むはず
    clickCheckbox(result, 0, { shiftKey: true });
    // 範囲にはならず、押した 1 件だけが足される
    expect(selectedInOrder(result.current, RESORTED)).toEqual(["f", "b"]);
  });
});

describe("useRangeSelect / 既存のドラッグ範囲選択", () => {
  it("閾値（5px）未満の動きではドラッグが始まらない", () => {
    const { result } = setup();

    act(() => result.current.range.onRowMouseDown(mouseDownEvent({ x: 100, y: 100 }), 1));
    move(102, 101);
    expect(result.current.range.isDragging).toBe(false);
    expect(selectedInOrder(result.current)).toEqual([]);
  });

  it("閾値を超えるとドラッグが始まり、mouseenter で範囲が伸び縮みする", async () => {
    const { result } = setup();

    act(() => result.current.range.onRowMouseDown(mouseDownEvent({ x: 100, y: 100 }), 1));
    move(100, 110);
    expect(result.current.range.isDragging).toBe(true);
    expect(selectedInOrder(result.current)).toEqual(["b"]);

    act(() => result.current.range.onRowMouseEnter(3));
    expect(selectedInOrder(result.current)).toEqual(["b", "c", "d"]);

    // 戻すと範囲も縮む（baseline から組み直しているため）
    act(() => result.current.range.onRowMouseEnter(2));
    expect(selectedInOrder(result.current)).toEqual(["b", "c"]);

    // mouseup 直後の click は 1 回だけ抑制される
    up();
    expect(result.current.range.isDragging).toBe(false);
    expect(result.current.range.shouldSuppressClick()).toBe(true);
    await nextFrame();
    expect(result.current.range.shouldSuppressClick()).toBe(false);
  });

  it("選択済みの行から始めたドラッグは範囲を外す（remove モード）", () => {
    const { result } = setup();

    // 先に b〜d を選んでおく
    clickCheckbox(result, 1);
    clickCheckbox(result, 3, { shiftKey: true });
    expect(selectedInOrder(result.current)).toEqual(["b", "c", "d"]);

    // 選択済みの c からドラッグを始めると外す側になる
    act(() => result.current.range.onRowMouseDown(mouseDownEvent({ x: 0, y: 0 }), 2));
    move(0, 20);
    expect(result.current.range.isDragging).toBe(true);
    act(() => result.current.range.onRowMouseEnter(3));
    expect(selectedInOrder(result.current)).toEqual(["b"]);
    up();
  });

  it("ドラッグの開始でもアンカーが立つ（続けて Shift+クリックできる）", () => {
    const { result } = setup();

    act(() => result.current.range.onRowMouseDown(mouseDownEvent({ x: 0, y: 0 }), 1));
    move(0, 20);
    act(() => result.current.range.onRowMouseEnter(2));
    up();
    expect(selectedInOrder(result.current)).toEqual(["b", "c"]);

    // アンカーはドラッグの起点（1）
    clickCheckbox(result, 4, { shiftKey: true });
    expect(selectedInOrder(result.current)).toEqual(["b", "c", "d", "e"]);
  });

  it("ドラッグで伸ばした選択は、その後の Shift+クリックでも消えない", () => {
    const { result } = setup();

    // 1（b）から 5（f）までドラッグして b〜f を選ぶ
    act(() => result.current.range.onRowMouseDown(mouseDownEvent({ x: 0, y: 0 }), 1));
    move(0, 20);
    for (const idx of [2, 3, 4, 5]) {
      act(() => result.current.range.onRowMouseEnter(idx));
    }
    up();
    expect(selectedInOrder(result.current)).toEqual(["b", "c", "d", "e", "f"]);

    // アンカー（1）より手前を Shift+クリック。範囲は足すだけで、ドラッグ分は残る
    clickCheckbox(result, 0, { shiftKey: true });
    expect(selectedInOrder(result.current)).toEqual(["a", "b", "c", "d", "e", "f"]);
  });

  it("外しドラッグで外した行は、その後の Shift+クリックで戻ってこない", () => {
    const { result } = setup();

    clickCheckbox(result, 1);
    clickCheckbox(result, 4, { shiftKey: true });
    expect(selectedInOrder(result.current)).toEqual(["b", "c", "d", "e"]);

    // 選択済みの 3（d）から 4（e）へドラッグして 2 件を外す
    act(() => result.current.range.onRowMouseDown(mouseDownEvent({ x: 0, y: 0 }), 3));
    move(0, 20);
    act(() => result.current.range.onRowMouseEnter(4));
    up();
    expect(selectedInOrder(result.current)).toEqual(["b", "c"]);

    // アンカー（3）を Shift+クリック。足されるのは d だけで、外した e は戻らない
    clickCheckbox(result, 3, { shiftKey: true });
    expect(selectedInOrder(result.current)).toEqual(["b", "c", "d"]);
  });

  it("右クリック（button !== 0）では何も起きない", () => {
    const { result } = setup();

    act(() => result.current.range.onCheckboxMouseDown(mouseDownEvent({ button: 2 }), 1));
    expect(selectedInOrder(result.current)).toEqual([]);
    expect(result.current.range.isDragging).toBe(false);

    act(() => result.current.range.onRowMouseDown(mouseDownEvent({ button: 2, x: 0, y: 0 }), 1));
    move(0, 20);
    expect(result.current.range.isDragging).toBe(false);
  });
});
