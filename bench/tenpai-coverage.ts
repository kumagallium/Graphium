// Tenpai layer coverage measurement (Phase A 観察、2026-05-26)
//
// PR #354 で note 単位 clustering 化した tenpai heuristic が、現状の atom コーパスに
// 対してどれだけ「届いている / 沈黙している」かを測る。判定境界（causal===1 /
// mechanistic===1 / observational≥1 & causal=0 & mech=0）は atom が育つと「ちょうど
// 1 件」を満たさなくなって沈黙する性質があるので、silence_rate を将来の境界調整
// （または LLM 聴牌 = B 案）の判断材料として記録する。
//
// 出力:
//   - stdout に集計（cluster サイズ分布、silence_rate、mode 分布など）
//   - bench/results/tenpai-coverage-<timestamp>.json に raw 集計
//
// 実行:
//   pnpm tsx bench/tenpai-coverage.ts

import { readFileSync, readdirSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";

import { REPO_ROOT } from "./load.ts";
import { computeTenpaiHints } from "../src/features/ai-assistant/tenpai-hints.ts";
import type {
  GraphiumDocument,
  GraphiumFile,
  WikiMetaSummary,
} from "../src/lib/document-types.ts";

type WikiFile = GraphiumDocument & { wikiMeta?: GraphiumDocument["wikiMeta"] };

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

function histogram(values: number[]): Record<number, number> {
  const h: Record<number, number> = {};
  for (const v of values) h[v] = (h[v] ?? 0) + 1;
  return h;
}

function main() {
  const wikiDir = join(REPO_ROOT, "data/wiki");
  const all = loadWiki(wikiDir);
  console.log(`[tenpai-coverage] wiki files: ${all.length}`);

  // GraphiumFile[] と WikiMetaSummary Map を作る（React 側と同じ shape）
  const wikiFiles: GraphiumFile[] = all.map(({ id, file }) => ({
    id,
    name: file.title ?? id,
    modifiedTime: file.modifiedAt ?? "",
    createdTime: file.createdAt ?? "",
  }));
  const wikiMetas = new Map<string, WikiMetaSummary>();
  const docCache = new Map<string, GraphiumDocument>();
  for (const { id, file } of all) {
    wikiMetas.set(id, {
      title: file.title ?? id,
      kind: file.wikiMeta?.kind ?? "claim",
      atomType: file.wikiMeta?.atomType,
      synthesisMode: file.wikiMeta?.synthesisMode,
    });
    docCache.set(`wiki:${id}`, file);
  }

  const atomMetas = [...wikiMetas.values()].filter((m) => m.kind === "atom");
  const claimMetas = [...wikiMetas.values()].filter((m) => m.kind === "claim");
  const synthesisMetas = [...wikiMetas.values()].filter((m) => m.kind === "synthesis");
  console.log(
    `[tenpai-coverage] kinds: atom=${atomMetas.length} claim=${claimMetas.length} synthesis=${synthesisMetas.length}`,
  );

  // atom 全体の atomType 分布（参考）
  const atomTypeDist: Record<string, number> = {};
  for (const m of atomMetas) {
    const key = m.atomType ?? "(none)";
    atomTypeDist[key] = (atomTypeDist[key] ?? 0) + 1;
  }
  console.log(`[tenpai-coverage] atomType distribution:`, atomTypeDist);

  // note 単位 clustering を直接覗くため、computeTenpaiHints の前段を手動で再現する
  // （bench script なので可読性を優先）
  const noteToAtoms = new Map<string, string[]>();
  const atomSourceCount = new Map<string, number>();
  for (const { id, file } of all) {
    if (file.wikiMeta?.kind !== "atom") continue;
    const noteSet = new Set<string>();
    const claimIds = file.wikiMeta.derivedFromClaims ?? [];
    for (const claimId of claimIds) {
      const claim = docCache.get(`wiki:${claimId}`);
      for (const noteId of claim?.wikiMeta?.derivedFromNotes ?? []) {
        noteSet.add(noteId);
      }
    }
    atomSourceCount.set(id, noteSet.size);
    for (const noteId of noteSet) {
      const list = noteToAtoms.get(noteId);
      if (list) list.push(id);
      else noteToAtoms.set(noteId, [id]);
    }
  }

  const TENPAI_MIN = 6; // TENPAI_MIN_ATOM_COUNT（tenpai-types.ts と同期）
  const clusterSizes = [...noteToAtoms.values()].map((c) => c.length);
  const clustersBigEnough = clusterSizes.filter((n) => n >= TENPAI_MIN).length;
  const sizeHist = histogram(clusterSizes);

  console.log(`[tenpai-coverage] unique source notes: ${noteToAtoms.size}`);
  console.log(`[tenpai-coverage] cluster size histogram (atoms per note):`, sizeHist);
  console.log(
    `[tenpai-coverage] clusters with >= ${TENPAI_MIN} atoms: ${clustersBigEnough} / ${noteToAtoms.size}`,
  );

  // atom が辿れる note 数（広く参照されている atom の指標）
  const sourceHist = histogram([...atomSourceCount.values()]);
  console.log(`[tenpai-coverage] atom source-note count histogram:`, sourceHist);

  // 実際に computeTenpaiHints を呼んで結果を得る
  const hints = computeTenpaiHints({
    wikiFiles,
    wikiMetas,
    getCachedDoc: (key) => docCache.get(key),
    now: new Date().toISOString(),
  });

  const modeDist: Record<string, number> = {};
  for (const h of hints) modeDist[h.mode] = (modeDist[h.mode] ?? 0) + 1;

  // silence_rate: eligible cluster のうち hint が出なかった割合
  // hint の involvedAtoms[0] がどの cluster の atom か逆引きして「発火 cluster」を数える
  const firedClusterNotes = new Set<string>();
  for (const h of hints) {
    const atomId = h.involvedAtoms[0]?.id;
    if (!atomId) continue;
    for (const [noteId, atomIds] of noteToAtoms) {
      if (atomIds.length >= TENPAI_MIN && atomIds.includes(atomId)) {
        firedClusterNotes.add(noteId);
      }
    }
  }
  const silenceRate = clustersBigEnough === 0
    ? null
    : 1 - firedClusterNotes.size / clustersBigEnough;

  console.log(`[tenpai-coverage] hints fired: ${hints.length}`);
  console.log(`[tenpai-coverage] hint mode distribution:`, modeDist);
  console.log(
    `[tenpai-coverage] silence_rate: ${silenceRate === null ? "n/a (no eligible clusters)" : silenceRate.toFixed(3)} ` +
      `(eligible clusters: ${clustersBigEnough}, fired: ${firedClusterNotes.size})`,
  );

  // 結果を dump
  const resultsDir = join(REPO_ROOT, "bench/results");
  if (!existsSync(resultsDir)) mkdirSync(resultsDir, { recursive: true });
  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  const outPath = join(resultsDir, `tenpai-coverage-${ts}.json`);
  writeFileSync(
    outPath,
    JSON.stringify(
      {
        ranAt: new Date().toISOString(),
        wikiFiles: all.length,
        kinds: {
          atom: atomMetas.length,
          claim: claimMetas.length,
          synthesis: synthesisMetas.length,
        },
        atomTypeDistribution: atomTypeDist,
        clusterSizeHistogram: sizeHist,
        atomSourceCountHistogram: sourceHist,
        uniqueSourceNotes: noteToAtoms.size,
        clustersBigEnough,
        tenpaiMinAtomCount: TENPAI_MIN,
        hintsFired: hints.length,
        modeDistribution: modeDist,
        firedClusters: firedClusterNotes.size,
        silenceRate,
        hintSamples: hints.slice(0, 10).map((h) => ({
          mode: h.mode,
          missingKey: h.missingKey,
          involvedAtoms: h.involvedAtoms,
        })),
      },
      null,
      2,
    ),
  );
  console.log(`[tenpai-coverage] dumped: ${outPath}`);
}

main();
