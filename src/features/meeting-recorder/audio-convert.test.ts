import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  AudioConvertError,
  convertToPcm16k,
  DURATION_PROBE_TIMEOUT_MS,
  downmixToMono,
  floatToInt16Bytes,
  checkConvertible,
  MAX_AUDIO_SECONDS,
  MAX_SOURCE_BYTES,
  probeAudioDuration,
  splitBytes,
} from "./audio-convert";

describe("downmixToMono", () => {
  it("チャンネルを平均する", () => {
    const out = downmixToMono([new Float32Array([1, 0.5]), new Float32Array([0, -0.5])]);
    expect(Array.from(out)).toEqual([0.5, 0]);
  });
  it("1 チャンネルはそのまま・空は空", () => {
    const a = new Float32Array([0.1, 0.2]);
    expect(downmixToMono([a])).toBe(a);
    expect(downmixToMono([]).length).toBe(0);
  });
  it("長さが違うときは短いほうに合わせる", () => {
    expect(downmixToMono([new Float32Array([1, 1, 1]), new Float32Array([1])]).length).toBe(1);
  });
});

describe("floatToInt16Bytes", () => {
  it("16 bit リトルエンディアンにし、範囲外は丸める", () => {
    const bytes = floatToInt16Bytes(new Float32Array([0, 1, -1, 2, -2, 0.5]));
    const v = new Int16Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 2);
    expect(Array.from(v)).toEqual([0, 32767, -32768, 32767, -32768, 16384]);
  });
});

describe("splitBytes", () => {
  it("指定バイトずつに分け、全部つなぐと元に戻る", () => {
    const src = new Uint8Array(10).map((_, i) => i);
    const parts = splitBytes(src, 4);
    expect(parts.map((p) => p.length)).toEqual([4, 4, 2]);
    expect(Array.from(parts.flatMap((p) => Array.from(p)))).toEqual(Array.from(src));
  });
  it("奇数の size は偶数に切り下げる・空は空", () => {
    expect(splitBytes(new Uint8Array(6), 3).map((p) => p.length)).toEqual([2, 2, 2]);
    expect(splitBytes(new Uint8Array(0))).toEqual([]);
  });
});

/**
 * <audio> 要素と blob URL の置き換え。behavior: { duration } = メタデータが読めて長さが取れる / "error" = 読み込み失敗 /
 * "never" = どちらのイベントも来ない。作った URL と revoke した URL を返す
 */
function stubDom(behavior: { duration: number } | "error" | "never") {
  const created: string[] = [];
  const revoked: string[] = [];
  const RealURL = URL;
  vi.stubGlobal(
    "URL",
    Object.assign(class extends RealURL {}, {
      createObjectURL: () => {
        const u = `blob:test-${created.length}`;
        created.push(u);
        return u;
      },
      revokeObjectURL: (u: string) => {
        revoked.push(u);
      },
    }),
  );
  vi.stubGlobal("document", {
    createElement: () => {
      const el: Record<string, unknown> = {
        preload: "",
        duration: behavior !== "error" && behavior !== "never" ? behavior.duration : NaN,
        onloadedmetadata: null,
        onerror: null,
        removeAttribute: () => {},
        load: () => {},
      };
      Object.defineProperty(el, "src", {
        set() {
          queueMicrotask(() => {
            if (behavior === "never") return;
            if (behavior === "error") (el.onerror as (() => void) | null)?.();
            else (el.onloadedmetadata as (() => void) | null)?.();
          });
        },
      });
      return el;
    },
  });
  return { created, revoked };
}

describe("checkConvertible（デコードの前に断る）", () => {
  it("長さが取れたら、2 時間を超えたときだけ too-long（ちょうどまでは通る）", () => {
    expect(MAX_AUDIO_SECONDS).toBe(7200);
    expect(checkConvertible(7200, 1_000)).toBeNull();
    expect(checkConvertible(7201, 1)).toBe("too-long");
  });
  it("大きさは長さが取れたときにも見る（too-large）", () => {
    expect(checkConvertible(60, MAX_SOURCE_BYTES)).toBeNull();
    expect(checkConvertible(60, MAX_SOURCE_BYTES + 1)).toBe("too-large");
    // 長さが 2 時間を超えていれば、大きさより長さの断りを先に出す
    expect(checkConvertible(7201, MAX_SOURCE_BYTES + 1)).toBe("too-long");
  });
  it("長さが取れない（null / Infinity / 0）ときも大きさで見る", () => {
    for (const d of [null, Infinity, NaN, 0]) {
      expect(checkConvertible(d, MAX_SOURCE_BYTES)).toBeNull();
      expect(checkConvertible(d, MAX_SOURCE_BYTES + 1)).toBe("too-large");
    }
  });
});

describe("probeAudioDuration", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("メタデータから長さを取り、自分で作った URL を revoke する", async () => {
    const { revoked, created } = stubDom({ duration: 123.4 });
    expect(await probeAudioDuration(new Blob(["x"]))).toBe(123.4);
    expect(created).toHaveLength(1);
    expect(revoked).toEqual(created);
  });

  it("Infinity は null（ファイルの大きさで見る側へ）", async () => {
    const { revoked, created } = stubDom({ duration: Infinity });
    expect(await probeAudioDuration(new Blob(["x"]))).toBeNull();
    expect(revoked).toEqual(created);
  });

  it("読み込みに失敗したら null で、URL は revoke する", async () => {
    const { revoked, created } = stubDom("error");
    expect(await probeAudioDuration(new Blob(["x"]))).toBeNull();
    expect(revoked).toEqual(created);
  });

  it("メタデータが来なければ時間切れで null、URL は revoke する", async () => {
    vi.useFakeTimers();
    const { revoked, created } = stubDom("never");
    const p = probeAudioDuration(new Blob(["x"]));
    await vi.advanceTimersByTimeAsync(DURATION_PROBE_TIMEOUT_MS + 1);
    expect(await p).toBeNull();
    expect(revoked).toEqual(created);
  });

  it("document が無い環境では null", async () => {
    vi.stubGlobal("document", undefined);
    expect(await probeAudioDuration(new Blob(["x"]))).toBeNull();
  });
});

describe("convertToPcm16k", () => {
  const closes: number[] = [];
  const ctorArgs: unknown[] = [];
  let offlineArgs: unknown[] | null = null;
  /** decodeAudioData が返す AudioBuffer 風のもの */
  const buffer = (sampleRate: number, channels: Float32Array[], duration: number) => ({
    sampleRate,
    duration,
    numberOfChannels: channels.length,
    getChannelData: (i: number) => channels[i],
  });

  function stubAudio(opts: { allow16k: boolean; decoded: ReturnType<typeof buffer> | "reject" }) {
    class FakeAudioContext {
      constructor(o?: { sampleRate?: number }) {
        ctorArgs.push(o);
        if (o?.sampleRate && !opts.allow16k) throw new Error("unsupported sampleRate");
      }
      decodeAudioData() {
        return opts.decoded === "reject" ? Promise.reject(new Error("bad")) : Promise.resolve(opts.decoded);
      }
      close() {
        closes.push(1);
        return Promise.resolve();
      }
    }
    class FakeOffline {
      destination = {};
      constructor(...a: unknown[]) {
        offlineArgs = a;
      }
      createBufferSource() {
        return { connect() {}, start() {}, buffer: null };
      }
      startRendering() {
        const out = new Float32Array([0.5, -0.5]);
        return Promise.resolve({ numberOfChannels: 1, getChannelData: () => out });
      }
    }
    vi.stubGlobal("AudioContext", FakeAudioContext);
    vi.stubGlobal("OfflineAudioContext", FakeOffline);
  }

  beforeEach(() => {
    closes.length = 0;
    ctorArgs.length = 0;
    offlineArgs = null;
    // 長さは <audio> で 60 秒と読める
    stubDom({ duration: 60 });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("2 時間を超えるなら、デコードに入る前に too-long（AudioContext を作らない）", async () => {
    stubDom({ duration: MAX_AUDIO_SECONDS + 1 });
    stubAudio({ allow16k: true, decoded: buffer(16000, [new Float32Array(4)], 1) });
    await expect(convertToPcm16k(new Blob(["x"]))).rejects.toMatchObject({ reason: "too-long" });
    expect(ctorArgs).toHaveLength(0);
  });

  it("長さが読めても読めなくても、ファイルが大きすぎるときは、デコードせずに too-large", async () => {
    stubDom("error");
    stubAudio({ allow16k: true, decoded: buffer(16000, [new Float32Array(4)], 1) });
    const big = { size: MAX_SOURCE_BYTES + 1, arrayBuffer: async () => new ArrayBuffer(0) } as unknown as Blob;
    await expect(convertToPcm16k(big)).rejects.toMatchObject({ reason: "too-large" });
    expect(ctorArgs).toHaveLength(0);
    // 長さが取れていても同じ
    stubDom({ duration: 60 });
    await expect(convertToPcm16k(big)).rejects.toMatchObject({ reason: "too-large" });
    expect(ctorArgs).toHaveLength(0);
  });

  it("16 kHz の AudioContext を作れるなら、それでデコードして OfflineAudioContext は使わず、終わったら close する", async () => {
    stubAudio({ allow16k: true, decoded: buffer(16000, [new Float32Array([1, 0]), new Float32Array([0, 1])], 1) });
    const r = await convertToPcm16k(new Blob(["x"]));
    expect(ctorArgs).toEqual([{ sampleRate: 16000 }]);
    expect(offlineArgs).toBeNull();
    expect(closes).toHaveLength(1);
    // ステレオを混ぜて 16 bit に（0.5 → 16384）
    expect(Array.from(new Int16Array(r.pcm.buffer, r.pcm.byteOffset, r.pcm.byteLength / 2))).toEqual([16384, 16384]);
    expect(r.seconds).toBe(1);
  });

  it("16 kHz で作れない環境では既定のレートで作り、OfflineAudioContext で 16 kHz にする（close もする）", async () => {
    stubAudio({ allow16k: false, decoded: buffer(48000, [new Float32Array(4)], 2) });
    const r = await convertToPcm16k(new Blob(["x"]));
    expect(ctorArgs).toEqual([{ sampleRate: 16000 }, undefined]);
    expect(offlineArgs).toEqual([1, 32000, 16000]);
    expect(closes).toHaveLength(1);
    expect(r.pcm.byteLength).toBe(4);
  });

  it("形式を読めなければ unreadable で、AudioContext は close する", async () => {
    stubAudio({ allow16k: true, decoded: "reject" });
    await expect(convertToPcm16k(new Blob(["x"]))).rejects.toMatchObject({ reason: "unreadable" });
    expect(closes).toHaveLength(1);
  });
});
