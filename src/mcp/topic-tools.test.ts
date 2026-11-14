import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { INDEX_SCHEMA_VERSION } from "../features/navigation/index-file";
import { readTaskLedger } from "./knowledge-tasks";
import { resetMediaIndexCache } from "./sources";
import { resetSearchIndex } from "./search";
import { resetSourceTextCache } from "./source-text";
import { getTopicWriteTask, startTopicTask, submitTopicPage, submitTopicRoutes } from "./topic-tools";
import { undoOperation } from "./upkeep/tools";

const ctx = { getClientName: () => "test-client" };
let root: string;

const p = (...s: string[]) => join(root, ...s);
const writeJson = (path: string, v: unknown) => writeFileSync(path, JSON.stringify(v));
const readJson = (path: string) => JSON.parse(readFileSync(path, "utf8"));
const taskIdOf = (reply: string) => reply.match(/taskId: (\S+)/)?.[1] ?? "";
const wikiFiles = () => readdirSync(p("wiki")).filter((f) => f.endsWith(".json"));

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

function schemaDoc() {
  const d = noteDoc("Knowledge Schema", "", { source: "skill" });
  return {
    ...d,
    skillMeta: { systemSkillId: "knowledge-schema", availableForIngest: false, language: "ja", createdAt: "2026-01-01T00:00:00.000Z" },
    pages: [
      {
        ...d.pages[0],
        blocks: [
          { id: "h", type: "heading", props: { level: 2 }, content: [{ type: "text", text: "Prompt Template", styles: {} }], children: [] },
          para("s1", "SCHEMA-BODY-MARK"),
        ],
      },
    ],
  };
}

/** 新形式のトピック（topicMarkdown を持つ）。本文は別の資料 other を引く */
function topicDoc(title: string, markdown: string, derivedFromNotes: string[]) {
  return {
    ...noteDoc(title, markdown, { source: "ai" }),
    wikiMeta: {
      kind: "topic",
      derivedFromNotes,
      derivedFromClaims: [],
      topicMarkdown: markdown,
      generatedBy: { model: "old", at: "2026-01-01T00:00:00.000Z" },
    },
  };
}

function wikiEntry(id: string, title: string, kind: "topic" | "answer" = "topic") {
  return {
    noteId: id,
    title,
    modifiedAt: "2026-09-01T00:00:00.000Z",
    createdAt: "2026-09-01T00:00:00.000Z",
    headings: [],
    labels: [],
    outgoingLinks: [],
    source: "ai",
    wikiKind: kind,
  };
}

const SOURCE_TEXT = "強力粉に水を加えてこねると、グルテンの網目ができて生地に弾力が出る。発酵温度は 28 ℃ が目安である。";
const OLD_BODY = "## 定義\n\nパン生地は粉と水を混ぜたものである。[[source:other]]\n";

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "topic-tools-"));
  for (const d of ["notes", "wiki", "appdata", "skills", "media"]) mkdirSync(p(d), { recursive: true });
  writeJson(p("skills", "knowledge-schema.json"), schemaDoc());
  writeJson(p("notes", "n1.json"), noteDoc("パン作りのメモ", SOURCE_TEXT));
  writeJson(p("notes", "other.json"), noteDoc("前のメモ", "パン生地は粉と水を混ぜたものである。"));
  writeJson(p("wiki", "t1.json"), topicDoc("パン生地", OLD_BODY, ["other"]));
  writeJson(p("appdata", "note-index.json"), {
    version: INDEX_SCHEMA_VERSION,
    updatedAt: "2026-09-01T00:00:00.000Z",
    notes: [wikiEntry("t1", "パン生地")],
  });
  resetSearchIndex();
  resetMediaIndexCache();
  resetSourceTextCache();
});
afterEach(() => {
  resetSearchIndex();
  resetMediaIndexCache();
  rmSync(root, { recursive: true, force: true });
});

async function routed(output: unknown): Promise<string> {
  const taskId = taskIdOf(await startTopicTask({ sourceId: "n1" }, ctx, root));
  expect(taskId).not.toBe("");
  const reply = await submitTopicRoutes({ taskId, output: JSON.stringify(output) }, root);
  return `${taskId}\n${reply}`;
}

describe("start_topic_task / submit_topic_routes", () => {
  it("振り分けの課題に既存のトピック一覧と資料を載せ、答えから書く件の一覧を作る", async () => {
    const start = await startTopicTask({ sourceId: "n1" }, ctx, root);
    expect(start).toContain("パン生地 (id: t1)");
    expect(start).toContain("グルテンの網目");
    expect(start).toContain("SCHEMA-BODY-MARK");
    const taskId = taskIdOf(start);

    const reply = await submitTopicRoutes(
      {
        taskId,
        output: JSON.stringify({ update: ["t1", "ghost"], create: [{ name: "グルテン", type: "concept" }, "パン生地"] }),
      },
      root,
    );
    // 幻覚の id は捨て、既存と同じ題の新規は改訂に回す
    expect(reply).toContain("w1: 改訂 「パン生地」");
    expect(reply).toContain("w2: 新規作成 「グルテン」");
    expect(reply).not.toContain("ghost");
    expect(reply).toContain("SYSTEM PROMPT（トピック用");
    const items = readTaskLedger(root).tasks[taskId].topics?.items ?? [];
    expect(items.map((i) => i.mode)).toEqual(["update", "create"]);
    expect(items[1].type).toBe("concept");
  });

  it("読めない振り分けは断り、課題は残す", async () => {
    const taskId = taskIdOf(await startTopicTask({ sourceId: "n1" }, ctx, root));
    expect(await submitTopicRoutes({ taskId, output: "not json" }, root)).toMatch(/^INVALID_OUTPUT/);
    expect(readTaskLedger(root).tasks[taskId].topics?.stage).toBe("route");
  });

  it("書く件が無ければ課題を完了にする", async () => {
    const [taskId, reply] = (await routed({ update: [], create: [] })).split("\n");
    expect(reply).toContain("ありませんでした");
    expect(readTaskLedger(root).tasks[taskId].doneAt).toBeTruthy();
  });

  it("ナレッジのページ自身は資料にしない", async () => {
    expect(await startTopicTask({ sourceId: "t1" }, ctx, root)).toMatch(/^NOT_SUPPORTED/);
  });
});

describe("get_topic_write_task / submit_topic_page", () => {
  it("新規作成: 本文を検査して保存し、資料を出典に持つトピックができる", async () => {
    const lines = (await routed({ update: [], create: ["グルテン"] })).split("\n");
    const taskId = lines[0];
    const write = await getTopicWriteTask({ taskId, ref: "w1" }, root);
    expect(write).toContain('## Topic title: "グルテン"');
    expect(write).toContain("(empty — this is the first source)");

    const before = wikiFiles().length;
    const body = "## 定義\n\nこねるとグルテンの網目ができる。[[source:n1|グルテンの網目ができて生地に弾力が出る]]\n";
    const reply = await submitTopicPage({ taskId, ref: "w1", output: JSON.stringify({ body }), model: "test-model" }, ctx, root);
    expect(reply).toContain("作成しました: 「グルテン」");
    expect(reply).toContain("operationId:");
    expect(reply).toContain("すべての件を提出しました");
    expect(wikiFiles().length).toBe(before + 1);
    const id = reply.match(/\(id: ([^)]+)\)/)?.[1] ?? "";
    const saved = readJson(p("wiki", `${id}.json`));
    expect(saved.wikiMeta.kind).toBe("topic");
    expect(saved.wikiMeta.derivedFromNotes).toEqual(["n1"]);
    expect(saved.generatedBy.agent).toBe("graphium-mcp (test-client)");
    expect(readTaskLedger(root).tasks[taskId].doneAt).toBeTruthy();
    // 索引に載り、1 件の操作として取り消せる（作ったページはゴミ箱へ）
    const index = readJson(p("appdata", "note-index.json"));
    expect(index.notes.some((n: { noteId: string }) => n.noteId === id)).toBe(true);
    const runId = reply.match(/runId: (\S+)/)?.[1] ?? "";
    const operationId = reply.match(/operationId: (\S+)/)?.[1] ?? "";
    expect(await undoOperation({ runId, operationId }, ctx, root)).toContain("取り消しました");
    const after = readJson(p("appdata", "note-index.json"));
    expect(after.notes.find((n: { noteId: string }) => n.noteId === id)?.deletedAt).toBeTruthy();
  });

  it("改訂も 1 件の操作として取り消せる（前の本文に戻る）", async () => {
    const taskId = (await routed({ update: ["t1"], create: [] })).split("\n")[0];
    const kept = "## 定義\n\nパン生地は粉と水を混ぜたものである。[[source:other]]\nこねると弾力が出る。[[source:n1]]\n";
    const reply = await submitTopicPage({ taskId, ref: "w1", output: JSON.stringify({ body: kept }) }, ctx, root);
    expect(reply).toContain("改訂しました");
    const runId = reply.match(/runId: (\S+)/)?.[1] ?? "";
    const operationId = reply.match(/operationId: (\S+)/)?.[1] ?? "";
    expect(await undoOperation({ runId, operationId }, ctx, root)).toContain("取り消しました");
    expect(readJson(p("wiki", "t1.json")).wikiMeta.topicMarkdown).toBe(OLD_BODY);
  });

  it("改訂で他の資料の文が消えたら 1 回だけ書き直しを頼み、残す文を USER MESSAGE に足す", async () => {
    const taskId = (await routed({ update: ["t1"], create: [] })).split("\n")[0];
    const dropping = "## 定義\n\nパン生地はこねると弾力が出る。[[source:n1]]\n";
    const first = await submitTopicPage({ taskId, ref: "w1", output: JSON.stringify({ body: dropping }) }, ctx, root);
    expect(first).toMatch(/^NEEDS_REVISION/);
    expect(readJson(p("wiki", "t1.json")).wikiMeta.topicMarkdown).toBe(OLD_BODY);
    const again = await getTopicWriteTask({ taskId, ref: "w1" }, root);
    expect(again).toContain("A new source never removes what a different source says");
    expect(again).toContain("[[source:other]]");

    const kept = "## 定義\n\nパン生地は粉と水を混ぜたものである。[[source:other]]\nこねると弾力が出る。[[source:n1]]\n";
    const second = await submitTopicPage({ taskId, ref: "w1", output: JSON.stringify({ body: kept }) }, ctx, root);
    expect(second).toContain("改訂しました: 「パン生地」");
    const saved = readJson(p("wiki", "t1.json"));
    expect(saved.wikiMeta.derivedFromNotes).toEqual(expect.arrayContaining(["other", "n1"]));
  });

  it("配ったあとにトピックが変わっていたら、その件は飛ばす", async () => {
    const taskId = (await routed({ update: ["t1"], create: [] })).split("\n")[0];
    writeJson(p("wiki", "t1.json"), topicDoc("パン生地", OLD_BODY + "\n手で直した。\n", ["other"]));
    const reply = await submitTopicPage({ taskId, ref: "w1", output: JSON.stringify({ body: OLD_BODY }) }, ctx, root);
    expect(reply).toMatch(/^TASK_STALE/);
    expect(readTaskLedger(root).tasks[taskId].topics?.items?.[0].status).toBe("skipped");
  });

  it("skip で書かない件を知らせられる・読めない本文は断る", async () => {
    const taskId = (await routed({ update: [], create: ["グルテン", "発酵"] })).split("\n")[0];
    expect(await submitTopicPage({ taskId, ref: "w1", output: "nope" }, ctx, root)).toMatch(/^INVALID_OUTPUT/);
    const skipped = await submitTopicPage({ taskId, ref: "w1", skip: true }, ctx, root);
    expect(skipped).toContain("書かないことにしました");
    expect(skipped).toContain("残り 1 件");
    expect(await submitTopicPage({ taskId, ref: "w1", skip: true }, ctx, root)).toMatch(/^ALREADY_SUBMITTED/);
    expect(await submitTopicPage({ taskId, ref: "w9", skip: true }, ctx, root)).toMatch(/^UNKNOWN_REF/);
  });

  it("振り分けの前に書く課題は受け取れない", async () => {
    const taskId = taskIdOf(await startTopicTask({ sourceId: "n1" }, ctx, root));
    expect(await getTopicWriteTask({ taskId, ref: "w1" }, root)).toMatch(/^NOT_ROUTED/);
  });
});
