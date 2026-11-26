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
import { useUpkeepJobs, sourceTopicsRunningText, type UseUpkeepJobsOptions, type UpkeepToastSink } from "./use-upkeep-jobs";
import { en } from "../../i18n/en";
import type { SourceTopicBackfillHandlers } from "./upkeep-job-types";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => {
  cleanup();
  __setConfirmResponderForTest(null);
});

const wrapper = ({ children }: { children: ReactNode }) => <LocaleProvider>{children}</LocaleProvider>;

function makeToast() {
  const items = new Map<string, IngestToastItem>();
  /** その処理の最後の行（id は実行ごとに upkeep:<処理>:<実行の印>） */
  const last = (jobId: string) => [...items.values()].filter((i) => i.id.startsWith(`upkeep:${jobId}:`)).pop();
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
  return { sink, items, history, controllers, last };
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
    expect(toast.history[0]).toMatchObject({ status: "generating", excludeFromCount: true });
    expect(toast.history[0].id.startsWith("upkeep:sourceTopics:")).toBe(true);
    expect(toast.last("sourceTopics")).toMatchObject({ status: "success" });
    // 終わったら停止の集合から外れる
    expect(toast.controllers.size).toBe(0);
  });

  it("もう一度走らせると、トーストには新しい行が出る（前の結果の行は残る）", async () => {
    const run = vi.fn(async () => ({ assigned: 1, total: 1, calls: 1 }));
    const { result, toast } = setup({ topicTypes: { untypedCount: 1, run } });
    __setConfirmResponderForTest(() => true);
    await act(async () => result.current.fillGaps[0].onRun?.());
    await new Promise((r) => setTimeout(r, 2));
    await act(async () => result.current.fillGaps[0].onRun?.());
    expect(run).toHaveBeenCalledTimes(2);
    const rows = [...toast.items.values()].filter((i) => i.id.startsWith("upkeep:topicTypes:"));
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.status === "success" && r.result)).toBe(true);
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
    await waitFor(() => expect(toast.last("sourceTopics")?.status).toBe("aborted"));
    expect(seen?.aborted).toBe(true);
    expect(result.current.fillGaps[0].status).toMatchObject({ kind: "result", tone: "warn" });
  });

  it("描画のたびに新しい handler が来ても、数え直しは回り続けない", async () => {
    const toast = makeToast();
    const plan = vi.fn(async () => ({ sources: 3, alreadySettled: 0 }));
    // note-app と同じく、描画のたびに handler のオブジェクトを作り直す
    const { result } = renderHook(
      () => useUpkeepJobs({
        active: true,
        toast: toast.sink,
        sourceTopics: { plan, run: vi.fn(async () => null) },
      }),
      { wrapper },
    );
    await waitFor(() => expect(result.current.fillGaps).toHaveLength(1));
    await new Promise((r) => setTimeout(r, 50));
    expect(plan).toHaveBeenCalledTimes(1);
  });

  it("種類付けもトーストの停止で止まる", async () => {
    let seen: AbortSignal | undefined;
    const run = vi.fn((_onProgress: (d: number, t: number) => void, signal: AbortSignal) => {
      seen = signal;
      return new Promise<never>((_resolve, reject) => {
        signal.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
      });
    });
    const { result, toast } = setup({ topicTypes: { untypedCount: 3, run } });
    __setConfirmResponderForTest(() => true);
    act(() => result.current.fillGaps[0].onRun?.());
    await waitFor(() => expect(toast.controllers.size).toBe(1));
    expect(result.current.fillGaps[0].onStop).toBeDefined();
    await act(async () => toast.controllers.forEach((c) => c.abort()));
    await waitFor(() => expect(toast.last("topicTypes")?.status).toBe("aborted"));
    expect(seen?.aborted).toBe(true);
    expect(toast.controllers.size).toBe(0);
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
    expect(toast.last("regenerate")).toMatchObject({ status: "success" });
  });
});

describe("sourceTopicsRunningText", () => {
  const t = (key: string, params?: Record<string, string>) =>
    (en[key] ?? key).replace(/\{(\w+)\}/g, (_, k: string) => params?.[k] ?? `{${k}}`);
  const base = { done: 3, total: 353, topicsTouched: 26 };

  it("資料の中の進み具合が無ければ、これまでどおり数だけ", () => {
    expect(sourceTopicsRunningText(t, base)).toBe("Building… source 3/353 · 26 Topic(s) created or updated");
  });

  it("何本目・題・書いた枚数を足し、窓が複数なら窓も出す", () => {
    const text = sourceTopicsRunningText(t, {
      ...base,
      current: { index: 4, title: "Al6Ge5", phase: "writing", written: 5, planned: 12, windowIndex: 1, windowTotal: 3 },
    });
    expect(text).toBe('Building… source 3/353 · 26 Topic(s) created or updated · writing Topics for source 4, "Al6Ge5" (5/12) (window 2/3)');
  });

  it("長い題は縮め、読んでいる・結んでいるも出す", () => {
    const long = "あ".repeat(40);
    const reading = sourceTopicsRunningText(t, {
      ...base,
      current: { index: 4, title: long, phase: "reading", written: 0, planned: 0, windowIndex: 0, windowTotal: 1 },
    });
    expect(reading).toContain(`reading source 4, "${"あ".repeat(24)}…"`);
    const linking = sourceTopicsRunningText(t, {
      ...base,
      current: { index: 4, title: "X", phase: "linking", written: 0, planned: 0, windowIndex: 0, windowTotal: 3 },
    });
    expect(linking).toMatch(/linking Claims to Topics for source 4, "X"$/);
  });
});
