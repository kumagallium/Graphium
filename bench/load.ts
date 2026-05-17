// Phase μ-1: corpus / ground-truth / probes のローダー

import { readFileSync, readdirSync } from "node:fs";
import { join, dirname, basename } from "node:path";
import { fileURLToPath } from "node:url";
import type { CorpusNote, GroundTruth, Probe } from "./types.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
export const BENCH_DIR = __dirname;
export const REPO_ROOT = join(__dirname, "..");

export function loadCorpus(): CorpusNote[] {
  const dir = join(BENCH_DIR, "corpus");
  const files = readdirSync(dir).filter((f) => f.endsWith(".note.json")).sort();
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
