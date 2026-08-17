// @vitest-environment jsdom
// recognizeImage（Tesseract ラッパー）の直列化・宙吊り対策のテスト。
//
// 不変条件:
// - 1 ジョブが OCR_JOB_TIMEOUT_MS を超えたら OcrTimeoutError で reject する
//   （呼び出し側が個別にタイムアウトを持たなくても、永久に待たされない）
// - タイムアウト後は worker と直列化チェーンを作り直し、次のジョブは
//   新しい worker で走る（詰まった worker の後ろに並び続けない）
// - タイムアウトは待ち行列の待機時間を含めない（自分の番が来てから計る）
//
// tesseract.js はモック（実 wasm には触れない）。

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const h = vi.hoisted(() => ({
  createWorker: vi.fn(),
  workers: [] as Array<{ recognize: ReturnType<typeof vi.fn>; terminate: ReturnType<typeof vi.fn> }>,
}));

vi.mock("tesseract.js", () => ({ createWorker: h.createWorker }));

/** recognize の挙動を差し込める worker を 1 つ作って createWorker に登録する */
function armWorker(recognize: ReturnType<typeof vi.fn>) {
  const w = { recognize, terminate: vi.fn().mockResolvedValue(undefined) };
  h.workers.push(w);
  h.createWorker.mockResolvedValueOnce(w);
  return w;
}

beforeEach(() => {
  vi.resetModules();
  h.createWorker.mockReset();
  h.workers.length = 0;
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

async function loadOcr() {
  return await import("./ocr");
}

describe("recognizeImage", () => {
  it("正常系: worker を 1 つ作って使い回す", async () => {
    const recognize = vi
      .fn()
      .mockResolvedValue({ data: { text: " hello ", confidence: 88.6 } });
    armWorker(recognize);
    const { recognizeImage } = await loadOcr();

    const a = await recognizeImage("blob:a");
    const b = await recognizeImage("blob:b");
    expect(a).toEqual({ text: "hello", confidence: 89 });
    expect(b.text).toBe("hello");
    expect(h.createWorker).toHaveBeenCalledTimes(1);
    expect(recognize).toHaveBeenCalledTimes(2);
  });

  it("宙吊りのジョブは OCR_JOB_TIMEOUT_MS で OcrTimeoutError になり、次は新しい worker で走る", async () => {
    // 1 つ目の worker は永久に返さない（宙吊りの再現）
    armWorker(vi.fn().mockReturnValue(new Promise(() => {})));
    // 2 つ目の worker は正常
    armWorker(vi.fn().mockResolvedValue({ data: { text: "ok", confidence: 90 } }));
    const { recognizeImage, OcrTimeoutError, OCR_JOB_TIMEOUT_MS } = await loadOcr();

    const first = recognizeImage("blob:stuck");
    // 拒否を先に捕まえておく（unhandled rejection にしない）
    const firstOutcome = first.then(
      () => "resolved",
      (e) => e,
    );
    await vi.advanceTimersByTimeAsync(OCR_JOB_TIMEOUT_MS + 1);
    const err = await firstOutcome;
    expect(err).toBeInstanceOf(OcrTimeoutError);

    // 詰まった worker は捨てられ（terminate）、次のジョブは新しい worker で完走する
    const second = await recognizeImage("blob:next");
    expect(second.text).toBe("ok");
    expect(h.createWorker).toHaveBeenCalledTimes(2);
    expect(h.workers[0].terminate).toHaveBeenCalled();
  });

  it("タイムアウトは待ち行列の待機時間を含めない", async () => {
    // 1 件目は 100s かかる（タイムアウト未満）。2 件目はその後ろに並ぶ。
    // 2 件目の 120s は「自分の番が来てから」数えるので、合計 220s でも成功する。
    let finishFirst: () => void = () => {};
    const recognize = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise((res) => {
            finishFirst = () => res({ data: { text: "first", confidence: 90 } });
          }),
      )
      .mockResolvedValueOnce({ data: { text: "second", confidence: 90 } });
    armWorker(recognize);
    const { recognizeImage, OCR_JOB_TIMEOUT_MS } = await loadOcr();

    const p1 = recognizeImage("blob:1");
    const p2 = recognizeImage("blob:2");
    await vi.advanceTimersByTimeAsync(OCR_JOB_TIMEOUT_MS - 20_000);
    finishFirst();
    await expect(p1).resolves.toEqual(expect.objectContaining({ text: "first" }));
    // 2 件目はここから 120s 以内に返ればよい
    await vi.advanceTimersByTimeAsync(1_000);
    await expect(p2).resolves.toEqual(expect.objectContaining({ text: "second" }));
  });
});
