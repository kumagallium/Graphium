// 文字起こし用の音声変換（WebView 側）
//
// スマホで録った音声（audio/mp4 の m4a、audio/webm の weba など）は Rust が直接読めない。
// WebView の decodeAudioData で読み、16 kHz・mono・16 bit に直して Rust へ渡す。
// 純粋な部分（ダウンミックス・Int16 化・分割）は関数に切り出してテストする。

/** Rust（whisper）が読む音声の標本化周波数 */
export const TARGET_SAMPLE_RATE = 16_000;
/** 受け付ける長さの上限（秒）。Rust 側の INPUT_MAX_SEC と同じ値（2 時間） */
export const MAX_AUDIO_SECONDS = 2 * 3600;
/**
 * 変換に入る元ファイルの大きさの上限（バイト）。長さが取れたときも取れないときも適用する。
 * 変換では、元のバイト列（ArrayBuffer）のほかに、展開後の Float32（16 kHz の AudioContext でデコードできたとき
 * 2 時間・stereo で約 0.9 GB、既定の周波数でデコードしたときはさらに大きい）を同時に持つので、
 * 元が 500 MB なら合わせて 1.5 GB 前後になる。これを超える音声は WebView が落ちるおそれがあるので断る
 * （圧縮音声の 320 kbps で 2 時間 = 約 290 MB なので、2 時間以内の圧縮音声はほぼ通る）
 */
export const MAX_SOURCE_BYTES = 500 * 1000 * 1000;
/** 長さを読むのに待つ上限（ミリ秒）。メタデータが来ないファイルで固まらないように */
export const DURATION_PROBE_TIMEOUT_MS = 10_000;
/** Rust へ 1 回で送るバイト数（偶数。大きな音声でも固まらないよう分ける） */
export const CHUNK_BYTES = 1024 * 1024;

/** reason: unreadable = WebView が形式を読めなかった / too-long = 長さの上限を超えた / too-large = 元ファイルが大きすぎる */
export class AudioConvertError extends Error {
  constructor(public readonly reason: "unreadable" | "too-long" | "too-large") {
    super(reason);
  }
}

/** 複数チャンネルを平均して 1 チャンネルにする。空なら空の配列 */
export function downmixToMono(channels: readonly Float32Array[]): Float32Array {
  if (channels.length === 0) return new Float32Array(0);
  if (channels.length === 1) return channels[0];
  const len = Math.min(...channels.map((c) => c.length));
  const out = new Float32Array(len);
  for (const c of channels) {
    for (let i = 0; i < len; i++) out[i] += c[i];
  }
  const n = channels.length;
  for (let i = 0; i < len; i++) out[i] /= n;
  return out;
}

/** Float32（-1〜1）を 16 bit のリトルエンディアンのバイト列にする。範囲外は丸める */
export function floatToInt16Bytes(samples: Float32Array): Uint8Array {
  const out = new Uint8Array(samples.length * 2);
  const view = new DataView(out.buffer);
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(i * 2, s < 0 ? Math.round(s * 0x8000) : Math.round(s * 0x7fff), true);
  }
  return out;
}

/** バイト列を size バイトずつに分ける（size は偶数に切り下げ。16 bit の標本が割れないように） */
export function splitBytes(bytes: Uint8Array, size: number = CHUNK_BYTES): Uint8Array[] {
  const step = Math.max(2, size - (size % 2));
  const out: Uint8Array[] = [];
  for (let i = 0; i < bytes.length; i += step) out.push(bytes.subarray(i, Math.min(bytes.length, i + step)));
  return out;
}

/**
 * 長さ（秒）とファイルの大きさから、変換せずに断るか。長さが取れて 2 時間を超えていれば "too-long"、
 * 大きさが上限（MAX_SOURCE_BYTES）を超えていれば "too-large"（長さが取れないときもここで断る）。通すなら null
 */
export function checkConvertible(duration: number | null, sizeBytes: number): "too-long" | "too-large" | null {
  if (duration !== null && Number.isFinite(duration) && duration > MAX_AUDIO_SECONDS) return "too-long";
  if (sizeBytes > MAX_SOURCE_BYTES) return "too-large";
  return null;
}

/**
 * <audio> 要素にメタデータだけ読ませて長さ（秒）を取る。デコードより先に長さを断るために使う
 * （decodeAudioData は全体を Float32 に展開するので、長い音声は先にメモリを使い切る）。
 * 取れないとき（要素が使えない・読めない・時間切れ・Infinity）は null。作った blob URL はここで必ず revoke する
 */
export function probeAudioDuration(blob: Blob): Promise<number | null> {
  if (typeof document === "undefined" || typeof URL === "undefined" || !URL.createObjectURL) return Promise.resolve(null);
  return new Promise((resolve) => {
    const url = URL.createObjectURL(blob); // 自分で作った URL（素材のプロバイダが持つ URL ではない）
    const el = document.createElement("audio");
    el.preload = "metadata";
    let done = false;
    const finish = (v: number | null) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      el.onloadedmetadata = null;
      el.onerror = null;
      el.removeAttribute("src");
      try {
        el.load();
      } catch {
        // 読み込みの取り消しに失敗しても、URL は必ず手放す
      }
      URL.revokeObjectURL(url);
      resolve(v);
    };
    const timer = setTimeout(() => finish(null), DURATION_PROBE_TIMEOUT_MS);
    el.onloadedmetadata = () => finish(Number.isFinite(el.duration) && el.duration > 0 ? el.duration : null);
    el.onerror = () => finish(null);
    el.src = url;
  });
}

/**
 * 音声ファイルを読み、16 kHz・mono・16 bit の PCM に直す。読めなければ AudioConvertError("unreadable")、
 * 2 時間を超えるなら・元ファイルが大きすぎるなら（デコードする前に）AudioConvertError("too-long" / "too-large")。
 * デコード用の AudioContext は可能なら 16 kHz で作り（展開後のメモリを小さくする）、作れない環境では
 * 既定の周波数で作って OfflineAudioContext で 16 kHz にする。使い終わった AudioContext は close する
 */
export async function convertToPcm16k(blob: Blob): Promise<{ pcm: Uint8Array; seconds: number }> {
  const refusal = checkConvertible(await probeAudioDuration(blob), blob.size);
  if (refusal) throw new AudioConvertError(refusal);
  let decoded: AudioBuffer;
  try {
    const data = await blob.arrayBuffer();
    let ctx: AudioContext;
    try {
      ctx = new AudioContext({ sampleRate: TARGET_SAMPLE_RATE });
    } catch {
      ctx = new AudioContext();
    }
    try {
      decoded = await ctx.decodeAudioData(data);
    } finally {
      void ctx.close().catch(() => {});
    }
  } catch {
    throw new AudioConvertError("unreadable");
  }
  if (decoded.duration > MAX_AUDIO_SECONDS) throw new AudioConvertError("too-long");
  try {
    let channels: Float32Array[];
    if (decoded.sampleRate === TARGET_SAMPLE_RATE) {
      // 16 kHz の AudioContext でデコードできた: そのまま使う
      channels = Array.from({ length: decoded.numberOfChannels }, (_, i) => decoded.getChannelData(i));
    } else {
      // 既定の周波数でデコードした: 標本化周波数を 16 kHz に落とす（チャンネルはそのまま。混ぜるのは downmixToMono）
      const frames = Math.max(1, Math.ceil(decoded.duration * TARGET_SAMPLE_RATE));
      const offline = new OfflineAudioContext(decoded.numberOfChannels, frames, TARGET_SAMPLE_RATE);
      const src = offline.createBufferSource();
      src.buffer = decoded;
      src.connect(offline.destination);
      src.start();
      const rendered = await offline.startRendering();
      channels = Array.from({ length: rendered.numberOfChannels }, (_, i) => rendered.getChannelData(i));
    }
    return { pcm: floatToInt16Bytes(downmixToMono(channels)), seconds: decoded.duration };
  } catch {
    throw new AudioConvertError("unreadable");
  }
}
