// MCP 起動時の片付け: 原子的な書き込みの途中で落ちたときに残る `*.tmp-*` を消す。
// 仕様: docs/internal/mcp-upkeep-stage3-spec-2026-10.md §2.4

import { readdir, rm } from "node:fs/promises";
import { join } from "node:path";

const DIRS = ["appdata", "wiki", "notes"];

/** `<root>/{appdata,wiki,notes}` の `*.tmp-*` を消し、消した件数を返す（失敗は stderr にだけ出す） */
export async function cleanupTempFiles(root: string): Promise<number> {
  let removed = 0;
  for (const d of DIRS) {
    const dir = join(root, d);
    let names: string[];
    try {
      names = await readdir(dir);
    } catch {
      continue; // 無いディレクトリは無視
    }
    for (const name of names) {
      if (!/\.tmp-[^/\\]*$/.test(name)) continue;
      try {
        await rm(join(dir, name), { force: true });
        removed++;
      } catch (e) {
        process.stderr.write(`[graphium-mcp] 一時ファイルを消せませんでした: ${join(dir, name)} (${String(e)})\n`);
      }
    }
  }
  return removed;
}
