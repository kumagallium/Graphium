import { describe, expect, it } from "vitest";
import { createKeyedSerial } from "./keyed-serial";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("createKeyedSerial", () => {
  it("同じキーは頼んだ順に走り、後から頼んだ書き込みが残る", async () => {
    // 追加（保存が遅い）→ 取り消し（保存が速い）の順に頼む。直列化しないと追加が後勝ちする
    const serial = createKeyedSerial();
    let stored: string[] = [];
    const write = (value: string[], delay: number) =>
      serial("note-1", async () => {
        await sleep(delay);
        stored = value;
      });
    await Promise.all([write(["A"], 30), write([], 1)]);
    expect(stored).toEqual([]);
  });

  it("直列化しないと遅い方が後勝ちする（前提の確認）", async () => {
    let stored: string[] = [];
    const write = async (value: string[], delay: number) => {
      await sleep(delay);
      stored = value;
    };
    await Promise.all([write(["A"], 30), write([], 1)]);
    expect(stored).toEqual(["A"]);
  });

  it("別のキーは並行に走る", async () => {
    const serial = createKeyedSerial();
    const order: string[] = [];
    await Promise.all([
      serial("a", async () => {
        await sleep(30);
        order.push("a");
      }),
      serial("b", async () => {
        await sleep(1);
        order.push("b");
      }),
    ]);
    expect(order).toEqual(["b", "a"]);
  });

  it("例外を投げても次の書き込みは走る", async () => {
    const serial = createKeyedSerial();
    const failed = serial("k", async () => {
      throw new Error("boom");
    });
    const next = serial("k", async () => "ok");
    await expect(failed).rejects.toThrow("boom");
    await expect(next).resolves.toBe("ok");
  });
});
