// MatPROV Hugging Face dataset から gold standard を fetch して fixtures に書き出す。
//
// 仕様（external-source-extraction-prompt.md §10）に従い 5-30 本のサンプルを集める。
// HF dataset (MatPROV-project/MatPROV) は (doi, label, prov_jsonld) のみで
// 論文本文 paragraph を含まない。fetcher は prov_jsonld のみ取得し、
// 対応する `.input.txt` は手動配置とする（README に明記）。
//
// 既に paper text が揃っている fixture（seed-cu2-fexs など）はスキップする。
//
// 使い方:
//   tsx tests/benchmark/material-science/fetch-dataset.ts --count 10 [--offset 0]

import { mkdirSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = join(__dirname, "fixtures");

type HfRow = {
  row: {
    doi: string;
    label: string;
    prov_jsonld: unknown;
  };
};

type HfResponse = {
  features: unknown;
  rows: HfRow[];
  num_rows_total: number;
};

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const count = Math.max(1, Math.min(50, args.count ?? 10));
  const offset = Math.max(0, args.offset ?? 0);

  mkdirSync(FIXTURES_DIR, { recursive: true });

  const params = new URLSearchParams({
    dataset: "MatPROV-project/MatPROV",
    config: "default",
    split: "train",
    offset: String(offset),
    length: String(count),
  });
  const url = `https://datasets-server.huggingface.co/rows?${params}`;
  console.log(`Fetching ${count} rows from offset ${offset} ...`);
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`HF datasets-server returned ${res.status}: ${await res.text()}`);
  }
  const data = (await res.json()) as HfResponse;
  console.log(`Got ${data.rows.length} rows (total in split: ${data.num_rows_total}).`);

  let written = 0;
  let skipped = 0;
  for (const r of data.rows) {
    const doi = r.row.doi;
    const label = r.row.label;
    if (!doi) continue;
    const slug = sanitizeId(doi) + "__" + sanitizeId(label);
    const goldPath = join(FIXTURES_DIR, `${slug}.gold.json`);
    const inputPath = join(FIXTURES_DIR, `${slug}.input.txt`);
    if (existsSync(goldPath)) {
      skipped++;
      continue;
    }
    // gold standard を [{label, @graph}] 形式に揃える（評価層と一致させる）
    const gold = [
      {
        label,
        "@graph": (r.row.prov_jsonld as { "@graph"?: unknown[] })["@graph"] ?? [],
      },
    ];
    writeFileSync(goldPath, JSON.stringify(gold, null, 2));
    if (!existsSync(inputPath)) {
      writeFileSync(
        inputPath,
        `# Source: ${doi}\n# Label: ${label}\n#\n# Paste the relevant synthesis paragraph from the paper here.\n# This fixture's input.txt is intentionally empty — HF dataset does not ship paper text.\n`,
      );
    }
    written++;
  }
  console.log(`Wrote ${written} fixtures, skipped ${skipped} existing.`);
  console.log(`Fill in *.input.txt for each fixture before running the benchmark.`);
}

function parseArgs(argv: string[]): { count?: number; offset?: number } {
  const out: { count?: number; offset?: number } = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--count") out.count = Number(argv[++i]);
    else if (argv[i] === "--offset") out.offset = Number(argv[++i]);
  }
  return out;
}

function sanitizeId(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
