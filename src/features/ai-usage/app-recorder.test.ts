import { describe, expect, it, vi } from "vitest";
import { createAppUsageRecorder } from "./app-recorder";
import type { AiUsageFile } from "./usage-log";

function memoryProvider() {
  const store = new Map<string, unknown>();
  return {
    store,
    readAppData: vi.fn(async (key: string) => (store.has(key) ? structuredClone(store.get(key)) : null)),
    writeAppData: vi.fn(async (key: string, data: unknown) => {
      // 読み書きの間に別の書き込みが割り込む競合を起こしやすくする
      await new Promise((r) => setTimeout(r, 1));
      store.set(key, structuredClone(data));
    }),
  };
}

describe("createAppUsageRecorder", () => {
  const at = new Date("2026-11-08T05:00:00Z");

  it("回答ごとのまとまりで appdata に積む", async () => {
    const p = memoryProvider();
    const rec = createAppUsageRecorder(() => p, "sess1");
    await rec.recordCitations(["wiki:a", "note:b"], { group: "run1", at });
    const f = p.store.get("ai-usage-20261108-app-sess1") as AiUsageFile;
    expect(f.writer).toBe("app");
    expect(f.events.map((e) => [e.ref, e.ev, e.g])).toEqual([
      ["wiki:a", "cite", "run1"],
      ["note:b", "cite", "run1"],
    ]);
  });

  it("続けて呼んでも取りこぼさない（書き込みを 1 本の列に並べる）", async () => {
    const p = memoryProvider();
    const rec = createAppUsageRecorder(() => p, "sess2");
    await Promise.all([
      rec.recordCitations(["wiki:1"], { group: "g1", at }),
      rec.recordCitations(["wiki:2"], { group: "g2", at }),
      rec.recordCitations(["wiki:3"], { group: "g3", at }),
    ]);
    const f = p.store.get("ai-usage-20261108-app-sess2") as AiUsageFile;
    expect(f.events.map((e) => e.ref)).toEqual(["wiki:1", "wiki:2", "wiki:3"]);
  });

  it("引用が無ければ書かない", async () => {
    const p = memoryProvider();
    await createAppUsageRecorder(() => p, "s").recordCitations([], { at });
    expect(p.writeAppData).not.toHaveBeenCalled();
  });

  it("置き場所を持たないプロバイダでは何もしない", async () => {
    const rec = createAppUsageRecorder(() => ({}), "s");
    await expect(rec.recordCitations(["wiki:a"], { at })).resolves.toBeUndefined();
  });

  it("書き込みに失敗しても投げず、次の記録は続けられる", async () => {
    const p = memoryProvider();
    p.writeAppData.mockRejectedValueOnce(new Error("disk full"));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const rec = createAppUsageRecorder(() => p, "s3");
    await expect(rec.recordCitations(["wiki:a"], { group: "g", at })).resolves.toBeUndefined();
    await rec.recordCitations(["wiki:b"], { group: "g", at });
    const f = p.store.get("ai-usage-20261108-app-s3") as AiUsageFile;
    expect(f.events.map((e) => e.ref)).toEqual(["wiki:b"]);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});
