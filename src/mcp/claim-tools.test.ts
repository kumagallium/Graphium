import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// 新規ページの保存だけを失敗させるスイッチ（タイトルで指定。failAfterWrite は書いてから落ちる）
const saveCtl = vi.hoisted(() => ({ failTitles: new Set<string>(), failAfterWrite: false }));
vi.mock("./upkeep/save", async (importActual) => {
  const actual = await importActual<typeof import("./upkeep/save")>();
  return {
    ...actual,
    saveWikiFileToVault: async (...args: Parameters<typeof actual.saveWikiFileToVault>) => {
      const doc = args[2];
      if (saveCtl.failTitles.has(doc.title)) {
        if (saveCtl.failAfterWrite) await actual.saveWikiFileToVault(...args);
        throw new Error("disk full");
      }
      return actual.saveWikiFileToVault(...args);
    },
  };
});

import { INDEX_SCHEMA_VERSION } from "../features/navigation/index-file";
import { protectEditedSections, startClaimTask, submitClaims, submitRewrite } from "./claim-tools";
import { tasksLedgerPath } from "./knowledge-tasks";
import { resetSearchIndex } from "./search";
import { listOperations, undoOperation } from "./upkeep/tools";

const NOTE_A = "note-aaaa";
const NOTE_B = "note-bbbb";
const ctx = { getClientName: () => "test-client" };
let root: string;

const p = (...s: string[]) => join(root, ...s);
const readJson = (path: string) => JSON.parse(readFileSync(path, "utf8"));
const writeJson = (path: string, v: unknown) => writeFileSync(path, JSON.stringify(v));
const readIndex = () => readJson(p("appdata", "note-index.json"));
const entryOf = (id: string) => readIndex().notes.find((n: { noteId: string }) => n.noteId === id);
const entryIdByTitle = (title: string): string =>
  readIndex().notes.find((n: { title: string }) => n.title === title)?.noteId ?? "";
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
    pages: [{ id: "main", title, blocks: body ? [para("b1", body)] : [], labels: {}, provLinks: [], knowledgeLinks: [] }],
    ...extra,
  };
}

function claimEntry(id: string, title: string, extra: Record<string, unknown> = {}) {
  return {
    noteId: id,
    title,
    modifiedAt: "2026-09-01T00:00:00.000Z",
    createdAt: "2026-09-01T00:00:00.000Z",
    headings: [],
    labels: [],
    outgoingLinks: [],
    source: "ai",
    wikiKind: "claim",
    ...extra,
  };
}

function schemaDoc() {
  return {
    version: 2,
    title: "Knowledge Schema",
    source: "skill",
    createdAt: "2026-01-01T00:00:00.000Z",
    modifiedAt: "2026-01-01T00:00:00.000Z",
    skillMeta: { systemSkillId: "knowledge-schema", availableForIngest: false, language: "ja", createdAt: "2026-01-01T00:00:00.000Z" },
    pages: [
      {
        id: "main",
        title: "Knowledge Schema",
        blocks: [
          { id: "h", type: "heading", props: { level: 2 }, content: [{ type: "text", text: "Prompt Template", styles: {} }], children: [] },
          para("s1", "SCHEMA-BODY-MARK"),
        ],
        labels: {},
        provLinks: [],
        knowledgeLinks: [],
      },
    ],
  };
}

function voiceDoc() {
  const d = schemaDoc();
  return {
    ...d,
    title: "My Voice",
    skillMeta: { availableForIngest: true, language: "ja", createdAt: "2026-01-01T00:00:00.000Z" },
    pages: [
      {
        ...d.pages[0],
        blocks: [d.pages[0].blocks[0], para("v1", "VOICE-BODY-MARK")],
      },
    ],
  };
}

/** ingester の答え。sections の見出しは H2 になる */
function claimOutput(title: string, extra: Record<string, unknown> = {}) {
  return JSON.stringify({
    wikis: [
      {
        kind: "claim",
        title,
        sections: [{ heading: "概要", content: `${title}という知見。` }],
        suggestedAction: "create",
        confidence: 0.9,
        level: "finding",
        relatedClaims: [],
        externalReferences: [],
        ...extra,
      },
    ],
  });
}

const taskIdOf = (reply: string) => reply.match(/taskId: (\S+)/)?.[1] ?? "";
const rewriteTaskIdOf = (reply: string) => reply.match(/submit_rewrite\(\{ taskId: "([^"]+)"/)?.[1] ?? "";
const opIds = (reply: string) => ({
  runId: reply.match(/runId: (maint-run-\S+)/)?.[1] ?? "",
  operationId: reply.match(/operationId: (\S+)/)?.[1] ?? "",
});
const createdId = (reply: string) => reply.match(/作成: 「[^」]*」 \(id: ([^)]+)\)/)?.[1] ?? "";

function writeFlags(claims: boolean) {
  writeJson(p("appdata", "feature-flags.json"), { claims, insights: false, updatedAt: "2026-10-26T00:00:00.000Z" });
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "claim-tools-"));
  for (const d of ["notes", "wiki", "appdata", "skills"]) mkdirSync(p(d), { recursive: true });
  writeJson(p("notes", `${NOTE_A}.json`), noteDoc("ノートA", "焼きなましで粒径が大きくなる。"));
  writeJson(p("notes", `${NOTE_B}.json`), noteDoc("ノートB", "粒径は焼きなまし温度で決まった。"));
  writeJson(p("skills", "knowledge-schema.json"), schemaDoc());
  writeJson(p("skills", "voice-1.json"), voiceDoc());
  writeJson(p("appdata", "note-index.json"), {
    version: INDEX_SCHEMA_VERSION,
    updatedAt: "2026-09-01T00:00:00.000Z",
    notes: [],
  });
  writeFlags(true);
  resetSearchIndex();
});
afterEach(() => {
  saveCtl.failTitles.clear();
  saveCtl.failAfterWrite = false;
  resetSearchIndex();
  rmSync(root, { recursive: true, force: true });
});

describe("start_claim_task の拒否", () => {
  it("設定の写しが無ければ SETTINGS_UNKNOWN、OFF なら CLAIMS_DISABLED", async () => {
    rmSync(p("appdata", "feature-flags.json"));
    expect(await startClaimTask({ noteId: NOTE_A }, ctx, root)).toMatch(/^SETTINGS_UNKNOWN:/);
    writeFlags(false);
    expect(await startClaimTask({ noteId: NOTE_A }, ctx, root)).toMatch(/^CLAIMS_DISABLED:/);
  });

  it("壊れた写しも不明として断る", async () => {
    writeFileSync(p("appdata", "feature-flags.json"), "{broken");
    expect(await startClaimTask({ noteId: NOTE_A }, ctx, root)).toMatch(/^SETTINGS_UNKNOWN:/);
  });

  it("索引が無ければ NO_INDEX", async () => {
    rmSync(p("appdata", "note-index.json"));
    expect(await startClaimTask({ noteId: NOTE_A }, ctx, root)).toMatch(/^NO_INDEX:/);
  });

  it("NOT_FOUND / NOT_A_NOTE / EMPTY_NOTE", async () => {
    expect(await startClaimTask({ noteId: "zzz" }, ctx, root)).toMatch(/^NOT_FOUND:/);
    // AI 派生ノート（notes/ にあっても source: ai）
    writeJson(p("notes", "ai-note.json"), noteDoc("AI ノート", "本文", { source: "ai" }));
    expect(await startClaimTask({ noteId: "ai-note" }, ctx, root)).toMatch(/^NOT_A_NOTE:/);
    // ナレッジのページ（wiki/）
    writeJson(p("wiki", "w1.json"), noteDoc("知見", "本文", { source: "ai" }));
    expect(await startClaimTask({ noteId: "w1" }, ctx, root)).toMatch(/^NOT_A_NOTE:/);
    // 素材・メモ
    expect(await startClaimTask({ noteId: "pdf:abc" }, ctx, root)).toMatch(/^NOT_A_NOTE:/);
    expect(await startClaimTask({ noteId: "memo:abc" }, ctx, root)).toMatch(/^NOT_A_NOTE:/);
    // 空のノート
    writeJson(p("notes", "empty.json"), noteDoc("空", ""));
    expect(await startClaimTask({ noteId: "empty" }, ctx, root)).toMatch(/^EMPTY_NOTE:/);
    writeJson(p("notes", "blank.json"), noteDoc("空白", "​  "));
    expect(await startClaimTask({ noteId: "blank" }, ctx, root)).toMatch(/^EMPTY_NOTE:/);
  });

  it("NO_SCHEMA", async () => {
    rmSync(p("skills", "knowledge-schema.json"));
    expect(await startClaimTask({ noteId: NOTE_A }, ctx, root)).toMatch(/^NO_SCHEMA:/);
  });

  it("起動中は課題を作らず APP_RUNNING", async () => {
    writeJson(p("appdata", "app-heartbeat.json"), { via: "web", at: new Date().toISOString() });
    expect(await startClaimTask({ noteId: NOTE_A }, ctx, root)).toMatch(/^APP_RUNNING:/);
    expect(() => readFileSync(tasksLedgerPath(root))).toThrow();
  });
});

describe("start_claim_task の課題", () => {
  it("規約・Skill・本文・既存の知見一覧（有効なものだけ）を含み、台帳に控える", async () => {
    writeJson(p("wiki", "k1.json"), noteDoc("既存の知見1", "x", { source: "ai" }));
    writeJson(p("appdata", "note-index.json"), {
      version: INDEX_SCHEMA_VERSION,
      updatedAt: "2026-09-01T00:00:00.000Z",
      notes: [
        claimEntry("k1", "既存の知見1"),
        claimEntry("k2", "ゴミ箱の知見", { deletedAt: "2026-09-02T00:00:00.000Z" }),
        claimEntry("k3", "アーカイブの知見", { archivedAt: "2026-09-02T00:00:00.000Z" }),
        { ...claimEntry("t1", "トピック"), wikiKind: "topic" },
      ],
    });
    const reply = await startClaimTask({ noteId: NOTE_A }, ctx, root);
    expect(reply).toContain("SCHEMA-BODY-MARK");
    expect(reply).toContain("VOICE-BODY-MARK");
    expect(reply).toContain("焼きなましで粒径が大きくなる");
    expect(reply).toContain("c1: 既存の知見1");
    expect(reply).not.toContain("ゴミ箱の知見");
    expect(reply).not.toContain("アーカイブの知見");
    expect(reply).not.toContain("c2:");
    expect(reply).toContain("submit_claims");

    const ledger = readJson(tasksLedgerPath(root));
    const task = ledger.tasks[taskIdOf(reply)];
    expect(task.kind).toBe("claims");
    expect(task.noteId).toBe(NOTE_A);
    expect(task.existingIndex.refToId).toEqual({ c1: "k1" });
    expect(task.client).toBe("test-client");
    expect(task.skillsUsed).toEqual(["My Voice"]);
  });

  it("壊れた台帳は黙って空にせず専用の断りを返す", async () => {
    writeFileSync(tasksLedgerPath(root), "{broken");
    expect(await startClaimTask({ noteId: NOTE_A }, ctx, root)).toMatch(/^LEDGER_CORRUPT:/);
    expect(readFileSync(tasksLedgerPath(root), "utf8")).toBe("{broken");
  });
});

describe("submit_claims", () => {
  it("課題 → 提出 → wiki ファイル・索引・操作の記録・来歴", async () => {
    const taskId = taskIdOf(await startClaimTask({ noteId: NOTE_A }, ctx, root));
    const reply = await submitClaims(
      { taskId, output: claimOutput("焼きなましは粒径を決める"), model: "claude-x", sessionId: "s1" },
      ctx,
      root,
    );
    expect(reply).toContain("知見を 1 件保存しました");
    expect(reply).toContain("omittedExistingClaims: 0");

    const id = createdId(reply);
    expect(id).toBeTruthy();
    expect(wikiFiles()).toEqual([`${id}.json`]);
    const doc = readJson(p("wiki", `${id}.json`));
    expect(doc.wikiMeta.kind).toBe("claim");
    expect(doc.wikiMeta.status).toBe("candidate");
    // 来歴は配ったときの noteId だけ
    expect(doc.wikiMeta.derivedFromNotes).toEqual([NOTE_A]);
    expect(doc.wikiMeta.generatedBy.model).toBe("claude-x");
    expect(doc.wikiMeta.skillsUsed).toEqual(["My Voice"]);
    expect(doc.generatedBy.agent).toBe("graphium-mcp (test-client)");
    expect(doc.generatedBy.sessionId).toBe("s1");
    expect(JSON.stringify(doc.documentProvenance)).toContain("wiki_ingest");
    expect(JSON.stringify(doc.documentProvenance)).toContain("graphium-mcp (test-client)");

    // 索引
    expect(entryOf(id)).toMatchObject({ source: "ai", wikiKind: "claim", title: "焼きなましは粒径を決める" });

    // 操作の記録
    const listed = await listOperations({}, ctx, root);
    expect(listed).toContain("MCP で知見を作成（1 件）");
    expect(listed).toContain("MCP (test-client)");
    const run = readJson(p("appdata", opIds(reply).runId + ".json"));
    expect(run.trigger).toBe("mcp_generate");
    expect(run.operations[0].kind).toBe("mcp_generate");
    expect(run.operations[0].created).toEqual([
      { wikiId: id, title: "焼きなましは粒径を決める", baseline: { derivedCount: 1 } },
    ]);

    // 課題は使い切り
    expect(await submitClaims({ taskId, output: claimOutput("もう一つ") }, ctx, root)).toMatch(/^TASK_DONE:/);
    expect(wikiFiles()).toHaveLength(1);
  });

  it("TASK_NOT_FOUND / TASK_EXPIRED / TASK_STALE", async () => {
    expect(await submitClaims({ taskId: "nope", output: "{}" }, ctx, root)).toMatch(/^TASK_NOT_FOUND:/);

    const taskId = taskIdOf(await startClaimTask({ noteId: NOTE_A }, ctx, root));
    const ledger = readJson(tasksLedgerPath(root));
    ledger.tasks[taskId].createdAt = new Date(Date.now() - 25 * 3600 * 1000).toISOString();
    writeJson(tasksLedgerPath(root), ledger);
    expect(await submitClaims({ taskId, output: claimOutput("x") }, ctx, root)).toMatch(/^TASK_EXPIRED:/);

    const t2 = taskIdOf(await startClaimTask({ noteId: NOTE_B }, ctx, root));
    writeJson(p("notes", `${NOTE_B}.json`), noteDoc("ノートB", "あとから書き換えた本文。"));
    expect(await submitClaims({ taskId: t2, output: claimOutput("x") }, ctx, root)).toMatch(/^TASK_STALE:/);
    expect(wikiFiles()).toHaveLength(0);
  });

  it("提出時にも設定と起動中を確かめる", async () => {
    const taskId = taskIdOf(await startClaimTask({ noteId: NOTE_A }, ctx, root));
    writeFlags(false);
    expect(await submitClaims({ taskId, output: claimOutput("x") }, ctx, root)).toMatch(/^CLAIMS_DISABLED:/);
    writeFlags(true);
    writeJson(p("appdata", "app-heartbeat.json"), { via: "web", at: new Date().toISOString() });
    expect(await submitClaims({ taskId, output: claimOutput("x") }, ctx, root)).toMatch(/^APP_RUNNING:/);
    expect(wikiFiles()).toHaveLength(0);
  });

  it("読めない出力は INVALID_OUTPUT で、課題は消費しない。{\"wikis\":[]} は 0 件で完了", async () => {
    const taskId = taskIdOf(await startClaimTask({ noteId: NOTE_A }, ctx, root));
    expect(await submitClaims({ taskId, output: "知見はありません" }, ctx, root)).toMatch(/^INVALID_OUTPUT:/);
    expect(await submitClaims({ taskId, output: JSON.stringify({ wikis: [{ kind: "claim" }] }) }, ctx, root)).toMatch(
      /^INVALID_OUTPUT:/,
    );
    expect(await submitClaims({ taskId, output: "   " }, ctx, root)).toMatch(/^INVALID_OUTPUT:/);
    // まだ使える
    const empty = await submitClaims({ taskId, output: '{"wikis":[]}' }, ctx, root);
    expect(empty).toContain("0 件");
    expect(wikiFiles()).toHaveLength(0);
    expect(await submitClaims({ taskId, output: '{"wikis":[]}' }, ctx, root)).toMatch(/^TASK_DONE:/);
  });

  it("判断フレームの title を兄弟の id に解決して保存し、原文で確認できない frame は捨てて件数を返す", async () => {
    const taskId = taskIdOf(await startClaimTask({ noteId: NOTE_A }, ctx, root));
    const base = {
      kind: "claim",
      sections: [{ heading: "概要", content: "本文。" }],
      suggestedAction: "create",
      confidence: 0.9,
      level: "finding",
      relatedClaims: [],
      externalReferences: [],
    };
    const output = JSON.stringify({
      wikis: [
        { ...base, title: "粒径が大きくなる" },
        {
          ...base,
          title: "焼きなましを選ぶ",
          claimRole: ["decision"],
          decisionFrame: { triggerTitles: ["粒径が大きくなる"], action: "焼きなましで粒径が大きくなる", rationale: "原文に無い理由" },
        },
      ],
    });
    const reply = await submitClaims({ taskId, output }, ctx, root);
    expect(reply).toContain("知見を 2 件保存しました");
    expect(reply).toContain("原文で確認できず捨てた frame: 1 件");
    const docs = wikiFiles().map((f) => readJson(p("wiki", f)));
    const trigger = docs.find((d) => d.title === "粒径が大きくなる");
    const decision = docs.find((d) => d.title === "焼きなましを選ぶ");
    const triggerId = entryIdByTitle("粒径が大きくなる");
    expect(decision.wikiMeta.decisionFrame.triggerClaimIds).toEqual([triggerId]);
    expect(trigger.wikiMeta.decisionFrame).toBeUndefined();
  });

  it("AI が名乗った procedureContext.derivedFromNotes は、課題のノートに固定される", async () => {
    const taskId = taskIdOf(await startClaimTask({ noteId: NOTE_A }, ctx, root));
    const reply = await submitClaims(
      {
        taskId,
        output: claimOutput("手順つきの知見", {
          procedureContext: { derivedFromNotes: ["forged-note"], protocolFingerprint: "焼きなまし" },
        }),
      },
      ctx,
      root,
    );
    const doc = readJson(p("wiki", `${createdId(reply)}.json`));
    expect(doc.wikiMeta.procedureContext.protocolFingerprint).toBe("焼きなまし");
    expect(doc.wikiMeta.procedureContext.derivedFromNotes).toEqual([NOTE_A]);
  });

  it("保存に失敗した兄弟の id は判断フレームに入らない。失敗した新規ページは残らない", async () => {
    const taskId = taskIdOf(await startClaimTask({ noteId: NOTE_A }, ctx, root));
    const base = {
      kind: "claim",
      sections: [{ heading: "概要", content: "本文。" }],
      suggestedAction: "create",
      confidence: 0.9,
      level: "finding",
      relatedClaims: [],
      externalReferences: [],
    };
    const output = JSON.stringify({
      wikis: [
        { ...base, title: "落ちる兄弟" },
        {
          ...base,
          title: "判断",
          claimRole: ["decision"],
          decisionFrame: { triggerTitles: ["落ちる兄弟"], action: "焼きなましで粒径が大きくなる", rationale: null },
        },
      ],
    });
    saveCtl.failTitles.add("落ちる兄弟");
    saveCtl.failAfterWrite = true; // ファイルは書けたあとで落ちる
    const reply = await submitClaims({ taskId, output }, ctx, root);
    expect(reply).toContain("知見を 1 件保存しました");
    expect(reply).toContain("失敗:");
    // 孤児のファイル・索引のエントリを残さない
    expect(wikiFiles()).toHaveLength(1);
    expect(entryIdByTitle("落ちる兄弟")).toBe("");
    const decision = readJson(p("wiki", wikiFiles()[0]));
    expect(decision.title).toBe("判断");
    expect(decision.wikiMeta.decisionFrame.triggerClaimIds).toEqual([]);
    // 記録には保存できたページだけ
    const run = readJson(p("appdata", opIds(reply).runId + ".json"));
    expect(run.operations[0].created.map((c: { title: string }) => c.title)).toEqual(["判断"]);
  });

  it("同じ既存知見への書き足しが 1 回の output に 2 件あっても、清書の課題は 1 件", async () => {
    const t1 = taskIdOf(await startClaimTask({ noteId: NOTE_A }, ctx, root));
    const id = createdId(await submitClaims({ taskId: t1, output: claimOutput("共通の知見") }, ctx, root));
    const startB = await startClaimTask({ noteId: NOTE_B }, ctx, root);
    const mk = (title: string) => ({
      kind: "claim",
      title,
      sections: [{ heading: "追記", content: `${title}の内容。` }],
      suggestedAction: "merge",
      mergeTargetId: "c1",
      confidence: 0.9,
      level: "finding",
      relatedClaims: [],
      externalReferences: [],
    });
    const reply = await submitClaims(
      { taskId: taskIdOf(startB), output: JSON.stringify({ wikis: [mk("追記その1"), mk("追記その2")] }) },
      ctx,
      root,
    );
    expect(reply.match(/submit_rewrite\(\{/g)).toHaveLength(1);
    expect(reply).toContain("追記その1の内容");
    expect(reply).toContain("追記その2の内容");
    // 課題は最終の内容に対するもの（そのまま提出できる）
    const out = JSON.stringify({ sections: [{ heading: "概要", content: "整理" }] });
    expect(await submitRewrite({ taskId: rewriteTaskIdOf(reply), output: out }, ctx, root)).toContain("差し替えました");
    expect(entryOf(id)).toBeTruthy();
  });

  it("配っていない id（mergeTargetId の偽造）は通らず、新規に倒れる", async () => {
    // アーカイブ済みの知見は一覧に載らない。その id を名指しで書き足し先にしても通らない
    writeJson(p("wiki", "k-arch.json"), noteDoc("アーカイブ済み", "元の本文", { source: "ai", wikiMeta: { kind: "claim", derivedFromNotes: ["x"] } }));
    writeJson(p("appdata", "note-index.json"), {
      version: INDEX_SCHEMA_VERSION,
      updatedAt: "2026-09-01T00:00:00.000Z",
      notes: [claimEntry("k-arch", "アーカイブ済み", { archivedAt: "2026-09-02T00:00:00.000Z" })],
    });
    const before = readFileSync(p("wiki", "k-arch.json"), "utf8");
    const taskId = taskIdOf(await startClaimTask({ noteId: NOTE_A }, ctx, root));
    const reply = await submitClaims(
      { taskId, output: claimOutput("新しい知見", { suggestedAction: "merge", mergeTargetId: "k-arch" }) },
      ctx,
      root,
    );
    expect(reply).toContain("作成: 「新しい知見」");
    expect(readFileSync(p("wiki", "k-arch.json"), "utf8")).toBe(before);
    expect(wikiFiles()).toHaveLength(2);
  });
});

describe("書き足し（merge）・昇格・清書", () => {
  /** ノート A から知見を 1 件作り、その id を返す */
  async function createFromA(): Promise<string> {
    const taskId = taskIdOf(await startClaimTask({ noteId: NOTE_A }, ctx, root));
    return createdId(await submitClaims({ taskId, output: claimOutput("粒径は焼きなまし条件で決まる"), model: "m1" }, ctx, root));
  }

  it("2 つ目の独立ノートで書き足すと verified に昇格し、清書の課題が返る", async () => {
    const id = await createFromA();
    const startB = await startClaimTask({ noteId: NOTE_B }, ctx, root);
    expect(startB).toContain("c1: 粒径は焼きなまし条件で決まる");
    const reply = await submitClaims(
      {
        taskId: taskIdOf(startB),
        output: claimOutput("粒径は焼きなまし条件で決まる", { suggestedAction: "merge", mergeTargetId: "c1" }),
        model: "m2",
      },
      ctx,
      root,
    );
    expect(reply).toContain(`書き足し: 「粒径は焼きなまし条件で決まる」 (id: ${id})`);
    expect(reply).toContain("verified に昇格");
    expect(wikiFiles()).toEqual([`${id}.json`]);

    const doc = readJson(p("wiki", `${id}.json`));
    expect(doc.wikiMeta.status).toBe("verified");
    expect(doc.wikiMeta.derivedFromNotes).toEqual([NOTE_A, NOTE_B]);
    expect(JSON.stringify(doc.documentProvenance)).toContain("wiki_merge");

    // 清書の課題
    expect(reply).toContain("清書の課題");
    expect(reply).toContain("Existing Page Content");
    expect(reply).toContain("SCHEMA-BODY-MARK");
    const rewriteTaskId = rewriteTaskIdOf(reply);
    expect(rewriteTaskId).toBeTruthy();

    // 清書を提出 → 本文が差し替わる
    const out = JSON.stringify({ sections: [{ heading: "整理した概要", content: "整理された本文。" }] });
    const done = await submitRewrite({ taskId: rewriteTaskId, output: out, model: "m3" }, ctx, root);
    expect(done).toContain("清書で差し替えました");
    const after = readJson(p("wiki", `${id}.json`));
    expect(JSON.stringify(after.pages[0].blocks)).toContain("整理された本文");
    expect(JSON.stringify(after.pages[0].blocks)).not.toContain("という知見。");
    expect(after.wikiMeta.derivedFromNotes).toEqual([NOTE_A, NOTE_B]);
    expect(after.wikiMeta.status).toBe("verified");
    expect(after.wikiMeta.generatedBy.model).toBe("m3");
    expect(after.generatedBy.agent).toBe("graphium-mcp (test-client)");
    expect(await submitRewrite({ taskId: rewriteTaskId, output: out }, ctx, root)).toMatch(/^TASK_DONE:/);
  });

  it("書き足しのあとにページが変わっていれば submit_rewrite は TASK_STALE", async () => {
    const id = await createFromA();
    const startB = await startClaimTask({ noteId: NOTE_B }, ctx, root);
    const reply = await submitClaims(
      {
        taskId: taskIdOf(startB),
        output: claimOutput("粒径は焼きなまし条件で決まる", { suggestedAction: "merge", mergeTargetId: "c1" }),
      },
      ctx,
      root,
    );
    const doc = readJson(p("wiki", `${id}.json`));
    doc.pages[0].blocks.push(para("human", "人が足した一文"));
    writeJson(p("wiki", `${id}.json`), doc);
    const out = JSON.stringify({ sections: [{ heading: "概要", content: "本文" }] });
    expect(await submitRewrite({ taskId: rewriteTaskIdOf(reply), output: out }, ctx, root)).toMatch(/^TASK_STALE:/);
    expect(JSON.stringify(readJson(p("wiki", `${id}.json`)).pages[0].blocks)).toContain("人が足した一文");
  });

  it("submit_rewrite: INVALID_OUTPUT は課題を消費しない・知見の課題は渡せない", async () => {
    await createFromA();
    const startB = await startClaimTask({ noteId: NOTE_B }, ctx, root);
    const claimsTaskId = taskIdOf(startB);
    const reply = await submitClaims(
      { taskId: claimsTaskId, output: claimOutput("x", { suggestedAction: "merge", mergeTargetId: "c1" }) },
      ctx,
      root,
    );
    const rid = rewriteTaskIdOf(reply);
    expect(await submitRewrite({ taskId: rid, output: "壊れた" }, ctx, root)).toMatch(/^INVALID_OUTPUT:/);
    expect(await submitRewrite({ taskId: claimsTaskId, output: "{}" }, ctx, root)).toMatch(/^TASK_DONE:/);
    const out = JSON.stringify({ sections: [{ heading: "概要", content: "ok" }] });
    expect(await submitRewrite({ taskId: rid, output: out }, ctx, root)).toContain("差し替えました");
  });

  it("protectEditedSections は手編集された節を元に戻す", () => {
    const current = [
      { heading: "A", content: "人が書いた" },
      { heading: "B", content: "AI" },
    ];
    const r = protectEditedSections(
      [{ heading: "A", content: "書き換えられた" }, { heading: "C", content: "新" }],
      current,
      ["A"],
    );
    expect(r.sections).toEqual([{ heading: "A", content: "人が書いた" }, { heading: "C", content: "新" }]);
    expect(r.restored).toEqual(["A"]);
    const dropped = protectEditedSections([{ heading: "C", content: "新" }], current, ["A"]);
    expect(dropped.sections[dropped.sections.length - 1]).toEqual({ heading: "A", content: "人が書いた" });
  });
});

describe("undo_operation（mcp_generate）", () => {
  it("作った知見はゴミ箱へ移り、取り消しの取り消しで戻る", async () => {
    const taskId = taskIdOf(await startClaimTask({ noteId: NOTE_A }, ctx, root));
    const reply = await submitClaims({ taskId, output: claimOutput("取り消す知見") }, ctx, root);
    const id = createdId(reply);
    expect(entryOf(id).deletedAt).toBeUndefined();

    const undone = await undoOperation(opIds(reply), ctx, root);
    expect(undone).toContain("取り消しました");
    expect(undone).toContain("取り消す知見");
    expect(entryOf(id).deletedAt).toBeTruthy();
    // ファイルは消さない（ゴミ箱）
    expect(wikiFiles()).toEqual([`${id}.json`]);
    expect(await listOperations({}, ctx, root)).toContain("取り消し済み");

    // 取り消しの取り消し
    const list = await listOperations({}, ctx, root);
    const undoLine = list.split("\n").find((l) => l.includes("操作を取り消しました") || l.includes("の操作を取り消しました"));
    const undoIds = undoLine?.match(/\[(maint-run-\S+) \/ (\S+)\]/);
    expect(undoIds).toBeTruthy();
    const redo = await undoOperation({ runId: undoIds![1], operationId: undoIds![2] }, ctx, root);
    expect(redo).toContain("取り消しました");
    expect(entryOf(id).deletedAt).toBeUndefined();
  });

  it("見積もりに「ゴミ箱へ移す」を出す。作成後に変わっていれば confirm が無いと実行しない", async () => {
    const taskId = taskIdOf(await startClaimTask({ noteId: NOTE_A }, ctx, root));
    const reply = await submitClaims({ taskId, output: claimOutput("変わる知見") }, ctx, root);
    const id = createdId(reply);
    // 作成後に別の資料で書き足された
    const doc = readJson(p("wiki", `${id}.json`));
    doc.wikiMeta.derivedFromNotes.push("other-note");
    writeJson(p("wiki", `${id}.json`), doc);

    const estimate = await undoOperation(opIds(reply), ctx, root);
    expect(estimate).toContain("ゴミ箱へ移します");
    expect(estimate).toContain("別の資料で書き足されています");
    expect(estimate).toContain("confirm: true");
    expect(entryOf(id).deletedAt).toBeUndefined();

    const done = await undoOperation({ ...opIds(reply), confirm: true }, ctx, root);
    expect(done).toContain("取り消しました");
    expect(entryOf(id).deletedAt).toBeTruthy();
  });

  it("すでにゴミ箱にあれば成功として扱う", async () => {
    const taskId = taskIdOf(await startClaimTask({ noteId: NOTE_A }, ctx, root));
    const reply = await submitClaims({ taskId, output: claimOutput("先にゴミ箱へ") }, ctx, root);
    const id = createdId(reply);
    const idx = readIndex();
    idx.notes.find((n: { noteId: string }) => n.noteId === id).deletedAt = "2026-10-01T00:00:00.000Z";
    writeJson(p("appdata", "note-index.json"), idx);
    const undone = await undoOperation(opIds(reply), ctx, root);
    expect(undone).not.toContain("失敗");
    expect(entryOf(id).deletedAt).toBe("2026-10-01T00:00:00.000Z");
  });

  it("書き足しの取り消しは写しからページを戻す。先の作成は後の書き足しを先に取り消すまで断る", async () => {
    const t1 = taskIdOf(await startClaimTask({ noteId: NOTE_A }, ctx, root));
    const created = await submitClaims({ taskId: t1, output: claimOutput("共通の知見") }, ctx, root);
    const id = createdId(created);
    const before = readJson(p("wiki", `${id}.json`));

    const t2 = taskIdOf(await startClaimTask({ noteId: NOTE_B }, ctx, root));
    const merged = await submitClaims(
      { taskId: t2, output: claimOutput("共通の知見", { suggestedAction: "merge", mergeTargetId: "c1" }) },
      ctx,
      root,
    );
    expect(readJson(p("wiki", `${id}.json`)).wikiMeta.status).toBe("verified");

    expect(await undoOperation(opIds(created), ctx, root)).toMatch(/^BLOCKED:/);
    const undone = await undoOperation(opIds(merged), ctx, root);
    expect(undone).toContain("戻したページ");
    const restored = readJson(p("wiki", `${id}.json`));
    expect(restored.wikiMeta.derivedFromNotes).toEqual(before.wikiMeta.derivedFromNotes);
    expect(restored.wikiMeta.status).toBe("candidate");
    // 作成の取り消しは、これで通る
    expect(await undoOperation(opIds(created), ctx, root)).toContain("取り消しました");
    expect(entryOf(id).deletedAt).toBeTruthy();
  });
});
