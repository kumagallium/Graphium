// MCP 側の wiki ページ保存（MaintenanceHost.saveWikiFile の fs 実装）。
// 仕様: docs/internal/mcp-upkeep-stage3-spec-2026-10.md §3.1（save.ts）
//
// - 版スナップショット（snapshotBeforeAiRewrite）は取らない。戻す手段は maint-copy と undo_operation
// - media-index.json の usedIn と埋め込み（意味検索）は更新しない（アプリで次に保存したときに追いつく）
// - 例外は throw する（host.ts の saveWikiFile が握って false を返す）

import { join } from "node:path";

import type { WikiSaveOptions } from "../../hooks/use-file-manager";
import type { GraphiumDocument } from "../../lib/document-types";
import { recordRevision } from "../../features/document-provenance/tracker";
import { resetSearchIndex } from "../search";
import { readNote, wikiDir } from "../vault";
import { writeFileAtomic } from "./atomic-write";
import { upsertEntry } from "./index-store";

/** wiki/<id>.json を書き、索引のエントリを作り直し、検索索引を捨てる。成功で true */
export async function saveWikiFileToVault(
  root: string,
  wikiId: string,
  doc: GraphiumDocument,
  options?: WikiSaveOptions,
): Promise<boolean> {
  let toWrite = doc;
  if (options?.activityType) {
    // 書く直前にディスクから読んだ内容を「前のページ」にする（save-answer.ts と同じ呼び方）
    const prevPage = readNote(wikiId, root)?.pages[0] ?? null;
    toWrite = await recordRevision(doc, prevPage, options.activityType, {
      agentLabel: options.agentLabel,
      force: true,
      sources: options.sources,
    });
  }
  await writeFileAtomic(join(wikiDir(root), `${wikiId}.json`), JSON.stringify(toWrite, null, 2));
  await upsertEntry(root, wikiId, toWrite);
  resetSearchIndex();
  return true;
}
