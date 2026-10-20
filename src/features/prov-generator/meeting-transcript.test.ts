import { describe, it, expect } from "vitest";
import { generateProvDocument, extractRelations } from "./generator";

// 会議の文字起こしブロック → 録音までの来歴
const para = (id: string, text: string) => ({
  id,
  type: "paragraph",
  content: [{ type: "text", text }],
  children: [],
});

const meetingBlock = (props: Record<string, unknown>) => ({
  id: "mt-1",
  type: "meetingTranscript",
  props,
  content: undefined,
  children: [],
});

const link = (id: string, from: string, to: string, createdBy: "system" | "ai") => ({
  id,
  sourceBlockId: from,
  targetBlockId: to,
  type: "derived_from" as const,
  layer: "prov" as const,
  createdBy,
});

describe("meetingTranscript の PROV 射影", () => {
  const blocks: any[] = [
    meetingBlock({
      recordingId: "rec-1",
      fileId: "file-abc",
      startedAt: "2026-10-20T01:00:00.000Z",
      durationMs: 60_000,
    }),
    para("p1", "[00:01] 相手: 始めます"),
    para("p2", "[00:05] 自分: 了解です"),
    para("s1", "来週までに資料を送る"),
  ];
  const links: any[] = [
    link("l1", "p1", "mt-1", "system"),
    link("l2", "p2", "mt-1", "system"),
    link("l3", "s1", "p2", "ai"),
  ];

  it("録音素材・文字起こし Activity・ブロック Entity と鎖が出る", () => {
    const doc = generateProvDocument({ blocks, labels: new Map(), links });
    const g = doc["@graph"] as any[];
    const media = g.find((n) => n["@id"] === "media_file-abc");
    expect(media["@type"]).toBe("prov:Entity");
    expect(media["graphium:mediaType"]).toBe("audio");
    expect(media["graphium:channels"]).toBe("left=others,right=self");

    const act = g.find((n) => n["@id"] === "transcription_mt-1");
    expect(act["@type"]).toBe("prov:Activity");
    expect(act["prov:type"]).toBe("graphium:Transcription");
    expect(act["graphium:engine"]).toBe("whisper.cpp");
    expect(act["prov:startTime"]).toBe("2026-10-20T01:00:00.000Z");
    expect(act["prov:endTime"]).toBe("2026-10-20T01:01:00.000Z");

    const rels = extractRelations(doc);
    expect(rels).toContainEqual({ "@type": "prov:used", from: "transcription_mt-1", to: "media_file-abc" });
    expect(rels).toContainEqual({ "@type": "prov:wasGeneratedBy", from: "block_mt-1", to: "transcription_mt-1" });
    expect(rels).toContainEqual({ "@type": "prov:wasDerivedFrom", from: "block_p1", to: "block_mt-1" });
    expect(rels).toContainEqual({ "@type": "prov:wasDerivedFrom", from: "block_p2", to: "block_mt-1" });
    expect(rels).toContainEqual({ "@type": "prov:wasDerivedFrom", from: "block_s1", to: "block_p2" });
  });

  it("durationMs が 0 なら endTime を出さない", () => {
    const doc = generateProvDocument({
      blocks: [meetingBlock({ recordingId: "r", fileId: "f", startedAt: "2026-10-20T01:00:00.000Z", durationMs: 0 })],
      labels: new Map(),
      links: [],
    });
    const act = (doc["@graph"] as any[]).find((n) => n["@id"] === "transcription_mt-1");
    expect(act["prov:startTime"]).toBeDefined();
    expect(act["prov:endTime"]).toBeUndefined();
  });

  it("fileId が空（ready）なら Activity も素材 Entity も出さない", () => {
    const doc = generateProvDocument({
      blocks: [meetingBlock({ recordingId: "", fileId: "", startedAt: "", durationMs: 0 })],
      labels: new Map(),
      links: [],
    });
    const ids = (doc["@graph"] as any[]).map((n) => n["@id"]);
    expect(ids.some((i) => i.startsWith("transcription_") || i.startsWith("media_"))).toBe(false);
  });
});
