import type { BlockLink } from "../block-link/link-types";
import type {
  ExternalFlowOrigin,
  FlowGraphData,
  FlowStep,
} from "./activity-graph-adapter";
import {
  resolveCrossNoteOutput,
  type ProcessIndex,
} from "./process-index";

function externalStepId(noteId: string, stepId: string): string {
  return `external-step:${encodeURIComponent(noteId)}:${stepId}`;
}

/**
 * 別ノート output のリンクを、現在ノートのフローへ1段だけ投影する。
 * 参照元プロセス全体は複製せず、参照元 step → 現在ノートの input だけを加える。
 */
export function addCrossNoteOriginsToFlowGraph(
  graph: FlowGraphData,
  links: BlockLink[],
  processIndex: ProcessIndex | null,
): FlowGraphData {
  const relevant = links.filter(
    (link) =>
      link.type === "informed_by" &&
      !!link.targetNoteId &&
      !!link.targetEntityId &&
      graph.steps.some((step) => !step.externalOrigin && step.id === link.sourceBlockId),
  );
  if (relevant.length === 0) return graph;

  const steps = [...graph.steps];
  const entities = graph.entities.map((entity) => ({ ...entity }));
  const edges = [...graph.edges];
  const stepIds = new Set(steps.map((step) => step.id));
  const edgeIds = new Set(edges.map((edge) => edge.id));

  for (const link of relevant) {
    const noteId = link.targetNoteId!;
    const resolved = resolveCrossNoteOutput(processIndex, {
      noteId,
      sourceModifiedAt: link.targetSourceModifiedAt,
      stepId: link.targetBlockId,
      entityIdentity: link.targetEntityId!,
      identityStable: link.targetEntityStable,
      outputIndex: link.targetEntityIndex,
      outputCount: link.targetEntityCount,
    });
    const origin: ExternalFlowOrigin = {
      noteId,
      noteTitle: resolved?.noteTitle ?? link.targetNoteTitle ?? noteId,
      stepId: link.targetBlockId,
      stepTitle: resolved?.stepName ?? link.targetStepTitle ?? link.targetBlockId.slice(0, 8),
      outputLabel:
        resolved?.label ?? link.targetEntityLabel ?? link.targetEntityId!,
      broken: !resolved,
    };
    const stepId = externalStepId(noteId, link.targetBlockId);
    if (!stepIds.has(stepId)) {
      const step: FlowStep = {
        id: stepId,
        name: origin.stepTitle,
        params: [],
        externalOrigin: origin,
      };
      steps.push(step);
      stepIds.add(stepId);
    }

    // sourceEntityId は表行受け取りでは行の tableRowIdentity（rowIdentity）、
    // 旧 span 受け取りでは inline の entityId。どちらでも現在側の入力を見つける
    const localEntity = link.sourceEntityId
      ? entities.find(
          (entity) =>
            entity.entityId === link.sourceEntityId ||
            entity.rowIdentity === link.sourceEntityId,
        )
      : undefined;
    if (localEntity) localEntity.externalOrigin = origin;

    const targetId = localEntity?.id ?? link.sourceBlockId;
    const edgeId = `external-${stepId}->${targetId}`;
    if (!edgeIds.has(edgeId)) {
      edges.push({
        id: edgeId,
        kind: "external",
        source: stepId,
        target: targetId,
      });
      edgeIds.add(edgeId);
    }
  }

  return { steps, entities, edges };
}
