// 索引の形をした仮のデータ（ノートの索引・素材の索引・メモの一覧）。
// from-indexes.ts の写しを通した結果を Storybook で見るためのもので、中身は架空。
// 日時は実データと同じ UTC の ISO 文字列にしてある（画面では端末の時刻で出る）。
import type { MediaIndexEntry } from "../asset-browser/media-index";
import type { CaptureEntry } from "../mobile-capture/capture-store";
import type { NoteIndexEntry } from "../navigation/index-file";
import type { RecordSources } from "./from-indexes";

/** 端末の時刻で書いた日時を UTC の ISO 文字列にする */
const at = (day: number, hour: number, minute: number) => new Date(2026, 10, day, hour, minute).toISOString();

const baseNote = { headings: [], labels: [], outgoingLinks: [] } satisfies Partial<NoteIndexEntry>;

const notes: NoteIndexEntry[] = [
  {
    ...baseNote,
    noteId: "n-trial",
    title: "食パン 試作 4 回目",
    createdAt: at(16, 8, 20),
    modifiedAt: at(16, 9, 0),
    headings: [
      { blockId: "h1", text: "材料", level: 2 },
      { blockId: "h2", text: "手順", level: 2 },
      { blockId: "h3", text: "焼き上がり", level: 2 },
    ],
    templateFrom: { kind: "official", id: "experiment" },
  },
  {
    ...baseNote,
    noteId: "n-plan",
    title: "発酵時間の見直し案",
    createdAt: at(17, 16, 5),
    modifiedAt: at(17, 16, 5),
    headings: [
      { blockId: "h1", text: "いまの手順", level: 2 },
      { blockId: "h2", text: "温度はそのままで時間を倍にする案", level: 2 },
    ],
    source: "human",
    author: "me",
    model: "claude-opus-4-7",
  },
  {
    ...baseNote,
    noteId: "n-clip",
    title: "低温で長く発酵させると、風味が変わる理由",
    createdAt: at(17, 13, 40),
    modifiedAt: at(17, 13, 42),
  },
  {
    ...baseNote,
    noteId: "w-topic",
    title: "低温発酵と風味",
    createdAt: at(17, 16, 20),
    modifiedAt: at(17, 16, 20),
    headings: [{ blockId: "h1", text: "発酵の温度と時間の関係", level: 2 }],
    source: "ai",
    wikiKind: "topic",
    model: "claude-opus-4-7",
    derivedFromNotes: ["n-trial", "n-plan", "url:u-clip"],
  },
  {
    ...baseNote,
    noteId: "n-curry",
    title: "カレーの覚え書き",
    createdAt: at(14, 19, 10),
    modifiedAt: at(14, 19, 10),
    importSourceHash: "sha256:0000",
  },
  // ゴミ箱のノートは出ない
  { ...baseNote, noteId: "n-trash", title: "消したノート", createdAt: at(17, 8, 0), modifiedAt: at(17, 8, 0), deletedAt: at(17, 8, 5) },
];

const baseMedia = { url: "", thumbnailUrl: "", usedIn: [] } satisfies Partial<MediaIndexEntry>;

const media: MediaIndexEntry[] = [
  {
    ...baseMedia,
    fileId: "u-clip",
    name: "低温で長く発酵させると、風味が変わる理由",
    type: "url",
    mimeType: "text/html",
    uploadedAt: at(17, 13, 40),
    urlMeta: { domain: "pan-no-techo.example", excerpt: "温度を下げると発酵はゆっくり進み、そのあいだに香りのもとが増えていく" },
    webClip: { noteId: "n-clip" },
    usedIn: [{ noteId: "n-clip", noteTitle: "低温で長く発酵させると、風味が変わる理由", blockId: "b1" }],
  },
  {
    ...baseMedia,
    fileId: "p-photo",
    name: "IMG_2041.jpg",
    type: "image",
    mimeType: "image/jpeg",
    uploadedAt: at(17, 11, 30),
    capture: { id: "sha256:1111", checksum: "sha256:1111", mime: "image/jpeg", bytes: 1024 },
    usedIn: [
      { noteId: "n-trial", noteTitle: "食パン 試作 4 回目", blockId: "b1" },
      { noteId: "n-trial", noteTitle: "食パン 試作 4 回目", blockId: "b2" },
    ],
  },
  {
    ...baseMedia,
    fileId: "a-voice",
    name: "打ち合わせの録音.m4a",
    type: "audio",
    mimeType: "audio/mp4",
    uploadedAt: at(17, 10, 12),
    usedIn: [{ noteId: "n-plan", noteTitle: "発酵時間の見直し案", blockId: "b9" }],
  },
  {
    ...baseMedia,
    fileId: "d-pdf",
    name: "製パンの基礎_第3章.pdf",
    type: "pdf",
    mimeType: "application/pdf",
    uploadedAt: at(17, 21, 30),
    pageCount: 24,
  },
];

const captures: CaptureEntry[] = [
  { id: "c-1", text: "食パン、こね上げの温度を 26℃ に抑えたら、きめが揃った気がする", createdAt: at(17, 9, 5) },
  {
    id: "c-2",
    text: "冷蔵庫の温度なら、ひと晩かけても過発酵になりにくい",
    createdAt: at(17, 13, 42),
    sourceAsset: { fileId: "u-clip", type: "url" } as CaptureEntry["sourceAsset"],
  },
  { id: "c-3", text: "型を変えれば、焼く温度はそのままでいいかもしれない", createdAt: at(14, 22, 5) },
];

export const SAMPLE_SOURCES: RecordSources = { notes, media, captures };
