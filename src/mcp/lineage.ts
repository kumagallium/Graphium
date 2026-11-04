// ノート間の来歴（MCP 用の包み）。本体は features/prov-graph/lineage.ts。
// vault のファイルを読む reader を作って本体に渡すだけ。意味論の説明は本体の冒頭を参照。

import type { ProvGraphReader } from "../features/prov-graph/reader";
import * as core from "../features/prov-graph/lineage";
import { allEntries } from "./search";
import { describeSource } from "./sources";
import { readNote, resolveGraphiumRoot } from "./vault";

export type { LineageEdge, LineageLayer, LineageNode, LineageResult } from "../features/prov-graph/lineage";

/** vault を読む reader */
export function vaultReader(root = resolveGraphiumRoot()): ProvGraphReader {
  return {
    entries: () => allEntries(root),
    readNote: (id) => readNote(id, root),
    sourceTitle: (id, titles) => describeSource(id, root, titles).title,
  };
}

export const upstreamOf = (noteId: string, root = resolveGraphiumRoot()) => core.upstreamOf(noteId, vaultReader(root));
export const downstreamOf = (noteId: string, root = resolveGraphiumRoot()) => core.downstreamOf(noteId, vaultReader(root));
export const upstreamKnowledgeOf = (noteId: string, root = resolveGraphiumRoot()) =>
  core.upstreamKnowledgeOf(noteId, vaultReader(root));
export const downstreamKnowledgeOf = (noteId: string, root = resolveGraphiumRoot()) =>
  core.downstreamKnowledgeOf(noteId, vaultReader(root));

export function traceLineage(
  noteId: string,
  options: { direction?: "upstream" | "downstream" | "both"; depth?: number } = {},
  root = resolveGraphiumRoot(),
): core.LineageResult {
  return core.traceLineage(noteId, options, vaultReader(root));
}
