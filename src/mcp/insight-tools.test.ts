import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// 新規ページの保存の直後に副作用を起こすフック（途中でアプリが起動した状況を作る）
const hook = vi.hoisted(() => ({ afterSave: null as null | (() => void) }));
vi.mock("./upkeep/save", async (importActual) => {
  const actual = await importActual<typeof import("./upkeep/save")>();
  return {
    ...actual,
    saveWikiFileToVault: async (...args: Parameters<typeof actual.saveWikiFileToVault>) => {
      const r = await actual.saveWikiFileToVault(...args);
      hook.afterSave?.();
      return r;
    },
  };
});

import { INDEX_SCHEMA_VERSION } from "../features/navigation/index-file";
import {
  findDuplicateCandidates,
  startInsightTask,
  submitInsightReview,
  submitInsights,
} from "./insight-tools";
import { insightCoveragePath } from "./insight-coverage";
import { textSimilarity } from "./text-similarity";
import { readTaskLedger, tasksLedgerPath } from "./knowledge-tasks";
import { resetSearchIndex } from "./search";
import { listOperations, undoOperation } from "./upkeep/tools";

const ctx = { getClientName: () => "test-client" };
let root: string;

const p = (...s: string[]) => join(root, ...s);
const readJson = (path: string) => JSON.parse(readFileSync(path, "utf8"));
const writeJson = (path: string, v: unknown) => writeFileSync(path, JSON.stringify(v));
const readIndex = () => readJson(p("appdata", "note-index.json"));
const entryOf = (id: string) => readIndex().notes.find((n: { noteId: string }) => n.noteId === id);
const wikiFiles = () => readdirSync(p("wiki")).filter((f) => f.endsWith(".json"));
const wikiDoc = (id: string) => readJson(p("wiki", `${id}.json`));
/** 洞察のページ（kind: atom）の id 一覧 */
const atomIds = () => wikiFiles().map((f) => f.slice(0, -5)).filter((id) => wikiDoc(id).wikiMeta?.kind === "atom");
const atomIdByTitle = (title: string): string => atomIds().find((id) => wikiDoc(id).title === title) ?? "";

function para(id: string, text: string) {
  return { id, type: "paragraph", props: {}, content: [{ type: "text", text, styles: {} }], children: [] };
}

function wikiPage(
  title: string,
  body: string,
  wikiMeta: Record<string, unknown>,
) {
  return {
    version: 2,
    title,
    source: "ai",
    createdAt: "2026-09-01T00:00:00.000Z",
    modifiedAt: "2026-09-01T00:00:00.000Z",
    wikiMeta: { derivedFromNotes: [], derivedFromChats: [], generatedAt: "2026-09-01T00:00:00.000Z", generatedBy: { model: "m", version: "1" }, ...wikiMeta },
    pages: [{ id: "main", title, blocks: [para("b1", body)], labels: {}, provLinks: [], knowledgeLinks: [] }],
  };
}

function indexEntry(id: string, title: string, wikiKind: string, extra: Record<string, unknown> = {}) {
  return {
    noteId: id,
    title,
    modifiedAt: "2026-09-01T00:00:00.000Z",
    createdAt: "2026-09-01T00:00:00.000Z",
    headings: [],
    labels: [],
    outgoingLinks: [],
    source: "ai",
    wikiKind,
    ...extra,
  };
}

type Seed = { id: string; title: string; body: string; status: string; rebuttals?: string[] };
const CLAIMS: Seed[] = [
  { id: "c1", title: "焼きなましで粒径が大きくなる", body: "焼きなまし温度を上げると粒径が大きくなる。", status: "observation", rebuttals: ["試料が薄い場合"] },
  { id: "c2", title: "拡散係数は温度で指数的に増える", body: "温度が上がると拡散係数が指数的に増える。", status: "speculation", rebuttals: ["高圧下では成り立たない"] },
  { id: "c3", title: "冷却速度が結晶性を決める", body: "冷却が速いほど結晶性が下がる。", status: "interpretation" },
];

function seedVault(claims: Seed[] = CLAIMS, atoms: { id: string; title: string; body: string; claims: string[] }[] = []) {
  const notes = [] as unknown[];
  for (const c of claims) {
    writeJson(
      p("wiki", `${c.id}.json`),
      wikiPage(c.title, c.body, {
        kind: "claim",
        status: "candidate",
        epistemicStatus: c.status,
        ...(c.rebuttals ? { rebuttalConditions: c.rebuttals } : {}),
      }),
    );
    notes.push(indexEntry(c.id, c.title, "claim"));
  }
  for (const a of atoms) {
    writeJson(p("wiki", `${a.id}.json`), wikiPage(a.title, a.body, { kind: "atom", derivedFromClaims: a.claims }));
    notes.push(indexEntry(a.id, a.title, "atom"));
  }
  writeJson(p("appdata", "note-index.json"), {
    version: INDEX_SCHEMA_VERSION,
    updatedAt: "2026-09-01T00:00:00.000Z",
    notes,
  });
}

function writeFlags(claims: boolean, insights: boolean) {
  writeJson(p("appdata", "feature-flags.json"), { claims, insights, updatedAt: "2026-10-27T00:00:00.000Z" });
}

/** 審査の答えの雛形: すべての節のキーが要る（空配列 = 答えない）。余分なキーは無視される */
const EMPTY = { transfer: [], fold: [], relift: [], duplicates: [] };
const ALL_EMPTY = JSON.stringify(EMPTY);

type AtomOut = {
  title: string;
  body: string;
  sourceConceptIds: string[];
  [k: string]: unknown;
};
const atomsOutput = (...atoms: AtomOut[]) => JSON.stringify({ atoms: atoms.map((a) => ({ confidence: 0.8, ...a })) });

const taskIdOf = (reply: string) => reply.match(/taskId[^:]*: (\S+)/)?.[1] ?? "";
const reviewTaskIdOf = (reply: string) => reply.match(/submit_insight_review\(\{ taskId: "([^"]+)"/)?.[1] ?? "";
const opIds = (reply: string) => ({
  runId: reply.match(/runId: (maint-run-\S+)/)?.[1] ?? "",
  operationId: reply.match(/operationId: (\S+)/)?.[1] ?? "",
});
const createdIdOf = (reply: string, title: string) =>
  reply.match(new RegExp(`作成: 「${title}」 \\(id: ([^)]+)\\)`))?.[1] ?? "";

/** start → submit_insights まで進めて、審査の課題の返事を返す */
async function toReview(...atoms: AtomOut[]): Promise<{ review: string; reviewTaskId: string; start: string }> {
  const start = await startInsightTask({}, ctx, root);
  const review = await submitInsights({ taskId: taskIdOf(start), output: atomsOutput(...atoms), model: "author-model" }, ctx, root);
  return { review, reviewTaskId: reviewTaskIdOf(review), start };
}

const A: AtomOut = {
  title: "均質なほど流れやすい",
  body: "構成要素の性質が均質なほど、内部の流れが妨げられにくい。",
  sourceConceptIds: ["c1", "c2", "c3"],
  shape: "monotonic-increase",
  atomType: "causal",
  rebuttalConditions: ["共通の反例"],
  transfer: { field: "交通", example: "車種が揃うほど渋滞が起きにくい" },
};
const B: AtomOut = { title: "冷えを速くすると乱れる", body: "冷却を急ぐほど、秩序が崩れやすい。", sourceConceptIds: ["c3"] };

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "insight-tools-"));
  for (const d of ["notes", "wiki", "appdata", "skills"]) mkdirSync(p(d), { recursive: true });
  seedVault();
  writeFlags(true, true);
  resetSearchIndex();
  hook.afterSave = null;
});
afterEach(() => {
  hook.afterSave = null;
  resetSearchIndex();
  rmSync(root, { recursive: true, force: true });
});

describe("start_insight_task の拒否", () => {
  it("vault が無ければ断る", async () => {
    expect(await startInsightTask({}, ctx, p("nope"))).toContain("vault が見つかりません");
  });

  it("索引が無ければ NO_INDEX", async () => {
    rmSync(p("appdata", "note-index.json"));
    expect(await startInsightTask({}, ctx, root)).toMatch(/^NO_INDEX:/);
  });

  it("設定の写しが無ければ SETTINGS_UNKNOWN、洞察か知見が OFF なら INSIGHTS_DISABLED", async () => {
    rmSync(p("appdata", "feature-flags.json"));
    expect(await startInsightTask({}, ctx, root)).toMatch(/^SETTINGS_UNKNOWN:/);
    writeFlags(true, false);
    expect(await startInsightTask({}, ctx, root)).toMatch(/^INSIGHTS_DISABLED:/);
    writeFlags(false, true);
    expect(await startInsightTask({}, ctx, root)).toMatch(/^INSIGHTS_DISABLED:/);
    expect(() => readFileSync(tasksLedgerPath(root))).toThrow();
  });

  it("起動中は APP_RUNNING", async () => {
    writeJson(p("appdata", "app-heartbeat.json"), { via: "web", at: new Date().toISOString() });
    expect(await startInsightTask({}, ctx, root)).toMatch(/^APP_RUNNING:/);
    expect(() => readFileSync(insightCoveragePath(root))).toThrow();
  });

  it("有効な知見が 2 件未満なら NOT_ENOUGH_CLAIMS（ゴミ箱の知見は数えない）", async () => {
    seedVault([CLAIMS[0]]);
    expect(await startInsightTask({}, ctx, root)).toMatch(/^NOT_ENOUGH_CLAIMS:/);
    seedVault(CLAIMS);
    const idx = readIndex();
    idx.notes[0].deletedAt = "2026-10-01T00:00:00.000Z";
    idx.notes[1].archivedAt = "2026-10-01T00:00:00.000Z";
    writeJson(p("appdata", "note-index.json"), idx);
    expect(await startInsightTask({}, ctx, root)).toMatch(/^NOT_ENOUGH_CLAIMS:/);
  });
});

describe("start_insight_task の課題", () => {
  it("アプリの /atomize と同じプロンプト（既存の洞察の一覧つき）と作業指示を返し、台帳に束を控える", async () => {
    seedVault(CLAIMS, [{ id: "a1", title: "既にある洞察", body: "既存の本文。", claims: ["c1"] }]);
    const reply = await startInsightTask({}, ctx, root);
    expect(reply).toContain("視野: 提出済み 0/3（配布中 3 件。1 巡目");
    expect(reply).toContain("=== SYSTEM PROMPT ===");
    expect(reply).toContain("Atom discoverer");
    expect(reply).toContain("(id: c1)");
    expect(reply).toContain("(id: c3)");
    // 既存の洞察のタイトル一覧
    expect(reply).toContain("Existing Atoms (do NOT duplicate these)");
    expect(reply).toContain("- 既にある洞察");
    // 作業指示（SYSTEM PROMPT の外）
    const [instructions] = reply.split("=== SYSTEM PROMPT ===");
    expect(instructions).toContain("JSON だけ");
    expect(instructions).toContain("submit_insights");
    expect(instructions).toContain("書き込み系");
    expect(instructions).toContain("審査は作者と別の文脈");

    const task = Object.values(readTaskLedger(root).tasks)[0];
    expect(task.kind).toBe("insights");
    const concepts = task.insights!.concepts;
    expect(concepts.map((c) => c.id).sort()).toEqual(["c1", "c2", "c3"]);
    const c1 = concepts.find((c) => c.id === "c1")!;
    expect(c1).toMatchObject({ title: "焼きなましで粒径が大きくなる", epistemicStatus: "observation", rebuttalConditions: ["試料が薄い場合"] });
    expect(c1.bodyPreview).toContain("粒径が大きくなる");
    expect(readJson(insightCoveragePath(root))).toMatchObject({ version: 1, round: 1 });
  });

  it("視野の提出済みに数えるのは submit_insights が受理された束だけ。配布中は別に数える", async () => {
    const r1 = await startInsightTask({}, ctx, root);
    expect(r1).toContain("視野: 提出済み 0/3（配布中 3 件。1 巡目");
    expect(r1).not.toContain("新しい巡に入りました");
    expect(readJson(insightCoveragePath(root)).covered).toEqual([]);
    expect(readJson(insightCoveragePath(root)).pending).toHaveLength(1);

    // INVALID_OUTPUT では確定しない
    const taskId = taskIdOf(r1);
    await submitInsights({ taskId, output: "洞察なし" }, ctx, root);
    expect(readJson(insightCoveragePath(root)).covered).toEqual([]);
    // 受理されたら確定する
    const ok = await submitInsights({ taskId, output: atomsOutput(B) }, ctx, root);
    expect(ok).toContain("まだ保存していません");
    expect(readJson(insightCoveragePath(root)).covered.sort()).toEqual(["c1", "c2", "c3"]);
    expect(readJson(insightCoveragePath(root)).pending).toEqual([]);
    expect(ok).not.toContain("視野");
  });

  it("全知見を提出し終えると次の巡に入る。restart で即リセット。提出されなかった束は見終えた扱いにならない", async () => {
    const r1 = await startInsightTask({}, ctx, root);
    // 提出しないまま取り直しても、提出済みは増えない（配布中は避けるが、知見が足りなければ重なる）
    const r1b = await startInsightTask({}, ctx, root);
    expect(r1b).toContain("視野: 提出済み 0/3");
    expect(r1b).not.toContain("新しい巡に入りました");
    expect(readJson(insightCoveragePath(root)).pending).toHaveLength(2);

    await submitInsights({ taskId: taskIdOf(r1), output: '{"atoms":[]}' }, ctx, root);
    const r2 = await startInsightTask({}, ctx, root);
    expect(r2).toContain("（配布中 3 件。2 巡目");
    expect(r2).toContain("新しい巡に入りました");

    const r3 = await startInsightTask({ restart: true }, ctx, root);
    expect(r3).toContain("。3 巡目");
    expect(readJson(insightCoveragePath(root)).round).toBe(3);
  });

  it("壊れた巡の台帳は新しい巡として始め、返事で知らせる。未知の version は上書きせず断る", async () => {
    writeFileSync(insightCoveragePath(root), "{broken");
    const reply = await startInsightTask({}, ctx, root);
    expect(reply).toContain("視野: 提出済み 0/3（配布中 3 件。1 巡目");
    expect(reply).toContain("視野の台帳が読めなかった");

    const future = JSON.stringify({ version: 2, round: 9, covered: [] });
    writeFileSync(insightCoveragePath(root), future);
    expect(await startInsightTask({}, ctx, root)).toMatch(/^LEDGER_CORRUPT:/);
    expect(readFileSync(insightCoveragePath(root), "utf8")).toBe(future);
  });
});

describe("submit_insights", () => {
  it("配っていない id は落ち、保存せずに審査の課題を返す（transfer / fold / relift の節）", async () => {
    const { review, reviewTaskId } = await toReview(A, { ...B, sourceConceptIds: ["zzz", "c3"] });
    expect(review).toContain("まだ保存していません");
    expect(review).toContain("審査は作者と別の文脈");
    expect(review).toContain("作ったときの推論は使わず");
    expect(review).toContain("アプリの審査が失敗したときと同じ既定");
    expect(reviewTaskId).toBeTruthy();
    expect(review).toContain('"transfer"');
    expect(review).toContain('"fold"');
    expect(review).toContain('"relift"');
    expect(review).not.toContain('"duplicates"');
    // 審査の SYSTEM PROMPT / USER MESSAGE はアプリのジャッジと同じ文
    expect(review).toContain("skeptical reviewer of cross-domain analogies");
    expect(review).toContain("skeptical reviewer of Atom \"folds\"");
    expect(review).toContain("clarity editor for Graphium Atoms");
    expect(review).toContain("transfer.example: \"車種が揃うほど渋滞が起きにくい\"");
    expect(atomIds()).toEqual([]);

    const ledger = readTaskLedger(root);
    const rt = ledger.tasks[reviewTaskId];
    expect(rt.kind).toBe("insight_review");
    // zzz は落ち、c3 だけが残る
    expect(rt.insightReview!.candidates[1].derivedFromClaims).toEqual(["c3"]);
    expect(rt.insightReview!.authorModel).toBe("author-model");
  });

  it("不正な出力は INVALID_OUTPUT で課題を消費しない。{\"atoms\":[]} は 0 件で完了", async () => {
    const taskId = taskIdOf(await startInsightTask({}, ctx, root));
    expect(await submitInsights({ taskId, output: "洞察はありません", model: "m" }, ctx, root)).toMatch(/^INVALID_OUTPUT:/);
    expect(await submitInsights({ taskId, output: "   " }, ctx, root)).toMatch(/^INVALID_OUTPUT:/);
    // 配っていない id だけ → 有効な洞察が 0 件（0 件の正当な形ではない）
    expect(
      await submitInsights({ taskId, output: atomsOutput({ ...B, sourceConceptIds: ["unknown"] }) }, ctx, root),
    ).toMatch(/^INVALID_OUTPUT:/);
    const done = await submitInsights({ taskId, output: '{"atoms":[]}' }, ctx, root);
    expect(done).toContain("洞察は 0 件でした");
    expect(done).toContain("視野: 提出済み 3/3");
    expect(await submitInsights({ taskId, output: '{"atoms":[]}' }, ctx, root)).toMatch(/^TASK_DONE:/);
  });

  it("台帳の照合: TASK_NOT_FOUND / TASK_EXPIRED / WRONG_TASK_KIND", async () => {
    expect(await submitInsights({ taskId: "nope", output: "{}" }, ctx, root)).toMatch(/^TASK_NOT_FOUND:/);
    const taskId = taskIdOf(await startInsightTask({}, ctx, root));
    const ledger = readJson(tasksLedgerPath(root));
    ledger.tasks[taskId].createdAt = new Date(Date.now() - 25 * 3600 * 1000).toISOString();
    writeJson(tasksLedgerPath(root), ledger);
    expect(await submitInsights({ taskId, output: atomsOutput(B) }, ctx, root)).toMatch(/^TASK_EXPIRED:/);

    // 審査の課題を submit_insights に、洞察の課題を submit_insight_review に渡す
    const { reviewTaskId, start } = await toReview(B);
    expect(await submitInsights({ taskId: reviewTaskId, output: atomsOutput(B) }, ctx, root)).toMatch(/^WRONG_TASK_KIND:/);
    expect(await submitInsightReview({ taskId: taskIdOf(start), output: "{}" }, ctx, root)).toMatch(/^TASK_DONE:/);
    const fresh = taskIdOf(await startInsightTask({}, ctx, root));
    expect(await submitInsightReview({ taskId: fresh, output: "{}" }, ctx, root)).toMatch(/^WRONG_TASK_KIND:/);
  });

  it("配った知見が消えた・変わったら TASK_STALE", async () => {
    const t1 = taskIdOf(await startInsightTask({}, ctx, root));
    const idx = readIndex();
    idx.notes.find((n: { noteId: string }) => n.noteId === "c2").deletedAt = "2026-10-27T00:00:00.000Z";
    writeJson(p("appdata", "note-index.json"), idx);
    expect(await submitInsights({ taskId: t1, output: atomsOutput(B) }, ctx, root)).toMatch(/^TASK_STALE:/);

    seedVault();
    const t2 = taskIdOf(await startInsightTask({}, ctx, root));
    writeJson(p("wiki", "c1.json"), wikiPage("焼きなましで粒径が大きくなる", "あとから書き換えた本文。", { kind: "claim", epistemicStatus: "observation" }));
    expect(await submitInsights({ taskId: t2, output: atomsOutput(B) }, ctx, root)).toMatch(/^TASK_STALE:/);
  });

  it("提出時にも設定と起動中を確かめる", async () => {
    const taskId = taskIdOf(await startInsightTask({}, ctx, root));
    writeFlags(true, false);
    expect(await submitInsights({ taskId, output: atomsOutput(B) }, ctx, root)).toMatch(/^INSIGHTS_DISABLED:/);
    writeFlags(true, true);
    writeJson(p("appdata", "app-heartbeat.json"), { via: "web", at: new Date().toISOString() });
    expect(await submitInsights({ taskId, output: atomsOutput(B) }, ctx, root)).toMatch(/^APP_RUNNING:/);
  });
});

describe("submit_insight_review: 保存", () => {
  it("審査を反映して保存する（transfer 却下・fold の部分集合・relift の差し替え・status 継承・来歴）", async () => {
    const { reviewTaskId } = await toReview(A, B);
    const answer = JSON.stringify({
      ...EMPTY, transfer: { items: [{ index: 1, valid: false, reason: "こじつけ" }] },
      fold: { items: [{ index: 1, coherentClaimIds: ["c1", "c2"], reason: "c3 は別の型" }] },
      relift: { atoms: [{ index: 1, title: "そろっているほど流れやすい", body: "そろっているほど、流れは止まりにくい。" }] },
    });
    const reply = await submitInsightReview({ taskId: reviewTaskId, output: answer, model: "reviewer-model" }, ctx, root);
    expect(reply).toContain("洞察を保存しました: 作成 2 件 / 支持追加 0 件 / 矛盾 0 件");
    expect(reply).toContain("審査で外した別分野の例（transfer）: 1 件");
    expect(reply).toContain("fold で絞った知見: 1 件");
    expect(reply).toMatch(/視野: 提出済み 3\/3/);

    const idA = createdIdOf(reply, "そろっているほど流れやすい");
    const idB = createdIdOf(reply, "冷えを速くすると乱れる");
    expect(idA && idB).toBeTruthy();
    const a = wikiDoc(idA);
    expect(a.wikiMeta.kind).toBe("atom");
    expect(a.wikiMeta.derivedFromClaims).toEqual(["c1", "c2"]);
    expect(a.wikiMeta.transfer).toBeUndefined();
    expect(a.wikiMeta.shape).toBe("monotonic-increase");
    // 入力の最低 status（speculation）を継承し、2 件以上が持つ rebuttal だけが伝播する
    expect(a.wikiMeta.epistemicStatus).toBe("speculation");
    expect(a.wikiMeta.rebuttalConditions).toEqual(["共通の反例"]);
    expect(JSON.stringify(a.pages[0].blocks)).toContain("そろっているほど、流れは止まりにくい");
    // 来歴: 作者が名乗ったモデル、MCP 経由の印、活動の種類
    expect(a.wikiMeta.generatedBy.model).toBe("author-model");
    expect(a.generatedBy.agent).toBe("graphium-mcp (test-client)");
    const acts = a.documentProvenance.activities;
    expect(acts[acts.length - 1].type).toBe("wiki_atomize");
    expect(acts[acts.length - 1].used).toEqual(["c1", "c2"]);
    expect(JSON.stringify(a.documentProvenance)).toContain("graphium-mcp (test-client)");
    const b = wikiDoc(idB);
    expect(b.wikiMeta.derivedFromClaims).toEqual(["c3"]);
    expect(b.wikiMeta.epistemicStatus).toBe("interpretation");
    // 索引
    expect(entryOf(idA).wikiKind).toBe("atom");
    // 操作の記録
    const ops = await listOperations({}, ctx, root);
    expect(ops).toContain("MCP で洞察を作成（2 件）");
    expect(ops).toContain("[maint-run-");
    // 同じ審査の再提出は TASK_DONE
    expect(await submitInsightReview({ taskId: reviewTaskId, output: answer }, ctx, root)).toMatch(/^TASK_DONE:/);
  });

  it("epistemicStatus は束の知見の最低値を継承する（speculation を含めば speculation）", async () => {
    const { reviewTaskId } = await toReview({ ...A, sourceConceptIds: ["c1", "c2"] });
    const reply = await submitInsightReview({ taskId: reviewTaskId, output: JSON.stringify({ ...EMPTY, transfer: { items: [{ index: 1, valid: true }] }, fold: { items: [{ index: 1, coherentClaimIds: ["c1", "c2"] }] } }) }, ctx, root);
    const id = createdIdOf(reply, "均質なほど流れやすい");
    const a = wikiDoc(id);
    expect(a.wikiMeta.epistemicStatus).toBe("speculation");
    expect(a.wikiMeta.rebuttalConditions).toEqual(["共通の反例"]);
    // 妥当と確認された transfer は残る
    expect(a.wikiMeta.transfer).toMatchObject({ field: "交通" });
  });

  it("答えの無い節はアプリの失敗時と同じ既定（transfer は外す・fold はそのまま・relift は元の文）", async () => {
    const { reviewTaskId } = await toReview(A);
    const reply = await submitInsightReview({ taskId: reviewTaskId, output: ALL_EMPTY }, ctx, root);
    expect(reply).toContain("答えのなかった審査");
    const a = wikiDoc(createdIdOf(reply, "均質なほど流れやすい"));
    expect(a.wikiMeta.transfer).toBeUndefined();
    expect(a.wikiMeta.derivedFromClaims).toEqual(["c1", "c2", "c3"]);
    expect(JSON.stringify(a.pages[0].blocks)).toContain("構成要素の性質が均質なほど");
  });

  it("fold が 1 件も confirm しなければ先頭 1 件に縮退（アプリの resolveFoldVerdict）。relift の答えが無い洞察は元の文のまま", async () => {
    const { reviewTaskId } = await toReview(A, B);
    const reply = await submitInsightReview(
      {
        taskId: reviewTaskId,
        output: JSON.stringify({
          ...EMPTY, transfer: { items: [{ index: 1, valid: true }] },
          fold: { items: [{ index: 1, coherentClaimIds: [], reason: "どれも違う" }] },
          relift: { atoms: [{ index: 1, title: "そろい方で流れが決まる", body: "そろい方が、流れやすさを決める。" }] },
        }),
      },
      ctx,
      root,
    );
    expect(reply).toContain("洞察を保存しました");
    expect(wikiDoc(createdIdOf(reply, "そろい方で流れが決まる")).wikiMeta.derivedFromClaims).toEqual(["c1"]);
    // 答えの無かった B は元の文のまま
    expect(createdIdOf(reply, "冷えを速くすると乱れる")).toBeTruthy();
  });

  it("審査の答えが JSON のオブジェクトでなければ INVALID_OUTPUT で課題を消費しない", async () => {
    const { reviewTaskId } = await toReview(B);
    expect(await submitInsightReview({ taskId: reviewTaskId, output: "審査しました" }, ctx, root)).toMatch(/^INVALID_OUTPUT:/);
    expect(await submitInsightReview({ taskId: reviewTaskId, output: "[1,2]" }, ctx, root)).toMatch(/^INVALID_OUTPUT:/);
    expect(await submitInsightReview({ taskId: reviewTaskId, output: " " }, ctx, root)).toMatch(/^INVALID_OUTPUT:/);
    expect(await submitInsightReview({ taskId: reviewTaskId, output: "```json\n" + ALL_EMPTY + "\n```" }, ctx, root)).toContain("洞察を保存しました");
  });

  it("審査のあとに依拠する知見が消えたら TASK_STALE", async () => {
    const { reviewTaskId } = await toReview(B);
    const idx = readIndex();
    idx.notes.find((n: { noteId: string }) => n.noteId === "c3").deletedAt = "2026-10-27T00:00:00.000Z";
    writeJson(p("appdata", "note-index.json"), idx);
    expect(await submitInsightReview({ taskId: reviewTaskId, output: "{}" }, ctx, root)).toMatch(/^TASK_STALE:/);
    expect(atomIds()).toEqual([]);
  });

  it("提出時にも設定と起動中を確かめる", async () => {
    const { reviewTaskId } = await toReview(B);
    writeFlags(true, false);
    expect(await submitInsightReview({ taskId: reviewTaskId, output: "{}" }, ctx, root)).toMatch(/^INSIGHTS_DISABLED:/);
    writeFlags(true, true);
    writeJson(p("appdata", "app-heartbeat.json"), { via: "web", at: new Date().toISOString() });
    expect(await submitInsightReview({ taskId: reviewTaskId, output: "{}" }, ctx, root)).toMatch(/^APP_RUNNING:/);
    expect(atomIds()).toEqual([]);
  });

  it("途中でアプリが起動したら以降を保存せず止める（課題は取り直せる）", async () => {
    const { reviewTaskId } = await toReview(A, B);
    hook.afterSave = () => writeJson(p("appdata", "app-heartbeat.json"), { via: "web", at: new Date().toISOString() });
    const reply = await submitInsightReview({ taskId: reviewTaskId, output: ALL_EMPTY }, ctx, root);
    expect(reply).toContain("起動したため");
    expect(atomIds()).toHaveLength(1);
    // 1 件は保存できているので課題は使い切る
    hook.afterSave = null;
    expect(await submitInsightReview({ taskId: reviewTaskId, output: ALL_EMPTY }, ctx, root)).toMatch(/^(TASK_DONE|APP_RUNNING):/);
  });
});

describe("submit_insight_review: 重複の候補と判定", () => {
  const EXISTING = {
    id: "a1",
    title: "構成要素が均質なほど流れが妨げられにくい",
    body: "構成要素の性質が均質なほど、内部の流れが妨げられにくい。キャリアの移動度が高まる。",
    claims: ["c1"],
  };
  const DUP: AtomOut = {
    title: "構成要素が均質なほど流れが妨げられにくい",
    body: "構成要素の性質が均質なほど、内部の流れが妨げられにくい。移動度が高くなる。",
    sourceConceptIds: ["c1", "c2"],
  };

  beforeEach(() => seedVault(CLAIMS, [EXISTING]));

  it("既存の洞察に近い候補だけ重複の節が出る（候補 1 件まで・無関係な候補は出ない）", async () => {
    const { review } = await toReview(DUP, B);
    expect(review).toContain('"duplicates"');
    expect(review).toContain("(existingId: a1)");
    // 無関係な B は対にならない（対は 1 つだけ）
    expect(review.match(/existingId: a1/g)).toHaveLength(1);
    expect(review).toContain("existing:  \"構成要素が均質なほど流れが妨げられにくい\"");
  });

  it("same → 既存の洞察を補強する（本文は変えず derivedFromClaims に足す。写しから戻せる）", async () => {
    const { reviewTaskId } = await toReview(DUP);
    const before = wikiDoc("a1");
    const reply = await submitInsightReview(
      { taskId: reviewTaskId, output: JSON.stringify({ ...EMPTY, duplicates: { verdicts: [{ index: 1, existingId: "a1", verdict: "same", reason: "同じ" }] } }) },
      ctx,
      root,
    );
    expect(reply).toContain("作成 0 件 / 支持追加 1 件 / 矛盾 0 件");
    expect(atomIds()).toEqual(["a1"]);
    const after = wikiDoc("a1");
    expect(after.wikiMeta.derivedFromClaims).toEqual(["c1", "c2"]);
    expect(after.title).toBe(before.title);
    expect(JSON.stringify(after.pages)).toBe(JSON.stringify(before.pages));
    const acts = after.documentProvenance.activities;
    expect(acts[acts.length - 1].type).toBe("wiki_reinforce");
    expect(acts[acts.length - 1].used).toEqual(["c2"]);

    // 取り消し: 補強の前の内容に戻る
    const undone = await undoOperation(opIds(reply), ctx, root);
    expect(undone).toContain("取り消しました");
    expect(wikiDoc("a1").wikiMeta.derivedFromClaims).toEqual(["c1"]);
  });

  it("same でも新しい支持が無ければ捨てる（アプリと同じ）", async () => {
    const { reviewTaskId } = await toReview({ ...DUP, sourceConceptIds: ["c1"] });
    const reply = await submitInsightReview(
      { taskId: reviewTaskId, output: JSON.stringify({ ...EMPTY, duplicates: { verdicts: [{ index: 1, existingId: "a1", verdict: "same" }] } }) },
      ctx,
      root,
    );
    expect(reply).toContain("新しい支持が無く捨てた候補: 1 件");
    expect(atomIds()).toEqual(["a1"]);
  });

  it("contradiction → 新しい洞察を別に作り、双方向に conflictsWith を書く。取り消しで両方戻る", async () => {
    const { reviewTaskId } = await toReview(DUP);
    const reply = await submitInsightReview(
      { taskId: reviewTaskId, output: JSON.stringify({ ...EMPTY, duplicates: { verdicts: [{ index: 1, existingId: "a1", verdict: "contradiction", reason: "逆" }] } }) },
      ctx,
      root,
    );
    expect(reply).toContain("作成 1 件 / 支持追加 0 件 / 矛盾 1 件");
    const newId = atomIds().find((id) => id !== "a1")!;
    expect(newId).toBeTruthy();
    expect(wikiDoc(newId).wikiMeta.conflictsWith).toEqual(["a1"]);
    expect(wikiDoc("a1").wikiMeta.conflictsWith).toEqual([newId]);

    const undone = await undoOperation(opIds(reply), ctx, root);
    expect(undone).toContain("取り消しました");
    expect(entryOf(newId).deletedAt).toBeTruthy();
    expect(wikiDoc("a1").wikiMeta.conflictsWith).toBeUndefined();
  });

  it("different か答えが無ければ新規", async () => {
    const t1 = await toReview(DUP);
    const different = await submitInsightReview({ taskId: t1.reviewTaskId, output: ALL_EMPTY }, ctx, root);
    expect(different).toContain("作成 1 件");
    expect(atomIds()).toHaveLength(2);
    expect(wikiDoc("a1").wikiMeta.derivedFromClaims).toEqual(["c1"]);
  });

  it("審査のあとに既存の洞察が変わっていたら統合しない（別として新規）", async () => {
    const t2 = await toReview(DUP);
    const doc = wikiDoc("a1");
    doc.pages[0].blocks = [para("b9", "人があとから書き換えた本文。")];
    writeJson(p("wiki", "a1.json"), doc);
    const changed = await submitInsightReview(
      { taskId: t2.reviewTaskId, output: JSON.stringify({ ...EMPTY, duplicates: { verdicts: [{ index: 1, existingId: "a1", verdict: "same" }] } }) },
      ctx,
      root,
    );
    expect(changed).toContain("作成 1 件 / 支持追加 0 件");
    expect(wikiDoc("a1").wikiMeta.derivedFromClaims).toEqual(["c1"]);
  });
});

describe("undo_operation（mcp_generate_insights）", () => {
  it("作った洞察はゴミ箱へ移り、ファイルは残る。記録の文面は「MCP で洞察を作成」", async () => {
    const { reviewTaskId } = await toReview(B);
    const reply = await submitInsightReview({ taskId: reviewTaskId, output: ALL_EMPTY }, ctx, root);
    const id = createdIdOf(reply, "冷えを速くすると乱れる");
    expect(entryOf(id).deletedAt).toBeUndefined();
    const undone = await undoOperation(opIds(reply), ctx, root);
    expect(undone).toContain("取り消しました");
    expect(entryOf(id).deletedAt).toBeTruthy();
    expect(atomIds()).toEqual([id]);
    expect(await listOperations({}, ctx, root)).toContain("MCP で洞察を作成（1 件）");
  });
});

describe("重複の候補探し（言語に応じた類似度）", () => {
  const existingJa = [
    { id: "x", title: "冷却を急ぐと秩序が崩れる", body: "冷却を急ぐほど、結晶の秩序が崩れやすい。急に冷やすと、内部にひずみが残る。" },
    { id: "y", title: "均質な構成ほど流れが止まりにくい", body: "構成要素の性質がそろっているほど、内部の流れは妨げられにくくなる。移動度が高くなる。" },
  ];
  const existingEn = [
    { id: "x", title: "Rapid cooling destroys crystalline order", body: "Quenching a melt quickly leaves residual strain inside the solid and lowers its crystallinity." },
    { id: "y", title: "Flow is impeded less when components are homogeneous", body: "Uniform component properties let carriers move through the material with fewer obstacles." },
  ];

  it("和文: 言い換えは候補になり、無関係な対は候補にならない。候補ごとに最良の 1 件", () => {
    const found = findDuplicateCandidates(
      [{ title: "構成要素が均質なほど流れが妨げられにくい", body: "構成要素の性質が均質なほど、内部の流れが妨げられにくい。キャリアの移動度が高まる。" }],
      existingJa,
    );
    expect(found).toHaveLength(1);
    expect(found[0].existing.id).toBe("y");
    expect(findDuplicateCandidates([{ title: "まったく関係ない料理の話", body: "パンを焼くには強力粉が要る。" }], existingJa)).toEqual([]);
  });

  it("英文: 言い換えは候補になり、無関係な対は候補にならない", () => {
    const found = findDuplicateCandidates(
      [{ title: "The more homogeneous the components, the less flow is impeded", body: "When component properties are uniform, carriers move through the material with fewer obstacles." }],
      existingEn,
    );
    expect(found).toHaveLength(1);
    expect(found[0].existing.id).toBe("y");
    expect(
      findDuplicateCandidates([{ title: "Baking bread needs strong flour", body: "Yeast ferments the dough slowly overnight in a cold kitchen." }], existingEn),
    ).toEqual([]);
    // 英語の無関係な対を文字 bigram で比べると高く出てしまう（単語で比べる理由）
    expect(textSimilarity(existingEn[0].body, "Baking bread needs strong flour. Yeast ferments the dough.")).toBeLessThan(0.15);
  });
});

describe("審査の答えの検証と来歴", () => {
  it("課題に含めた節のキーが欠けていたら INVALID_OUTPUT（どの節か示し、課題は消費しない）。空配列は可", async () => {
    const { reviewTaskId } = await toReview(A, B);
    const missing = await submitInsightReview({ taskId: reviewTaskId, output: "{}" }, ctx, root);
    expect(missing).toMatch(/^INVALID_OUTPUT:/);
    expect(missing).toContain("transfer, fold, relift");
    const partial = await submitInsightReview({ taskId: reviewTaskId, output: JSON.stringify({ transfer: [], relift: [] }) }, ctx, root);
    expect(partial).toContain("キーがありません: fold");
    expect(atomIds()).toEqual([]);
    expect(await submitInsightReview({ taskId: reviewTaskId, output: ALL_EMPTY }, ctx, root)).toContain("洞察を保存しました");
  });

  it("fold が一部の項目にしか答えていなければ「答えなし」に数えて返事に出す", async () => {
    const { reviewTaskId } = await toReview(A, { ...B, title: "二つの知見から", sourceConceptIds: ["c2", "c3"] });
    const reply = await submitInsightReview(
      { taskId: reviewTaskId, output: JSON.stringify({ ...EMPTY, fold: { items: [{ index: 1, coherentClaimIds: ["c1", "c2", "c3"] }] } }) },
      ctx,
      root,
    );
    expect(reply).toContain("fold（2 件中 1 件にだけ答え");
  });

  it("審査を待つ間に依拠する知見が変わっていたら TASK_STALE", async () => {
    const { reviewTaskId } = await toReview(B);
    writeJson(p("wiki", "c3.json"), wikiPage("冷却速度が結晶性を決める", "冷却が速いほど結晶性が下がる。", { kind: "claim", epistemicStatus: "established" }));
    expect(await submitInsightReview({ taskId: reviewTaskId, output: ALL_EMPTY }, ctx, root)).toMatch(/^TASK_STALE:/);
    expect(atomIds()).toEqual([]);
  });

  it("作者がモデル名を名乗らなければ unknown（審査役のモデルは洞察に書かない）", async () => {
    const start = await startInsightTask({}, ctx, root);
    const review = await submitInsights({ taskId: taskIdOf(start), output: atomsOutput(B) }, ctx, root);
    const reply = await submitInsightReview({ taskId: reviewTaskIdOf(review), output: ALL_EMPTY, model: "reviewer-model" }, ctx, root);
    const doc = wikiDoc(createdIdOf(reply, "冷えを速くすると乱れる"));
    expect(doc.wikiMeta.generatedBy.model).toBe("unknown");
    expect(doc.generatedBy.model).toBeUndefined();
    expect(JSON.stringify(doc)).not.toContain("reviewer-model");
  });

  it("途中で止まったら、保存しなかった候補のタイトルを返事に出す", async () => {
    const { reviewTaskId } = await toReview(A, B);
    hook.afterSave = () => writeJson(p("appdata", "app-heartbeat.json"), { via: "web", at: new Date().toISOString() });
    const reply = await submitInsightReview({ taskId: reviewTaskId, output: ALL_EMPTY }, ctx, root);
    expect(reply).toContain("保存しなかった候補:");
    expect(reply).toContain("「冷えを速くすると乱れる」");
  });
});
