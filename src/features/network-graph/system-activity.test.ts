import { describe, it, expect } from "vitest";
import { generateProvDocument, isSystemActivity } from "../prov-generator/generator";
import { provDocToStepGraph, provDocToFlowGraph } from "./activity-graph-adapter";
import { summarizeNoteProv } from "../prov-extractor/note-prov-summary";
import type { GraphiumDocument } from "../../lib/document-types";

// meetingTranscript だけのノート: 文字起こし Activity は来歴には残るが、手順（ステップ）ではない
const blocks: any[] = [
  {
    id: "mt-1",
    type: "meetingTranscript",
    props: { recordingId: "r1", fileId: "file-abc", startedAt: "2026-10-20T01:00:00.000Z", durationMs: 60_000 },
    content: undefined,
    children: [],
  },
];
const doc = generateProvDocument({ blocks, labels: new Map(), links: [] });

describe("自動生成の Activity（文字起こし）はステップ扱いしない", () => {
  it("PROV 文書には Activity が残る", () => {
    const acts = (doc["@graph"] as any[]).filter((n) => n["@type"] === "prov:Activity");
    expect(acts).toHaveLength(1);
    expect(isSystemActivity(acts[0])).toBe(true);
  });

  it("パネル自動オープンの判定（ユーザーの Activity が無ければ false）", () => {
    const hasActivity = doc["@graph"].some((n) => n["@type"] === "prov:Activity" && !isSystemActivity(n));
    expect(hasActivity).toBe(false);
  });

  it("利用者の手順（prov:type 無し）は system 扱いにならない", () => {
    expect(isSystemActivity({ "@id": "a", "@type": "prov:Activity" } as any)).toBe(false);
  });

  it("ステップ一覧・フロー図に文字起こしが出ない", () => {
    const step = provDocToStepGraph(doc);
    expect(step.activities).toHaveLength(0);
    expect(step.steps).toHaveLength(0);
    const flow = provDocToFlowGraph(doc);
    expect(flow.steps).toHaveLength(0);
    expect(flow.edges.filter((e) => e.kind === "used" || e.kind === "generates")).toHaveLength(0);
  });

  it("ノートの来歴要約に出ない", () => {
    const d: GraphiumDocument = {
      version: 5,
      title: "t",
      pages: [
        { id: "p0", title: "t", blocks, labels: {}, provLinks: [], knowledgeLinks: [] } as any,
      ],
      createdAt: "2026-10-20T00:00:00Z",
      modifiedAt: "2026-10-20T00:00:00Z",
    };
    expect(summarizeNoteProv(d, { noteId: "n" }).activities).toHaveLength(0);
  });
});
