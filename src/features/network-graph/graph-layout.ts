// ──────────────────────────────────────────────
// グラフの手動配置（ノード座標）の保存と復元。
//
// ノート周辺グラフ（Cytoscape）と手順フロー（React Flow）は描画ライブラリが
// 違うが、「どのノードをどこに置いたか」という情報の形は同じなので、保存形式と
// 読み書きだけをここに一本化する。各ビューはライブラリ固有のアダプタ
// （use-graph-layout.ts / step-flow-view.tsx）を通してこのモジュールを使う。
//
// 保存先は appdata（process-index と同じ仕組み）。ストレージプロバイダ経由で
// 同期されるので、同じアカウントの別端末でも同じ並びが再現される。ノート JSON
// には触らないため、既存ユーザーのノートを壊す心配がない。
// ──────────────────────────────────────────────

import { readAppDataFile, writeAppDataFile } from "../../lib/storage/app-data-file";
import { getActiveProvider } from "../../lib/storage/registry";
import type { StorageProvider } from "../../lib/storage/types";

const APP_DATA_KEY = "graph-layouts";
const DRIVE_FILE_NAME = ".graphium-graph-layouts.json";

/**
 * 保存形式の版。座標の意味が変わったら上げる → 読み込み時に全破棄される。
 * 手動配置は「失っても自動レイアウトに戻るだけ」なので、マイグレーションは
 * 用意せず捨てる方針でよい。
 */
export const GRAPH_LAYOUT_VERSION = 1;

/**
 * 保存するスコープの上限。ノートごとに 1 スコープ増えるので、放っておくと
 * ノート数だけ際限なく溜まる。上限を超えたら更新が古いものから捨てる。
 */
const MAX_SCOPES = 300;

/** ノード ID → 座標 */
export type GraphLayoutPositions = Record<string, { x: number; y: number }>;

type StoredLayout = {
  positions: GraphLayoutPositions;
  /** LRU の判定に使う。epoch ミリ秒 */
  updatedAt: number;
};

export type GraphLayoutFile = {
  version: number;
  layouts: Record<string, StoredLayout>;
};

// ── スコープキー ──
//
// ビューの種類とその対象を合わせて 1 つのキーにする。同じノートでも
// 「周辺グラフ」と「手順フロー」は別のグラフなので別スコープになる。

/** ノート周辺グラフ（右パネル graph タブ / 拡大表示） */
export const noteGraphScope = (noteId: string): string => `note:${noteId}`;

/** 手順フロー（右パネル prov タブ / 拡大表示 / 手順ギャラリーのプレビュー） */
export const provFlowScope = (noteId: string): string => `prov:${noteId}`;

/** ノート間の全体グラフ（1 つしかないので固定キー） */
export const globalGraphScope = (): string => "global";

/** 素材グラフ（素材ブラウザ） */
export const assetGraphScope = (assetId: string): string => `asset:${assetId}`;

// ── キャッシュ ──

let cache: GraphLayoutFile | null = null;
let loading: Promise<GraphLayoutFile> | null = null;

function emptyFile(): GraphLayoutFile {
  return { version: GRAPH_LAYOUT_VERSION, layouts: {} };
}

/** サインアウト・プロバイダ切り替え時に読み直させる */
export function clearGraphLayoutCache(): void {
  cache = null;
  loading = null;
}

/**
 * appdata から読み込む（1 回だけ。以降はキャッシュ）。
 * 読めない・壊れている・版違いはすべて「配置なし」として扱う —
 * 手動配置は失っても自動レイアウトに戻るだけで、実害がない。
 */
export async function ensureGraphLayouts(
  provider: StorageProvider = getActiveProvider(),
): Promise<GraphLayoutFile> {
  if (cache) return cache;
  if (loading) return loading;
  loading = (async () => {
    let file = emptyFile();
    try {
      const read = await readAppDataFile<GraphLayoutFile>(APP_DATA_KEY, DRIVE_FILE_NAME, provider);
      if (read && read.version === GRAPH_LAYOUT_VERSION && read.layouts) {
        file = read;
      }
    } catch {
      // 読めなければ空で始める
    }
    cache = file;
    loading = null;
    return file;
  })();
  return loading;
}

/** ロード済みの配置を同期で引く。未ロードなら null */
export function getGraphLayout(scope: string): GraphLayoutPositions | null {
  const layout = cache?.layouts[scope];
  if (!layout) return null;
  return layout.positions;
}

// ── 書き込み ──
//
// ドラッグのたびに appdata へ書くと（Drive の場合は特に）回数が多すぎるので、
// メモリ上のキャッシュだけ即座に更新し、実ファイルへの書き込みはまとめて遅らせる。

const SAVE_DEBOUNCE_MS = 800;

let saveTimer: ReturnType<typeof setTimeout> | null = null;
let saveChain: Promise<void> = Promise.resolve();

function pruneScopes(file: GraphLayoutFile): void {
  const entries = Object.entries(file.layouts);
  if (entries.length <= MAX_SCOPES) return;
  entries.sort((a, b) => b[1].updatedAt - a[1].updatedAt);
  file.layouts = Object.fromEntries(entries.slice(0, MAX_SCOPES));
}

function scheduleFlush(provider: StorageProvider): void {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveTimer = null;
    void flushGraphLayouts(provider);
  }, SAVE_DEBOUNCE_MS);
}

/**
 * 保留中の書き込みを実行する。テストと「今すぐ保存したい」場面のために公開する。
 * 書き込みは直列化する（同時に走らせると後勝ちで欠落する）。
 */
export function flushGraphLayouts(
  provider: StorageProvider = getActiveProvider(),
): Promise<void> {
  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = null;
  }
  const snapshot = cache;
  if (!snapshot) return Promise.resolve();
  const operation = saveChain.then(async () => {
    await writeAppDataFile(APP_DATA_KEY, DRIVE_FILE_NAME, snapshot, provider);
  });
  saveChain = operation.then(
    () => undefined,
    () => undefined,
  );
  return operation;
}

/**
 * スコープの配置を丸ごと差し替える。座標が 1 つも無ければスコープごと消す
 * （「自動レイアウトに戻した」状態を空オブジェクトで残さない）。
 */
export function saveGraphLayout(
  scope: string,
  positions: GraphLayoutPositions,
  provider: StorageProvider = getActiveProvider(),
): void {
  const file = cache ?? (cache = emptyFile());
  if (Object.keys(positions).length === 0) {
    delete file.layouts[scope];
  } else {
    file.layouts[scope] = { positions, updatedAt: Date.now() };
    pruneScopes(file);
  }
  scheduleFlush(provider);
}

/** そのグラフを自動レイアウトに戻す */
export function clearGraphLayout(
  scope: string,
  provider: StorageProvider = getActiveProvider(),
): void {
  saveGraphLayout(scope, {}, provider);
}

/** 保存済みの配置を持っているか（「リセット」ボタンの出し分けに使う） */
export function hasGraphLayout(scope: string): boolean {
  const layout = cache?.layouts[scope];
  return !!layout && Object.keys(layout.positions).length > 0;
}
