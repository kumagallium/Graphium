import { describe, expect, it } from "vitest";
import type { BlockLink } from "../block-link/link-types";
import type { FlowGraphData } from "./activity-graph-adapter";
import { addCrossNoteOriginsToFlowGraph } from "./cross-note-flow";
import type { ProcessIndex } from "./process-index";

const graph: FlowGraphData = {
  steps: [{ id: "local-step", name: "Evaluate", params: [] }],
  entities: [
    {
      id: "inline_material_input-1",
      label: "Powder",
      kind: "material",
      entityId: "input-1",
      attrs: [],
    },
  ],
  edges: [
    {
      id: "used-inline_material_input-1->local-step",
      kind: "used",
      source: "inline_material_input-1",
      target: "local-step",
    },
  ],
};

const link: BlockLink = {
  id: "link-1",
  sourceBlockId: "local-step",
  targetBlockId: "remote-step",
  targetNoteId: "remote-note",
  targetEntityId: "row-1",
  targetEntityIndex: 0,
  targetEntityCount: 1,
  targetEntityStable: true,
  targetSourceModifiedAt: "2026-08-21T00:00:00.000Z",
  sourceEntityId: "input-1",
  targetEntityLabel: "Old powder",
  targetNoteTitle: "Old note title",
  targetStepTitle: "Old step title",
  type: "informed_by",
  layer: "prov",
  createdBy: "human",
};

const processIndex: ProcessIndex = {
  version: 2,
  updatedAt: "2026-08-21T01:00:00.000Z",
  processes: [
    {
      noteId: "remote-note",
      title: "Source experiment",
      sourceModifiedAt: "2026-08-21T00:30:00.000Z",
      projectedAt: "2026-08-21T00:31:00.000Z",
      graph: {
        steps: [{ id: "remote-step", name: "Synthesis", params: [] }],
        entities: [
          {
            id: "result-table-powder",
            label: "Powder",
            kind: "output",
            rowIdentity: "row-1",
            attrs: [],
          },
        ],
        edges: [
          {
            id: "gen",
            kind: "generates",
            source: "remote-step",
            target: "result-table-powder",
          },
        ],
      },
      summary: {
        stepCount: 1,
        materialCount: 0,
        toolCount: 0,
        outputCount: 1,
        branching: false,
      },
    },
  ],
};

describe("addCrossNoteOriginsToFlowGraph", () => {
  it("参照元stepから現在ノートのinputへ外部プロセスを1段投影する", () => {
    const result = addCrossNoteOriginsToFlowGraph(graph, [link], processIndex);

    expect(result.steps).toContainEqual(
      expect.objectContaining({
        name: "Synthesis",
        externalOrigin: expect.objectContaining({
          noteId: "remote-note",
          noteTitle: "Source experiment",
          outputLabel: "Powder",
          broken: false,
        }),
      }),
    );
    expect(result.entities[0].externalOrigin).toEqual(
      expect.objectContaining({
        noteTitle: "Source experiment",
        stepTitle: "Synthesis",
      }),
    );
    expect(result.edges).toContainEqual(
      expect.objectContaining({
        kind: "external",
        target: "inline_material_input-1",
      }),
    );
    expect(graph.entities[0].externalOrigin).toBeUndefined();
  });

  it("解決できない旧リンクもスナップショット付きのリンク切れとして表示する", () => {
    const result = addCrossNoteOriginsToFlowGraph(graph, [link], null);
    const external = result.steps.find((step) => step.externalOrigin)?.externalOrigin;

    expect(external).toEqual(
      expect.objectContaining({
        noteTitle: "Old note title",
        stepTitle: "Old step title",
        outputLabel: "Old powder",
        broken: true,
      }),
    );
  });
});
