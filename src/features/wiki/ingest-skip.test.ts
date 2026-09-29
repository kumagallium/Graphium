import { describe, expect, it } from "vitest";
import {
  createKnowledgeDocLoader,
  isUnchangedSinceLastIngest,
  lastIngestedAtForSource,
  mediaKnowledgeSourceId,
  shouldSkipUnchangedSource,
} from "./ingest-skip";
import type { GraphiumDocument } from "../../lib/document-types";
import type { EditActivity } from "../document-provenance/types";

function activity(overrides: Partial<EditActivity> = {}): EditActivity {
  return {
    id: "act-1",
    type: "wiki_ingest",
    startedAt: "2026-09-01T00:00:00.000Z",
    endedAt: "2026-09-01T00:00:00.000Z",
    wasAssociatedWith: "agent-1",
    ...overrides,
  };
}

function doc(activities: EditActivity[]): GraphiumDocument {
  return {
    documentProvenance: { revisions: [], agents: [], activities },
  } as unknown as GraphiumDocument;
}

describe("lastIngestedAtForSource", () => {
  it("used に含まれない活動は無視する", () => {
    const docs = [doc([activity({ used: ["note-other"], endedAt: "2026-09-05T00:00:00.000Z" })])];
    expect(lastIngestedAtForSource("note-1", docs)).toBeUndefined();
  });

  it("複数ページにまたがっていても最大値を取る", () => {
    const docs = [
      doc([activity({ used: ["note-1"], endedAt: "2026-09-01T00:00:00.000Z" })]),
      doc([
        activity({ used: ["note-1"], endedAt: "2026-09-10T00:00:00.000Z" }),
        activity({ used: ["note-1"], endedAt: "2026-09-03T00:00:00.000Z" }),
      ]),
    ];
    expect(lastIngestedAtForSource("note-1", docs)).toBe("2026-09-10T00:00:00.000Z");
  });

  it("記録が無ければ undefined", () => {
    expect(lastIngestedAtForSource("note-1", [])).toBeUndefined();
  });
});

describe("shouldSkipUnchangedSource", () => {
  it("最終取り込み記録が無ければ外さない", () => {
    expect(shouldSkipUnchangedSource("2026-09-01T00:00:00.000Z", undefined)).toBe(false);
  });

  it("取り込み後に編集されていれば外さない", () => {
    expect(
      shouldSkipUnchangedSource("2026-09-10T00:00:00.000Z", "2026-09-05T00:00:00.000Z"),
    ).toBe(false);
  });

  it("取り込み後に編集されていなければ外す", () => {
    expect(
      shouldSkipUnchangedSource("2026-09-01T00:00:00.000Z", "2026-09-05T00:00:00.000Z"),
    ).toBe(true);
  });

  it("時刻が壊れていれば外さない側に倒す", () => {
    expect(shouldSkipUnchangedSource("not-a-date", "2026-09-05T00:00:00.000Z")).toBe(false);
  });
});

describe("mediaKnowledgeSourceId", () => {
  const DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

  it("URL・PDF・Word(.docx) は取り込みと同じ出どころ id になる", () => {
    expect(mediaKnowledgeSourceId({ type: "url", fileId: "u1", url: "https://example.com/a" })).toBe("url:https://example.com/a");
    expect(mediaKnowledgeSourceId({ type: "pdf", fileId: "p1" })).toBe("pdf:p1");
    expect(mediaKnowledgeSourceId({ type: "document", fileId: "d1", mimeType: DOCX })).toBe("document:d1");
  });

  it("取り込みの対象外は undefined", () => {
    expect(mediaKnowledgeSourceId({ type: "image", fileId: "i1" })).toBeUndefined();
    expect(mediaKnowledgeSourceId({ type: "document", fileId: "d2", mimeType: "application/msword" })).toBeUndefined();
    expect(mediaKnowledgeSourceId({ type: "document", fileId: "x1", mimeType: "application/vnd.ms-excel" })).toBeUndefined();
    expect(mediaKnowledgeSourceId({ type: "url", fileId: "u2" })).toBeUndefined();
  });
});

describe("createKnowledgeDocLoader", () => {
  it("wiki: を付けて引き、同じページは 1 回しか読まない", async () => {
    const page = doc([]);
    const requested: string[] = [];
    const load = createKnowledgeDocLoader(
      () => undefined,
      async (key) => { requested.push(key); return key === "wiki:page-1" ? page : null; },
    );
    expect(await load("page-1")).toBe(page);
    expect(await load("page-1")).toBe(page);
    expect(await load("page-2")).toBeNull();
    expect(requested).toEqual(["wiki:page-1", "wiki:page-2"]);
  });
});

describe("isUnchangedSinceLastIngest", () => {
  const ingested = doc([activity({ used: ["document:d1"], endedAt: "2026-09-26T05:00:00.000Z" })]);
  const loadAll = async () => ingested;

  it("取り込み後に資料が変わっていなければ外す（素材はアップロード時刻で比べる）", async () => {
    expect(await isUnchangedSinceLastIngest("document:d1", "2026-06-02T07:45:00.000Z", [{ noteId: "c1" }], loadAll)).toBe(true);
  });

  it("取り込み後に資料が変わっていれば外さない", async () => {
    expect(await isUnchangedSinceLastIngest("document:d1", "2026-09-27T00:00:00.000Z", [{ noteId: "c1" }], loadAll)).toBe(false);
  });

  it("現役のナレッジページが無ければ外さない（アーカイブ・ゴミ箱だけは数えない）", async () => {
    const pages = [
      { noteId: "c1", archivedAt: "2026-09-27T00:00:00.000Z" },
      { noteId: "c2", deletedAt: "2026-09-27T00:00:00.000Z" },
    ];
    expect(await isUnchangedSinceLastIngest("document:d1", "2026-06-02T07:45:00.000Z", pages, loadAll)).toBe(false);
    expect(await isUnchangedSinceLastIngest("document:d1", "2026-06-02T07:45:00.000Z", undefined, loadAll)).toBe(false);
  });

  it("来歴にその資料の取り込み記録が無ければ外さない", async () => {
    const other = async () => doc([activity({ used: ["document:other"] })]);
    expect(await isUnchangedSinceLastIngest("document:d1", "2026-06-02T07:45:00.000Z", [{ noteId: "c1" }], other)).toBe(false);
  });
});
