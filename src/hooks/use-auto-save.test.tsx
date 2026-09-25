// @vitest-environment jsdom
// オートセーブの不変条件テスト（use-auto-save）
//
// 対象の不変条件:
// - オートセーブは常に「最新のスナップショット」を保存する（デバウンス中の
//   内容更新は新しい方が書かれる）
// - アンマウント後にタイマーの保存を走らせない（未保存の書き出しは
//   use-auto-save.unmount-flush.test.tsx）
//
// テスト環境メモ: プロジェクト既定の vitest 環境は node なので、
// 先頭の @vitest-environment ディレクティブで per-file に jsdom を指定する。

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useAutoSave } from "./use-auto-save";

// React 18 の act() 警告を抑止（テストランナーが act 環境であることを明示）
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("useAutoSave: 保存経路の不変条件", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    document.body.innerHTML = "";
  });

  // 不変条件 4: デバウンス中に内容が更新されたら「新しい方」が保存される。
  // useAutoSave は onSave を ref に保持し、タイマー発火時点の最新コールバックを
  // 呼ぶ設計（markDirty 時点のクロージャを捕まえると古い内容を書いてしまう）。
  it("デバウンス中に onSave が更新されたら、発火時に最新の onSave が呼ばれる", async () => {
    const saved: string[] = [];
    const { result, rerender } = renderHook(
      ({ text }: { text: string }) => useAutoSave(() => { saved.push(text); }),
      { initialProps: { text: "古いスナップショット v1" } }
    );

    act(() => {
      result.current.markDirty();
    });

    // デバウンス中（3 秒未満）に内容が更新される = 親が新しい onSave を渡す
    rerender({ text: "最新のスナップショット v2" });

    await act(async () => {
      vi.advanceTimersByTime(3000);
    });

    // 旧クロージャ（v1）ではなく最新（v2）が保存される
    expect(saved).toEqual(["最新のスナップショット v2"]);
  });

  it("markDirty の連打はタイマーをリセットし、保存は 1 回だけ実行される", async () => {
    const onSave = vi.fn();
    const { result } = renderHook(() => useAutoSave(onSave));

    act(() => {
      result.current.markDirty();
    });
    await act(async () => {
      vi.advanceTimersByTime(2000);
    });
    act(() => {
      result.current.markDirty(); // タイマーリセット
    });
    await act(async () => {
      vi.advanceTimersByTime(2000); // 最初の markDirty から 4 秒、2 回目から 2 秒
    });
    // 2 回目の markDirty から 3 秒経っていないので未保存
    expect(onSave).not.toHaveBeenCalled();

    await act(async () => {
      vi.advanceTimersByTime(1000); // 2 回目の markDirty から 3 秒
    });
    expect(onSave).toHaveBeenCalledTimes(1);
  });

  // アンマウント後にタイマーの保存を走らせない（外されたエディタから後で書くと、開き直した
  // 同じノートの編集を古い本文で上書きしうる）。未保存の書き出しは onUnmountFlush が担う
  // （下の「アンマウント時の書き出し」）。書き出しを渡さない使い方ではタイマーを消すだけ。
  it("アンマウント後にタイマーの保存は走らない（書き出しを渡さないときは何もしない）", async () => {
    const onSave = vi.fn();
    const { result, unmount } = renderHook(() => useAutoSave(onSave));

    act(() => {
      result.current.markDirty();
    });

    // 3 秒経過前にアンマウント（= ノート切替でエディタが差し替わる状況）
    unmount();

    await act(async () => {
      vi.advanceTimersByTime(10000);
    });

    // アンマウント後に保存が走ってはいけない
    expect(onSave).not.toHaveBeenCalled();
  });

  it("saveNow は保留中のタイマーをキャンセルして即時保存する（二重保存しない）", async () => {
    const onSave = vi.fn();
    const { result } = renderHook(() => useAutoSave(onSave));

    act(() => {
      result.current.markDirty();
    });
    await act(async () => {
      result.current.saveNow();
    });
    expect(onSave).toHaveBeenCalledTimes(1);

    // 元のデバウンスタイマーが残っていれば 3 秒後に 2 回目が走ってしまう
    await act(async () => {
      vi.advanceTimersByTime(5000);
    });
    expect(onSave).toHaveBeenCalledTimes(1);
  });

  it("保存完了後に dirty フラグがリセットされる", async () => {
    const onSave = vi.fn();
    const { result } = renderHook(() => useAutoSave(onSave));

    expect(result.current.dirty).toBe(false);
    act(() => {
      result.current.markDirty();
    });
    expect(result.current.dirty).toBe(true);

    await act(async () => {
      vi.advanceTimersByTime(3000);
    });
    expect(result.current.dirty).toBe(false);
  });

  // ハンドラは window / document 両方にキャプチャ登録されているが、
  // stopPropagation により保存は 1 回に抑えられる（二重保存しない）。
  it("Cmd+S で即時保存が 1 回だけ走り、保留中のタイマーもキャンセルされる", async () => {
    const onSave = vi.fn();
    const { result } = renderHook(() => useAutoSave(onSave));

    act(() => {
      result.current.markDirty();
    });

    await act(async () => {
      document.body.dispatchEvent(
        new KeyboardEvent("keydown", { key: "s", metaKey: true, bubbles: true, cancelable: true })
      );
    });
    expect(onSave).toHaveBeenCalledTimes(1);

    // markDirty のデバウンスタイマーが残っていれば 3 秒後に 2 回目が走ってしまう
    await act(async () => {
      vi.advanceTimersByTime(5000);
    });
    expect(onSave).toHaveBeenCalledTimes(1);
  });

  // SidePeek パリティの不変条件: サイドピーク内にフォーカスがあるときの Cmd+S は
  // サイドピーク側の保存ハンドラに委譲し、メインエディタの保存は走らせない
  // （両方走ると main の stale ドキュメントが SidePeek の保存を上書きしうる）。
  it("フォーカスが SidePeek 内にあるとき、メイン側の Cmd+S 保存は発火しない", async () => {
    const onSave = vi.fn();
    renderHook(() => useAutoSave(onSave));

    // SidePeek の DOM（data-side-peek 属性）とその内部のフォーカス要素を用意
    const peek = document.createElement("div");
    peek.setAttribute("data-side-peek", "");
    const input = document.createElement("input");
    peek.appendChild(input);
    document.body.appendChild(peek);
    input.focus();
    expect(document.activeElement).toBe(input);

    await act(async () => {
      window.dispatchEvent(
        new KeyboardEvent("keydown", { key: "s", metaKey: true, cancelable: true })
      );
    });

    expect(onSave).not.toHaveBeenCalled();
  });
});
