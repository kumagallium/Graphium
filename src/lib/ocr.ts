// クライアント内 OCR（Tesseract.js）ラッパー
//
// - LLM を一切使わず、画像から文字を抽出する。
// - 画像（File/Blob）はブラウザ内だけで処理され、外部サーバーへ送信されない。
//   （wasm と言語データのみ CDN から取得する。完全オフライン運用時は self-host も可能）
// - デスクトップ版は、端末内の PP-OCRv6 small（Rust 側・ocr-native.ts）でモデル取得済みならそちらで読む。
//   未取得なら取得を裏で始め、今回は Tesseract で読む。端末内の読み取りが失敗した回も Tesseract に落とす。
// - Tesseract ワーカーは 1 つを使い回し、認識ジョブは直列化する
//   （ワーカーは同時に 1 ジョブしか処理できず、logger も共有のため）。

import type { Worker, LoggerMessage } from "tesseract.js";
import { isTauri } from "./platform";

export type OcrProgress = { status: string; progress: number };
/** 読んだエンジン。tesseract = Tesseract.js、pp-ocrv6-small = 端末内の PP-OCRv6 small（デスクトップ版） */
export type OcrEngineName = "tesseract" | "pp-ocrv6-small";
export type OcrResult = { text: string; confidence: number; engine?: OcrEngineName };

/** 既定の認識言語（日本語＋英語）。日本語ノート向け。 */
export const DEFAULT_OCR_LANG = "jpn+eng";

/** 選択可能な言語プリセット */
export const OCR_LANGS = ["jpn+eng", "jpn", "eng"] as const;
export type OcrLang = (typeof OCR_LANGS)[number];

/**
 * 1 ジョブの待機上限。初回はワーカー起動（wasm + 言語データの読み込み）を含む
 * ため長めに取る。超えたら宙吊りとみなしてジョブを失敗させ、パイプラインを
 * 作り直す（デスクトップの WKWebView では worker 起動や画像の読み戻しが
 * まれに永久 pending になり、直列化チェーンごと後続が全部止まる）。
 *
 * 端末内 OCR（Rust の ocr_recognize）は 1 件 90 秒（ocr_models.rs の OCR_DEADLINE_SECS）で自分で
 * 打ち切る。この 120 秒より短いので、ここがタイムアウトして次のジョブを始める時には Rust 側の
 * 前のジョブはすでに止まっている（タイムアウト後に前のジョブと次のジョブが並走しない）。
 * この関係を保つため、Rust 側の持ち時間をこの値以上に伸ばさないこと。
 */
export const OCR_JOB_TIMEOUT_MS = 120_000;

export class OcrTimeoutError extends Error {
  constructor() {
    super("OCR がタイムアウトしました");
    this.name = "OcrTimeoutError";
  }
}

/** wasm を動かせない環境（CSP で止められている等）。待たずに失敗させる */
export class OcrUnavailableError extends Error {
  constructor(cause: unknown) {
    super(`OCR エンジンを起動できません: ${String(cause)}`);
    this.name = "OcrUnavailableError";
  }
}

// ヘッダだけの最小 wasm（マジック "\0asm" + バージョン 1）
const EMPTY_WASM = new Uint8Array([0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00]);
let wasmCheck: { ok: true } | { ok: false; cause: unknown } | null = null;

/**
 * このページで wasm をコンパイルできるかを確かめる。
 *
 * CSP の script-src に 'wasm-unsafe-eval' が無いと、worker 内の wasm コンパイルが
 * 拒否される。その失敗は worker の中で Abort するだけで recognize に返ってこず、
 * OCR_JOB_TIMEOUT_MS の間「認識中」のまま宙吊りになる（デスクトップで実際に起きた）。
 * blob worker はページの CSP を引き継ぐので、メインスレッドで同じ判定ができる。
 * CSP は実行中に変わらないため結果は使い回す。
 * WebKit はコンパイルまでは通してインスタンス化で拒否するので、Instance まで作る。
 */
function assertWasmAllowed(): void {
  if (!wasmCheck) {
    try {
      new WebAssembly.Instance(new WebAssembly.Module(EMPTY_WASM));
      wasmCheck = { ok: true };
    } catch (e) {
      wasmCheck = { ok: false, cause: e };
    }
  }
  if (!wasmCheck.ok) throw new OcrUnavailableError(wasmCheck.cause);
}

function withJobTimeout<T>(promise: Promise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new OcrTimeoutError()), OCR_JOB_TIMEOUT_MS);
    promise.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      },
    );
  });
}

// 進捗コールバック（ジョブは直列実行のため単一で足りる）
let activeProgress: ((p: OcrProgress) => void) | null = null;

let workerPromise: Promise<Worker> | null = null;
let workerLangs = "";
// 認識ジョブ直列化用のチェーン
let queue: Promise<unknown> = Promise.resolve();

async function loadCreateWorker() {
  // 動的 import でバンドルを分割し、初回 OCR まで wasm/コアを読み込まない
  const mod: any = await import("tesseract.js");
  const createWorker = mod.createWorker ?? mod.default?.createWorker;
  if (typeof createWorker !== "function") {
    throw new Error("tesseract.js の createWorker が見つかりません");
  }
  return createWorker as typeof import("tesseract.js").createWorker;
}

/**
 * worker / wasm コア / 学習データをアプリ同梱のものに向ける。
 *
 * tesseract.js の既定はいずれも jsdelivr で、worker を blob で作った中から
 * `importScripts("https://cdn.jsdelivr.net/...")` を呼ぶ。デスクトップ（Tauri）の CSP は
 * `script-src 'self'` なのでこれがブロックされ、OCR がまったく起動しない。
 * 同一オリジンに置いた実体を指せば CSP を緩めずに動き、オフラインでも動くようになる。
 * 実体は vite の copy-tesseract-assets プラグインが public/tesseract/ に配置する。
 */
function localAssetPaths(): {
  workerPath: string;
  corePath: string;
  langPath: string;
} {
  // BASE_URL は "/Graphium/"（web）や "/"（Tauri / Vercel）。末尾スラッシュを保証する。
  const base = import.meta.env.BASE_URL.endsWith("/")
    ? import.meta.env.BASE_URL
    : `${import.meta.env.BASE_URL}/`;
  const root = new URL(`${base}tesseract/`, window.location.origin).href;
  return {
    workerPath: `${root}worker.min.js`,
    // ディレクトリを渡すと worker が SIMD 対応を見てバリアントを選ぶ
    corePath: root,
    langPath: `${root}lang`,
  };
}

async function getWorker(langs: string): Promise<Worker> {
  if (workerPromise && workerLangs === langs) return workerPromise;
  assertWasmAllowed();

  // 言語が変わったら古いワーカーを破棄して作り直す
  if (workerPromise) {
    const prev = workerPromise;
    workerPromise = null;
    prev.then((w) => w.terminate()).catch(() => {});
  }

  workerLangs = langs;
  workerPromise = (async () => {
    const createWorker = await loadCreateWorker();
    return createWorker(langs, undefined, {
      ...localAssetPaths(),
      logger: (m: LoggerMessage) => {
        activeProgress?.({ status: m.status, progress: m.progress ?? 0 });
      },
    });
  })();
  return workerPromise;
}

// ── 端末内 OCR（デスクトップ版） ──

/** Tesseract が認識中に出す status と同じ文字列 */
const NATIVE_PROGRESS_STATUS = "recognizing text";

type NativeApi = typeof import("./ocr-native");

/** 自動取得が失敗してから次に試すまでの待ち（一括 OCR で画像ごとに取得を始めない） */
export const OCR_DOWNLOAD_RETRY_MS = 10 * 60 * 1000;

// 裏でのモデル取得が走っている間 true（多重に始めない）
let nativeDownloading = false;
// 直近の取得失敗の時刻。OCR_DOWNLOAD_RETRY_MS の間は再試行しない（成功で消す）
let nativeDownloadFailedAt: number | null = null;

function startNativeDownload(native: NativeApi): void {
  if (nativeDownloading) return;
  if (nativeDownloadFailedAt !== null && Date.now() - nativeDownloadFailedAt < OCR_DOWNLOAD_RETRY_MS) return;
  nativeDownloading = true;
  native
    .downloadOcrModel()
    .then(() => {
      nativeDownloadFailedAt = null;
    })
    .catch(() => {
      nativeDownloadFailedAt = Date.now();
    })
    .finally(() => {
      nativeDownloading = false;
    });
}

async function imageToBytes(image: File | Blob | string): Promise<Uint8Array> {
  let blob: Blob;
  if (typeof image === "string") {
    const res = await fetch(image);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    blob = await res.blob();
  } else {
    blob = image;
  }
  return new Uint8Array(await blob.arrayBuffer());
}

/**
 * 端末内 OCR で読む。使えない（ブラウザ版・モデル未取得・失敗）ときは null を返し、
 * 呼び出し側が Tesseract で読む。opts.langs は使わない（PP-OCR は 1 つのモデルで多言語）。
 */
async function recognizeNativeOrNull(
  image: File | Blob | string,
  onProgress?: (p: OcrProgress) => void,
): Promise<OcrResult | null> {
  if (!isTauri()) return null;
  let native: NativeApi;
  try {
    native = await import("./ocr-native");
  } catch (e) {
    console.warn("[ocr] 端末内 OCR を読み込めません。Tesseract で読みます", e);
    return null;
  }
  try {
    const status = await native.getOcrModelStatus();
    if (!status.present) {
      startNativeDownload(native);
      return null;
    }
    const bytes = await imageToBytes(image);
    // Rust 側は途中経過を返さないので、開始（0）と終了（1）だけ知らせる。
    // status は Tesseract の認識中と同じ文字列（既存の表示がそのまま「認識中」を出せる）
    onProgress?.({ status: NATIVE_PROGRESS_STATUS, progress: 0 });
    const r = await native.recognizeNative(bytes);
    onProgress?.({ status: NATIVE_PROGRESS_STATUS, progress: 1 });
    return {
      text: (r.text ?? "").trim(),
      confidence: Math.round(r.confidence ?? 0),
      engine: "pp-ocrv6-small",
    };
  } catch (e) {
    console.warn("[ocr] 端末内 OCR に失敗。Tesseract で読みます", e);
    if (String(e).includes(native.OCR_MODEL_NOT_DOWNLOADED)) startNativeDownload(native);
    return null;
  }
}

/**
 * 画像からテキストを抽出する。
 *
 * File/Blob を渡せば通信不要（CORS 回避・オフライン可）。挿入時の元ファイルを
 * 渡すのが最も確実。string（URL）も渡せるが、クロスオリジン画像は CORS で
 * 失敗する場合がある。
 *
 * 認識ジョブは内部で直列化されるため、複数ブロックから同時に呼んでも安全。
 *
 * 1 ジョブが OCR_JOB_TIMEOUT_MS を超えたら OcrTimeoutError で reject し、
 * ワーカーと直列化チェーンを作り直す（resetOcrPipeline）。呼び出し側は
 * 個別にタイムアウトを持たなくてよく、詰まっても次のジョブは新しい
 * ワーカーで再開できる。
 */
export function recognizeImage(
  image: File | Blob | string,
  opts: { langs?: string; onProgress?: (p: OcrProgress) => void } = {},
): Promise<OcrResult> {
  const langs = opts.langs || DEFAULT_OCR_LANG;

  const run = async (): Promise<OcrResult> => {
    const job = (async (): Promise<OcrResult> => {
      const nativeResult = await recognizeNativeOrNull(image, opts.onProgress);
      if (nativeResult) return nativeResult;
      const worker = await getWorker(langs);
      activeProgress = opts.onProgress ?? null;
      try {
        const { data } = await worker.recognize(image);
        return {
          text: (data.text ?? "").trim(),
          confidence: Math.round(data.confidence ?? 0),
          engine: "tesseract",
        };
      } finally {
        activeProgress = null;
      }
    })();
    try {
      // タイムアウトは待ち行列の待機時間を含めない（run はチェーンの先頭で
      // 呼ばれるので、ここから計るのが「1 ジョブの所要」になる）
      return await withJobTimeout(job);
    } catch (e) {
      // 宙吊りは worker・直列化チェーンごと作り直す。詰まったまま引きずると
      // 以後のジョブがすべて連鎖的に待たされ続ける
      if (e instanceof OcrTimeoutError) resetOcrPipeline();
      throw e;
    }
  };

  // 前のジョブの成否に関わらず順に実行する
  const result = queue.then(run, run);
  queue = result.catch(() => {});
  return result;
}

/**
 * 詰まった認識パイプラインを作り直す。
 *
 * ワーカーの起動や認識が宙吊りになると、ジョブ直列化チェーンごと後続が
 * 永久に待たされる。呼び出し側がタイムアウトを検知したらこれを呼ぶと、
 * 次のジョブは新しいワーカー・新しいチェーンで再開できる。
 * 宙吊りワーカーの terminate は投げっぱなしにする（それ自体が応答しない
 * 可能性があるため待たない）。
 */
export function resetOcrPipeline(): void {
  const p = workerPromise;
  workerPromise = null;
  workerLangs = "";
  queue = Promise.resolve();
  if (p) {
    p.then((w) => w.terminate()).catch(() => {});
  }
}

/** ワーカーを破棄してメモリを解放する。サインアウト時などに任意で呼ぶ。 */
export async function terminateOcr(): Promise<void> {
  const p = workerPromise;
  workerPromise = null;
  workerLangs = "";
  if (!p) return;
  try {
    const w = await p;
    await w.terminate();
  } catch {
    // 破棄失敗は無視
  }
}
