// クライアント内 OCR（Tesseract.js）ラッパー
//
// - LLM を一切使わず、画像から文字を抽出する。
// - 画像（File/Blob）はブラウザ内だけで処理され、外部サーバーへ送信されない。
//   （wasm と言語データのみ CDN から取得する。完全オフライン運用時は self-host も可能）
// - Tesseract ワーカーは 1 つを使い回し、認識ジョブは直列化する
//   （ワーカーは同時に 1 ジョブしか処理できず、logger も共有のため）。

import type { Worker, LoggerMessage } from "tesseract.js";

export type OcrProgress = { status: string; progress: number };
export type OcrResult = { text: string; confidence: number };

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
 */
export const OCR_JOB_TIMEOUT_MS = 120_000;

export class OcrTimeoutError extends Error {
  constructor() {
    super("OCR がタイムアウトしました");
    this.name = "OcrTimeoutError";
  }
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
    const job = (async () => {
      const worker = await getWorker(langs);
      activeProgress = opts.onProgress ?? null;
      try {
        const { data } = await worker.recognize(image);
        return {
          text: (data.text ?? "").trim(),
          confidence: Math.round(data.confidence ?? 0),
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
