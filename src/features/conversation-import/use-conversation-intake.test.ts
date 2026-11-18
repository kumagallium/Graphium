// @vitest-environment jsdom
// 「AI との会話」の区画の hook のテスト。口と取り込みは deps で差し替える

import { afterEach, describe, expect, it, vi } from "vitest";
import { createElement, type ReactNode } from "react";
import { act, renderHook, waitFor } from "@testing-library/react";
import { LocaleProvider } from "../../i18n";
import type { ConversationWorkdirItem } from "./api";
import { useConversationIntake, type ConversationIntakeDeps } from "./use-conversation-intake";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => vi.unstubAllGlobals());

const wrapper = ({ children }: { children: ReactNode }) => createElement(LocaleProvider, null, children);

function item(name: string, count: number): ConversationWorkdirItem {
  return {
    workdir: `/Users/example/${name}`,
    sessions: count,
    unattendedSessions: 0,
    candidateSessions: 0,
    ownTurns: count,
    ownChars: count * 100,
    startedAt: "",
    endedAt: "",
    sessionRefs: Array.from({ length: count }, (_, i) => ({ dirName: name, fileName: `${i}.jsonl` })),
  };
}

function makeDeps(items: ConversationWorkdirItem[], over: Partial<ConversationIntakeDeps> = {}) {
  const fetchWorkdirs = vi.fn(async () => ({ kind: "ok" as const, searchedPath: "~/x", workdirs: items }));
  const fetchMaterials = vi.fn(async (refs: { dirName: string; fileName: string }[]) => ({
    materials: refs.map(() => ({}) as never),
    failed: 0,
  }));
  const importConversations = vi.fn(async (materials: readonly unknown[]) => ({
    created: materials.map((_, i) => `c${i}`),
    updated: [],
    unchanged: [],
    skipped: [],
  }));
  return { fetchWorkdirs, fetchMaterials, importConversations, ...over } as unknown as ConversationIntakeDeps & {
    fetchWorkdirs: ReturnType<typeof vi.fn>;
    fetchMaterials: ReturnType<typeof vi.fn>;
    importConversations: ReturnType<typeof vi.fn>;
  };
}

async function openReady(deps: ConversationIntakeDeps) {
  const hook = renderHook(() => useConversationIntake(deps), { wrapper });
  act(() => hook.result.current.setSection("conversations"));
  await waitFor(() => expect(hook.result.current.state.kind).toBe("ready"));
  return hook;
}

describe("useConversationIntake", () => {
  it("区画を開くと一覧を読み、最初は何も選んでいない", async () => {
    const deps = makeDeps([item("bakery-notes", 3)]);
    const { result } = await openReady(deps);
    expect(deps.fetchWorkdirs).toHaveBeenCalledTimes(1);
    expect(result.current.state).toMatchObject({ kind: "ready", searchedPath: "~/x" });
    if (result.current.state.kind === "ready") expect(result.current.state.selected.size).toBe(0);
  });

  it("開く前は idle のまま読まない", () => {
    const deps = makeDeps([]);
    const { result } = renderHook(() => useConversationIntake(deps), { wrapper });
    expect(result.current.state.kind).toBe("idle");
    expect(deps.fetchWorkdirs).not.toHaveBeenCalled();
  });

  it("unavailable・error に倒れ、retry で読み直せる", async () => {
    const deps = makeDeps([]);
    deps.fetchWorkdirs.mockResolvedValueOnce({ kind: "unavailable" });
    const a = renderHook(() => useConversationIntake(deps), { wrapper });
    act(() => a.result.current.setSection("conversations"));
    await waitFor(() => expect(a.result.current.state.kind).toBe("unavailable"));

    const deps2 = makeDeps([item("curry-lab", 1)]);
    deps2.fetchWorkdirs.mockResolvedValueOnce({ kind: "error" });
    const b = renderHook(() => useConversationIntake(deps2), { wrapper });
    act(() => b.result.current.setSection("conversations"));
    await waitFor(() => expect(b.result.current.state.kind).toBe("error"));
    act(() => b.result.current.retry());
    await waitFor(() => expect(b.result.current.state.kind).toBe("ready"));
  });

  it("選んで取り込むと 20 件ずつ読む（45 件で 3 回）", async () => {
    const deps = makeDeps([item("bakery-notes", 30), item("curry-lab", 15)]);
    const { result } = await openReady(deps);
    act(() => result.current.toggleAll(true));
    await act(async () => {
      await result.current.startImport();
    });
    expect(deps.fetchMaterials.mock.calls.map((c) => c[0].length)).toEqual([20, 20, 5]);
    expect(deps.importConversations).toHaveBeenCalledTimes(3);
    expect(deps.importConversations.mock.calls[0][1]).toMatchObject({ folderRoot: expect.any(String) });
    expect(result.current.state).toEqual({ kind: "done", created: 45, updated: 0, unchanged: 0, failed: 0 });
  });

  it("結果を足し合わせ、failed は口 B の failed と skipped を足す", async () => {
    const deps = makeDeps([item("bakery-notes", 25)]);
    deps.fetchMaterials.mockImplementation(async (refs: unknown[]) => ({
      materials: refs.map(() => ({})),
      failed: 1,
    }));
    deps.importConversations.mockResolvedValue({
      created: ["a"],
      updated: ["b", "c"],
      unchanged: ["d"],
      skipped: [{ sessionId: "s", reason: "empty" }],
    });
    const { result } = await openReady(deps);
    act(() => result.current.toggle("/Users/example/bakery-notes"));
    await act(async () => {
      await result.current.startImport();
    });
    expect(result.current.state).toEqual({ kind: "done", created: 2, updated: 4, unchanged: 2, failed: 4 });
  });

  it("口 B が 1 回投げても続け、その回の件数を failed に足す", async () => {
    const deps = makeDeps([item("bakery-notes", 45)]);
    deps.fetchMaterials
      .mockResolvedValueOnce({ materials: Array(20).fill({}), failed: 0 })
      .mockRejectedValueOnce(new Error("boom"))
      .mockResolvedValueOnce({ materials: Array(5).fill({}), failed: 0 });
    const { result } = await openReady(deps);
    act(() => result.current.toggleAll(true));
    await act(async () => {
      await result.current.startImport();
    });
    expect(deps.fetchMaterials).toHaveBeenCalledTimes(3);
    expect(result.current.state).toEqual({ kind: "done", created: 25, updated: 0, unchanged: 0, failed: 20 });
  });

  it("reset で idle・ファイル側に戻る", async () => {
    const deps = makeDeps([item("bakery-notes", 2)]);
    const { result } = await openReady(deps);
    act(() => result.current.reset());
    expect(result.current.state.kind).toBe("idle");
    expect(result.current.section).toBe("files");
  });

  it("AI の口を呼ばない（差し替えた deps 以外の fetch が呼ばれない）", async () => {
    const globalFetch = vi.fn();
    vi.stubGlobal("fetch", globalFetch);
    const deps = makeDeps([item("bakery-notes", 3)]);
    const { result } = await openReady(deps);
    act(() => result.current.toggleAll(true));
    await act(async () => {
      await result.current.startImport();
    });
    expect(globalFetch).not.toHaveBeenCalled();
  });
});
