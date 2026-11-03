// 見本モードの起動時の読み込み — 見本の DB が空なら束を取りに行って流し込む。
// 結果は画面の帯（DemoBanner）が購読する。

import type { StorageProvider } from "../storage/types";
import { demoBundleUrl, getDemoId } from "./demo-mode";
import { isProviderEmpty, loadBundleInto, parseDemoBundle, type DemoBundle } from "./bundle";

export type DemoLoadState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "ready"; bundle: Pick<DemoBundle, "id" | "language" | "generatedBy" | "createdAt" | "tour">; fresh: boolean }
  | { status: "error"; message: string };

export const DEMO_LOAD_EVENT = "graphium-demo-load";

let state: DemoLoadState = { status: "idle" };

export function getDemoLoadState(): DemoLoadState {
  return state;
}

function setState(next: DemoLoadState): void {
  state = next;
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(DEMO_LOAD_EVENT, { detail: next }));
  }
}

/** 束を取りに行く。テストで差し替えられるよう fetch を引数に取る */
export async function fetchDemoBundle(
  url: string,
  fetchFn: typeof fetch = fetch,
): Promise<DemoBundle> {
  const res = await fetchFn(url, { cache: "no-cache" });
  if (!res.ok) throw new Error(`bundle fetch failed: ${res.status}`);
  return parseDemoBundle(await res.json());
}

/**
 * 見本モードなら、DB が空のときだけ束を読み込む。見本モードでなければ何もしない。
 * 失敗しても例外は投げない（アプリは空の見本として起動し、帯に失敗を出す）。
 */
export async function ensureDemoLoaded(
  provider: StorageProvider,
  opts: { base?: string; fetchFn?: typeof fetch } = {},
): Promise<DemoLoadState> {
  const id = getDemoId();
  if (!id) return state;
  const base = opts.base ?? import.meta.env.BASE_URL ?? "/";
  setState({ status: "loading" });
  try {
    const bundle = await fetchDemoBundle(demoBundleUrl(base, id), opts.fetchFn);
    const empty = await isProviderEmpty(provider);
    if (empty) {
      await loadBundleInto(provider, bundle);
    }
    const summary = {
      id: bundle.id,
      language: bundle.language,
      createdAt: bundle.createdAt,
      ...(bundle.generatedBy ? { generatedBy: bundle.generatedBy } : {}),
      ...(bundle.tour ? { tour: bundle.tour } : {}),
    };
    setState({ status: "ready", bundle: summary, fresh: empty });
  } catch (e) {
    console.error("[demo] bundle load failed", e);
    setState({ status: "error", message: e instanceof Error ? e.message : String(e) });
  }
  return state;
}

/** 見本の DB を捨てて読み直す（帯の「最初から」）。IndexedDB を消してからリロードする */
export async function resetDemo(dbName: string): Promise<void> {
  // 順路の進み具合も消す（最初の歩から）
  try {
    for (const k of Object.keys(sessionStorage)) if (k.startsWith("graphium-demo-tour:")) sessionStorage.removeItem(k);
  } catch {
    // 消せなくても DB の作り直しは続ける
  }
  await new Promise<void>((resolve) => {
    const req = indexedDB.deleteDatabase(dbName);
    req.onsuccess = () => resolve();
    req.onerror = () => resolve();
    req.onblocked = () => resolve();
  });
  location.reload();
}
