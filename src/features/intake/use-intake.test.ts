// @vitest-environment jsdom
// useIntake のテスト
//
// - running → done の遷移と open の連動
// - 実行中に closeIntake しても state.kind は running のまま保たれる
// - 実行中に 2 回目の run が来たら待ち行列に積み、完了後に合算した done になる
// - files.length === 0 の run は受け皿を開くだけ

import { describe, it, expect, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useIntake } from "./use-intake";
import type { IntakeDeps, IntakeProgress, MarkdownImportResult } from "./run-intake";
import type { IntakeFile } from "./types";

function mdFile(name: string): IntakeFile {
  return { file: new File(["# " + name], name, { type: "text/markdown" }), path: name };
}

// importMarkdown を await new Promise(setTimeout) で待たせ、実行中の再入を作れるようにする
function makeDeps(overrides: Partial<IntakeDeps> = {}): IntakeDeps & { aiAvailable: boolean } {
  const importMarkdown = vi.fn(
    async (files: IntakeFile[], onProgress: (p: IntakeProgress) => void): Promise<MarkdownImportResult> => {
      await new Promise((r) => setTimeout(r, 20));
      onProgress({ done: files.length, total: files.length, failed: [] });
      return {
        created: files.length,
        linksResolved: 0,
        linksUnresolved: 0,
        failed: [],
        lastNewId: files.length > 0 ? "note-last" : null,
      };
    },
  );
  const uploadAsset = vi.fn(async (_file: File) => ({}));
  return { importMarkdown, uploadAsset, aiAvailable: true, ...overrides };
}

describe("useIntake", () => {
  it("run で running → done に遷移し、open が true になる", async () => {
    const deps = makeDeps();
    const { result } = renderHook(() => useIntake(deps));

    let runPromise: Promise<void>;
    act(() => {
      runPromise = result.current.run([mdFile("a.md")]);
    });

    expect(result.current.open).toBe(true);
    expect(result.current.state.kind).toBe("running");

    await act(async () => {
      await runPromise;
    });

    expect(result.current.state.kind).toBe("done");
    expect(result.current.open).toBe(true);
    if (result.current.state.kind === "done") {
      expect(result.current.state.notes).toBe(1);
    }
  });

  it("実行中に closeIntake しても open は false だが state.kind は running のまま", async () => {
    const deps = makeDeps();
    const { result } = renderHook(() => useIntake(deps));

    let runPromise: Promise<void>;
    act(() => {
      runPromise = result.current.run([mdFile("a.md")]);
    });
    expect(result.current.state.kind).toBe("running");

    act(() => {
      result.current.closeIntake();
    });

    expect(result.current.open).toBe(false);
    expect(result.current.state.kind).toBe("running");

    await act(async () => {
      await runPromise;
    });
    // 完了すれば結果を見せるために open は true に戻る
    expect(result.current.state.kind).toBe("done");
    expect(result.current.open).toBe(true);
  });

  it("実行中に 2 回目の run → 完了後の done が両バッチを合算した数字になる", async () => {
    const deps = makeDeps();
    const { result } = renderHook(() => useIntake(deps));

    let runPromise: Promise<void>;
    act(() => {
      runPromise = result.current.run([mdFile("a.md"), mdFile("b.md")]);
    });
    expect(result.current.state.kind).toBe("running");

    act(() => {
      // 実行中の再入は待ち行列に積まれるだけで別の Promise は発火しない
      void result.current.run([mdFile("c.md")]);
    });

    await act(async () => {
      await runPromise;
    });

    expect(result.current.state.kind).toBe("done");
    if (result.current.state.kind === "done") {
      expect(result.current.state.notes).toBe(3);
    }
    expect(deps.importMarkdown).toHaveBeenCalledTimes(2);
  });

  it("files.length === 0 の run は受け皿を開くだけ", async () => {
    const deps = makeDeps();
    const { result } = renderHook(() => useIntake(deps));

    await act(async () => {
      await result.current.run([]);
    });

    expect(result.current.open).toBe(true);
    expect(result.current.state.kind).toBe("idle");
    expect(deps.importMarkdown).not.toHaveBeenCalled();
  });
});
