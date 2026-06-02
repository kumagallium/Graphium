// ──────────────────────────────────────────────
// Whole-note derivation
//
// Phase 4 of the PROV roadmap (docs/internal/external-source-note.md).
// Builds a brand-new GraphiumDocument from an existing one with:
//   - all blocks deeply re-cloned with fresh IDs
//   - labels, step attributes, provLinks, knowledgeLinks remapped to the new IDs
//   - derivedFromNoteId pointing back to the source
//
// This is the "no special notes" stance from external-source-note.md:
// derivation is a property all notes share. Phase 3 covered block-range
// copy/paste; Phase 4 covers whole-note copy via a single header action.
// ──────────────────────────────────────────────

import type { BlockLink } from "../block-link/link-types";
import type { GraphiumDocument, GraphiumPage, NoteLink } from "../../lib/document-types";
import { newId } from "../../lib/id";

/**
 * Deep-clone a BlockNote block tree, assigning a new ID to every block.
 * Returns the cloned tree plus an old→new ID map covering every node.
 */
export function cloneBlocksWithIdMap(
  blocks: readonly any[],
): { blocks: any[]; idMap: Map<string, string> } {
  const idMap = new Map<string, string>();
  const cloneList = (list: readonly any[]): any[] =>
    list.map((block) => {
      const cloned: any = { ...block };
      if (typeof block?.id === "string") {
        const fresh = newId();
        idMap.set(block.id, fresh);
        cloned.id = fresh;
      }
      // BlockNote blocks may carry props / content / children. content can be
      // an array of inline nodes (no IDs) or a tableContent object — we clone
      // by reference here to keep the implementation simple. Block IDs are
      // the only identifiers labels / links target.
      if (Array.isArray(block?.children) && block.children.length > 0) {
        cloned.children = cloneList(block.children);
      }
      return cloned;
    });
  return { blocks: cloneList(blocks), idMap };
}

/** Remap labels (blockId → label) using the new IDs. */
export function remapLabels(
  labels: Record<string, string> | undefined,
  idMap: ReadonlyMap<string, string>,
): Record<string, string> {
  if (!labels) return {};
  const out: Record<string, string> = {};
  for (const [oldId, label] of Object.entries(labels)) {
    const next = idMap.get(oldId);
    if (next) out[next] = label;
  }
  return out;
}

/**
 * Remap an arbitrary record keyed by blockId (used for connected attributes
 * snapshots — e.g. procedure StepAttributes).
 */
export function remapByBlockId<T>(
  src: Record<string, T> | undefined,
  idMap: ReadonlyMap<string, string>,
): Record<string, T> {
  if (!src) return {};
  const out: Record<string, T> = {};
  for (const [oldId, value] of Object.entries(src)) {
    const next = idMap.get(oldId);
    if (next) out[next] = value;
  }
  return out;
}

/**
 * Remap block-to-block links to the new IDs. Drops links whose endpoints
 * are not both inside the cloned range and assigns a fresh link id so the
 * derived note doesn't share IDs with the source.
 */
export function remapLinks(
  links: readonly BlockLink[] | undefined,
  idMap: ReadonlyMap<string, string>,
): BlockLink[] {
  if (!links) return [];
  const out: BlockLink[] = [];
  for (const link of links) {
    const newSource = idMap.get(link.sourceBlockId);
    const newTarget = idMap.get(link.targetBlockId);
    if (!newSource || !newTarget) continue;
    out.push({
      ...link,
      id: newId(),
      sourceBlockId: newSource,
      targetBlockId: newTarget,
    });
  }
  return out;
}

/**
 * Remap an indexTables record: { tableBlockId → { sampleName → noteFileId } }.
 * Keys at the outer level are block IDs (need remapping); inner values are
 * note IDs from other notes (left intact).
 */
function remapIndexTables(
  src: Record<string, Record<string, string>> | undefined,
  idMap: ReadonlyMap<string, string>,
): Record<string, Record<string, string>> | undefined {
  if (!src) return undefined;
  const out: Record<string, Record<string, string>> = {};
  for (const [oldId, inner] of Object.entries(src)) {
    const next = idMap.get(oldId);
    if (next) out[next] = { ...inner };
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

export type BuildDerivedDocumentInput = {
  sourceDoc: GraphiumDocument;
  sourceNoteId: string;
  derivedTitle: string;
  /** Override timestamp (defaults to now). Mainly for tests. */
  now?: string;
};

/**
 * Build a fresh GraphiumDocument that mirrors `sourceDoc` with new IDs and
 * a `derivedFromNoteId` pointer back. The source document is left untouched.
 *
 * The whole-note derivation deliberately does not set `derivedFromBlockId`:
 * the relationship is note-to-note. Per-block derivation is still available
 * through the existing handleDeriveNote path.
 */
export function buildDerivedDocument(input: BuildDerivedDocumentInput): GraphiumDocument {
  const { sourceDoc, sourceNoteId, derivedTitle } = input;
  const now = input.now ?? new Date().toISOString();

  const sourcePage: Partial<GraphiumPage> = sourceDoc.pages?.[0] ?? {};
  const { blocks, idMap } = cloneBlocksWithIdMap(sourcePage.blocks ?? []);

  const newPage: GraphiumPage = {
    id: "main",
    title: derivedTitle,
    blocks,
    labels: remapLabels(sourcePage.labels, idMap),
    provLinks: remapLinks(sourcePage.provLinks as BlockLink[] | undefined, idMap),
    knowledgeLinks: remapLinks(sourcePage.knowledgeLinks as BlockLink[] | undefined, idMap),
    indexTables: remapIndexTables(sourcePage.indexTables, idMap),
  };

  return {
    version: 3,
    title: derivedTitle,
    pages: [newPage],
    derivedFromNoteId: sourceNoteId,
    createdAt: now,
    modifiedAt: now,
  };
}

/**
 * Append a `derived_from` NoteLink to the source document so the parent note
 * records its outgoing derivation. Returns a new array (does not mutate).
 *
 * sourceBlockId is left empty for whole-note derivation; the link points at
 * the note as a whole rather than a specific block.
 */
export function appendDerivedNoteLink(
  existing: NoteLink[] | undefined,
  derivedNoteId: string,
): NoteLink[] {
  return [
    ...(existing ?? []),
    {
      targetNoteId: derivedNoteId,
      sourceBlockId: "",
      type: "derived_from",
    },
  ];
}
