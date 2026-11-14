// 別ウィンドウが保存先からノートを読む口（ViewerWindow.tsx から分けてある。編集部品を
// 読み込まずにテストできるように）

import type { GraphiumDocument } from "../../lib/document-types";
import { getActiveProvider, probeServerProvider } from "../../lib/storage/registry";
import { loadSnapshot } from "../version-snapshots/snapshot-store";

// 保存先の準備は、このウィンドウで 1 度だけ行う。読み直しのたびに行うと、デスクトップ版では
// そのたびにノートの一覧を取り直す（init が list を呼ぶ）。失敗したら次の読み込みでやり直す
let providerReady: Promise<void> | null = null;
function ensureProviderReady(): Promise<void> {
  if (!providerReady) {
    providerReady = (async () => {
      // Web のサーバー保存は起動後に見つかる。先に確かめないと IndexedDB を読みに行く
      await probeServerProvider();
      await getActiveProvider().init();
    })().catch((e) => {
      providerReady = null;
      throw e;
    });
  }
  return providerReady;
}

/** テスト用: 保存先の準備をやり直させる */
export function resetViewerProviderForTest(): void {
  providerReady = null;
}

/** 保存先からノートを読む。ピーク（side-peek.tsx）と同じ振り分け */
export async function loadViewerDoc(id: string): Promise<GraphiumDocument> {
  await ensureProviderReady();
  const provider = getActiveProvider();
  if (id.startsWith("snapshot:")) {
    const doc = await loadSnapshot(provider, id.slice("snapshot:".length));
    if (!doc) throw new Error("snapshot not found");
    return doc;
  }
  if (id.startsWith("wiki:")) {
    if (!provider.loadWikiFile) throw new Error("wiki not supported");
    return provider.loadWikiFile(id.slice("wiki:".length));
  }
  if (id.startsWith("skill:")) {
    if (!provider.loadSkillFile) throw new Error("skill not supported");
    return provider.loadSkillFile(id.slice("skill:".length));
  }
  return provider.loadFile(id);
}

/** 描き直すかどうかの判定に使う、見た目に効く部分の写し */
export function viewerDocSignature(doc: GraphiumDocument): string {
  const page = doc.pages?.[0];
  return JSON.stringify([doc.title ?? "", page ?? null]);
}
