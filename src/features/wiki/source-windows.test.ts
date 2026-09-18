import { describe, expect, it } from "vitest";
import { splitIntoWindows, WINDOW_SIZE, WINDOW_OVERLAP } from "./source-windows";

describe("splitIntoWindows", () => {
  it("短文は窓 1 枚（全文そのまま）", () => {
    const text = "短い資料です。";
    const windows = splitIntoWindows(text, { size: 100, overlap: 10 });
    expect(windows).toEqual([{ index: 0, start: 0, end: text.length, text }]);
  });

  it("既定値（4000/400）でも size 以下なら窓 1 枚", () => {
    const text = "a".repeat(WINDOW_SIZE);
    const windows = splitIntoWindows(text);
    expect(windows).toHaveLength(1);
    expect(windows[0].text).toBe(text);
  });

  it("区切りは手前 boundarySlack 字以内の文末に寄る", () => {
    // 先頭 90 字 + 文末「。」+ 残り 20 字。size=100, overlap=10(=slack) なら
    // 「。」の直後（91 文字目）で切れるはず。
    const text = "あ".repeat(90) + "。" + "い".repeat(20);
    const windows = splitIntoWindows(text, { size: 100, overlap: 10 });
    expect(windows[0].end).toBe(91);
    expect(windows[0].text.endsWith("。")).toBe(true);
  });

  it("窓どうしは overlap 字ぶん重なる", () => {
    const text = "あ".repeat(90) + "。" + "い".repeat(90) + "。" + "う".repeat(30);
    const windows = splitIntoWindows(text, { size: 100, overlap: 10 });
    expect(windows.length).toBeGreaterThan(1);
    for (let i = 1; i < windows.length; i++) {
      // 次の窓の開始は前の窓の終わりより前（重なっている）
      expect(windows[i].start).toBeLessThan(windows[i - 1].end);
      expect(windows[i].start).toBeGreaterThan(windows[i - 1].start);
    }
  });

  it("区切りが見つからないときも size で進む（無限ループしない）", () => {
    // 文末記号が一切無い長文
    const text = "a".repeat(500);
    const windows = splitIntoWindows(text, { size: 100, overlap: 10 });
    // size=100・overlap=10 で 500 字を覆うと、重なり分だけ枚数が増える（100,90,90,90,90,40 の 6 枚）
    expect(windows.length).toBe(6);
    expect(windows.every((w) => w.end > w.start)).toBe(true);
    expect(windows[windows.length - 1].end).toBe(text.length);
  });

  it("長文は複数枚に分かれ、末尾まで欠けなく覆う", () => {
    const text = "文末。".repeat(2000); // 6000 字
    const windows = splitIntoWindows(text, { size: WINDOW_SIZE, overlap: WINDOW_OVERLAP });
    expect(windows.length).toBeGreaterThan(1);
    expect(windows[0].start).toBe(0);
    expect(windows[windows.length - 1].end).toBe(text.length);
    // index が連番であること
    windows.forEach((w, i) => expect(w.index).toBe(i));
  });

  it("size <= 0 は例外", () => {
    expect(() => splitIntoWindows("x", { size: 0, overlap: 0 })).toThrow();
  });

  it("overlap が size 以上は例外", () => {
    expect(() => splitIntoWindows("x".repeat(10), { size: 5, overlap: 5 })).toThrow();
  });
});
