// World-grounding KB coverage measurement (Phase A 観察、2026-05-26)
//
// 目的:
//   seed KB（public/grounding-kb/seed.v1.json）に対して、既存 atoms と syntheses
//   がどの程度マッチするかを集計する。Synthesizer が KB を gate として参照したと
//   仮定したとき、何割の synthesis 起動で何らかの verdict が引けるかを数値化する。
//
// データソース:
//   - public/grounding-kb/seed.v1.json — seed KB
//   - data/wiki/*.json — appdata の wiki（atom / synthesis を抽出）
//   ※ data/ は worktree から親 provnote/ にシンボリックリンクされている前提
//
// マッチング規則:
//   distilled-kb-retriever の matchKeyword と同じ正規化 (NFKC lowercase) +
//   素朴な includes、>= 2 keywords が同一 entry で一致したら hit。
//
// 出力:
//   - bench/results/kb-coverage-<timestamp>.json — raw 集計
//   - stdout に要約
//
// 副作用: なし（appdata は読むだけ）。
//
// 実行:
//   pnpm tsx bench/kb-coverage.ts

import { readFileSync, readdirSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";

import { REPO_ROOT } from "./load.ts";

type KbEntry = { id: string; verdict: string; keywords: string[] };
type KbFile = { version: number; entries: KbEntry[] };

type WikiKind = "summary" | "claim" | "atom" | "synthesis" | "meta-atom" | string;
type WikiBlock = { type: string; content?: { text?: string; type?: string }[] };
type WikiPage = { blocks?: WikiBlock[] };
type WikiFile = {
  title?: string;
  pages?: WikiPage[];
  wikiMeta?: {
    kind?: WikiKind;
    atomType?: string;
    synthesisMode?: string;
    sourceConceptIds?: string[];
  };
};

type Match = {
  entryId: string;
  verdict: string;
  matchedKeywords: string[];
};

function normalize(text: string): string {
  return text.normalize("NFKC").toLowerCase().replace(/\s+/g, " ").trim();
}

function matchEntry(text: string, entry: KbEntry): Match | null {
  const matched = entry.keywords.filter((k) => {
    const n = normalize(k);
    return n.length > 0 && text.includes(n);
  });
  if (matched.length < 2) return null;
  return { entryId: entry.id, verdict: entry.verdict, matchedKeywords: matched };
}

function bestMatch(text: string, kb: KbEntry[]): Match | null {
  const norm = normalize(text);
  if (!norm) return null;
  let best: Match | null = null;
  for (const entry of kb) {
    if (!Array.isArray(entry.keywords) || entry.keywords.length === 0) continue;
    const m = matchEntry(norm, entry);
    if (m && (!best || m.matchedKeywords.length > best.matchedKeywords.length)) {
      best = m;
    }
  }
  return best;
}

function extractWikiText(f: WikiFile): string {
  const parts: string[] = [];
  if (f.title) parts.push(f.title);
  for (const page of f.pages ?? []) {
    for (const block of page.blocks ?? []) {
      for (const c of block.content ?? []) {
        if (c.text) parts.push(c.text);
      }
    }
  }
  return parts.join("\n");
}

function loadKb(): KbEntry[] {
  const path = join(REPO_ROOT, "public/grounding-kb/seed.v1.json");
  const raw = readFileSync(path, "utf-8");
  const json = JSON.parse(raw) as KbFile;
  return Array.isArray(json.entries) ? json.entries : [];
}

function loadWiki(dir: string): { id: string; file: WikiFile }[] {
  if (!existsSync(dir)) return [];
  const files = readdirSync(dir).filter((f) => f.endsWith(".json"));
  return files.map((f) => {
    const id = f.replace(/\.json$/, "");
    const raw = readFileSync(join(dir, f), "utf-8");
    const file = JSON.parse(raw) as WikiFile;
    return { id, file };
  });
}

function main() {
  const kb = loadKb();
  console.log(`[kb-coverage] KB entries: ${kb.length}`);

  const wikiDir = join(REPO_ROOT, "data/wiki");
  const all = loadWiki(wikiDir);
  console.log(`[kb-coverage] wiki files: ${all.length}`);

  const atoms = all.filter((w) => w.file.wikiMeta?.kind === "atom");
  const syntheses = all.filter((w) => w.file.wikiMeta?.kind === "synthesis");
  const claims = all.filter((w) => w.file.wikiMeta?.kind === "claim");
  const summaries = all.filter((w) => w.file.wikiMeta?.kind === "summary");
  console.log(
    `[kb-coverage] kinds: claim=${claims.length} atom=${atoms.length} synthesis=${syntheses.length} summary=${summaries.length}`,
  );

  // Atoms
  let atomHits = 0;
  const atomVerdictCounts: Record<string, number> = {};
  const atomDetails: { id: string; title: string; atomType?: string; match: Match | null }[] = [];
  for (const a of atoms) {
    const text = extractWikiText(a.file);
    const m = bestMatch(text, kb);
    if (m) {
      atomHits++;
      atomVerdictCounts[m.verdict] = (atomVerdictCounts[m.verdict] ?? 0) + 1;
    }
    atomDetails.push({
      id: a.id,
      title: a.file.title ?? "",
      atomType: a.file.wikiMeta?.atomType,
      match: m,
    });
  }
  const atomHitRate = atoms.length > 0 ? atomHits / atoms.length : 0;
  console.log(
    `[kb-coverage] Atom hit rate: ${atomHits}/${atoms.length} = ${(atomHitRate * 100).toFixed(1)}%`,
  );

  // Syntheses — 2 つの解釈
  // (a) synthesis 自体のテキスト（title + body）が KB にマッチするか
  // (b) synthesis の sourceConceptIds (= 入力 atom) のいずれかが KB にマッチするか
  //     これは「Synthesizer が呼ばれる時点で gate を発火させるか」に近い

  const synthSelfHitDetails: { id: string; title: string; match: Match | null }[] = [];
  let synthSelfHits = 0;
  for (const s of syntheses) {
    const text = extractWikiText(s.file);
    const m = bestMatch(text, kb);
    if (m) synthSelfHits++;
    synthSelfHitDetails.push({ id: s.id, title: s.file.title ?? "", match: m });
  }
  const synthSelfHitRate = syntheses.length > 0 ? synthSelfHits / syntheses.length : 0;

  // (b) source atoms の hit を見る
  // atomId -> Match | null マップを作る
  const atomMatchById = new Map<string, Match | null>();
  for (const d of atomDetails) atomMatchById.set(d.id, d.match);

  let synthAnySourceHits = 0;
  let synthSourceUnknown = 0;
  const synthGateDetails: {
    id: string;
    title: string;
    sourceConceptIds: string[];
    sourceHitVerdicts: string[];
    anyHit: boolean;
  }[] = [];
  for (const s of syntheses) {
    const srcIds = s.file.wikiMeta?.sourceConceptIds ?? [];
    if (!Array.isArray(srcIds) || srcIds.length === 0) {
      synthSourceUnknown++;
      synthGateDetails.push({
        id: s.id,
        title: s.file.title ?? "",
        sourceConceptIds: [],
        sourceHitVerdicts: [],
        anyHit: false,
      });
      continue;
    }
    const verdicts: string[] = [];
    for (const id of srcIds) {
      const m = atomMatchById.get(id);
      if (m) verdicts.push(m.verdict);
    }
    const anyHit = verdicts.length > 0;
    if (anyHit) synthAnySourceHits++;
    synthGateDetails.push({
      id: s.id,
      title: s.file.title ?? "",
      sourceConceptIds: srcIds,
      sourceHitVerdicts: verdicts,
      anyHit,
    });
  }
  const synthGateHitRate = syntheses.length > 0 ? synthAnySourceHits / syntheses.length : 0;

  console.log(
    `[kb-coverage] Synthesis self-text hit rate: ${synthSelfHits}/${syntheses.length} = ${(synthSelfHitRate * 100).toFixed(1)}%`,
  );
  console.log(
    `[kb-coverage] Synthesis source-atom (gate proxy) hit rate: ${synthAnySourceHits}/${syntheses.length} = ${(synthGateHitRate * 100).toFixed(1)}% (sourceConceptIds 欠落: ${synthSourceUnknown}件)`,
  );

  console.log(`[kb-coverage] verdict distribution on Atom hits:`, atomVerdictCounts);

  // 書き出し
  const resultsDir = join(REPO_ROOT, "bench/results");
  mkdirSync(resultsDir, { recursive: true });
  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  const outPath = join(resultsDir, `kb-coverage-${ts}.json`);
  writeFileSync(
    outPath,
    JSON.stringify(
      {
        timestamp: new Date().toISOString(),
        kbEntries: kb.length,
        kindCounts: {
          claim: claims.length,
          atom: atoms.length,
          synthesis: syntheses.length,
          summary: summaries.length,
        },
        atom: {
          hitCount: atomHits,
          total: atoms.length,
          hitRate: atomHitRate,
          verdictDistribution: atomVerdictCounts,
        },
        synthesis: {
          selfTextHitRate: { hitCount: synthSelfHits, total: syntheses.length, rate: synthSelfHitRate },
          sourceAtomGateHitRate: {
            hitCount: synthAnySourceHits,
            total: syntheses.length,
            rate: synthGateHitRate,
            sourceConceptIdsMissing: synthSourceUnknown,
          },
        },
        details: { atoms: atomDetails, syntheses: synthGateDetails, synthSelf: synthSelfHitDetails },
      },
      null,
      2,
    ),
  );
  console.log(`\n[kb-coverage] wrote ${outPath}`);
}

main();
