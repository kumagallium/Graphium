// 画像 OCR の text（表示用の読み）への守り:
// 共有フォルダの他人のノート JSON・素材索引の JSON から型の違う値・巨大な値が来ても、
// 索引の生成・全文の索引の断片化・一覧の検索が投げず、上限で切れる。

import { describe, expect, it } from "vitest";
import { MAX_OCR_TEXT_CHARS } from "../../lib/ocr-text";
import { buildIndexEntry, type GraphiumIndex, type NoteIndexEntry } from "../navigation/index-file";
import { IndexFileNoteListSource } from "../navigation/note-list-source";
import { chunkPlainText } from "../lexical-search/chunk";
import { desiredAssetSources } from "../lexical-search/sources";
import type { MediaIndexEntry } from "../asset-browser/media-index";
import type { GraphiumDocument } from "../../lib/document-types";
import { collectOcrAltText, collectOcrText, MAX_OCR_TEXT_TOTAL_CHARS } from "./collect";

const BAD_VALUES: [string, unknown][] = [
  ["数値", 123],
  ["オブジェクト", {}],
  ["配列", ["x"]],
  ["null", null],
];
const BIG = "あ".repeat(5 * 1024 * 1024);
const EDGE = "a".repeat(MAX_OCR_TEXT_CHARS - 1) + "😀";

const docWith = (mediaOcr: unknown): GraphiumDocument =>
  ({
    version: 2,
    title: "t",
    createdAt: "2026-07-01T00:00:00.000Z",
    modifiedAt: "2026-07-02T00:00:00.000Z",
    pages: [
      {
        id: "p1",
        title: "t",
        blocks: [{ id: "img1", type: "image", props: { url: "local-media://abc" }, children: [] }],
        labels: {},
        provLinks: [],
        knowledgeLinks: [],
        mediaOcr,
      },
    ],
  }) as unknown as GraphiumDocument;

const entryWith = (text: unknown) => ({ img1: { text, confidence: "x", lang: 1, extractedAt: {} } });

describe("(a) 索引エントリの生成（buildIndexEntry）", () => {
  for (const [name, v] of BAD_VALUES) {
    it(`text が ${name} でも投げず、ocrText は付かない`, () => {
      expect(buildIndexEntry("n", docWith(entryWith(v))).ocrText).toBeUndefined();
    });
  }
  it("mediaOcr が配列・文字列・null、エントリが null でも投げない", () => {
    for (const m of [[], "abc", null, { img1: null }, { img1: "x" }]) {
      expect(buildIndexEntry("n", docWith(m)).ocrText).toBeUndefined();
    }
  });
  it("5 MB の text は上限で切れる", () => {
    expect(buildIndexEntry("n", docWith(entryWith(BIG))).ocrText!.length).toBe(MAX_OCR_TEXT_CHARS);
  });
  it("上限ちょうどでサロゲートペアが切れる text は片割れを残さない", () => {
    const got = buildIndexEntry("n", docWith(entryWith(EDGE))).ocrText!;
    expect(got.length).toBe(MAX_OCR_TEXT_CHARS - 1);
  });
  it("多数の画像を連結しても総量の上限で切れる", () => {
    const many: Record<string, unknown> = {};
    for (let i = 0; i < 20; i++) many[`b${i}`] = { text: "い".repeat(MAX_OCR_TEXT_CHARS) };
    expect(collectOcrText(many as never)!.length).toBe(MAX_OCR_TEXT_TOTAL_CHARS);
  });
  it("正常な値は従来どおり", () => {
    expect(buildIndexEntry("n", docWith(entryWith("焼給 800"))).ocrText).toBe("焼給 800");
  });
});

const media = (over: Partial<MediaIndexEntry>): MediaIndexEntry =>
  ({ fileId: "f", name: "file", type: "image", mimeType: "image/png", url: "u", uploadedAt: "2026-01-01", usedIn: [], ...over }) as MediaIndexEntry;

describe("(c) 全文の索引の断片化（desiredAssetSources → chunkPlainText）", () => {
  for (const [name, v] of BAD_VALUES) {
    it(`素材の ocrText が ${name} でも投げず、対象から外れる`, () => {
      const { desired } = desiredAssetSources([media({ ocrText: v as never })]);
      expect(desired).toEqual([]);
    });
  }
  it("5 MB の ocrText は上限で切れ、断片化も投げない", () => {
    const { plans } = desiredAssetSources([media({ ocrText: BIG })]);
    const plan = plans.get("f")!;
    expect(plan.mode).toBe("inline");
    const text = (plan as { text: string }).text;
    expect(text.length).toBe(MAX_OCR_TEXT_CHARS);
    expect(() => chunkPlainText(text)).not.toThrow();
  });
  it("サロゲートペアの途中で切れない", () => {
    const { plans } = desiredAssetSources([media({ ocrText: EDGE })]);
    expect((plans.get("f") as { text: string }).text.length).toBe(MAX_OCR_TEXT_CHARS - 1);
  });
});

describe("(e) 一覧の検索（IndexFileNoteListSource）", () => {
  const note = (over: Partial<NoteIndexEntry>): NoteIndexEntry =>
    ({ noteId: "n", title: "t", headings: [], labels: [], outgoingLinks: [], ...over }) as unknown as NoteIndexEntry;
  for (const [name, v] of BAD_VALUES) {
    it(`保存済みの索引の ocrText が ${name} でも searchNotes / loadNoteList が投げない`, async () => {
      const source = new IndexFileNoteListSource({
        notes: [note({ ocrText: v as never, ocrAltText: v as never })],
      } as unknown as GraphiumIndex);
      expect(source.searchNotes("x")).toEqual([]);
      expect((await source.loadNoteList())[0].ocrText).toBeUndefined();
    });
  }
  it("5 MB の ocrText でも上限で切れて検索できる", async () => {
    const source = new IndexFileNoteListSource({
      notes: [note({ ocrText: BIG })],
    } as unknown as GraphiumIndex);
    expect(source.searchNotes("あ")).toHaveLength(1);
    expect((await source.loadNoteList())[0].ocrText!.length).toBe(MAX_OCR_TEXT_CHARS);
  });
});

describe("連結の上限", () => {
  it("総量の上限がサロゲートペアの途中に当たっても片割れを残さない", () => {
    // "x" + 改行 + 19,997 字 + 絵文字（2 単位）= 20,001 単位。上限 20,000 は絵文字の途中に当たる
    const head = "a".repeat(19_997) + "\u{1F600}";
    const text = collectOcrAltText({
      b1: { altText: "x" },
      b2: { altText: head },
    } as never);
    expect(text).toBeDefined();
    const last = text!.charCodeAt(text!.length - 1);
    expect(last >= 0xd800 && last <= 0xdbff).toBe(false);
    expect(text!.length).toBe(19_999);
  });
});
