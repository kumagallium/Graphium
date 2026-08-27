// ノート間の来歴（PROV 層リンク）を辿る。
//
// 方向の意味論は src/lib/block-link-types.ts の ProvLinkType に従う。
// リンクは「後のもの → 元のもの」に張られる（derived_from: データ→考察、
// used: 手順→試料、informed_by: 手順2→手順1）。したがってノートから出ている
// provLinks は **上流** を指す。下流は他ノートからの参照を逆引きして得る。
//
// 注意: ノート間の来歴は 2 経路ある。index の outgoingLinks は両方を layer:"prov" に
// 射影してしまう（index-file.ts）ので、向きを知るには本体を読む必要がある。
//   - page.provLinks / doc.derivedFromNoteId … このノートが元にしたもの（上流）
//   - doc.noteLinks                          … このノートから派生したもの（下流）
// 実データには provLinks が空で noteLinks だけを持つノートが存在するため、
// 下流は noteLinks を直接読んだうえで、相手側の上流からの逆引きも足して取りこぼしを防ぐ。

import type { LinkType } from "../lib/block-link-types";
import { allEntries } from "./search";
import { readNote, resolveGraphiumRoot } from "./vault";

export type LineageEdge = {
  /** 相手側のノート ID */
  noteId: string;
  title: string;
  type: LinkType;
  /** リンク元ブロック（このノート側） */
  sourceBlockId: string;
  /** リンク先ブロック（相手ノート側） */
  targetBlockId: string;
  /** リンク作成時のスナップショット（リンク切れでも文脈が残る） */
  stepTitle?: string;
  entityLabel?: string;
  createdBy?: string;
};

/** ノートから出ている PROV リンク（= 上流）を集める */
export function upstreamOf(noteId: string, root = resolveGraphiumRoot()): LineageEdge[] {
  const doc = readNote(noteId, root);
  if (!doc) return [];

  const edges: LineageEdge[] = [];
  const seen = new Set<string>();

  for (const page of doc.pages ?? []) {
    for (const link of page?.provLinks ?? []) {
      const target = link.targetNoteId;
      // 自ノート内のリンクは来歴の「ノート間」追跡では扱わない（self-loop ガード）
      if (!target || target === noteId) continue;
      const key = `${target}:${link.sourceBlockId}:${link.targetBlockId}`;
      if (seen.has(key)) continue;
      seen.add(key);
      edges.push({
        noteId: target,
        title: link.targetNoteTitle ?? "",
        type: link.type,
        sourceBlockId: link.sourceBlockId,
        targetBlockId: link.targetBlockId,
        stepTitle: link.targetStepTitle,
        entityLabel: link.targetEntityLabel,
        createdBy: link.createdBy,
      });
    }
  }

  // ドキュメントレベルの派生元（ノートを「派生」で作った場合）
  if (doc.derivedFromNoteId && doc.derivedFromNoteId !== noteId) {
    const key = `${doc.derivedFromNoteId}:doc`;
    if (!seen.has(key)) {
      edges.push({
        noteId: doc.derivedFromNoteId,
        title: "",
        type: "derived_from",
        sourceBlockId: doc.derivedFromBlockId ?? "",
        targetBlockId: doc.derivedFromBlockId ?? "",
      });
    }
  }

  return edges;
}

/**
 * このノートから派生した他ノート（= 下流）を集める。
 *
 * doc.noteLinks（派生先への参照）を読むのが主。加えて、相手側だけが
 * derivedFromNoteId / provLinks を持つ場合に備えて逆引きも行う。
 * 実データでは両表現が混在しており、片方だけでは取りこぼす。
 */
export function downstreamOf(noteId: string, root = resolveGraphiumRoot()): LineageEdge[] {
  const edges: LineageEdge[] = [];
  const seen = new Set<string>();
  const push = (edge: LineageEdge) => {
    const key = `${edge.noteId}:${edge.sourceBlockId}:${edge.targetBlockId}`;
    if (seen.has(key)) return;
    seen.add(key);
    edges.push(edge);
  };

  const titles = new Map(allEntries(root).map((e) => [e.noteId, e.title]));

  // 1) 自ノートの noteLinks が派生先を指している
  const doc = readNote(noteId, root);
  for (const link of doc?.noteLinks ?? []) {
    if (!link.targetNoteId || link.targetNoteId === noteId) continue;
    push({
      noteId: link.targetNoteId,
      title: titles.get(link.targetNoteId) ?? "",
      type: link.type,
      sourceBlockId: link.sourceBlockId ?? "",
      targetBlockId: "",
    });
  }

  // 2) 相手側の上流に自分がいる場合の逆引き（noteLinks を持たないデータのため）
  const candidates = allEntries(root).filter(
    (e) =>
      e.noteId !== noteId &&
      (e.outgoingLinks ?? []).some(
        (l) => l.targetNoteId === noteId && l.layer === "prov",
      ),
  );
  for (const entry of candidates) {
    for (const edge of upstreamOf(entry.noteId, root)) {
      if (edge.noteId !== noteId) continue;
      push({
        ...edge,
        // 下流から見た相手は「派生した側」なので入れ替える
        noteId: entry.noteId,
        title: entry.title,
      });
    }
  }

  return edges;
}

export type LineageNode = {
  noteId: string;
  title: string;
  depth: number;
  /** この一段をどう辿ってきたか（起点ノートは undefined） */
  via?: { type: LinkType; sourceBlockId: string; targetBlockId: string; stepTitle?: string };
};

export type LineageResult = {
  noteId: string;
  upstream: LineageNode[];
  downstream: LineageNode[];
};

function walk(
  startId: string,
  depth: number,
  step: (id: string) => LineageEdge[],
  titleOf: (id: string) => string,
): LineageNode[] {
  const out: LineageNode[] = [];
  const visited = new Set<string>([startId]);
  let frontier: string[] = [startId];

  for (let d = 1; d <= depth; d++) {
    const next: string[] = [];
    for (const id of frontier) {
      for (const edge of step(id)) {
        if (visited.has(edge.noteId)) continue;
        visited.add(edge.noteId);
        next.push(edge.noteId);
        out.push({
          noteId: edge.noteId,
          title: edge.title || titleOf(edge.noteId),
          depth: d,
          via: {
            type: edge.type,
            sourceBlockId: edge.sourceBlockId,
            targetBlockId: edge.targetBlockId,
            stepTitle: edge.stepTitle,
          },
        });
      }
    }
    if (next.length === 0) break;
    frontier = next;
  }
  return out;
}

export function traceLineage(
  noteId: string,
  options: { direction?: "upstream" | "downstream" | "both"; depth?: number } = {},
  root = resolveGraphiumRoot(),
): LineageResult {
  const { direction = "both", depth = 2 } = options;
  const titles = new Map(allEntries(root).map((e) => [e.noteId, e.title]));
  const titleOf = (id: string) => titles.get(id) ?? "";

  return {
    noteId,
    upstream:
      direction === "downstream" ? [] : walk(noteId, depth, (id) => upstreamOf(id, root), titleOf),
    downstream:
      direction === "upstream" ? [] : walk(noteId, depth, (id) => downstreamOf(id, root), titleOf),
  };
}
