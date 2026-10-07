// MaintenanceStorageLike を満たす fs 実装（<root>/appdata/<key>.json）。
// 仕様: docs/internal/mcp-upkeep-stage3-spec-2026-10.md §3.1（fs-storage.ts）

import { existsSync, readFileSync } from "node:fs";
import { readdir, unlink } from "node:fs/promises";
import { join } from "node:path";

import type { MaintenanceStorageLike } from "../../features/knowledge-maintenance/types";
import { assertValidAppDataKey } from "../../lib/storage/app-data-key";
import { writeFileAtomic } from "./atomic-write";
import { appDataDir } from "../vault";

/** root 配下の appdata を読み書きする口を作る。キーは app-data-key の規則で検証する */
export function createFsMaintenanceStorage(root: string): Required<MaintenanceStorageLike> {
  const dir = appDataDir(root);
  const pathOf = (key: string) => join(dir, `${assertValidAppDataKey(key)}.json`);
  return {
    async readAppData(key) {
      const path = pathOf(key);
      if (!existsSync(path)) return null;
      try {
        return JSON.parse(readFileSync(path, "utf8")) as unknown;
      } catch (e) {
        process.stderr.write(`[graphium-mcp] appdata を読めません（壊れています）: ${key}: ${String(e)}\n`);
        return null;
      }
    },
    async writeAppData(key, data) {
      await writeFileAtomic(pathOf(key), JSON.stringify(data));
    },
    async listAppDataKeys(prefix) {
      assertValidAppDataKey(prefix, "prefix");
      let names: string[];
      try {
        names = await readdir(dir);
      } catch {
        return [];
      }
      return names
        .filter((n) => n.startsWith(prefix) && n.endsWith(".json") && !n.includes(".tmp-"))
        .map((n) => n.slice(0, -".json".length));
    },
    async deleteAppData(key) {
      try {
        await unlink(pathOf(key));
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
      }
    },
  };
}
