// @vitest-environment jsdom
// 手入れの一括処理（useUpkeepJobs）。文言は既定の en で照合する。
// - 対象が無ければ行を出さない
// - 確かめの窓で断れば走らせない。受ければ走らせ、結果の行とトーストの 1 行を出す
// - トーストの「停止」（登録した中断ハンドル）で止まる
// - 一括再生成は選んだ種類だけを 1 件ずつ回し、中断の合図を渡す
import type { ReactNode } from "react";
import { describe, it, expect, afterEach, vi } from "vitest";
import { renderHook, act, waitFor, cleanup } from "@testing-library/react";
import { LocaleProvider } from "../../i18n";
import { __setConfirmResponderForTest } from "../../ui/confirm-dialog";
import type { IngestToastItem } from "./IngestToast";
import { useUpkeepJobs, type UseUpkeepJobsOptions, type UpkeepToastSink } from "./use-upkeep-jobs";
import type { SourceTopicBackfillHandlers } from "./upkeep-job-types";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => {
  cleanup();
  __setConfirmResponderForTest(null);
});

const wrapper = ({ children }: { children: ReactNode }) => <LocaleProvider>{children}</LocaleProvider>;

function makeToast() {
  const items = new Map<string, IngestToastItem>();
  const history: IngestToastItem[] = [];
  const controllers = new Set<AbortController>();
  const sink: UpkeepToastSink = {
    upsert: (item) => {
      items.set(item.id, item);
      history.push(item);
    },
    registerAbort: (c) => {
      controllers.add(c);
      return () => controllers.delete(c);
    },
  };
  return { sink, items, history, controllers };
}

function sourceTopics(sources: number, run?: SourceTopicBackfillHandlers["run"]): SourceTopicBackfillHandlers {
  let left = sources;
  return {
    plan: vi.fn(async () => ({ sources: left, alreadySettled: 0 })),
    run: vi.fn(
      run ??
        (async (onProgress) => {
          onProgress({ done: 1, total: left, topicsTouched: 2 });
          const total = left;
          left = 0;
          return {
            done: total, total, topicsTouched: 3, created: 2, noTopic: 0, unreadable: 0,
            failedSources: 0, aborted: false, stoppedByFailures: false,
          };
        }),
    ),
  };
}

function setup(opts: Partial<UseUpkeepJobsOptions>) {
  const toast = makeToast();
  const hook = renderHook(
    (props: Partial<UseUpkeepJobsOptions>) => useUpkeepJobs({ active: true, toast: toast.sink, ...props }),
    { wrapper, initialProps: opts },
  );
  return { ...hook, toast };
}

describe("useUpkeepJobs", () => {
  it("対象が無ければ行を出さない", async () => {
    const handlers = sourceTopics(0);
    const { result } = setup({ sourceTopics: handlers, topicTypes: { untypedCount: 0, run: vi.fn() } });
    await waitFor(() => expect(handlers.plan).toHaveBeenCalled());
    expect(result.current.fillGaps).toEqual([]);
  });

  it("手入れ画面が開いていないあいだは数えない", async () => {
    const handlers = sourceTopics(3);
    setup({ sourceTopics: handlers, active: false });
    await Promise.resolve();
    expect(handlers.plan).not.toHaveBeenCalled();
  });

  it("確かめの窓で断れば走らせない", async () => {
    const handlers = sourceTopics(2);
    const { result, toast } = setup({ sourceTopics: handlers });
    await waitFor(() => expect(result.current.fillGaps).toHaveLength(1));
    __setConfirmResponderForTest(() => false);
    await act(async () => result.current.fillGaps[0].onRun?.());
    expect(handlers.run).not.toHaveBeenCalled();
    expect(toast.history).toEqual([]);
  });

  it("受ければ走らせ、結果の行とトーストの 1 行を出す。対象が無くなっても結果ごと残る", async () => {
    const handlers = sourceTopics(2);
    const { result, toast } = setup({ sourceTopics: handlers });
    await waitFor(() => expect(result.current.fillGaps).toHaveLength(1));
    __setConfirmResponderForTest(() => true);
    await act(async () => result.current.fillGaps[0].onRun?.());
    expect(handlers.run).toHaveBeenCalledTimes(1);
    const row = result.current.fillGaps[0];
    expect(row.status.kind).toBe("result");
    expect(row.onRun).toBeUndefined();
    // トーストは実行中から出て、終わると結果に変わる。見出しの件数には数えない
    expect(toast.history[0]).toMatchObject({ id: "upkeep:sourceTopics", status: "generating", excludeFromCount: true });
    expect(toast.items.get("upkeep:sourceTopics")).toMatchObject({ status: "success" });
    // 終わったら停止の集合から外れる
    expect(toast.controllers.size).toBe(0);
  });

  it("トーストの停止で止まる", async () => {
    let seen: AbortSignal | undefined;
    const handlers = sourceTopics(2, (_onProgress, signal) => {
      seen = signal;
      return new Promise((resolve) => {
        signal.addEventListener("abort", () =>
          resolve({
            done: 0, total: 2, topicsTouched: 0, created: 0, noTopic: 0, unreadable: 0,
            failedSources: 0, aborted: true, stoppedByFailures: false,
          }),
        );
      });
    });
    const { result, toast } = setup({ sourceTopics: handlers });
    await waitFor(() => expect(result.current.fillGaps).toHaveLength(1));
    __setConfirmResponderForTest(() => true);
    let running: Promise<void> | undefined;
    act(() => {
      running = Promise.resolve(result.current.fillGaps[0].onRun?.());
    });
    await waitFor(() => expect(toast.controllers.size).toBe(1));
    expect(result.current.fillGaps[0].status.kind).toBe("running");
    await act(async () => {
      toast.controllers.forEach((c) => c.abort());
      await running;
    });
    await waitFor(() => expect(toast.items.get("upkeep:sourceTopics")?.status).toBe("aborted"));
    expect(seen?.aborted).toBe(true);
    expect(result.current.fillGaps[0].status).toMatchObject({ kind: "result", tone: "warn" });
  });

  it("一括再生成は選んだ種類だけを回し、中断の合図を渡す", async () => {
    const run = vi.fn(async () => ({ ok: true }));
    const { result, toast } = setup({
      regenerate: {
        summaries: [
          { id: "t1", title: "Hydration", kind: "topic" },
          { id: "c1", title: "Wetter dough", kind: "claim" },
          { id: "a1", title: "Trade-off", kind: "atom" },
        ],
        run,
        estimateCalls: (ids) => ids.length * 2,
        models: [{ value: "model-a", label: "model-a" }],
        defaultModel: "model-a",
      },
    });
    const regen = () => result.current.regenerate!;
    expect(regen().targetCount).toBe(3);
    expect(regen().estimatedCalls).toBe(6);
    // 既定のモデルには「（現在の設定）」が添えられる
    expect(regen().models[0].label).toContain("model-a ");
    act(() => regen().onToggleKind("claim"));
    act(() => regen().onToggleKind("atom"));
    expect(regen().targetCount).toBe(1);
    __setConfirmResponderForTest(() => true);
    await act(async () => regen().onRun());
    expect(run).toHaveBeenCalledTimes(1);
    expect(run).toHaveBeenCalledWith("t1", expect.objectContaining({ model: "model-a", signal: expect.any(AbortSignal) }));
    expect(regen().progress).toMatchObject({ done: 1, total: 1, failed: 0 });
    expect(toast.items.get("upkeep:regenerate")).toMatchObject({ status: "success" });
  });
});
