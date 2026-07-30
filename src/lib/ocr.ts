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
 */
export function recognizeImage(
  image: File | Blob | string,
  opts: { langs?: string; onProgress?: (p: OcrProgress) => void } = {},
): Promise<OcrResult> {
  const langs = opts.langs || DEFAULT_OCR_LANG;

  const run = async (): Promise<OcrResult> => {
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
  };

  // 前のジョブの成否に関わらず順に実行する
  const result = queue.then(run, run);
  queue = result.catch(() => {});
  return result;
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
