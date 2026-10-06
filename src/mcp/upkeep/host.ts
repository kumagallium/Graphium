// MCP 側の MaintenanceHost（recorder / undo が使う口）。
// 仕様: docs/internal/mcp-upkeep-stage3-spec-2026-10.md §3.1（host.ts）

import { randomUUID } from "node:crypto";

import type { MaintenanceHost } from "../../features/knowledge-maintenance/recorder";
import { readNote } from "../vault";
import { createFsMaintenanceStorage } from "./fs-storage";
import { getFlags, setFlag } from "./index-store";
import { saveWikiFileToVault } from "./save";

export type McpHostDeps = {
  now?: () => Date;
  newId?: () => string;
  sleep?: (ms: number) => Promise<void>;
};

export function createMcpMaintenanceHost(root: string, deps: McpHostDeps = {}): MaintenanceHost {
  const storage = createFsMaintenanceStorage(root);
  return {
    provider: () => storage,
    flushEditors: async () => {},
    loadWikiDocFresh: async (id) => readNote(id, root),
    getIndexFlags: (id) => getFlags(root, id),
    // 保存の例外はここで握って stderr に出し false を返す。isSaving が常に false なので、
    // recorder は MaintenanceSaveFailedError で即座に諦める（再試行しない）。原因は stderr で分かる
    saveWikiFile: async (wikiId, doc, options) => {
      try {
        return await saveWikiFileToVault(root, wikiId, doc, options);
      } catch (e) {
        process.stderr.write(`[graphium-mcp] wiki の保存に失敗: ${wikiId}: ${String(e)}\n`);
        return false;
      }
    },
    isSaving: () => false,
    trashWiki: (id) => setFlag(root, id, "deletedAt", new Date().toISOString()),
    archiveWiki: (id) => setFlag(root, id, "archivedAt", new Date().toISOString()),
    restoreWikiFlag: (id, flag) => setFlag(root, id, flag, null),
    now: deps.now ?? (() => new Date()),
    newId: deps.newId ?? randomUUID,
    sleep: deps.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms))),
  };
}
