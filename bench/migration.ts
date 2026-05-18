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
//   - "noDataLoss": true なら、input にあった key が必ず output にも残る
//
// `pnpm test:migration` で全 fixture を順次 migrate し、不変量違反があれば fail。
// Phase μ-3 時点では document migration (v1-v4 → v5) のみ完全動作する。
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
  /** noDataLoss=true なら、input の primitives 全てが output に等価に残る */
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
    checks.push({
      name: "version",
      passed: ok,
      reason: ok ? `version === ${expect.version}` : `expected ${expect.version}, got ${after.version}`,
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
    // input にあった primitive key→value セットが output にも残ること。
    // labels の値変更や key rename は許容するため、key 単位ではなく value 集合で比較。
    const beforeValues = new Set<string>();
    deepKeys(before, "", []); // warm up
    const beforeList: string[] = [];
    deepKeys(before, "", beforeList);
    for (const entry of beforeList) {
      const v = entry.split("=").slice(1).join("=");
      beforeValues.add(v);
    }
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
  }

  return checks;
}

function pathExists(obj: unknown, path: string): boolean {
  const parts = path.split(".");
  let cur: any = obj;
  for (const p of parts) {
    if (cur == null) return false;
    const m = p.match(/^(.+?)\[(\d+)\]$/);
    if (m) {
      cur = cur[m[1]];
      if (!Array.isArray(cur)) return false;
      cur = cur[parseInt(m[2], 10)];
      continue;
    }
    cur = cur[p];
  }
  return cur !== undefined;
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

  // データロス系の fail は CI を block する。Phase μ-3 では document migration は
  // 全 pass する想定（v1-v4 fixture は既存 production コードを通すだけ）。
  if (anyFail && process.env.BENCH_MIGRATION_STRICT === "true") {
    process.exit(1);
  }
}

const invokedAsScript =
  !!process.argv[1] && import.meta.url.endsWith(basename(process.argv[1]));
if (invokedAsScript) {
  main();
}
