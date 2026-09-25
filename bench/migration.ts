// Phase μ-3: migration fixture runner
//
// 「schema を bump する Phase（η / γ / δ / ε / ζ）が既存ユーザーのデータを壊さない」
// ことを fixture ベースで確認する。
//
// fixtures/document/  - 旧 version の GraphiumDocument スナップショット
// fixtures/index/     - 旧 version の GraphiumIndex スナップショット
//
// 各 fixture は次のレイアウトを持つ:
//   <name>.input.json     ← 古いバージョンのデータ
//   <name>.expect.json    ← migration 後に守られるべき不変量（assertions）
//
// 不変量 (`expect.json`) は厳密な equality ではなく必要条件として書く:
//   - version === <number>
//   - "title" / "noteCount" 等の主要フィールドが保持される
//   - "labels.<blockId>" が rename されている
//   - "paths" の各パスが指定の値になっている（ブロックの木を組み替える移行の形を確かめる）
//   - "noDataLoss": true なら、title / createdAt と、全ブロックの id・本文テキストが output にも残る
//
// `pnpm test:migration` で全 fixture を順次 migrate し、不変量違反があれば fail。
// document migration は v1〜v5 の各段（→ 最新 v6）に fixture がある。
// LATEST_DOCUMENT_VERSION を上げたら、expect の version を上げ、新しい段の
// fixture（入力 = 1 つ前の version）を足す。上げ忘れると CI の migration ジョブが落ちる。
// Phase η 以降が INDEX bump fixture を追加していく前提。

import { readFileSync, readdirSync, existsSync, writeFileSync } from "node:fs";
import { join, dirname, basename } from "node:path";
import { fileURLToPath } from "node:url";

import { migrateToLatest, LATEST_DOCUMENT_VERSION } from "../src/lib/document-migration.ts";
import type { GraphiumDocument } from "../src/lib/document-types.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const BENCH_DIR = __dirname;
const FIXTURE_DIR = join(BENCH_DIR, "migration", "fixtures");

export type MigrationFixtureKind = "document" | "index";

export type MigrationExpect = {
  /** migrate 後に GraphiumDocument.version がこの値になっていること */
  version?: number;
  /** 期待する WikiKind 値（document.wikiMeta.kind === expected） */
  wikiKind?: string;
  /** 含まれるべき labels の key → value マップ（label rename を検証） */
  labels?: Record<string, string>;
  /** 旧 key が input にあったが output には残っていないことを確認するパス */
  removedKeys?: string[];
  /** 保持されるべきトップレベルキー（title / pages / createdAt 等） */
  preservedKeys?: string[];
  /**
   * migrate 後に、パス（removedKeys と同じ書式: "pages[0].blocks[1].type"）の値が
   * これと等しいこと（JSON で比較）。v6 の step 化のようにブロックの木を組み替える
   * 移行で、どのブロックがどこに収まったかを確かめる
   */
  paths?: Record<string, unknown>;
  /**
   * noDataLoss=true なら、title / createdAt と、全ブロック（children を含む）の id と
   * 本文テキストが output にも残る。表のセルの中身は見ない
   */
  noDataLoss?: boolean;
  /** index 用: notes 件数の不変量 */
  noteCount?: number;
  /** 任意の自由記述（fixture の意図） */
  rationale?: string;
};

export type MigrationCheck = {
  name: string;
  passed: boolean;
  reason: string;
  /** 失敗したときの直し方。同じ文言は集約して summary の最後に 1 回だけ出す */
  hint?: string;
};

export type MigrationResult = {
  fixture: string;
  kind: MigrationFixtureKind;
  passed: boolean;
  checks: MigrationCheck[];
  error?: string;
};

export type MigrationReport = {
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  fixtureCount: number;
  documentPassRate: number;
  indexPassRate: number;
  results: MigrationResult[];
};

function deepKeys(value: unknown, prefix: string, out: string[]): void {
  if (Array.isArray(value)) {
    value.forEach((v, i) => deepKeys(v, `${prefix}[${i}]`, out));
    return;
  }
  if (value && typeof value === "object") {
    for (const [k, v] of Object.entries(value)) {
      deepKeys(v, prefix ? `${prefix}.${k}` : k, out);
    }
    return;
  }
  out.push(`${prefix}=${JSON.stringify(value)}`);
}

function evaluateDocument(
  before: GraphiumDocument,
  after: GraphiumDocument,
  expect: MigrationExpect,
): MigrationCheck[] {
  const checks: MigrationCheck[] = [];

  if (typeof expect.version === "number") {
    const ok = after.version === expect.version;
    // 最新 version に上がったのに期待値が古いだけなら、移行ではなく fixture の更新漏れ
    const staleExpect =
      !ok && after.version === LATEST_DOCUMENT_VERSION && expect.version < LATEST_DOCUMENT_VERSION;
    checks.push({
      name: "version",
      passed: ok,
      reason: ok ? `version === ${expect.version}` : `expected ${expect.version}, got ${after.version}`,
      hint: staleExpect
        ? `LATEST_DOCUMENT_VERSION is now ${LATEST_DOCUMENT_VERSION} but some expect files still say ` +
          `${expect.version}. Bump "version" in bench/migration/fixtures/document/*.expect.json and add a ` +
          `fixture whose input is version ${LATEST_DOCUMENT_VERSION - 1} for the new migration step.`
        : undefined,
    });
  } else {
    // 既定: LATEST_DOCUMENT_VERSION に揃っていること
    const ok = after.version === LATEST_DOCUMENT_VERSION;
    checks.push({
      name: "version-latest",
      passed: ok,
      reason: ok ? `version === ${LATEST_DOCUMENT_VERSION}` : `expected ${LATEST_DOCUMENT_VERSION}, got ${after.version}`,
    });
  }

  if (typeof expect.wikiKind === "string") {
    const got = (after as any).wikiMeta?.kind;
    const ok = got === expect.wikiKind;
    checks.push({
      name: "wikiMeta.kind",
      passed: ok,
      reason: ok ? `kind === "${expect.wikiKind}"` : `expected "${expect.wikiKind}", got "${got}"`,
    });
  }

  if (expect.labels) {
    for (const [blockId, expectedLabel] of Object.entries(expect.labels)) {
      let actual: string | undefined;
      for (const page of after.pages ?? []) {
        if (page.labels && page.labels[blockId] != null) {
          actual = page.labels[blockId] as string;
          break;
        }
      }
      const ok = actual === expectedLabel;
      checks.push({
        name: `labels[${blockId}]`,
        passed: ok,
        reason: ok ? `mapped to "${expectedLabel}"` : `expected "${expectedLabel}", got "${actual ?? "(absent)"}"`,
      });
    }
  }

  if (Array.isArray(expect.removedKeys)) {
    for (const path of expect.removedKeys) {
      const present = pathExists(after, path);
      checks.push({
        name: `removed:${path}`,
        passed: !present,
        reason: present ? `${path} still present after migration` : `${path} removed`,
      });
    }
  }

  if (expect.paths) {
    for (const [path, expected] of Object.entries(expect.paths)) {
      const actual = getPath(after, path);
      const ok = JSON.stringify(actual) === JSON.stringify(expected);
      checks.push({
        name: `path:${path}`,
        passed: ok,
        reason: ok
          ? `=== ${JSON.stringify(expected)}`
          : `expected ${JSON.stringify(expected)}, got ${actual === undefined ? "(absent)" : JSON.stringify(actual)}`,
      });
    }
  }

  if (Array.isArray(expect.preservedKeys)) {
    for (const key of expect.preservedKeys) {
      const before_ = (before as any)[key];
      const after_ = (after as any)[key];
      const ok = JSON.stringify(before_) === JSON.stringify(after_);
      checks.push({
        name: `preserved:${key}`,
        passed: ok,
        reason: ok ? `${key} preserved` : `${key} mutated`,
      });
    }
  }

  if (expect.noDataLoss === true) {
    // labels の値変更や key rename は許容するため、key 単位ではなく value 集合で比較。
    const afterList: string[] = [];
    deepKeys(after, "", afterList);
    const afterValues = new Set(afterList.map((e) => e.split("=").slice(1).join("=")));

    // title / pages 等の structural value が残っているか
    const titleOk = afterValues.has(JSON.stringify(before.title));
    checks.push({
      name: "noDataLoss:title",
      passed: titleOk,
      reason: titleOk ? "title preserved" : `title "${before.title}" lost`,
    });
    const createdAtOk = afterValues.has(JSON.stringify(before.createdAt));
    checks.push({
      name: "noDataLoss:createdAt",
      passed: createdAtOk,
      reason: createdAtOk ? "createdAt preserved" : `createdAt "${before.createdAt}" lost`,
    });

    // ブロックの木を組み替える移行（v6 の step 化）が、ブロックを落としたり id を
    // 振り直したりしていないこと。id はメモ・リンク・PROV（activity_<id>）の参照先なので、
    // 位置が変わっても値が残っていなければならない。
    const beforeBlocks = collectBlockContent(before);
    const afterBlocks = collectBlockContent(after);
    const afterIds = new Set(afterBlocks.ids);
    const lostIds = beforeBlocks.ids.filter((id) => !afterIds.has(id));
    checks.push({
      name: "noDataLoss:blockIds",
      passed: lostIds.length === 0,
      reason:
        lostIds.length === 0
          ? `${beforeBlocks.ids.length} block id(s) preserved`
          : `block id(s) lost: ${lostIds.join(", ")}`,
    });
    // 同じ文字列が複数のブロックにあっても片方の消失に気づけるよう、出現回数で突き合わせる
    const afterTextCounts = new Map<string, number>();
    for (const t of afterBlocks.texts) afterTextCounts.set(t, (afterTextCounts.get(t) ?? 0) + 1);
    const lostTexts: string[] = [];
    for (const t of beforeBlocks.texts) {
      const left = afterTextCounts.get(t) ?? 0;
      if (left === 0) lostTexts.push(t);
      else afterTextCounts.set(t, left - 1);
    }
    checks.push({
      name: "noDataLoss:blockText",
      passed: lostTexts.length === 0,
      reason:
        lostTexts.length === 0
          ? `${beforeBlocks.texts.length} text run(s) preserved`
          : `text lost: ${lostTexts.map((t) => JSON.stringify(t)).join(", ")}`,
    });
  }

  return checks;
}

/** 全ページのブロック（children を含む）の id と、インライン本文の text を集める（表のセルは見ない） */
function collectBlockContent(doc: GraphiumDocument): { ids: string[]; texts: string[] } {
  const ids: string[] = [];
  const texts: string[] = [];
  const walkInline = (content: unknown): void => {
    if (!Array.isArray(content)) return;
    for (const c of content as any[]) {
      if (typeof c?.text === "string") texts.push(c.text);
      // link 等はインラインの中にさらにインラインを持つ
      walkInline(c?.content);
    }
  };
  const walkBlocks = (blocks: unknown): void => {
    if (!Array.isArray(blocks)) return;
    for (const b of blocks as any[]) {
      if (typeof b?.id === "string") ids.push(b.id);
      walkInline(b?.content);
      walkBlocks(b?.children);
    }
  };
  for (const page of doc.pages ?? []) walkBlocks(page.blocks);
  return { ids, texts };
}

/** "pages[0].blocks[1].id" 形式のパスで値を取り出す。途中で途切れたら undefined */
function getPath(obj: unknown, path: string): unknown {
  let cur: any = obj;
  for (const p of path.split(".")) {
    if (cur == null) return undefined;
    const m = p.match(/^(.+?)\[(\d+)\]$/);
    if (m) {
      cur = cur[m[1]];
      if (!Array.isArray(cur)) return undefined;
      cur = cur[parseInt(m[2], 10)];
      continue;
    }
    cur = cur[p];
  }
  return cur;
}

function pathExists(obj: unknown, path: string): boolean {
  return getPath(obj, path) !== undefined;
}

function evaluateIndex(
  before: any,
  expect: MigrationExpect,
): MigrationCheck[] {
  const checks: MigrationCheck[] = [];

  // index migration は `ensureIndex` で全件 rebuild される設計。
  // ここでは fixture が「rebuild 後の最新スキーマに乗っているか」だけ確認する。
  // 旧スキーマ fixture は version < CURRENT で意図的に保存し、Phase η 以降の
  // bump 時に「migrate runner が拾えるか」を回帰する placeholder として残す。
  if (typeof expect.version === "number") {
    const ok = before?.version === expect.version;
    checks.push({
      name: "index.version",
      passed: ok,
      reason: ok ? `version === ${expect.version}` : `expected ${expect.version}, got ${before?.version}`,
    });
  }
  if (typeof expect.noteCount === "number") {
    const got = Array.isArray(before?.notes) ? before.notes.length : 0;
    const ok = got === expect.noteCount;
    checks.push({
      name: "index.noteCount",
      passed: ok,
      reason: ok ? `notes.length === ${expect.noteCount}` : `expected ${expect.noteCount}, got ${got}`,
    });
  }
  return checks;
}

type FixturePair = {
  name: string;
  kind: MigrationFixtureKind;
  inputPath: string;
  expectPath: string;
};

function discoverFixtures(kind: MigrationFixtureKind): FixturePair[] {
  const dir = join(FIXTURE_DIR, kind);
  if (!existsSync(dir)) return [];
  const entries = readdirSync(dir).filter((f) => f.endsWith(".input.json"));
  return entries
    .map((f): FixturePair => {
      const name = f.replace(/\.input\.json$/, "");
      return {
        name,
        kind,
        inputPath: join(dir, f),
        expectPath: join(dir, `${name}.expect.json`),
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

function runOneFixture(fix: FixturePair): MigrationResult {
  let inputRaw: string;
  let expectRaw: string;
  try {
    inputRaw = readFileSync(fix.inputPath, "utf-8");
    expectRaw = readFileSync(fix.expectPath, "utf-8");
  } catch (err) {
    return {
      fixture: fix.name,
      kind: fix.kind,
      passed: false,
      checks: [],
      error: `fixture load failed: ${(err as Error).message}`,
    };
  }
  let input: any;
  let expect: MigrationExpect;
  try {
    input = JSON.parse(inputRaw);
    expect = JSON.parse(expectRaw);
  } catch (err) {
    return {
      fixture: fix.name,
      kind: fix.kind,
      passed: false,
      checks: [],
      error: `fixture JSON parse failed: ${(err as Error).message}`,
    };
  }

  if (fix.kind === "document") {
    let migrated: GraphiumDocument;
    try {
      migrated = migrateToLatest(structuredClone(input) as GraphiumDocument);
    } catch (err) {
      return {
        fixture: fix.name,
        kind: fix.kind,
        passed: false,
        checks: [],
        error: `migrateToLatest threw: ${(err as Error).message}`,
      };
    }
    const checks = evaluateDocument(input as GraphiumDocument, migrated, expect);
    return {
      fixture: fix.name,
      kind: fix.kind,
      passed: checks.length > 0 && checks.every((c) => c.passed),
      checks,
    };
  }

  const checks = evaluateIndex(input, expect);
  return {
    fixture: fix.name,
    kind: fix.kind,
    passed: checks.length > 0 && checks.every((c) => c.passed),
    checks,
  };
}

export function runMigrationFixtures(): MigrationReport {
  const startedAt = new Date();
  const documents = discoverFixtures("document");
  const indexes = discoverFixtures("index");
  const fixtures = [...documents, ...indexes];

  const results: MigrationResult[] = [];
  for (const fix of fixtures) {
    results.push(runOneFixture(fix));
  }

  const finishedAt = new Date();
  const docResults = results.filter((r) => r.kind === "document");
  const idxResults = results.filter((r) => r.kind === "index");
  return {
    startedAt: startedAt.toISOString(),
    finishedAt: finishedAt.toISOString(),
    durationMs: finishedAt.getTime() - startedAt.getTime(),
    fixtureCount: results.length,
    documentPassRate: docResults.length ? docResults.filter((r) => r.passed).length / docResults.length : 0,
    indexPassRate: idxResults.length ? idxResults.filter((r) => r.passed).length / idxResults.length : 0,
    results,
  };
}

function fmtRate(n: number): string {
  return `${(n * 100).toFixed(1)}%`;
}

function main(): void {
  const report = runMigrationFixtures();

  const outPath =
    process.env.BENCH_MIGRATION_OUTPUT ??
    join(BENCH_DIR, "results", `migration-latest.json`);
  if (process.env.BENCH_WRITE !== "false") {
    writeFileSync(outPath, JSON.stringify(report, null, 2), "utf-8");
    console.log(`[migration] wrote ${outPath}`);
  }

  console.log("\n========== migration summary ==========");
  console.log(`fixtures             : ${report.fixtureCount}`);
  console.log(`document pass rate   : ${fmtRate(report.documentPassRate)}`);
  console.log(`index pass rate      : ${fmtRate(report.indexPassRate)}`);
  console.log(`duration             : ${report.durationMs} ms`);
  console.log("");

  let anyFail = false;
  for (const r of report.results) {
    const tag = r.passed ? "PASS" : "FAIL";
    const err = r.error ? ` (${r.error})` : "";
    console.log(`[${tag}] ${r.kind.padEnd(8)} ${r.fixture}${err}`);
    for (const c of r.checks) {
      console.log(`    ${c.passed ? "✓" : "✗"} ${c.name}: ${c.reason}`);
    }
    if (!r.passed) anyFail = true;
  }

  const hints = new Set(
    report.results.flatMap((r) => r.checks.filter((c) => !c.passed && c.hint).map((c) => c.hint!)),
  );
  for (const hint of hints) {
    console.log(`\nhint: ${hint}`);
  }

  // データロス系の fail は CI を block する。document migration は全 pass する想定
  // （各 fixture は既存 production コードを通すだけ）。
  if (anyFail && process.env.BENCH_MIGRATION_STRICT === "true") {
    process.exit(1);
  }
}

const invokedAsScript =
  !!process.argv[1] && import.meta.url.endsWith(basename(process.argv[1]));
if (invokedAsScript) {
  main();
}
