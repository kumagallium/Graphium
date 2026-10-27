// 見本の束（bundle）— ノートとナレッジ（wiki）のドキュメントを 1 つの JSON にまとめた形。
//
// 設定の「バックアップをダウンロード」が出す notes/*.graphium.json と wiki/*.graphium.json を
// 1 ファイルに畳んだだけで、ドキュメント本体の形は GraphiumDocument のまま。
// 読み込みは StorageProvider の saveFile / saveWikiFile に流し込む（索引は ensureIndex が
// 次の読み込みで作り直す）。

import type { GraphiumDocument } from "../document-types";
import type { StorageProvider } from "../storage/types";

export const DEMO_BUNDLE_FORMAT = "graphium-demo-bundle";
export const DEMO_BUNDLE_VERSION = 1;

export type DemoBundleEntry = { id: string; doc: GraphiumDocument };

export type DemoBundle = {
  format: typeof DEMO_BUNDLE_FORMAT;
  version: typeof DEMO_BUNDLE_VERSION;
  id: string;
  /** 本文・ナレッジの言語（ja / en） */
  language: string;
  /** 束を作った日時（ISO 8601） */
  createdAt: string;
  /** ナレッジを作った AI の名前（見本の画面に出す。空なら出さない） */
  generatedBy?: string;
  notes: DemoBundleEntry[];
  wiki: DemoBundleEntry[];
  /** appdata（note-index など）。無ければ読み込み時に作り直される */
  appdata?: Record<string, unknown>;
};

function isEntry(v: unknown): v is DemoBundleEntry {
  if (!v || typeof v !== "object") return false;
  const e = v as { id?: unknown; doc?: unknown };
  return typeof e.id === "string" && e.id.length > 0 && !!e.doc && typeof e.doc === "object";
}

/** JSON を束として検証する。形が違えば理由を投げる */
export function parseDemoBundle(json: unknown): DemoBundle {
  if (!json || typeof json !== "object") throw new Error("bundle is not an object");
  const b = json as Partial<DemoBundle>;
  if (b.format !== DEMO_BUNDLE_FORMAT) throw new Error(`unknown bundle format: ${String(b.format)}`);
  if (b.version !== DEMO_BUNDLE_VERSION) throw new Error(`unsupported bundle version: ${String(b.version)}`);
  if (typeof b.id !== "string" || !b.id) throw new Error("bundle id is missing");
  if (!Array.isArray(b.notes) || !b.notes.every(isEntry)) throw new Error("bundle notes are malformed");
  if (!Array.isArray(b.wiki) || !b.wiki.every(isEntry)) throw new Error("bundle wiki pages are malformed");
  return {
    format: DEMO_BUNDLE_FORMAT,
    version: DEMO_BUNDLE_VERSION,
    id: b.id,
    language: typeof b.language === "string" ? b.language : "en",
    createdAt: typeof b.createdAt === "string" ? b.createdAt : "",
    ...(typeof b.generatedBy === "string" ? { generatedBy: b.generatedBy } : {}),
    notes: b.notes,
    wiki: b.wiki,
    ...(b.appdata && typeof b.appdata === "object" ? { appdata: b.appdata as Record<string, unknown> } : {}),
  };
}

export type LoadBundleResult = { notes: number; wiki: number; appdata: number };

/**
 * 束をプロバイダに書き込む。id は束のものをそのまま使う（ノート間の @ リンク・
 * 知見の derivedFromNotes が id で結ばれているため、付け直すと切れる）。
 */
export async function loadBundleInto(provider: StorageProvider, bundle: DemoBundle): Promise<LoadBundleResult> {
  let notes = 0;
  for (const n of bundle.notes) {
    await provider.saveFile(n.id, n.doc);
    notes++;
  }
  let wiki = 0;
  if (provider.saveWikiFile) {
    for (const w of bundle.wiki) {
      await provider.saveWikiFile(w.id, w.doc);
      wiki++;
    }
  }
  let appdata = 0;
  if (bundle.appdata && provider.writeAppData) {
    for (const [key, value] of Object.entries(bundle.appdata)) {
      await provider.writeAppData(key, value);
      appdata++;
    }
  }
  return { notes, wiki, appdata };
}

/** 見本の DB がまだ空か（初回だけ束を読み込む） */
export async function isProviderEmpty(provider: StorageProvider): Promise<boolean> {
  const files = await provider.listFiles();
  if (files.length > 0) return false;
  if (provider.listWikiFiles) {
    const wiki = await provider.listWikiFiles();
    if (wiki.length > 0) return false;
  }
  return true;
}
