import { describe, expect, it } from "vitest";
import type { GraphiumDocument, WikiMeta } from "../../lib/document-types";
import { pickPeekExternalFields } from "./peek-save-merge";

const wikiMeta = (extra?: Partial<WikiMeta>): WikiMeta => ({
  kind: "claim",
  derivedFromNotes: ["note-1"],
  derivedFromChats: [],
  generatedAt: "2026-09-01T00:00:00Z",
  generatedBy: { model: "m", version: "" },
  ...extra,
});

const doc = (extra?: Partial<GraphiumDocument>): GraphiumDocument =>
  ({
    version: 1,
    title: "t",
    pages: [],
    createdAt: "2026-09-01T00:00:00Z",
    modifiedAt: "2026-09-01T00:00:00Z",
    ...extra,
  }) as GraphiumDocument;

describe("pickPeekExternalFields", () => {
  it("キャッシュが無ければ何も上書きしない", () => {
    expect(pickPeekExternalFields("wiki:a", undefined)).toEqual({});
    expect(pickPeekExternalFields("wiki:a", null)).toEqual({});
  });

  it("wiki: はキャッシュ側の wikiMeta を採る（照合結果を旧い docRef で巻き戻さない）", () => {
    const meta = wikiMeta({
      sourceCheck: {
        verdict: "supported",
        entries: [],
        checkedAt: "2026-09-17T00:00:00Z",
        checkedBy: "local",
        claimHash: "h",
      },
    });
    expect(pickPeekExternalFields("wiki:a", doc({ source: "ai", wikiMeta: meta }))).toEqual({
      wikiMeta: meta,
    });
  });

  it("判定を消した後の wikiMeta（sourceCheck 無し）もそのまま採る", () => {
    const meta = wikiMeta();
    expect(pickPeekExternalFields("wiki:a", doc({ wikiMeta: meta })).wikiMeta).toBe(meta);
  });

  it("通常ノートでは wikiMeta を採らない", () => {
    expect(pickPeekExternalFields("note-1", doc({ wikiMeta: wikiMeta() }))).toEqual({});
  });

  it("chats はノートの種類を問わずキャッシュ側を採る", () => {
    const chats = [] as NonNullable<GraphiumDocument["chats"]>;
    expect(pickPeekExternalFields("note-1", doc({ chats }))).toEqual({ chats });
    expect(pickPeekExternalFields("wiki:a", doc({ chats }))).toEqual({ chats });
  });
});
