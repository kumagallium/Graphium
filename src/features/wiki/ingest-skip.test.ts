import { describe, expect, it } from "vitest";
import { lastIngestedAtForSource, shouldSkipUnchangedSource } from "./ingest-skip";
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
