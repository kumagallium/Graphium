// MCP 側の記録の書き手。外の AI が get_note / get_topic でページを開いたことを
// 保管庫の appdata に積む（形は features/ai-usage/usage-log.ts。アプリと同じ）。
//
// - ファイルはこのプロセス専用（キーにプロセスごとのセッション ID を入れる）。Claude Desktop と
//   Claude Code が同時に MCP を起動しても、互いのファイルを書き換えない
// - 書き込みは 1 本の列に並べ、一時ファイル → rename で原子的に置き換える
// - 失敗しても道具の応答は壊さない（stderr に 1 行残すだけ）

import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

import {
  appendUsageEvents,
  buildUsageEvents,
  newUsageSessionId,
  usageKey,
} from "../features/ai-usage/usage-log";
import { writeFileAtomic } from "./upkeep/atomic-write";
import { appDataDir, resolveGraphiumRoot, wikiDir } from "./vault";

export type McpUsageRecorder = {
  /** ページが読まれたことを記録する。待たなくてよい */
  recordRead(id: string, opts?: { kind?: "wiki" | "note"; at?: Date }): Promise<void>;
  /** このプロセスのセッション ID（テスト用） */
  readonly session: string;
};

export function createMcpUsageRecorder(opts: {
  getClientName?: () => string | undefined;
  root?: () => string;
  session?: string;
} = {}): McpUsageRecorder {
  const session = opts.session ?? newUsageSessionId();
  const rootOf = opts.root ?? (() => resolveGraphiumRoot());
  // MCP には「1 回の回答」の区切りが無いので、まとまりはプロセス単位にする。
  // 一緒に使われたかどうかは、集計側で時刻の近さで区切って判断する
  const group = `mcp-${session}`;
  let queue: Promise<void> = Promise.resolve();

  return {
    session,
    recordRead(id, o) {
      const root = rootOf();
      const at = o?.at ?? new Date();
      const kind = o?.kind ?? (existsSync(join(wikiDir(root), `${id}.json`)) ? "wiki" : "note");
      const run = async () => {
        const path = join(appDataDir(root), `${usageKey(at, "mcp", session)}.json`);
        let existing: unknown = null;
        try {
          existing = JSON.parse(await readFile(path, "utf8"));
        } catch {
          // 無い・壊れている → 作り直す
        }
        const next = appendUsageEvents(existing, buildUsageEvents([`${kind}:${id}`], "read", group, at), {
          writer: "mcp",
          session,
          client: opts.getClientName?.(),
        });
        await writeFileAtomic(path, JSON.stringify(next));
      };
      queue = queue.then(run).catch((e) => {
        process.stderr.write(`[graphium-mcp] 使われた記録を書けませんでした: ${String(e)}\n`);
      });
      return queue;
    },
  };
}
