import { describe, expect, it } from "vitest";
import type { MediaIndexEntry } from "../asset-browser/media-index";
import type { CaptureEntry } from "../mobile-capture/capture-store";
import type { NoteIndexEntry } from "../navigation/index-file";
import {
  buildRecords,
  collectRecordingNoteIds,
  collectWebClipNoteIds,
  deriveMediaOrigin,
  deriveMemoOrigin,
  deriveNoteOrigin,
  deriveNoteWho,
  mediaToRecord,
  memoToRecord,
  noteToRecord,
  spreadRecordingHits,
} from "./from-indexes";

function note(over: Partial<NoteIndexEntry> = {}): NoteIndexEntry {
  return {
    noteId: "n1",
    title: "食パン 試作",
    createdAt: "2026-11-17T01:00:00.000Z",
    modifiedAt: "2026-11-17T02:00:00.000Z",
    headings: [],
    labels: [],
    outgoingLinks: [],
    ...over,
  };
}

function media(over: Partial<MediaIndexEntry> = {}): MediaIndexEntry {
  return {
    fileId: "m1",
    name: "IMG_0001.jpg",
    type: "image",
    mimeType: "image/jpeg",
    url: "file-media://m1",
    thumbnailUrl: "file-media://m1",
    uploadedAt: "2026-11-17T03:00:00.000Z",
    usedIn: [],
    ...over,
  };
}

function memo(over: Partial<CaptureEntry> = {}): CaptureEntry {
  return { id: "c1", text: "こね上げ温度を下げる", createdAt: "2026-11-17T04:00:00.000Z", ...over };
}

const NONE: ReadonlySet<string> = new Set();

describe("deriveNoteOrigin", () => {
  it("何の印も無いノートは、手で書いた", () => {
    expect(deriveNoteOrigin(note(), NONE)).toBe("written");
  });

  it("AI のページは、ナレッジ化", () => {
    expect(deriveNoteOrigin(note({ source: "ai", wikiKind: "topic", model: "m" }), NONE)).toBe("knowledge");
  });

  it("録音済みの文字起こしを持つノートは、録音から", () => {
    expect(deriveNoteOrigin(note({ hasRecording: true }), NONE)).toBe("recording");
  });

  it("Web クリップのまとめ先は、録音から より先", () => {
    expect(deriveNoteOrigin(note({ hasRecording: true }), new Set(["n1"]))).toBe("webClip");
  });

  it("モデル名があっても、録音を持つなら録音から", () => {
    expect(deriveNoteOrigin(note({ hasRecording: true, source: "human", model: "m" }), NONE)).toBe("recording");
  });

  it("AI のページは、録音の印があってもナレッジ化のまま", () => {
    expect(deriveNoteOrigin(note({ source: "ai", wikiKind: "topic", hasRecording: true }), NONE)).toBe("knowledge");
  });

  it("モデル名を持つノートは、AI から", () => {
    expect(deriveNoteOrigin(note({ source: "human", model: "m", author: "me" }), NONE)).toBe("aiChat");
  });

  it("投入口で取り込んだノートは、取り込んだファイル", () => {
    expect(deriveNoteOrigin(note({ importSourceHash: "sha256:abc" }), NONE)).toBe("file");
  });

  it("テンプレートから作ったノートは、テンプレートから", () => {
    expect(deriveNoteOrigin(note({ templateFrom: { kind: "official", id: "plan" } }), NONE)).toBe("template");
  });

  it("Web クリップのまとめ先は、ほかの印より先に Web クリップになる", () => {
    const ids = new Set(["n1"]);
    expect(deriveNoteOrigin(note({ templateFrom: { kind: "official", id: "plan" } }), ids)).toBe("webClip");
  });

  it("取り込みとテンプレートの両方があれば、取り込みを取る", () => {
    expect(deriveNoteOrigin(note({ importSourceHash: "sha256:abc", templateFrom: { kind: "user", id: "t" } }), NONE)).toBe("file");
  });
});

describe("deriveNoteWho", () => {
  it("印の無いノートは自分", () => {
    expect(deriveNoteWho(note())).toEqual({ type: "self" });
  });

  it("モデル名を持つノートは、自分と AI", () => {
    expect(deriveNoteWho(note({ model: "m" }))).toEqual({ type: "selfWithAi", model: "m" });
  });

  it("AI のページは AI。モデル名が無ければ付けない", () => {
    expect(deriveNoteWho(note({ source: "ai", model: "m" }))).toEqual({ type: "ai", model: "m" });
    expect(deriveNoteWho(note({ source: "ai" }))).toEqual({ type: "ai" });
  });
});

describe("素材とメモの出どころ", () => {
  it("受信箱から取り込んだ素材は、スマホから", () => {
    const capture = { id: "sha256:x", checksum: "sha256:x", mime: "image/jpeg", bytes: 10 };
    expect(deriveMediaOrigin(media({ capture }))).toBe("phone");
  });

  it("URL の素材と Web クリップは、Web クリップ", () => {
    expect(deriveMediaOrigin(media({ type: "url" }))).toBe("webClip");
    expect(deriveMediaOrigin(media({ type: "url", webClip: { noteId: "n9" } }))).toBe("webClip");
  });

  it("それ以外の素材は、取り込んだファイル", () => {
    expect(deriveMediaOrigin(media({ type: "pdf" }))).toBe("file");
  });

  it("音声の素材がノートで使われていても、会議の録音にはしない（ブロックの種類が索引に無い）", () => {
    const audio = media({ type: "audio", usedIn: [{ noteId: "n1", noteTitle: "打ち合わせ", blockId: "b1" }] });
    expect(deriveMediaOrigin(audio)).toBe("file");
    expect(deriveNoteOrigin(note(), collectWebClipNoteIds([audio]))).toBe("written");
  });

  it("素材から引用したメモだけ、素材からの引用になる", () => {
    expect(deriveMemoOrigin(memo())).toBe("memo");
    expect(deriveMemoOrigin(memo({ sourceAsset: { fileId: "m1", type: "url" } as CaptureEntry["sourceAsset"] }))).toBe("quote");
  });
});

describe("1 件の記録への写し", () => {
  it("ノートは題と、見出しを 3 つまで並べた 1 行を持つ", () => {
    const r = noteToRecord(
      note({
        headings: [
          { blockId: "a", text: "材料", level: 2 },
          { blockId: "b", text: " ", level: 2 },
          { blockId: "c", text: "手順", level: 2 },
          { blockId: "d", text: "焼き上がり", level: 3 },
          { blockId: "e", text: "次回", level: 2 },
        ],
      }),
      NONE,
    );
    expect(r).toMatchObject({ id: "note:n1", kind: "note", title: "食パン 試作", detail: "材料 · 手順 · 焼き上がり" });
    expect(r.at).toBe("2026-11-17T01:00:00.000Z");
    expect(r.trace).toBeUndefined();
  });

  it("作成日時の無いノートは、更新日時で並べる", () => {
    expect(noteToRecord(note({ createdAt: "" }), NONE).at).toBe("2026-11-17T02:00:00.000Z");
  });

  it("AI のページは、元になった記録の数を持つ", () => {
    const r = noteToRecord(note({ source: "ai", wikiKind: "topic", derivedFromNotes: ["n2", "pdf:x", "url:y"] }), NONE);
    expect(r.kind).toBe("wiki");
    expect(r.trace).toEqual({ type: "sources", count: 3 });
  });

  it("素材は、使われているノートを重ねずに数える", () => {
    const r = mediaToRecord(
      media({
        usedIn: [
          { noteId: "n1", noteTitle: "A", blockId: "b1" },
          { noteId: "n1", noteTitle: "A", blockId: "b2" },
          { noteId: "n2", noteTitle: "B", blockId: "b3" },
        ],
      }),
    );
    expect(r).toMatchObject({ id: "media:m1", kind: "media", mediaType: "image", who: { type: "self" } });
    expect(r.trace).toEqual({ type: "usedIn", count: 2 });
  });

  it("URL の素材は、ドメインと抜粋を持つ。抜粋が無ければ説明文", () => {
    const withExcerpt = mediaToRecord(
      media({ type: "url", name: "低温発酵", urlMeta: { domain: "bread.example", description: "説明", excerpt: "抜粋" } }),
    );
    expect(withExcerpt).toMatchObject({ domain: "bread.example", detail: "抜粋", origin: "webClip" });
    const withDescription = mediaToRecord(media({ type: "url", urlMeta: { domain: "bread.example", description: "説明" } }));
    expect(withDescription.detail).toBe("説明");
  });

  it("PDF は、ページ数を持つ", () => {
    expect(mediaToRecord(media({ type: "pdf", pageCount: 24 })).pageCount).toBe(24);
    expect(mediaToRecord(media({ type: "pdf" })).pageCount).toBeUndefined();
  });

  it("メモは本文を持ち、題は持たない", () => {
    const r = memoToRecord(memo({ usedIn: [{ noteId: "n1" } as NonNullable<CaptureEntry["usedIn"]>[number]] }));
    expect(r).toMatchObject({ id: "memo:c1", kind: "memo", text: "こね上げ温度を下げる", origin: "memo" });
    expect(r.title).toBeUndefined();
    expect(r.trace).toEqual({ type: "usedIn", count: 1 });
  });
});

describe("buildRecords", () => {
  it("3 つの置き場の記録を、新しい順に 1 本に並べる", () => {
    const records = buildRecords({ notes: [note()], media: [media()], captures: [memo()] });
    expect(records.map((r) => r.id)).toEqual(["memo:c1", "media:m1", "note:n1"]);
  });

  it("ゴミ箱・アーカイブ・スキル・メモの一時エントリは外す", () => {
    const records = buildRecords({
      notes: [
        note({ noteId: "keep" }),
        note({ noteId: "trashed", deletedAt: "2026-11-17T05:00:00.000Z" }),
        note({ noteId: "archived", archivedAt: "2026-11-17T05:00:00.000Z" }),
        note({ noteId: "skill", source: "skill" }),
      ],
      media: [media({ fileId: "keep" }), media({ fileId: "archived", archivedAt: "2026-11-17T05:00:00.000Z" }), media({ fileId: "peek", type: "memo" })],
      captures: [
        memo({ id: "keep" }),
        memo({ id: "trashed", deletedAt: "2026-11-17T05:00:00.000Z" }),
        memo({ id: "archived", archivedAt: "2026-11-17T05:00:00.000Z" }),
      ],
    });
    expect(records.map((r) => r.id).sort()).toEqual(["media:keep", "memo:keep", "note:keep"]);
  });

  it("Web クリップのまとめ先のノートは、素材の印から Web クリップになる", () => {
    const records = buildRecords({
      notes: [note({ noteId: "clip-note" })],
      media: [media({ type: "url", webClip: { noteId: "clip-note" } })],
      captures: [],
    });
    expect(records.find((r) => r.id === "note:clip-note")?.origin).toBe("webClip");
  });

  it("日時として読めない記録は、いちばん後ろに回す", () => {
    const records = buildRecords({ notes: [note({ createdAt: "", modifiedAt: "" })], media: [media()], captures: [] });
    expect(records.map((r) => r.id)).toEqual(["media:m1", "note:n1"]);
  });

  it("渡した配列を書き換えない", () => {
    const notes = Object.freeze([Object.freeze(note())]);
    const mediaList = Object.freeze([Object.freeze(media())]);
    expect(() => buildRecords({ notes, media: mediaList, captures: [] })).not.toThrow();
  });
});

describe("録音の素材と、録音を持つノート", () => {
  const usedIn = (noteId: string) => [{ noteId, noteTitle: "打ち合わせ", blockId: "b1" }];
  const recNotes = new Set(["n1"]);

  it("録音・文字起こしを持つノートの ID を集める", () => {
    expect([...collectRecordingNoteIds([note({ noteId: "n1", hasRecording: true }), note({ noteId: "n2" })])]).toEqual(["n1"]);
  });

  it("録音を持つノートが使っている音声・動画は「録音から」", () => {
    expect(deriveMediaOrigin(media({ type: "audio", usedIn: usedIn("n1") }), recNotes)).toBe("recording");
    expect(deriveMediaOrigin(media({ type: "video", usedIn: usedIn("n1") }), recNotes)).toBe("recording");
  });

  it("どのノートにも置いていない音声・録音を持たないノートの音声・画像は「取り込んだファイル」のまま", () => {
    expect(deriveMediaOrigin(media({ type: "audio" }), recNotes)).toBe("file");
    expect(deriveMediaOrigin(media({ type: "audio", usedIn: usedIn("n2") }), recNotes)).toBe("file");
    expect(deriveMediaOrigin(media({ type: "image", usedIn: usedIn("n1") }), recNotes)).toBe("file");
    expect(deriveMediaOrigin(media({ type: "audio", usedIn: usedIn("n1") }))).toBe("file");
  });

  it("スマホからの音声は、録音を持つノートで使っていても「スマホから」", () => {
    const capture = { capturedAt: "2026-11-17T03:00:00.000Z" } as MediaIndexEntry["capture"];
    expect(deriveMediaOrigin(media({ type: "audio", capture, usedIn: usedIn("n1") }), recNotes)).toBe("phone");
  });

  it("buildRecords は、ノートの hasRecording から素材の札を導く", () => {
    const records = buildRecords({
      notes: [note({ noteId: "n1", hasRecording: true })],
      media: [media({ fileId: "a1", type: "audio", usedIn: usedIn("n1") })],
      captures: [],
    });
    expect(records.find((r) => r.id === "media:a1")?.origin).toBe("recording");
    expect(records.find((r) => r.id === "note:n1")?.origin).toBe("recording");
  });

  it("録音を置いたノートがごみ箱・アーカイブにあっても、録音の素材は「録音から」のまま。ノートは出さない", () => {
    const records = buildRecords({
      notes: [],
      hiddenNotes: [
        note({ noteId: "n1", hasRecording: true, deletedAt: "2026-11-18T00:00:00.000Z" }),
        note({ noteId: "n2", hasRecording: true, archivedAt: "2026-11-18T00:00:00.000Z" }),
      ],
      media: [
        media({ fileId: "a1", type: "audio", usedIn: usedIn("n1") }),
        media({ fileId: "a2", type: "audio", usedIn: usedIn("n2") }),
      ],
      captures: [],
    });
    expect(records.find((r) => r.id === "media:a1")?.origin).toBe("recording");
    expect(records.find((r) => r.id === "media:a2")?.origin).toBe("recording");
    expect(records.some((r) => r.kind === "note")).toBe(false);
  });

  it("文字起こしで当たった録音から、その録音を持つノートにも当たりを広げる", () => {
    const m = [media({ fileId: "a1", type: "audio", usedIn: usedIn("n1") })];
    const hits = spreadRecordingHits(new Map([["media:a1", "抜粋"]]), m, recNotes);
    expect(hits.get("note:n1")).toBe("抜粋");
    expect(hits.get("media:a1")).toBe("抜粋");
  });

  it("ノート自身が本文で当たっていれば、その当たりを残す。録音でない素材からは広げない", () => {
    const m = [
      media({ fileId: "a1", type: "audio", usedIn: usedIn("n1") }),
      media({ fileId: "i1", type: "image", usedIn: usedIn("n3") }),
    ];
    const hits = spreadRecordingHits(
      new Map([
        ["media:a1", "文字起こしの抜粋"],
        ["note:n1", "本文の抜粋"],
        ["media:i1", "画像の文字"],
      ]),
      m,
      new Set(["n1", "n3"]),
    );
    expect(hits.get("note:n1")).toBe("本文の抜粋");
    expect(hits.has("note:n3")).toBe(false);
  });

  it("文字起こしで当たっていない録音からは広げない", () => {
    const m = [media({ fileId: "a1", type: "audio", usedIn: usedIn("n1") })];
    expect(spreadRecordingHits(new Map<string, string>(), m, recNotes).size).toBe(0);
  });
});
