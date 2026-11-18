// 検索用の「別の読み」（macOS の Vision・altText）の取り回し:
// 探す経路には入り、表示用の文字（text）には混ざらない。無い既存データもそのまま読める。

import { describe, expect, it } from "vitest";
import type { MediaOcrEntry } from "../../lib/document-types";
import { IndexFileNoteListSource } from "../navigation/note-list-source";
import type { GraphiumIndex, NoteIndexEntry } from "../navigation/index-file";
import { collectOcrAltText, collectOcrText } from "./collect";

const entry = (over: Partial<MediaOcrEntry>): MediaOcrEntry => ({
  text: "",
  confidence: 90,
  lang: "jpn+eng",
  extractedAt: "2026-11-18T00:00:00.000Z",
  ...over,
});

describe("collectOcrAltText / collectOcrText", () => {
  it("altText は別に集め、表示用の text には混ざらない", () => {
    const mediaOcr = {
      a: entry({ text: "焼給 800", altText: "焼結温度 800℃", altEngine: "apple-vision" }),
      b: entry({ text: "XRD" }),
    };
    expect(collectOcrText(mediaOcr)).toBe("焼給 800\nXRD");
    expect(collectOcrAltText(mediaOcr)).toBe("焼結温度 800℃");
    expect(collectOcrText(mediaOcr)).not.toContain("焼結");
  });

  it("alt 無しの既存データ・空はキーを作らない", () => {
    expect(collectOcrAltText({ a: entry({ text: "x" }) })).toBeUndefined();
    expect(collectOcrAltText(undefined)).toBeUndefined();
    expect(collectOcrAltText({ a: entry({ text: "x", altText: "  " }) })).toBeUndefined();
  });
});

describe("ノート一覧の検索（searchNotes）", () => {
  const note = (over: Partial<NoteIndexEntry>): NoteIndexEntry =>
    ({ noteId: "n", title: "t", headings: [], outgoingLinks: [], ...over }) as unknown as NoteIndexEntry;
  const source = new IndexFileNoteListSource({
    notes: [
      note({ noteId: "n1", title: "実験メモ", ocrText: "焼給 800", ocrAltText: "焼結温度 800℃" }),
      note({ noteId: "n2", title: "別のノート", ocrText: "XRD" }),
    ],
  } as unknown as GraphiumIndex);

  it("別の読みだけに含まれる語でも当たる", () => {
    expect(source.searchNotes("焼結温度").map((n) => n.noteId)).toEqual(["n1"]);
    expect(source.searchNotes("xrd").map((n) => n.noteId)).toEqual(["n2"]);
  });
});
