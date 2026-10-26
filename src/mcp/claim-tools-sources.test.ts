import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { INDEX_SCHEMA_VERSION } from "../features/navigation/index-file";
import { claimSourceDeps } from "./claim-source";
import { findClaimsForTask, MCP_EXISTING_INDEX_BUDGET_TOKENS, startClaimTask, submitClaims } from "./claim-tools";
import { readTaskLedger, tasksLedgerPath } from "./knowledge-tasks";
import { resetMediaIndexCache } from "./sources";
import { resetSearchIndex } from "./search";
import { resetSourceTextCache } from "./source-text";
import { buildMinimalDocx, buildMinimalPdf } from "./test-support";

const ctx = { getClientName: () => "test-client" };
const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
let root: string;

const p = (...s: string[]) => join(root, ...s);
const readJson = (path: string) => JSON.parse(readFileSync(path, "utf8"));
const writeJson = (path: string, v: unknown) => writeFileSync(path, JSON.stringify(v));
const wikiFiles = () => readdirSync(p("wiki")).filter((f) => f.endsWith(".json"));
const taskIdOf = (reply: string) => reply.match(/taskId: (\S+)/)?.[1] ?? "";
const createdId = (reply: string) => reply.match(/作成: 「[^」]*」 \(id: ([^)]+)\)/)?.[1] ?? "";

function para(id: string, text: string) {
  return { id, type: "paragraph", props: {}, content: [{ type: "text", text, styles: {} }], children: [] };
}

function doc(title: string, body: string, extra: Record<string, unknown> = {}) {
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

function claimEntry(id: string, title: string) {
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
  };
}

function schemaDoc() {
  const d = doc("Knowledge Schema", "", { source: "skill" });
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

function voiceDoc() {
  const s = schemaDoc();
  return { ...s, title: "My Voice", skillMeta: { availableForIngest: true, language: "ja", createdAt: "2026-01-01T00:00:00.000Z" }, pages: [{ ...s.pages[0], blocks: [s.pages[0].blocks[0], para("v1", "VOICE-BODY-MARK")] }] };
}

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

const LONG_EN = "Annealing increases the grain size of the alloy and the hardness drops accordingly in this experiment.";

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "claim-sources-"));
  for (const d of ["notes", "wiki", "appdata", "skills", "media"]) mkdirSync(p(d), { recursive: true });
  writeJson(p("skills", "knowledge-schema.json"), schemaDoc());
  writeJson(p("skills", "voice-1.json"), voiceDoc());
  writeJson(p("appdata", "note-index.json"), { version: INDEX_SCHEMA_VERSION, updatedAt: "2026-09-01T00:00:00.000Z", notes: [] });
  writeJson(p("appdata", "feature-flags.json"), { claims: true, insights: false, updatedAt: "2026-10-26T00:00:00.000Z" });
  resetSearchIndex();
  resetMediaIndexCache();
  resetSourceTextCache();
});
afterEach(() => {
  resetSearchIndex();
  resetMediaIndexCache();
  rmSync(root, { recursive: true, force: true });
});

describe("既存の知見の一覧を絞る（MCP の予算）と find_claims_for_task", () => {
  const TOTAL = 400;
  const HIDDEN_ID = "k-hidden";

  beforeEach(() => {
    writeJson(p("notes", "n1.json"), doc("ノート", "焼きなましで粒径が大きくなる。"));
    const notes = [] as ReturnType<typeof claimEntry>[];
    for (let i = 0; i < TOTAL - 1; i++) notes.push(claimEntry(`k${i}`, `無関係な測定条件に関する知見その${i}番目の記録`));
    // 一覧の最後（予算に入らない位置）。ノート本文とは重ならない題名
    notes.push(claimEntry(HIDDEN_ID, "アルミニウム合金の時効硬化挙動"));
    writeJson(p("appdata", "note-index.json"), { version: INDEX_SCHEMA_VERSION, updatedAt: "2026-09-01T00:00:00.000Z", notes });
    writeJson(p("wiki", `${HIDDEN_ID}.json`), doc("アルミニウム合金の時効硬化挙動", "本文", {
      source: "ai",
      wikiMeta: { kind: "claim", derivedFromNotes: ["old-note"], status: "candidate" },
    }));
  });

  it("予算で絞られ、全体の件数と載せた件数が作業指示に出る", async () => {
    const reply = await startClaimTask({ noteId: "n1" }, ctx, root);
    const task = Object.values(readTaskLedger(root).tasks)[0];
    const shown = Object.keys(task.existingIndex!.refToId).length;
    expect(shown).toBeGreaterThan(0);
    expect(shown).toBeLessThan(TOTAL);
    expect(task.existingIndex!.totalClaims).toBe(TOTAL);
    expect(reply).toContain(`全体 ${TOTAL} 件のうち`);
    expect(reply).toContain(`${shown} 件を一覧に載せています`);
    expect(reply).toContain("find_claims_for_task");
    expect(MCP_EXISTING_INDEX_BUDGET_TOKENS).toBe(2_000);
    // 配った一覧に隠れた知見は無い
    expect(Object.values(task.existingIndex!.refToId)).not.toContain(HIDDEN_ID);
  });

  it("find は配っていない知見にだけ続きの番号を振り、台帳に追記する。同じ知見は 2 度振らない", async () => {
    const taskId = taskIdOf(await startClaimTask({ noteId: "n1" }, ctx, root));
    const found = await findClaimsForTask({ taskId, query: "時効硬化" }, root);
    expect(found).toContain(`- c${TOTAL + 1}: アルミニウム合金の時効硬化挙動`);
    expect(readTaskLedger(root).tasks[taskId].existingIndex!.refToId[`c${TOTAL + 1}`]).toBe(HIDDEN_ID);
    // もう一度探しても、配った知見は出ない
    const again = await findClaimsForTask({ taskId, query: "時効硬化" }, root);
    expect(again).toContain("見つかりませんでした");
    // 配ってある知見（一覧に載っているもの）は、題名に近くても再び振られない（id が重複しない）
    const task = readTaskLedger(root).tasks[taskId];
    const deliveredId = Object.values(task.existingIndex!.refToId).find((id) => id.startsWith("k0") || id.startsWith("k1"))!;
    const idx = Number(deliveredId.slice(1));
    await findClaimsForTask({ taskId, query: `無関係な測定条件に関する知見その${idx}番目の記録`, limit: 50 }, root);
    const ids = Object.values(readTaskLedger(root).tasks[taskId].existingIndex!.refToId);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("追記された番号で書き足せる。配っていない番号は通らず新規に倒れる", async () => {
    const taskId = taskIdOf(await startClaimTask({ noteId: "n1" }, ctx, root));
    await findClaimsForTask({ taskId, query: "時効硬化" }, root);
    const reply = await submitClaims(
      { taskId, output: claimOutput("時効硬化の追記", { suggestedAction: "merge", mergeTargetId: `c${TOTAL + 1}` }) },
      ctx,
      root,
    );
    expect(reply).toContain(`書き足し: 「アルミニウム合金の時効硬化挙動」 (id: ${HIDDEN_ID})`);
    expect(readJson(p("wiki", `${HIDDEN_ID}.json`)).wikiMeta.derivedFromNotes).toEqual(["old-note", "n1"]);

  });

  it("配っていない生の id は書き足し先にならない", async () => {
    const taskId = taskIdOf(await startClaimTask({ noteId: "n1" }, ctx, root));
    const before = readFileSync(p("wiki", `${HIDDEN_ID}.json`), "utf8");
    const reply = await submitClaims(
      { taskId, output: claimOutput("偽造", { suggestedAction: "merge", mergeTargetId: HIDDEN_ID }) },
      ctx,
      root,
    );
    expect(reply).toContain("作成: 「偽造」");
    expect(readFileSync(p("wiki", `${HIDDEN_ID}.json`), "utf8")).toBe(before);
  });

  it("期限切れ・提出済みの課題は断る。アプリ起動中でも断らない", async () => {
    const taskId = taskIdOf(await startClaimTask({ noteId: "n1" }, ctx, root));
    writeJson(p("appdata", "app-heartbeat.json"), { via: "web", at: new Date().toISOString() });
    expect(await findClaimsForTask({ taskId, query: "時効硬化" }, root)).toContain("時効硬化");
    expect(await findClaimsForTask({ taskId: "nope", query: "x" }, root)).toMatch(/^TASK_NOT_FOUND:/);
    expect(await findClaimsForTask({ taskId, query: "  " }, root)).toMatch(/^INVALID_ARGUMENT:/);
    const ledger = readJson(tasksLedgerPath(root));
    ledger.tasks[taskId].createdAt = new Date(Date.now() - 25 * 3600 * 1000).toISOString();
    writeJson(tasksLedgerPath(root), ledger);
    expect(await findClaimsForTask({ taskId, query: "時効硬化" }, root)).toMatch(/^TASK_EXPIRED:/);
  });

  it("limit は上限 50", async () => {
    const taskId = taskIdOf(await startClaimTask({ noteId: "n1" }, ctx, root));
    const found = await findClaimsForTask({ taskId, query: "無関係な測定条件", limit: 500 }, root);
    expect(found.split("\n").filter((l) => l.startsWith("- c"))).toHaveLength(50);
  });
});

describe("素材とメモを対象にする", () => {
  function mediaIndex(media: unknown[]) {
    writeJson(p("appdata", "media-index.json"), { version: 1, media });
    resetMediaIndexCache();
  }

  it("PDF: 課題 → 提出 → derivedFromNotes が pdf:<id>。Skill は渡さない", async () => {
    writeFileSync(p("media", "pdf1.pdf"), buildMinimalPdf([LONG_EN]));
    mediaIndex([{ fileId: "pdf1", type: "pdf", name: "論文.pdf", mimeType: "application/pdf" }]);
    const reply = await startClaimTask({ noteId: "pdf:pdf1" }, ctx, root);
    expect(reply).toContain("[出力言語: 日本語で書いてください");
    expect(reply).toContain("Annealing increases the grain size");
    expect(reply).not.toContain("VOICE-BODY-MARK");
    expect(reply).toContain("SCHEMA-BODY-MARK");

    const out = await submitClaims({ taskId: taskIdOf(reply), output: claimOutput("焼きなましは粒径を増やす") }, ctx, root);
    expect(out).toContain("知見を 1 件保存しました（「論文.pdf」から）");
    const saved = readJson(p("wiki", `${createdId(out)}.json`));
    expect(saved.wikiMeta.derivedFromNotes).toEqual(["pdf:pdf1"]);
    expect(saved.wikiMeta.skillsUsed).toBeUndefined();
  });

  it("PDF: 本文が短すぎる・アーカイブ済み・存在しない素材は断る", async () => {
    writeFileSync(p("media", "pdf2.pdf"), buildMinimalPdf(["short"]));
    mediaIndex([
      { fileId: "pdf2", type: "pdf", name: "短い.pdf", mimeType: "application/pdf" },
      { fileId: "pdf3", type: "pdf", name: "しまった.pdf", mimeType: "application/pdf", archivedAt: "2026-10-01T00:00:00.000Z" },
      { fileId: "img1", type: "image", name: "画像", mimeType: "image/png" },
    ]);
    expect(await startClaimTask({ noteId: "pdf:pdf2" }, ctx, root)).toMatch(/^EMPTY_NOTE:/);
    expect(await startClaimTask({ noteId: "pdf:pdf3" }, ctx, root)).toMatch(/^NOT_FOUND:/);
    expect(await startClaimTask({ noteId: "pdf:ghost" }, ctx, root)).toMatch(/^NOT_FOUND:/);
    expect(await startClaimTask({ noteId: "pdf:img1" }, ctx, root)).toMatch(/^NOT_A_NOTE:/);
  });

  it("Word: 課題 → 提出 → document:<id>。素材が差し替わると TASK_STALE", async () => {
    writeFileSync(p("media", "doc1.docx"), buildMinimalDocx([LONG_EN, "Second paragraph about heat treatment of metals."]));
    mediaIndex([{ fileId: "doc1", type: "document", name: "報告書.docx", mimeType: DOCX_MIME }]);
    const reply = await startClaimTask({ noteId: "document:doc1" }, ctx, root);
    expect(reply).toContain("Second paragraph about heat treatment");
    const stale = await startClaimTask({ noteId: "document:doc1" }, ctx, root);
    writeFileSync(p("media", "doc1.docx"), buildMinimalDocx(["A completely different document that has been replaced after the task was issued."]));
    expect(await submitClaims({ taskId: taskIdOf(stale), output: claimOutput("x") }, ctx, root)).toMatch(/^TASK_STALE:/);

    const out = await submitClaims({ taskId: taskIdOf(await startClaimTask({ noteId: "document:doc1" }, ctx, root)), output: claimOutput("置き換え後の知見") }, ctx, root);
    expect(readJson(p("wiki", `${createdId(out)}.json`)).wikiMeta.derivedFromNotes).toEqual(["document:doc1"]);
  });

  it("Word 以外の document（xlsx など）は対象外", async () => {
    mediaIndex([{ fileId: "x1", type: "document", name: "表.xlsx", mimeType: "application/vnd.ms-excel" }]);
    expect(await startClaimTask({ noteId: "document:x1" }, ctx, root)).toMatch(/^NOT_A_NOTE:/);
  });

  it("メモ: 課題 → 提出 → memo:<id> と、元メモへの逆リンク（knowledgedInto）", async () => {
    writeJson(p("appdata", "captures.json"), {
      version: 1,
      updatedAt: "2026-10-01T00:00:00.000Z",
      captures: [
        { id: "c1", text: "  焼きなましで粒径が大きくなる、という気づき。\n二行目のメモ  ", createdAt: "2026-10-01T00:00:00.000Z" },
        { id: "c2", text: "しまったメモ", createdAt: "2026-10-01T00:00:00.000Z", archivedAt: "2026-10-02T00:00:00.000Z" },
        { id: "c3", text: "   ", createdAt: "2026-10-01T00:00:00.000Z" },
      ],
    });
    expect(await startClaimTask({ noteId: "memo:c2" }, ctx, root)).toMatch(/^NOT_FOUND:/);
    expect(await startClaimTask({ noteId: "memo:c3" }, ctx, root)).toMatch(/^EMPTY_NOTE:/);
    const reply = await startClaimTask({ noteId: "memo:c1" }, ctx, root);
    expect(reply).toContain("二行目のメモ");
    expect(reply).toContain("VOICE-BODY-MARK"); // メモはノートと同じく Skill を渡す
    const out = await submitClaims({ taskId: taskIdOf(reply), output: claimOutput("メモから得た知見") }, ctx, root);
    const id = createdId(out);
    expect(readJson(p("wiki", `${id}.json`)).wikiMeta.derivedFromNotes).toEqual(["memo:c1"]);
    const captures = readJson(p("appdata", "captures.json")).captures;
    expect(captures[0].knowledgedInto).toMatchObject([{ noteId: `wiki:${id}`, noteTitle: "メモから得た知見" }]);
    expect(captures[1].knowledgedInto).toBeUndefined();
  });

  it("URL: 取得は差し替えられる。配った本文を台帳に控え、提出では取り直さない（指紋の照合をしない）", async () => {
    mediaIndex([{ fileId: "u1", type: "url", name: "解説ページ", url: "https://example.com/a", mimeType: "text/html" }]);
    const original = claimSourceDeps.fetchUrl;
    try {
      let calls = 0;
      claimSourceDeps.fetchUrl = async () => {
        calls++;
        return { title: "ページ", description: "説明文", text: `取得${calls}回目の本文。焼きなましで粒径が大きくなる。` };
      };
      const reply = await startClaimTask({ noteId: "url:https://example.com/a" }, ctx, root);
      expect(reply).toContain("> 説明文");
      expect(reply).toContain("取得1回目の本文");
      expect(reply).not.toContain("VOICE-BODY-MARK");

      const out = await submitClaims({ taskId: taskIdOf(reply), output: claimOutput("URL からの知見") }, ctx, root);
      expect(calls).toBe(1); // 提出では取り直さない
      expect(out).toContain("（「解説ページ」から）");
      expect(readJson(p("wiki", `${createdId(out)}.json`)).wikiMeta.derivedFromNotes).toEqual(["url:https://example.com/a"]);

      // 取得できなければ分かる拒否コード。登録の無い URL は NOT_FOUND
      claimSourceDeps.fetchUrl = async () => {
        throw { status: 500, message: "ECONNREFUSED" };
      };
      expect(await startClaimTask({ noteId: "url:https://example.com/a" }, ctx, root)).toMatch(/^SOURCE_UNAVAILABLE:.*ECONNREFUSED/);
      expect(await startClaimTask({ noteId: "url:https://example.com/zzz" }, ctx, root)).toMatch(/^NOT_FOUND:/);
    } finally {
      claimSourceDeps.fetchUrl = original;
    }
    expect(wikiFiles()).toHaveLength(1);
  });
});
