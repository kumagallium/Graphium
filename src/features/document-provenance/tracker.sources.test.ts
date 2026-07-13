// recordRevision に sources が渡されたとき、EditActivity.used（prov:used）に
// 取り込みソースが記録されることを検証する（Wiki 成長の PROV 一級市民化）。

import { describe, it, expect } from "vitest";
import { recordRevision } from "./tracker";
import type { GraphiumDocument } from "../../lib/document-types";

function makeDoc(): GraphiumDocument {
  return {
    version: 5,
    title: "t",
    pages: [
      {
        id: "p1",
        title: "t",
        blocks: [
          { id: "b1", type: "paragraph", content: [{ type: "text", text: "hello" }] },
        ],
        labels: {},
        provLinks: [],
        knowledgeLinks: [],
      },
    ],
    createdAt: "2026-05-04T00:00:00Z",
    modifiedAt: "2026-05-04T00:00:00Z",
  };
}

describe("recordRevision + sources (prov:used)", () => {
  it("sources が EditActivity.used に記録される", async () => {
    const doc = await recordRevision(makeDoc(), null, "wiki_merge", {
      agentLabel: "claude",
      force: true,
      sources: ["note-a"],
    });
    const activity = doc.documentProvenance!.activities[0];
    expect(activity.type).toBe("wiki_merge");
    expect(activity.used).toEqual(["note-a"]);
  });

  it("重複と空文字は落とされる", async () => {
    const doc = await recordRevision(makeDoc(), null, "wiki_regenerate", {
      force: true,
      sources: ["claim-1", "claim-1", "", "pdf:file-9"],
    });
    const activity = doc.documentProvenance!.activities[0];
    expect(activity.used).toEqual(["claim-1", "pdf:file-9"]);
  });

  it("sources 未指定・空配列なら used は付かない（旧データと同形）", async () => {
    const doc1 = await recordRevision(makeDoc(), null, "human_edit");
    expect(doc1.documentProvenance!.activities[0].used).toBeUndefined();

    const doc2 = await recordRevision(makeDoc(), null, "wiki_ingest", {
      force: true,
      sources: [],
    });
    expect(doc2.documentProvenance!.activities[0].used).toBeUndefined();
  });

  it("wiki_* 系の操作は AI エージェントとして分類される", async () => {
    const types = [
      "wiki_ingest",
      "wiki_merge",
      "wiki_cross_update",
      "wiki_dedup_merge",
      "wiki_regenerate",
      "wiki_atomize",
    ] as const;
    for (const type of types) {
      const doc = await recordRevision(makeDoc(), null, type, {
        agentLabel: "m",
        force: true,
      });
      const agentId = doc.documentProvenance!.activities[0].wasAssociatedWith;
      const agent = doc.documentProvenance!.agents.find((a) => a.id === agentId);
      expect(agent?.type, `${type} should be attributed to an AI agent`).toBe("ai");
    }
  });

  it("リビジョン連鎖（wasDerivedFrom / wasGeneratedBy）は sources 有無で変わらない", async () => {
    let doc = await recordRevision(makeDoc(), null, "wiki_ingest", {
      force: true,
      sources: ["note-a"],
    });
    const prev = doc.pages[0];
    doc = {
      ...doc,
      pages: [{ ...doc.pages[0], blocks: [{ id: "b1", type: "paragraph", content: [{ type: "text", text: "world" }] }] }],
    };
    doc = await recordRevision(doc, prev, "wiki_merge", {
      force: true,
      sources: ["note-b"],
    });
    const [rev1, rev2] = doc.documentProvenance!.revisions;
    expect(rev2.wasDerivedFrom).toBe(rev1.id);
    expect(rev2.prevContentHash).toBe(rev1.contentHash);
    const act2 = doc.documentProvenance!.activities.find((a) => a.id === rev2.wasGeneratedBy);
    expect(act2?.used).toEqual(["note-b"]);
  });
});
