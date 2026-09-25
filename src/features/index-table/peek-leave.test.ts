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
    go: vi.fn(() => void order.push("go")),
  };
  return { order, steps };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

describe("leaveAfterSave", () => {
  it("未保存が無ければ保存せず、その場で移る（外部ブラウザを同期で開けるように）", () => {
    const { order, steps } = setup();
    leaveAfterSave({ status: "saved", timerPending: false }, steps);
    expect(order).toEqual(["go"]);
    expect(steps.save).not.toHaveBeenCalled();
  });

  it.each<PeekSaveState>([
    { status: "dirty", timerPending: true },
    { status: "saving", timerPending: false },
    // 保存中に打った分: 先の保存の完了で状態は saved に戻るが、タイマーは待っている
    { status: "saved", timerPending: true },
  ])("保存が要る状態（%o）では保存し終えてから移る", async (state) => {
    const { order, steps } = setup();
    leaveAfterSave(state, steps);
    // 保存が済むまでは移らない
    expect(steps.go).not.toHaveBeenCalled();
    await flush();
    expect(order).toEqual(["cancelTimer", "save:start", "save:done", "go"]);
  });

  it("保存に失敗しても移る（閉じる・全画面で開くときと同じ）", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const { steps } = setup(() => Promise.reject(new Error("disk full")));
    leaveAfterSave({ status: "dirty", timerPending: true }, steps);
    await flush();
    expect(steps.go).toHaveBeenCalledTimes(1);
    expect(error).toHaveBeenCalled();
    error.mockRestore();
  });
});
