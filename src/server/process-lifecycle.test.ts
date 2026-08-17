import { describe, it, expect } from "vitest";
import {
  installProcessLifecycleHandlers,
  describeError,
  type ProcessLike,
} from "./process-lifecycle.js";

/** process の on / exit だけを持つ偽物。登録されたリスナーをテストから発火できる。 */
function fakeProcess() {
  const listeners = new Map<string, Array<(...args: unknown[]) => void>>();
  const exits: number[] = [];
  const proc: ProcessLike = {
    pid: 4242,
    on(event, listener) {
      const list = listeners.get(event) ?? [];
      list.push(listener);
      listeners.set(event, list);
      return proc;
    },
    exit(code) {
      exits.push(code ?? 0);
      // 実物と違い戻ってくるが、テストでは exit の記録だけ見る
      return undefined as never;
    },
  };
  const emit = (event: string, ...args: unknown[]) => {
    for (const l of listeners.get(event) ?? []) l(...args);
  };
  return { proc, emit, exits, listeners };
}

describe("installProcessLifecycleHandlers", () => {
  it("unhandledRejection は理由をログに残して継続する（exit しない）", () => {
    const logs: string[] = [];
    const { proc, emit, exits } = fakeProcess();
    installProcessLifecycleHandlers(proc, (m) => logs.push(m));

    emit("unhandledRejection", new Error("embed failed: 400"));

    expect(exits).toEqual([]);
    expect(logs).toHaveLength(1);
    expect(logs[0]).toContain("unhandledRejection");
    expect(logs[0]).toContain("continuing");
    expect(logs[0]).toContain("embed failed: 400");
  });

  it("uncaughtException は理由をログに残してから exit(1) する", () => {
    const logs: string[] = [];
    const { proc, emit, exits } = fakeProcess();
    installProcessLifecycleHandlers(proc, (m) => logs.push(m));

    emit("uncaughtException", new TypeError("boom"));

    expect(exits).toEqual([1]);
    expect(logs[0]).toContain("uncaughtException");
    expect(logs[0]).toContain("boom");
    // ログが exit より前に出ている（配列順で保証）
    expect(logs).toHaveLength(1);
  });

  it.each(["SIGTERM", "SIGINT", "SIGHUP"])("%s を受けたらシグナル名と pid を残して exit(0)", (sig) => {
    const logs: string[] = [];
    const { proc, emit, exits } = fakeProcess();
    installProcessLifecycleHandlers(proc, (m) => logs.push(m));

    emit(sig);

    expect(exits).toEqual([0]);
    expect(logs[0]).toContain(sig);
    expect(logs[0]).toContain("4242");
  });

  it("exit イベントで終了コードを残す", () => {
    const logs: string[] = [];
    const { proc, emit } = fakeProcess();
    installProcessLifecycleHandlers(proc, (m) => logs.push(m));

    emit("exit", 137);

    expect(logs.some((l) => l.includes("exit code=137"))).toBe(true);
  });

  it("Error でない reason（文字列・オブジェクト）も落とさずに記録する", () => {
    const logs: string[] = [];
    const { proc, emit, exits } = fakeProcess();
    installProcessLifecycleHandlers(proc, (m) => logs.push(m));

    emit("unhandledRejection", "plain string reason");
    emit("unhandledRejection", { code: "E_WEIRD", detail: 1 });

    expect(exits).toEqual([]);
    expect(logs[0]).toContain("plain string reason");
    expect(logs[1]).toContain("E_WEIRD");
  });
});

describe("describeError", () => {
  it("Error は stack の先頭数行を | 区切りで 1 行にする", () => {
    const err = new Error("something broke");
    const out = describeError(err, 2);
    expect(out).toContain("something broke");
    expect(out.split("\n")).toHaveLength(1);
  });

  it("循環参照オブジェクトでも throw しない", () => {
    const circular: Record<string, unknown> = { a: 1 };
    circular.self = circular;
    expect(() => describeError(circular)).not.toThrow();
  });
});
