// @vitest-environment jsdom
// 実行前の確認の待ち行列のテスト

import { afterEach, describe, expect, it } from "vitest";
import { act, renderHook } from "@testing-library/react";
import {
  answerToolApproval,
  registerToolApprovalHost,
  requestToolApproval,
  usePendingToolApproval,
} from "./tool-approval";

const req = { server: "slack", name: "post_message", input: { text: "hi" } };
let unregister: (() => void) | null = null;
afterEach(() => {
  unregister?.();
  unregister = null;
});

describe("tool-approval の待ち行列", () => {
  it("聞ける画面が無ければ、やめたことにする", async () => {
    await expect(requestToolApproval(req)).resolves.toEqual({ approved: false, remember: false });
  });

  it("先頭の 1 件を出し、返事で解く（複数は順に）", async () => {
    unregister = registerToolApprovalHost();
    const { result } = renderHook(() => usePendingToolApproval());
    let first!: ReturnType<typeof requestToolApproval>;
    let second!: ReturnType<typeof requestToolApproval>;
    act(() => {
      first = requestToolApproval(req);
      second = requestToolApproval({ ...req, name: "delete_message" });
    });
    expect(result.current?.request.name).toBe("post_message");
    act(() => answerToolApproval(result.current!.id, { approved: true, remember: true }));
    await expect(first).resolves.toEqual({ approved: true, remember: true });
    expect(result.current?.request.name).toBe("delete_message");
    act(() => answerToolApproval(result.current!.id, { approved: false, remember: false }));
    await expect(second).resolves.toEqual({ approved: false, remember: false });
    expect(result.current).toBeNull();
  });

  it("中断されたら行列から外して、やめたことにする", async () => {
    unregister = registerToolApprovalHost();
    const { result } = renderHook(() => usePendingToolApproval());
    const controller = new AbortController();
    let p!: ReturnType<typeof requestToolApproval>;
    act(() => {
      p = requestToolApproval(req, controller.signal);
    });
    expect(result.current).not.toBeNull();
    act(() => controller.abort());
    await expect(p).resolves.toEqual({ approved: false, remember: false });
    expect(result.current).toBeNull();
  });

  it("画面が外れたら、残りは全部やめたことにする", async () => {
    const off = registerToolApprovalHost();
    const p = requestToolApproval(req);
    off();
    await expect(p).resolves.toEqual({ approved: false, remember: false });
  });
});
