import { describe, it, expect } from "vitest";
import { buildIndexEntry, type GraphiumIndex } from "./index-file";
import { IndexFileNoteListSource } from "./note-list-source";
import type { GraphiumDocument } from "../../lib/document-types";

// 画像ブロック + mediaOcr サイドストアを持つ最小ドキュメントを組み立てる。
// OCR テキストはブロック props ではなくページの mediaOcr に入るため、
// 貼り方（/image・ペースト・ドラッグ&ドロップ）を問わず同じ形になる。
function makeDoc(ocrText: string, title = "実験ノート"): GraphiumDocument {
  return {
    version: 2,
    title,
    createdAt: "2026-07-01T00:00:00.000Z",
    modifiedAt: "2026-07-02T00:00:00.000Z",
    pages: [
      {
        id: "p1",
        title,
        blocks: [
          { id: "h1", type: "heading", props: { level: 2 }, content: [{ type: "text", text: "手順" }], children: [] },
          { id: "img1", type: "image", props: { url: "local-media://abc", name: "scan.png" }, children: [] },
        ],
        labels: {},
        provLinks: [],
        knowledgeLinks: [],
        mediaOcr: ocrText
          ? {
              img1: {
                text: ocrText,
                confidence: 88,
                lang: "jpn+eng",
                extractedAt: "2026-07-02T00:00:00.000Z",
              },
            }
          : undefined,
      },
    ],
  };
}

describe("OCR 画像テキストの索引化", () => {
  it("buildIndexEntry が mediaOcr の抽出テキストを回収する", () => {
    const doc = makeDoc("焼結温度 800℃ で 2 時間 保持");
    const entry = buildIndexEntry("note-1", doc);
    expect(entry.ocrText).toBe("焼結温度 800℃ で 2 時間 保持");
  });

  it("複数の画像エントリは改行区切りで連結される", () => {
    const doc = makeDoc("最初の画像テキスト");
    doc.pages[0].blocks.push({
      id: "img2",
      type: "image",
      props: { url: "local-media://def", name: "b.png" },
      children: [],
    });
    doc.pages[0].mediaOcr!.img2 = {
      text: "二枚目の画像テキスト",
      confidence: 70,
      lang: "jpn",
      extractedAt: "2026-07-02T00:00:00.000Z",
    };
    const entry = buildIndexEntry("note-1", doc);
    expect(entry.ocrText).toBe("最初の画像テキスト\n二枚目の画像テキスト");
  });

  it("抽出テキストが空のエントリは索引に含めない", () => {
    const doc = makeDoc("ダミー");
    doc.pages[0].mediaOcr!.img1.text = "   ";
    const entry = buildIndexEntry("note-1", doc);
    expect(entry.ocrText).toBeUndefined();
  });

  it("OCR していないノートは ocrText 未設定（後方互換）", () => {
    const doc = makeDoc("");
    const entry = buildIndexEntry("note-1", doc);
    expect(entry.ocrText).toBeUndefined();
  });
});

describe("OCR 画像テキストでの横断検索", () => {
  function makeIndex(): GraphiumIndex {
    return {
      version: 1,
      updatedAt: "2026-07-02T00:00:00.000Z",
      notes: [
        buildIndexEntry("note-1", makeDoc("走査型電子顕微鏡 SEM 観察", "サンプルA")),
        buildIndexEntry("note-2", makeDoc("X線回折 XRD パターン", "サンプルB")),
      ],
    };
  }

  it("画像内テキストにヒットしたノートが検索結果に含まれる", () => {
    const src = new IndexFileNoteListSource(makeIndex());
    const hits = src.searchNotes("SEM");
    expect(hits.map((n) => n.noteId)).toEqual(["note-1"]);
  });

  it("タイトルにも画像テキストにも無い語はヒットしない", () => {
    const src = new IndexFileNoteListSource(makeIndex());
    expect(src.searchNotes("透過電子顕微鏡")).toHaveLength(0);
  });

  it("loadNoteList が ocrText を一覧エントリに引き継ぐ", async () => {
    const src = new IndexFileNoteListSource(makeIndex());
    const list = await src.loadNoteList();
    const a = list.find((e) => e.noteId === "note-1");
    expect(a?.ocrText).toContain("SEM");
  });
});
