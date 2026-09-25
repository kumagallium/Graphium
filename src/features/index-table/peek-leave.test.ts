import { describe, expect, it, vi } from "vitest";
import { leaveAfterSave, type PeekSaveState } from "./peek-leave";

function setup(saveImpl?: () => Promise<void>) {
  const order: string[] = [];
  const steps = {
    cancelTimer: vi.fn(() => void order.push("cancelTimer")),
    save: vi.fn(async () => {
      order.push("save:start");
      await (saveImpl?.() ?? Promise.resolve());
      order.push("save:done");
    }),
    waitSaved: vi.fn(async () => {
      order.push("wait:start");
      await Promise.resolve();
      order.push("wait:done");
    }),
    go: vi.fn(() => void order.push("go")),
  };
  return { order, steps };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

describe("leaveAfterSave", () => {
  it("未保存も書き込み中の保存も無ければ、保存せずその場で移る（外部ブラウザを同期で開けるように）", () => {
    const { order, steps } = setup();
    leaveAfterSave({ unsaved: false, saving: false }, steps);
    expect(order).toEqual(["go"]);
    expect(steps.save).not.toHaveBeenCalled();
    expect(steps.waitSaved).not.toHaveBeenCalled();
  });

  it.each<PeekSaveState>([
    { unsaved: true, saving: false },
    // 保存中に打った分: 先の保存が書き込み中でも、未保存があれば保存する（列の後ろに並ぶ）
    { unsaved: true, saving: true },
  ])("未保存があれば（%o）保存し終えてから移る", async (state) => {
    const { order, steps } = setup();
    leaveAfterSave(state, steps);
    // 保存が済むまでは移らない
    expect(steps.go).not.toHaveBeenCalled();
    await flush();
    expect(order).toEqual(["cancelTimer", "save:start", "save:done", "go"]);
    expect(steps.waitSaved).not.toHaveBeenCalled();
  });

  it("未保存が無く保存が書き込み中なら、保存し直さずに書き終わるのを待ってから移る", async () => {
    const { order, steps } = setup();
    leaveAfterSave({ unsaved: false, saving: true }, steps);
    expect(steps.go).not.toHaveBeenCalled();
    await flush();
    expect(order).toEqual(["cancelTimer", "wait:start", "wait:done", "go"]);
    expect(steps.save).not.toHaveBeenCalled();
  });

  it("保存に失敗しても移る", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const { steps } = setup(() => Promise.reject(new Error("disk full")));
    leaveAfterSave({ unsaved: true, saving: false }, steps);
    await flush();
    expect(steps.go).toHaveBeenCalledTimes(1);
    expect(error).toHaveBeenCalled();
    error.mockRestore();
  });
});
