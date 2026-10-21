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

// 音声ノートから書き出した要約の項目・段落は、音声ノートのブロック（文字起こしが作ったもの）からの派生。
// ステップのフローに「派生元」の線とノードとして出ていた（v0.92.0 の実機で発見）
describe("自動生成のものからの派生は、ステップのフローに出さない", () => {
  const tx = (s: string) => [{ type: "text", text: s, styles: {} }];
  const blocks2: any[] = [
    {
      id: "mt-1",
      type: "meetingTranscript",
      props: { recordingId: "r1", fileId: "file-abc", startedAt: "2026-10-20T01:00:00.000Z", durationMs: 60_000 },
      content: undefined,
      children: [],
    },
    { id: "sum-1", type: "bulletListItem", content: tx("本番環境で清書機能を再テストする"), children: [] },
    { id: "para-1", type: "paragraph", content: tx("[00:01] 自分: 録音の実験中です"), children: [] },
    { id: "sum-2", type: "bulletListItem", content: tx("実験の結果を共有する"), children: [] },
    { id: "u-a", type: "paragraph", content: tx("自分で書いたメモ A"), children: [] },
    { id: "u-b", type: "paragraph", content: tx("自分で書いたメモ B"), children: [] },
  ];
  const link = (id: string, from: string, to: string, createdBy: "ai" | "system" | "human") => ({
    id, sourceBlockId: from, targetBlockId: to, type: "derived_from" as const, layer: "prov" as const, createdBy,
  });
  const doc2 = generateProvDocument({
    blocks: blocks2,
    labels: new Map(),
    links: [
      link("l1", "sum-1", "mt-1", "ai"), // v0.92: 書き出した要約の項目 → ブロック
      link("l2", "para-1", "mt-1", "system"), // v0.91: 展開した段落 → ブロック
      link("l3", "sum-2", "para-1", "ai"), // v0.91: 要約の項目 → 段落（2 段）
      link("l4", "u-b", "u-a", "human"), // 利用者のリンク
    ],
  });

  it("PROV には派生がすべて残る", () => {
    const derived = (doc2["@graph"] as any[]).filter((n) => Array.isArray(n["prov:wasDerivedFrom"]));
    expect(derived.length).toBeGreaterThanOrEqual(4);
  });

  it("フローには利用者のリンクだけが出る", () => {
    const flow = provDocToFlowGraph(doc2);
    const derived = flow.edges.filter((e) => e.kind === "derived");
    expect(derived).toHaveLength(1);
    expect(derived[0].target).toContain("u-b");
    expect(flow.entities.map((e) => e.id).some((id) => id.includes("mt-1") || id.includes("sum-1") || id.includes("sum-2"))).toBe(false);
  });
});
