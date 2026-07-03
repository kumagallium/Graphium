// Phase μ-1: corpus / ground-truth / probes のローダー
// Phase μ-2: ドメイン解決ヘルパーを追加

import { readFileSync, readdirSync } from "node:fs";
import { join, dirname, basename } from "node:path";
import { fileURLToPath } from "node:url";
import type { CorpusDomain, CorpusNote, GroundTruth, Probe } from "./types.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
export const BENCH_DIR = __dirname;
export const REPO_ROOT = join(__dirname, "..");

export function loadCorpus(): CorpusNote[] {
  const dir = join(BENCH_DIR, "corpus");
  let files = readdirSync(dir).filter((f) => f.endsWith(".note.json")).sort();
  // BENCH_CORPUS_ONLY: カンマ区切りの部分一致リストで corpus を絞る（BENCH_CORPUS_LIMIT が
  // 先頭 N 件しか取れないのに対し、特定ノートだけを狙って回せる）。cross-language pair
  // (047..052) だけで cross_language_consistency を安く実測する等に使う。
  const only = (process.env.BENCH_CORPUS_ONLY ?? "").trim();
  if (only.length > 0) {
    const needles = only.split(",").map((s) => s.trim()).filter(Boolean);
    files = files.filter((f) => needles.some((n) => f.includes(n)));
  }
  return files.map((f) => {
    const raw = readFileSync(join(dir, f), "utf-8");
    return JSON.parse(raw) as CorpusNote;
  });
}

export function loadGroundTruthMap(): Map<string, GroundTruth> {
  const dir = join(BENCH_DIR, "ground-truth");
  const files = readdirSync(dir).filter((f) => f.endsWith(".gt.json"));
  const map = new Map<string, GroundTruth>();
  for (const f of files) {
    const raw = readFileSync(join(dir, f), "utf-8");
    const gt = JSON.parse(raw) as GroundTruth;
    map.set(gt.noteId, gt);
  }
  return map;
}

export function loadProbes(): Probe[] {
  const dir = join(BENCH_DIR, "probes");
  const files = readdirSync(dir).filter((f) => f.endsWith(".probe.json")).sort();
  return files.map((f) => {
    const raw = readFileSync(join(dir, f), "utf-8");
    return JSON.parse(raw) as Probe;
  });
}

export function resolveProbeInput(relPath: string): CorpusNote {
  const abs = join(REPO_ROOT, relPath);
  const raw = readFileSync(abs, "utf-8");
  return JSON.parse(raw) as CorpusNote;
}

export function corpusFileBaseName(relPath: string): string {
  return basename(relPath).replace(/\.note\.json$/, "");
}

// Phase μ-2: ノートのドメインを決定する。
// 明示の domain が無ければ category から推定する（既存 25 ノートは domain 未設定）。
export function resolveDomain(note: CorpusNote): CorpusDomain {
  if (note.domain) return note.domain;
  switch (note.category) {
    case "clean-lab":
    case "wrong-speculation":
      // wrong-speculation は body 内容が栄養/医療寄りなのでひとまず "biology" に寄せる
      return note.category === "clean-lab" ? "materials" : "biology";
    case "clean-software":
    case "contradiction-pair":
      return "software";
    case "cross-domain-pair":
      // 既存の cross-domain pair (免疫/HIDS, 進化/SGD) は biology と software をまたぐ。
      // 個別の domain は明示の方が良いが、後方互換として misc を返す。
      return "misc";
    case "casual-musing":
    case "pure-observation":
      return "misc";
    case "clean-en-technical":
      return "materials";
    case "casual-musing-en":
      return "misc";
    case "bio-note":
      return "biology";
    case "econ-note":
      return "economics";
    case "humanities-note":
      return "humanities";
    case "cross-language-pair":
      return "misc";
    default:
      return "misc";
  }
}
