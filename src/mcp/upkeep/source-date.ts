// set_source_date: 既存のノートに「資料の日付」（doc.sourceDate）を付ける・直す・外す。
//
// MCP は原則として既存のノートを書き換えない（create_note は新しいノートを足すだけ）。
// これはその例外で、手入れの道具（revise_topic などと同じ guard）に置く:
// - 変えるのは資料の日付（と、変えたことを示す modifiedAt・編集の記録）だけ。本文・題・フォルダは触らない
// - Graphium を終了してから使う（起動中は断る。開いているエディタの自動保存が書き戻すため）
// - ノートの編集の記録（documentProvenance）に "source_date_set" の版を 1 つ刻む（書いたのは外の AI）
// - 取り消しは、結果に出す「前の値」を同じ道具で渡し直す（無かったものは null）
// - 作成日時（createdAt）は変えない（来歴を偽らないため。資料の日付はそのために別に持つ）
//
// 対象は人のノート（notes/ 直下）だけ。ナレッジ層のページ（wiki/）は対象にしない。

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import type { GraphiumDocument } from "../../lib/document-types";
import { recordRevision } from "../../features/document-provenance/tracker";
import { normalizeStoredSourceDate, parseSourceDate } from "../../lib/source-date";
import { resetSearchIndex } from "../search";
import type { ToolContext } from "../tools";
import { notesDir, resolveGraphiumRoot } from "../vault";
import { agentLabelFor } from "./actor";
import { writeFileAtomic } from "./atomic-write";
import { upsertEntry } from "./index-store";
import { errMsg, stoppedIfRunning, withWriteGuard } from "./tools";

/** 1 回で付けられる件数の上限（取り込んだ資料をまとめて付けられる程度・応答が長くなりすぎない程度） */
export const SET_SOURCE_DATE_MAX_ITEMS = 500;

export type SetSourceDateInput = {
  items: { noteId: string; sourceDate: string | null }[];
  model?: string;
  sessionId?: string;
};

/** notes/<id>.json だけを読む（wiki/ は見ない） */
function readHumanNote(root: string, id: string): GraphiumDocument | null {
  if (!id || /[\\/]/.test(id) || id.includes("..")) return null;
  const path = join(notesDir(root), `${id}.json`);
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf8")) as GraphiumDocument;
  } catch {
    return null;
  }
}

export async function setSourceDate(input: SetSourceDateInput, ctx: ToolContext, root: string): Promise<string> {
  return withWriteGuard(root, async (lock) => {
    const items = input.items ?? [];
    if (items.length === 0) return "INVALID_ARGUMENT: items が空です。";
    if (items.length > SET_SOURCE_DATE_MAX_ITEMS) {
      return `INVALID_ARGUMENT: 1 回に渡せるのは ${SET_SOURCE_DATE_MAX_ITEMS} 件までです（${items.length} 件）。分けて呼んでください。`;
    }

    // ── 先に全件を確かめる（1 件でも問題があれば何も書かない） ──
    type Plan = { id: string; doc: GraphiumDocument; before?: string; after?: string };
    const plans: Plan[] = [];
    const problems: string[] = [];
    const seen = new Set<string>();
    for (const item of items) {
      const id = (item.noteId ?? "").trim();
      if (seen.has(id)) {
        problems.push(`同じ noteId が 2 回あります: ${id}`);
        continue;
      }
      seen.add(id);
      const doc = readHumanNote(root, id);
      if (!doc) {
        problems.push(`ノートが見つかりません（notes/ の人のノートだけが対象です）: ${id}`);
        continue;
      }
      let after: string | undefined;
      if (item.sourceDate === null || item.sourceDate.trim() === "") {
        after = undefined;
      } else {
        const parsed = parseSourceDate(item.sourceDate);
        if (!parsed) {
          problems.push(`「${doc.title}」(${id}) の sourceDate を日付として読めません: "${item.sourceDate}"`);
          continue;
        }
        after = parsed;
      }
      plans.push({ id, doc, before: normalizeStoredSourceDate(doc.sourceDate), after });
    }
    if (problems.length > 0) {
      return [
        "INVALID_ARGUMENT: 次の項目に問題があるため、どのノートも変えていません。",
        ...problems.map((p) => `  - ${p}`),
        "",
        "sourceDate は \"2012\" / \"2012-03\" / \"2012-03-15\" のように、分かっている桁まで書いてください（外すときは null）。",
      ].join("\n");
    }

    const targets = plans.filter((p) => p.before !== p.after);
    const unchanged = plans.filter((p) => p.before === p.after);
    if (targets.length === 0) {
      return `変える必要のあるノートはありませんでした（${unchanged.length} 件はすでに同じ資料の日付です）。`;
    }

    const agentLabel = agentLabelFor(ctx.getClientName?.());
    const done: Plan[] = [];
    try {
      for (const p of targets) {
        const s = await stoppedIfRunning(root);
        if (s) {
          return [
            s,
            `資料の日付を変えたのは ${done.length}/${targets.length} 件です。`,
            ...formatChanges(done),
          ].join("\n");
        }
        const next: GraphiumDocument = { ...p.doc, modifiedAt: new Date().toISOString() };
        if (p.after) next.sourceDate = p.after;
        else delete next.sourceDate;
        // 本文は変えないので差分は空。force で「資料の日付を設定」の版を刻む
        const recorded = await recordRevision(next, p.doc.pages[0] ?? null, "source_date_set", {
          agentLabel,
          force: true,
        });
        await writeFileAtomic(join(notesDir(root), `${p.id}.json`), JSON.stringify(recorded, null, 2));
        await upsertEntry(root, p.id, recorded);
        await lock.refresh();
        done.push(p);
      }
    } catch (e) {
      resetSearchIndex();
      return [
        `資料の日付の書き込みに失敗しました: ${errMsg(e)}`,
        `変えたのは ${done.length}/${targets.length} 件です。`,
        ...formatChanges(done),
      ].join("\n");
    }
    resetSearchIndex();
    return [
      `${done.length} 件のノートに資料の日付を付けました（作成日時は変えていません）。`,
      ...formatChanges(done),
      ...(unchanged.length > 0 ? [`すでに同じ値だったため変えなかった: ${unchanged.length} 件`] : []),
      "",
      "戻すには、同じ noteId に「前」の値（無かったものは null）を渡して set_source_date を呼び直してください。",
      "Graphium を次に起動すると一覧に反映されます。",
    ].join("\n");
  });
}

function formatChanges(plans: { id: string; doc: GraphiumDocument; before?: string; after?: string }[]): string[] {
  return plans.map(
    (p) => `  - 「${p.doc.title}」(${p.id}): 前 ${p.before ?? "なし"} → ${p.after ?? "なし（外した）"}`,
  );
}

/** set_source_date を登録する（index.ts から呼ぶ。upkeep/tools.ts と循環しないよう、ここで登録する） */
export function registerSourceDateTool(server: McpServer, ctx: ToolContext = {}): void {
  server.registerTool(
    "set_source_date",
    {
      title: "ノートに資料の日付を付ける",
      description:
        "既存のノートに「資料の日付」（その資料がいつのものか。論文の出版日・ブログの公開日・議事録の日付など）を" +
        "付ける・直す・外す。変えるのは資料の日付だけで、本文・題・フォルダ・作成日時は変えない。" +
        "あとから取り込んだ資料の日付が本文（出典の行など）に書いてあるときに、まとめて付けるのに使う。" +
        "Graphium を終了してから使う（起動中は断られる）。1 件でも読めない日付や見つからない noteId があれば、" +
        "どのノートも変えずに問題を返す。ノートの編集の記録に「資料の日付を設定」として残り、" +
        "結果に出る前の値を渡し直せば戻せる。新しく作るノートは create_note の sourceDate で付ける。",
      inputSchema: {
        items: z
          .array(
            z.object({
              noteId: z.string().describe("ノート ID（search_notes / list_folders などで分かる。notes/ の人のノートだけ）"),
              sourceDate: z
                .string()
                .nullable()
                .describe(
                  "資料の日付。分かっている桁まで書く: \"2012\" / \"2012-03\" / \"2012-03-15\"（\"2012年3月\" も読める）。" +
                    "日を知らないのに -01 で埋めない。外すときは null",
                ),
            }),
          )
          .min(1)
          .max(SET_SOURCE_DATE_MAX_ITEMS)
          .describe(`付けるノートと日付の組（1 回に ${SET_SOURCE_DATE_MAX_ITEMS} 件まで）`),
        model: z.string().optional().describe("書いた LLM のモデル ID（例: claude-opus-5）"),
        sessionId: z.string().optional().describe("呼び出し側のセッション識別子"),
      },
      // 既存ノートの資料の日付を書き換える（同じ値で呼んでも変わらない）
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
    },
    async (input) => {
      const body = await setSourceDate(input, ctx, resolveGraphiumRoot());
      return { content: [{ type: "text" as const, text: body }] };
    },
  );
}
