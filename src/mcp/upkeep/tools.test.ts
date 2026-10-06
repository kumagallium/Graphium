import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { INDEX_SCHEMA_VERSION } from "../../features/navigation/index-file";
import { resetSearchIndex } from "../search";
import {
  archivePage,
  listOperations,
  mergeTopics,
  restorePage,
  reviseTopic,
  undoOperation,
} from "./tools";

const NOTE = "note-aaaa";
const ctx = { getClientName: () => "test-client" };
let root: string;

const p = (...s: string[]) => join(root, ...s);
const readJson = (path: string) => JSON.parse(readFileSync(path, "utf8"));
const readIndex = () => readJson(p("appdata", "note-index.json"));
const entryOf = (id: string) => readIndex().notes.find((n: { noteId: string }) => n.noteId === id);
const wikiBody = (id: string): string => readJson(p("wiki", `${id}.json`)).wikiMeta.topicMarkdown;

function topicDoc(title: string, md: string, kind = "topic", newFormat = true) {
  return {
    version: 2,
    title,
    source: "ai",
    createdAt: "2026-09-01T00:00:00.000Z",
    modifiedAt: "2026-09-01T00:00:00.000Z",
    pages: [
      {
        id: "main",
        title,
        blocks: [{ id: "b1", type: "paragraph", props: {}, content: [{ type: "text", text: md, styles: {} }], children: [] }],
        labels: {},
        provLinks: [],
        knowledgeLinks: [],
      },
    ],
    wikiMeta: {
      kind,
      derivedFromNotes: [NOTE],
      derivedFromClaims: [],
      ...(newFormat ? { topicMarkdown: md } : {}),
    },
  };
}

function entry(id: string, title: string) {
  return {
    noteId: id,
    title,
    modifiedAt: "2026-09-01T00:00:00.000Z",
    createdAt: "2026-09-01T00:00:00.000Z",
    headings: [],
    labels: [],
    outgoingLinks: [],
    source: "ai",
    wikiKind: "topic",
  };
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "upkeep-tools-"));
  for (const d of ["notes", "wiki", "appdata"]) mkdirSync(p(d), { recursive: true });
  writeFileSync(
    p("notes", `${NOTE}.json`),
    JSON.stringify({
      version: 2,
      title: "資料ノート",
      pages: [{ id: "main", title: "資料ノート", blocks: [], labels: {}, provLinks: [], knowledgeLinks: [] }],
      source: "human",
      modifiedAt: "2026-01-01T00:00:00.000Z",
    }),
  );
  writeFileSync(p("wiki", "t1.json"), JSON.stringify(topicDoc("トピック1", "元の本文1")));
  writeFileSync(p("wiki", "t2.json"), JSON.stringify(topicDoc("トピック2", "元の本文2")));
  writeFileSync(p("wiki", "old.json"), JSON.stringify(topicDoc("旧形式", "旧", "topic", false)));
  writeFileSync(
    p("appdata", "note-index.json"),
    JSON.stringify({
      version: INDEX_SCHEMA_VERSION,
      updatedAt: "2026-09-01T00:00:00.000Z",
      notes: [entry("t1", "トピック1"), entry("t2", "トピック2")],
    }),
  );
  resetSearchIndex();
});
afterEach(() => {
  resetSearchIndex();
  rmSync(root, { recursive: true, force: true });
});

const ids = (reply: string) => ({
  runId: reply.match(/runId: (maint-run-\S+)/)?.[1] ?? "",
  operationId: reply.match(/operationId: (\S+)/)?.[1] ?? "",
});

describe("revise_topic と undo_operation", () => {
  it("書き直すとファイル・索引・記録が変わり、取り消すと戻る", async () => {
    const reply = await reviseTopic(
      { topicId: "t1", body: `新しい本文です [[source:${NOTE}]]`, model: "m1" },
      ctx,
      root,
    );
    expect(reply).toContain("書き直しました");
    expect(wikiBody("t1")).toContain("新しい本文です");
    expect(readJson(p("wiki", "t1.json")).generatedBy.agent).toBe("graphium-mcp (test-client)");

    const listed = await listOperations({}, ctx, root);
    expect(listed).toContain("取り消せます");
    expect(listed).toContain("MCP (test-client)");

    const { runId, operationId } = ids(reply);
    const undone = await undoOperation({ runId, operationId }, ctx, root);
    expect(undone).toContain("取り消しました");
    expect(wikiBody("t1")).toBe("元の本文1");
    expect(await listOperations({}, ctx, root)).toContain("取り消し済み");
  });

  it("引用が無いと注意を添える", async () => {
    const reply = await reviseTopic({ topicId: "t1", body: "引用なし" }, ctx, root);
    expect(reply).toContain("出典照合の対象になりません");
  });

  it("UNKNOWN_SOURCE / OLD_FORMAT / NOT_FOUND / NOT_KNOWLEDGE_PAGE", async () => {
    expect(await reviseTopic({ topicId: "t1", body: "x", sources: ["no-such"] }, ctx, root)).toMatch(
      /^UNKNOWN_SOURCE: no-such/,
    );
    expect(await reviseTopic({ topicId: "old", body: "x" }, ctx, root)).toMatch(/^OLD_FORMAT/);
    expect(await reviseTopic({ topicId: "zzz", body: "x" }, ctx, root)).toMatch(/^NOT_FOUND/);
    writeFileSync(p("wiki", "c1.json"), JSON.stringify(topicDoc("知見", "c", "claim")));
    expect(await reviseTopic({ topicId: "c1", body: "x" }, ctx, root)).toMatch(/^NOT_KNOWLEDGE_PAGE/);
  });

  it("索引が無ければ NO_INDEX", async () => {
    rmSync(p("appdata", "note-index.json"));
    expect(await reviseTopic({ topicId: "t1", body: "x" }, ctx, root)).toMatch(/^NO_INDEX/);
  });
});

describe("起動中の判定", () => {
  const beat = (ageMs: number) =>
    writeFileSync(
      p("appdata", "app-heartbeat.json"),
      JSON.stringify({ via: "web", at: new Date(Date.now() - ageMs).toISOString() }),
    );

  it("新しいハートビートがあれば APP_RUNNING、古ければ通る", async () => {
    beat(0);
    expect(await reviseTopic({ topicId: "t1", body: "x" }, ctx, root)).toMatch(/^APP_RUNNING/);
    expect(wikiBody("t1")).toBe("元の本文1");
    beat(120_000);
    expect(await reviseTopic({ topicId: "t1", body: "x" }, ctx, root)).toContain("書き直しました");
  });
});

describe("merge_topics", () => {
  it("吸収側に deletedAt が付き、取り消すと戻る", async () => {
    const reply = await mergeTopics(
      { keepId: "t1", absorbIds: ["t2"], body: `統合後 [[source:${NOTE}]]` },
      ctx,
      root,
    );
    expect(reply).toContain("統合しました");
    expect(wikiBody("t1")).toContain("統合後");
    expect(entryOf("t2").deletedAt).toBeTruthy();

    const { runId, operationId } = ids(reply);
    expect(await undoOperation({ runId, operationId }, ctx, root)).toContain("取り消しました");
    expect(entryOf("t2").deletedAt).toBeUndefined();
    expect(wikiBody("t1")).toBe("元の本文1");
  });

  it("検査: 自分自身・旧形式・answer", async () => {
    expect(await mergeTopics({ keepId: "t1", absorbIds: ["t1"], body: "x" }, ctx, root)).toMatch(/^INVALID_ARGUMENT/);
    expect(await mergeTopics({ keepId: "t1", absorbIds: ["old"], body: "x" }, ctx, root)).toMatch(/^OLD_FORMAT/);
    writeFileSync(p("wiki", "a1.json"), JSON.stringify(topicDoc("問答", "a", "answer")));
    expect(await mergeTopics({ keepId: "t1", absorbIds: ["a1"], body: "x" }, ctx, root)).toMatch(
      /^NOT_KNOWLEDGE_PAGE/,
    );
  });
});

describe("archive_page / restore_page", () => {
  it("索引に無い wiki ページをアーカイブするとエントリが挿入されフラグが立つ", async () => {
    writeFileSync(p("wiki", "u1.json"), JSON.stringify(topicDoc("未掲載", "未掲載の本文")));
    expect(entryOf("u1")).toBeUndefined();
    const reply = await archivePage({ pageIds: ["u1"] }, ctx, root);
    expect(reply).toContain("アーカイブしました");
    expect(entryOf("u1").archivedAt).toBeTruthy();
    expect(readIndex().version).toBe(INDEX_SCHEMA_VERSION);
  });

  it("アーカイブ → restore_page で戻る。フラグが無ければ NOT_FLAGGED", async () => {
    await archivePage({ pageIds: ["t1"] }, ctx, root);
    expect(entryOf("t1").archivedAt).toBeTruthy();
    expect(await restorePage({ pageId: "t1" }, ctx, root)).toContain("戻しました");
    expect(entryOf("t1").archivedAt).toBeUndefined();
    expect(await restorePage({ pageId: "t1" }, ctx, root)).toMatch(/^NOT_FLAGGED/);
  });

  it("topic / answer 以外は NOT_KNOWLEDGE_PAGE", async () => {
    writeFileSync(p("wiki", "c1.json"), JSON.stringify(topicDoc("知見", "c", "claim")));
    expect(await archivePage({ pageIds: ["c1"] }, ctx, root)).toMatch(/^NOT_KNOWLEDGE_PAGE/);
  });
});

describe("list_operations", () => {
  it("記録が無ければその旨を返す", async () => {
    expect(await listOperations({}, ctx, root)).toContain("まだありません");
  });
});

describe("undo_operation の見積もり", () => {
  it("操作のあとにページが書き換えられていると confirm を求め、confirm: true で実行する", async () => {
    const reply = await reviseTopic({ topicId: "t1", body: `A [[source:${NOTE}]]` }, ctx, root);
    const { runId, operationId } = ids(reply);
    // 操作のあとに別の経路で書き換える（編集の記録に残らない変更）
    const doc = readJson(p("wiki", "t1.json"));
    doc.pages[0].blocks[0].content[0].text = "あとから直した";
    doc.wikiMeta.topicMarkdown = "あとから直した";
    doc.modifiedAt = new Date(Date.now() + 60_000).toISOString();
    writeFileSync(p("wiki", "t1.json"), JSON.stringify(doc));

    const estimate = await undoOperation({ runId, operationId }, ctx, root);
    expect(estimate).toContain("confirm: true");
    expect(wikiBody("t1")).toBe("あとから直した");

    const done = await undoOperation({ runId, operationId, confirm: true }, ctx, root);
    expect(done).toContain("取り消しました");
    expect(wikiBody("t1")).toBe("元の本文1");
  });

  it("形の合わない runId は NOT_FOUND", async () => {
    expect(await undoOperation({ runId: "x", operationId: "y" }, ctx, root)).toMatch(/^NOT_FOUND/);
  });
});
