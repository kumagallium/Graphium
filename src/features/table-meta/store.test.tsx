// @vitest-environment jsdom
// テーブル注釈ストアのテスト。dataTableBlockIds の参照同値・restore によるリセットを検証する。

import { describe, expect, it } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { TableMetaStoreProvider, useTableMetaStore } from "./store";

// React 18 の act() 警告を抑止（テストランナーが act 環境であることを明示）
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function setup() {
  return renderHook(() => useTableMetaStore(), {
    wrapper: ({ children }) => <TableMetaStoreProvider>{children}</TableMetaStoreProvider>,
  });
}

describe("TableMetaStoreProvider / dataTableBlockIds", () => {
  it("既定は null", () => {
    const { result } = setup();
    expect(result.current.dataTableBlockIds).toBeNull();
  });

  it("setDataTableBlockIds で反映される", () => {
    const { result } = setup();
    act(() => {
      result.current.setDataTableBlockIds(["a"]);
    });
    expect(result.current.dataTableBlockIds).toEqual(["a"]);
  });

  it("同じ中身の配列を再度渡しても参照が変わらない（無駄な再評価を起こさない）", () => {
    const { result } = setup();
    act(() => {
      result.current.setDataTableBlockIds(["a", "b"]);
    });
    const first = result.current.dataTableBlockIds;
    act(() => {
      // 別のインスタンスだが中身は同じ配列
      result.current.setDataTableBlockIds(["a", "b"]);
    });
    expect(result.current.dataTableBlockIds).toBe(first);
  });

  it("restore すると null に戻る（ノートをまたいで前のノートの配布を残さない）", () => {
    const { result } = setup();
    act(() => {
      result.current.setDataTableBlockIds(["a"]);
    });
    expect(result.current.dataTableBlockIds).toEqual(["a"]);
    act(() => {
      result.current.restore(undefined);
    });
    expect(result.current.dataTableBlockIds).toBeNull();
  });
});
