// 原子的なファイル書き込み（同じディレクトリの一時ファイルに書いて rename）。
// 仕様: docs/internal/mcp-upkeep-stage3-spec-2026-10.md §2.4
// 一時ファイルは `<名前>.tmp-<pid>`（.json で終わらないので notes/ wiki/ の走査・appdata の列挙に紛れない）。

import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";

/** Windows で他プロセスが掴んでいるときの rename の再試行 */
const RENAME_RETRY_MAX = 5;
const RENAME_RETRY_WAIT_MS = 50;

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** filePath に content を原子的に書く。失敗したら一時ファイルを消して throw する */
export async function writeFileAtomic(filePath: string, content: string): Promise<void> {
  const dir = dirname(filePath);
  await mkdir(dir, { recursive: true });
  const tmp = join(dir, `${basename(filePath)}.tmp-${process.pid}`);
  try {
    await writeFile(tmp, content, "utf8");
    for (let attempt = 0; ; attempt++) {
      try {
        await rename(tmp, filePath);
        return;
      } catch (e) {
        const code = (e as NodeJS.ErrnoException).code;
        if ((code === "EPERM" || code === "EBUSY") && attempt < RENAME_RETRY_MAX) {
          await sleep(RENAME_RETRY_WAIT_MS);
          continue;
        }
        throw e;
      }
    }
  } catch (e) {
    await rm(tmp, { force: true }).catch(() => undefined);
    throw e;
  }
}
