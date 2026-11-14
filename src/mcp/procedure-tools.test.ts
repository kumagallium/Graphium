import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { INDEX_SCHEMA_VERSION } from "../features/navigation/index-file";
import { readTaskLedger } from "./knowledge-tasks";
import {
  INLINE_SOURCE_MAX_CHARS,
  pickProcedureNudge,
  startProcedureTask,
  submitProcedure,
} from "./procedure-tools";
import { resetMediaIndexCache } from "./sources";
import { resetSearchIndex } from "./search";
import { resetSourceTextCache } from "./source-text";

const ctx = { getClientName: () => "test-client" };
let root: string;

const p = (...s: string[]) => join(root, ...s);
const writeJson = (path: string, v: unknown) => writeFileSync(path, JSON.stringify(v));
const readJson = (path: string) => JSON.parse(readFileSync(path, "utf8"));
const taskIdOf = (reply: string) => reply.match(/taskId: (\S+)/)?.[1] ?? "";
const noteFiles = () => readdirSync(p("notes")).filter((f) => f.endsWith(".json"));

function para(id: string, text: string) {
  return { id, type: "paragraph", props: {}, content: [{ type: "text", text, styles: {} }], children: [] };
}

function noteDoc(title: string, body: string, extra: Record<string, unknown> = {}) {
  return {
    version: 2,
    title,
    source: "human",
    createdAt: "2026-01-01T00:00:00.000Z",
    modifiedAt: "2026-01-01T00:00:00.000Z",
    pages: [{ id: "main", title, blocks: [para("b1", body)], labels: {}, provLinks: [], knowledgeLinks: [] }],
    ...extra,
  };
}

const RECIPE =
  "強力粉 300 g とドライイースト 3 g を混ぜ、ぬるま湯 200 mL を加えて 10 分こねる。" +
  "生地を 28 ℃ で 60 分発酵させる。発酵した生地を丸めてオーブンで 200 ℃ 20 分焼く。";

/** 2 手順（こねる → 焼く）の手順 JSON。step2 は step1 の生地を使う */
function procedureOutput(opts: { headings?: [string, string]; title?: string } = {}) {
  const [h1, h2] = opts.headings ?? ["こねる", "焼く"];
  return JSON.stringify({
    title: opts.title ?? "パンの作り方",
    blocks: [
      { blockType: "heading", level: 2, role: "procedure", text: h1, stepId: "knead" },
      {
        blockType: "paragraph",
        content: [
          { text: "強力粉", role: "material" },
          { text: " と " },
          { text: "ぬるま湯", role: "material" },
          { text: " を " },
          { text: "時間: 10 分", role: "attribute", attachTo: "activity" },
          { text: " こねて " },
          { text: "生地", role: "output" },
          { text: " にする。" },
        ],
      },
      { blockType: "heading", level: 2, role: "procedure", text: h2, stepId: "bake" },
      {
        blockType: "paragraph",
        content: [
          { text: "生地", role: "material", derivedFrom: "knead" },
          { text: " を " },
          { text: "オーブン", role: "tool" },
          { text: " で焼いて " },
          { text: "パン", role: "output" },
          { text: " にする。" },
        ],
      },
    ],
  });
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "procedure-tools-"));
  for (const d of ["notes", "wiki", "appdata", "media"]) mkdirSync(p(d), { recursive: true });
  writeJson(p("appdata", "note-index.json"), { version: INDEX_SCHEMA_VERSION, updatedAt: "2026-09-01T00:00:00.000Z", notes: [] });
  writeJson(p("notes", "n1.json"), noteDoc("パンのメモ", RECIPE, { noteContexts: ["台所"] }));
  resetSearchIndex();
  resetMediaIndexCache();
  resetSourceTextCache();
});
afterEach(() => {
  resetSearchIndex();
  resetMediaIndexCache();
  rmSync(root, { recursive: true, force: true });
});

describe("start_procedure_task", () => {
  it("短い資料は本文を USER MESSAGE に載せ、アプリと同じ SYSTEM PROMPT を返し、台帳に控える", async () => {
    const reply = await startProcedureTask({ sourceId: "n1" }, ctx, root);
    const taskId = taskIdOf(reply);
    expect(taskId).not.toBe("");
    expect(reply).toContain("=== SYSTEM PROMPT ===");
    expect(reply).toContain("PROV-DM structural analyzer");
    expect(reply).toContain("強力粉 300 g");
    const task = readTaskLedger(root).tasks[taskId];
    expect(task.kind).toBe("procedure");
    expect(task.procedure?.sourceKind).toBe("note");
    expect(task.procedure?.sourceTitle).toBe("パンのメモ");
  });

  it("長い資料は本文を載せず、get_source_text で読むよう指示する", async () => {
    writeJson(p("notes", "long.json"), noteDoc("長い論文", "試料を加熱する。".repeat(Math.ceil(INLINE_SOURCE_MAX_CHARS / 8) + 10)));
    const reply = await startProcedureTask({ sourceId: "long" }, ctx, root);
    expect(reply).toContain('get_source_text({ sourceId: "long", window: 0 })');
    expect(reply).not.toContain("試料を加熱する。試料を加熱する。試料を加熱する。試料を加熱する。");
  });

  it("ナレッジのページ・知らない種類・短すぎる本文は断る", async () => {
    writeJson(p("notes", "w1.json"), { ...noteDoc("知見", RECIPE), wikiMeta: { kind: "claim" } });
    expect(await startProcedureTask({ sourceId: "w1" }, ctx, root)).toMatch(/^NOT_SUPPORTED/);
    expect(await startProcedureTask({ sourceId: "memo:abc" }, ctx, root)).toMatch(/^NOT_SUPPORTED/);
    expect(await startProcedureTask({ sourceId: "nope" }, ctx, root)).toMatch(/^NOT_FOUND/);
    writeJson(p("notes", "short.json"), noteDoc("短い", "混ぜる。"));
    expect(await startProcedureTask({ sourceId: "short" }, ctx, root)).toMatch(/^EMPTY_SOURCE/);
  });
});

describe("submit_procedure", () => {
  async function start(): Promise<string> {
    return taskIdOf(await startProcedureTask({ sourceId: "n1", folder: "実験/パン" }, ctx, root));
  }

  it("手順ノートを新しく作る（step と informed_by・元のノートへの @リンク・フォルダ・版の記録）", async () => {
    const taskId = await start();
    const before = noteFiles().length;
    const r = await submitProcedure({ taskId, output: procedureOutput(), model: "test-model" }, ctx, root);
    expect(r.message).toContain("手順ノートを作成しました");
    expect(r.message).toContain("手順 2 件");
    expect(noteFiles().length).toBe(before + 1);

    const saved = readJson(p("notes", `${r.noteId}.json`));
    expect(saved.title).toBe("パンの作り方");
    const page = saved.pages[0];
    // 手順の見出しは step ブロックになり、焼く → こねる の informed_by が張られる
    const steps = page.blocks.filter((b: { type: string }) => b.type === "step");
    expect(steps).toHaveLength(2);
    expect(page.provLinks.some((l: { type: string }) => l.type === "informed_by")).toBe(true);
    // 元のノートへの @リンク
    expect(page.knowledgeLinks.some((l: { targetNoteId: string }) => l.targetNoteId === "n1")).toBe(true);
    // 種類のフォルダ・指定のフォルダ
    expect(saved.noteContexts).toContain("実験/パン");
    expect(saved.noteContexts.length).toBeGreaterThanOrEqual(2);
    // 誰が書いたか・版の記録
    expect(saved.generatedBy.agent).toBe("graphium-mcp (test-client)");
    expect(saved.generatedBy.model).toBe("test-model");
    expect(saved.documentProvenance?.revisions?.length ?? 0).toBeGreaterThan(0);
    // 課題は完了
    expect(readTaskLedger(root).tasks[taskId].doneAt).toBeTruthy();
    expect((await submitProcedure({ taskId, output: procedureOutput() }, ctx, root)).message).toMatch(/^TASK_DONE/);
  });

  it("読めない JSON は断り、課題は残す", async () => {
    const taskId = await start();
    const r = await submitProcedure({ taskId, output: "これは JSON ではない" }, ctx, root);
    expect(r.message).toMatch(/^INVALID_OUTPUT/);
    expect(readTaskLedger(root).tasks[taskId].doneAt).toBeUndefined();
  });

  it("見出しが出力言語と違えば 1 回だけ直しを頼み、2 回目はそのまま保存する（アプリの再試行と同じ）", async () => {
    const taskId = await start();
    const english = procedureOutput({ headings: ["Kneading", "Baking"] });
    const first = await submitProcedure({ taskId, output: english }, ctx, root);
    expect(first.message).toMatch(/^NEEDS_REVISION/);
    expect(first.noteId).toBeUndefined();
    const second = await submitProcedure({ taskId, output: english }, ctx, root);
    expect(second.noteId).toBeTruthy();
  });

  it("知らない taskId は断る", async () => {
    expect((await submitProcedure({ taskId: "missing", output: procedureOutput() }, ctx, root)).message).toMatch(/^TASK_NOT_FOUND/);
  });
});

describe("pickProcedureNudge", () => {
  it("健全な出力には何も頼まない", () => {
    const blocks = JSON.parse(procedureOutput()).blocks;
    expect(pickProcedureNudge("ja", blocks)).toBeNull();
  });
});
