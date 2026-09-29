// @vitest-environment jsdom
// use-list-peek-keys のテスト
// 一覧の器にフォーカスがある前提で ↑↓ / Enter を DOM に送り、
// 印（cursorId）の動き・ピークの差し替え（onStep）・押しっぱなしの待ち・横取りしない条件を確かめる。

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { STEP_SETTLE_MS, useListPeekKeys } from "./use-list-peek-keys";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const IDS = ["a", "b", "c", "d"];

/** 呼び出し側（note-app）と同じく、onStep でピークの state を差し替える入れ物 */
function Harness({
  initialActive = "a",
  onStep,
  onOpenFull,
  enabled,
  externalActive,
}: {
  initialActive?: string | null;
  onStep?: (id: string) => void;
  onOpenFull?: (id: string) => void;
  enabled?: boolean;
  /** 外からピークを差し替える（ピーク内のリンク・× で閉じる）のを模す */
  externalActive?: { value: string | null };
}) {
  const [active, setActive] = useState<string | null>(initialActive);
  const activeId = externalActive ? externalActive.value : active;
  const keys = useListPeekKeys({
    orderedIds: IDS,
    activeId,
    onStep: (id) => {
      onStep?.(id);
      setActive(id);
    },
    onOpenFull,
    enabled,
  });
  return (
    <div data-testid="list" ref={keys.containerRef} tabIndex={-1} onKeyDown={keys.onKeyDown}>
      <input data-testid="search" />
      <button data-testid="button">x</button>
      {IDS.map((id) => (
        <div key={id} data-list-row-id={id} data-cursor={keys.cursorId === id ? "yes" : undefined}>
          {id}
        </div>
      ))}
    </div>
  );
}

function cursor(): string | null {
  return document.querySelector("[data-cursor='yes']")?.getAttribute("data-list-row-id") ?? null;
}

function press(key: string, init: { repeat?: boolean; shiftKey?: boolean; target?: HTMLElement } = {}) {
  const target = init.target ?? screen.getByTestId("list");
  return fireEvent.keyDown(target, { key, repeat: init.repeat ?? false, shiftKey: init.shiftKey ?? false });
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("useListPeekKeys", () => {
  it("↓ / ↑ で印を動かし、単発の押下はすぐピークを差し替える", () => {
    const onStep = vi.fn();
    render(<Harness onStep={onStep} />);
    expect(cursor()).toBe("a");

    press("ArrowDown");
    expect(cursor()).toBe("b");
    expect(onStep).toHaveBeenLastCalledWith("b");

    press("ArrowDown");
    press("ArrowUp");
    expect(cursor()).toBe("b");
    expect(onStep.mock.calls.map((c) => c[0])).toEqual(["b", "c", "b"]);
  });

  it("端では止まり、折り返さない", () => {
    const onStep = vi.fn();
    render(<Harness initialActive="d" onStep={onStep} />);
    press("ArrowDown");
    expect(cursor()).toBe("d");
    expect(onStep).not.toHaveBeenCalled();
  });

  it("押しっぱなしの間は印だけ動かし、止まってからピークを 1 回だけ差し替える", () => {
    const onStep = vi.fn();
    render(<Harness onStep={onStep} />);
    press("ArrowDown"); // 押し始めは単発扱い
    press("ArrowDown", { repeat: true });
    press("ArrowDown", { repeat: true });
    expect(cursor()).toBe("d");
    expect(onStep.mock.calls.map((c) => c[0])).toEqual(["b"]);

    act(() => {
      vi.advanceTimersByTime(STEP_SETTLE_MS);
    });
    expect(onStep.mock.calls.map((c) => c[0])).toEqual(["b", "d"]);
  });

  it("待っている間にピークが外から閉じられたら、差し替えを捨てて印も消す", () => {
    const onStep = vi.fn();
    const external = { value: "a" as string | null };
    const { rerender } = render(<Harness onStep={onStep} externalActive={external} />);
    press("ArrowDown", { repeat: true });
    expect(cursor()).toBe("b");

    external.value = null;
    rerender(<Harness onStep={onStep} externalActive={{ ...external }} />);
    act(() => {
      vi.advanceTimersByTime(STEP_SETTLE_MS * 2);
    });
    expect(onStep).not.toHaveBeenCalled();
    expect(cursor()).toBeNull();
  });

  it("ピークが外で別のノートに変わったら、印もそこへ移る", () => {
    const { rerender } = render(<Harness externalActive={{ value: "a" }} />);
    rerender(<Harness externalActive={{ value: "c" }} />);
    expect(cursor()).toBe("c");
  });

  it("文字入力欄・修飾キー付き・無効中は拾わない", () => {
    const onStep = vi.fn();
    const { rerender } = render(<Harness onStep={onStep} />);
    press("ArrowDown", { target: screen.getByTestId("search") });
    press("ArrowDown", { shiftKey: true });
    rerender(<Harness onStep={onStep} enabled={false} />);
    press("ArrowDown");
    expect(onStep).not.toHaveBeenCalled();
    expect(cursor()).toBe("a");
  });

  it("印の行が一覧に無い・印が無いときは何もせず、既定のスクロールも止めない", () => {
    const onStep = vi.fn();
    render(<Harness initialActive="wiki:x" onStep={onStep} />);
    // fireEvent は preventDefault されたら false を返す
    expect(press("ArrowDown")).toBe(true);
    cleanup();
    render(<Harness initialActive={null} onStep={onStep} />);
    expect(press("ArrowDown")).toBe(true);
    expect(onStep).not.toHaveBeenCalled();
  });

  it("Enter で印の行を全画面で開く。ボタンの上の Enter は奪わない", () => {
    const onOpenFull = vi.fn();
    render(<Harness initialActive="b" onOpenFull={onOpenFull} />);
    press("Enter", { target: screen.getByTestId("button") });
    expect(onOpenFull).not.toHaveBeenCalled();
    press("Enter");
    expect(onOpenFull).toHaveBeenCalledWith("b");
  });
});
