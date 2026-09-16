// ──────────────────────────────────────────────
// 全体ビューの集約（プロセス一覧の上に置く、ステップ名で畳んだ有向グラフ）
//
// note-chain-plan.md §2.5。ProcessIndex（投影キャッシュ）から、ノートをまたいだ
// cross-note 参照（crossNoteLinks）を「供給側 step 名 → 消費側 step 名」の
// エッジへ変換し、受け渡し回数（線の太さ）を数える。
//
// 名寄せは collectStepNames と同じ規則（trim・"(無題)" 除外）。ただし ここでは
// t() を使わず、未題ラベルは呼び出し側から opts.untitledLabel として渡す。
// ──────────────────────────────────────────────

import type { ProcessIndex, ProcessIndexEntry } from "./process-index";

export type StepNameGraph = {
  /** name = 正規化後の表示名。noteCount = その名前の step を持つノート数 */
  nodes: { name: string; noteCount: number }[];
  /** from = 供給側 step 名、to = 消費側 step 名、count = 受け渡し回数（1 本 = 1 回、畳まない） */
  edges: { from: string; to: string; count: number }[];
  /** 名前が解決できなかった cross-note リンクの数。黙って落とさず UI に出す */
  dropped: number;
};

/**
 * step 名の正規化。空文字・未題ラベルは候補から外す（collectStepNames と同じ規則）。
 */
function normalizeStepName(name: string | undefined, untitledLabel?: string): string | null {
  const trimmed = (name ?? "").trim();
  if (!trimmed) return null;
  if (untitledLabel && trimmed === untitledLabel) return null;
  return trimmed;
}

export function aggregateStepNameGraph(
  processIndex: ProcessIndex | null,
  opts?: { since?: string; untitledLabel?: string },
): StepNameGraph {
  const empty: StepNameGraph = { nodes: [], edges: [], dropped: 0 };
  if (!processIndex) return empty;

  const since = opts?.since;
  // since は「参照を持つ側（消費側）のエントリ」だけを絞る。供給側の解決は
  // 全件の index（フィルタ前）で行う — 供給側ノートが期間外でも名前は正しく引けるが、
  // 線としては数えない（dropped に計上）。詳細は note-chain-plan.md §2.5。
  const activeEntries: ProcessIndexEntry[] = since
    ? processIndex.processes.filter((entry) => entry.sourceModifiedAt >= since)
    : processIndex.processes;
  const activeIds = new Set(activeEntries.map((entry) => entry.noteId));

  // 供給側の解決に使う全件 index（フィルタ前）。期間外でも「ノートが存在するか」は
  // ここで判定する
  const allEntryById = new Map(processIndex.processes.map((entry) => [entry.noteId, entry]));

  const nameToNotes = new Map<string, Set<string>>();
  const addName = (name: string, noteId: string) => {
    if (!nameToNotes.has(name)) nameToNotes.set(name, new Set());
    nameToNotes.get(name)!.add(noteId);
  };

  // 対象エントリの step 名を先に全部登録する（エッジに出ない孤立ノードも出すため）
  for (const entry of activeEntries) {
    for (const step of entry.graph.steps) {
      const name = normalizeStepName(step.name, opts?.untitledLabel);
      if (name) addName(name, entry.noteId);
    }
  }

  const edgeCounts = new Map<string, { from: string; to: string; count: number }>();
  let dropped = 0;

  for (const entry of activeEntries) {
    for (const link of entry.crossNoteLinks ?? []) {
      if (!link.targetNoteId) continue; // ノート間参照でなければ集計対象外

      // 消費側 = このエントリの graph.steps から sourceBlockId で引く
      const consumerStep = entry.graph.steps.find((step) => step.id === link.sourceBlockId);
      const consumerName = normalizeStepName(consumerStep?.name, opts?.untitledLabel);
      if (!consumerName) {
        dropped++;
        continue;
      }

      // 供給側 = targetNoteId のエントリを全件 index から引く。
      //   - 全件 index に無い（削除・アーカイブ済み等） → 切れた参照。dropped
      //   - 全件 index にはあるが期間外 → 名前としては正しく引けるが線としては数えない。dropped
      //   - 期間内で targetBlockId の step が見つからない（改名・削除） → targetStepTitle にフォールバック
      //   - フォールバックも無ければ dropped
      const targetEntry = allEntryById.get(link.targetNoteId);
      if (!targetEntry) {
        dropped++;
        continue;
      }
      if (!activeIds.has(targetEntry.noteId)) {
        dropped++;
        continue;
      }
      const targetStep = targetEntry.graph.steps.find((step) => step.id === link.targetBlockId);
      const supplierName =
        normalizeStepName(targetStep?.name, opts?.untitledLabel) ??
        normalizeStepName(link.targetStepTitle, opts?.untitledLabel);
      if (!supplierName) {
        dropped++;
        continue;
      }

      addName(consumerName, entry.noteId);
      addName(supplierName, link.targetNoteId);

      // 異なる 2 ノートの step が同名の場合、from === to の見た目になるが
      // これは仕様どおりそのまま出す（自己ループとして畳んだり除外したりしない）
      const key = `${supplierName} ${consumerName}`;
      const existing = edgeCounts.get(key);
      if (existing) {
        existing.count++;
      } else {
        edgeCounts.set(key, { from: supplierName, to: consumerName, count: 1 });
      }
    }
  }

  const nodes = [...nameToNotes.entries()]
    .map(([name, notes]) => ({ name, noteCount: notes.size }))
    .sort((a, b) => b.noteCount - a.noteCount || a.name.localeCompare(b.name));

  const edges = [...edgeCounts.values()].sort(
    (a, b) => b.count - a.count || a.from.localeCompare(b.from) || a.to.localeCompare(b.to),
  );

  return { nodes, edges, dropped };
}
