// lineage.ts のノート間来歴追跡の回帰テスト。
// search.ts の allEntries() がプロセス内キャッシュを持つため、各テスト前に resetSearchIndex() で捨てる。

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  upstreamOf,
  downstreamOf,
  connectionsOf,
  traceLineage,
  upstreamKnowledgeOf,
  downstreamKnowledgeOf,
} from "./lineage";
import { resetSearchIndex } from "./search";
import { buildIndexEntry, type GraphiumIndex, type NoteIndexEntry } from "../features/navigation/index-file";
import type { BlockLink } from "../lib/block-link-types";
import type { GraphiumDocument, NoteLink, WikiMeta } from "../lib/document-types";

function makeEntry(overrides: Partial<NoteIndexEntry> = {}): NoteIndexEntry {
  return {
    noteId: overrides.noteId ?? "note-1",
    title: overrides.title ?? "テストノート",
    modifiedAt: "2026-08-01T00:00:00.000Z",
    createdAt: "2026-08-01T00:00:00.000Z",
    headings: [],
    labels: [],
    outgoingLinks: [],
    ...overrides,
  };
}

function makeProvLink(overrides: Partial<BlockLink> = {}): BlockLink {
  return {
    id: `link-${Math.random()}`,
    sourceBlockId: "src-block",
    targetBlockId: "",
    type: "derived_from",
    layer: "prov",
    createdBy: "human",
    ...overrides,
  };
}

function makeDoc(overrides: Partial<GraphiumDocument> = {}): GraphiumDocument {
  return {
    version: 6,
    title: "ドキュメント",
    pages: [],
    createdAt: "2026-08-01T00:00:00.000Z",
    modifiedAt: "2026-08-01T00:00:00.000Z",
    ...overrides,
  };
}

/** 一時 vault を組み立て、notes/ と appdata/note-index.json を書く */
function buildVault(
  dir: string,
  docs: Record<string, GraphiumDocument>,
  entries: NoteIndexEntry[],
): void {
  const notesDirPath = join(dir, "notes");
  const appdata = join(dir, "appdata");
  mkdirSync(notesDirPath, { recursive: true });
  mkdirSync(appdata, { recursive: true });
  for (const [noteId, doc] of Object.entries(docs)) {
    writeFileSync(join(notesDirPath, `${noteId}.json`), JSON.stringify(doc), "utf8");
  }
  const index: GraphiumIndex = {
    version: 1,
    updatedAt: "2026-08-01T00:00:00.000Z",
    notes: entries,
  };
  writeFileSync(join(appdata, "note-index.json"), JSON.stringify(index), "utf8");
}

describe("lineage", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "graphium-mcp-"));
    resetSearchIndex();
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
    resetSearchIndex();
  });

  describe("upstreamOf", () => {
    it("page.provLinks（targetNoteId 付き）と doc.derivedFromNoteId の両方を拾う", () => {
      const doc = makeDoc({
        pages: [
          {
            id: "page-1",
            title: "ページ1",
            blocks: [],
            labels: {},
            provLinks: [
              makeProvLink({
                sourceBlockId: "s1",
                targetBlockId: "t1",
                targetNoteId: "note-b",
                targetNoteTitle: "ノートB",
              }),
            ],
            knowledgeLinks: [],
          },
        ],
        derivedFromNoteId: "note-c",
        derivedFromBlockId: "block-c",
      });

      buildVault(
        dir,
        { "note-a": doc },
        [makeEntry({ noteId: "note-a" })],
      );

      const edges = upstreamOf("note-a", dir);
      const targetIds = edges.map((e) => e.noteId).sort();
      expect(targetIds).toEqual(["note-b", "note-c"]);
    });

    it("自ノートを指すリンク（self-loop）を除外する", () => {
      const doc = makeDoc({
        pages: [
          {
            id: "page-1",
            title: "ページ1",
            blocks: [],
            labels: {},
            provLinks: [
              makeProvLink({ sourceBlockId: "s1", targetBlockId: "t1", targetNoteId: "note-a" }),
            ],
            knowledgeLinks: [],
          },
        ],
      });

      buildVault(dir, { "note-a": doc }, [makeEntry({ noteId: "note-a" })]);

      expect(upstreamOf("note-a", dir)).toEqual([]);
    });
  });

  describe("downstreamOf", () => {
    it("doc.noteLinks 経由で派生先を拾う（相手の derivedFromNoteId が自分の線）", () => {
      const noteLink: NoteLink = {
        targetNoteId: "note-y",
        sourceBlockId: "b1",
        type: "derived_from",
      };
      const docX = makeDoc({ noteLinks: [noteLink] });
      const docY = makeDoc({ derivedFromNoteId: "note-x" });

      buildVault(
        dir,
        { "note-x": docX, "note-y": docY },
        [makeEntry({ noteId: "note-x" }), makeEntry({ noteId: "note-y", title: "ノートY" })],
      );

      const edges = downstreamOf("note-x", dir);
      expect(edges).toHaveLength(1);
      expect(edges[0].noteId).toBe("note-y");
    });

    it("相手ノートの derivedFromNoteId からの逆引きでも拾う（noteLinks が無いケース）", () => {
      const docP = makeDoc({
        pages: [
          {
            id: "page-1",
            title: "ページ1",
            blocks: [],
            labels: {},
            provLinks: [
              makeProvLink({
                sourceBlockId: "blockA",
                targetBlockId: "",
                targetNoteId: "note-x",
                targetNoteTitle: "ノートX",
              }),
            ],
            knowledgeLinks: [],
          },
        ],
      });
      const docX = makeDoc();

      buildVault(
        dir,
        { "note-p": docP, "note-x": docX },
        [
          makeEntry({
            noteId: "note-p",
            title: "ノートP",
            outgoingLinks: [{ targetNoteId: "note-x", layer: "prov" }],
          }),
          makeEntry({ noteId: "note-x", title: "ノートX" }),
        ],
      );

      const edges = downstreamOf("note-x", dir);
      expect(edges).toHaveLength(1);
      expect(edges[0].noteId).toBe("note-p");
    });

    it("同じ関係が noteLinks と逆引きの両方に現れても 1 件に重複排除される", () => {
      const noteLink: NoteLink = {
        targetNoteId: "note-p",
        sourceBlockId: "blockA",
        type: "derived_from",
      };
      const docX = makeDoc({ noteLinks: [noteLink] });
      const docP = makeDoc({
        pages: [
          {
            id: "page-1",
            title: "ページ1",
            blocks: [],
            labels: {},
            provLinks: [
              makeProvLink({
                sourceBlockId: "blockA",
                targetBlockId: "",
                targetNoteId: "note-x",
                targetNoteTitle: "ノートX",
              }),
            ],
            knowledgeLinks: [],
          },
        ],
      });

      buildVault(
        dir,
        { "note-x": docX, "note-p": docP },
        [
          makeEntry({
            noteId: "note-p",
            title: "ノートP",
            outgoingLinks: [{ targetNoteId: "note-x", layer: "prov" }],
          }),
          makeEntry({ noteId: "note-x", title: "ノートX" }),
        ],
      );

      const edges = downstreamOf("note-x", dir);
      expect(edges).toHaveLength(1);
      expect(edges[0].noteId).toBe("note-p");
    });
  });

  describe("traceLineage", () => {
    it("depth が効く（2 段先まで辿る）", () => {
      // note-3 は note-2 から派生、note-2 は note-1 から派生（provLinks は上流を指す）
      const doc1 = makeDoc();
      const doc2 = makeDoc({
        pages: [
          {
            id: "page-1",
            title: "ページ1",
            blocks: [],
            labels: {},
            provLinks: [
              makeProvLink({
                sourceBlockId: "s2",
                targetBlockId: "t2",
                targetNoteId: "note-1",
                targetNoteTitle: "ノート1",
              }),
            ],
            knowledgeLinks: [],
          },
        ],
      });
      const doc3 = makeDoc({
        pages: [
          {
            id: "page-1",
            title: "ページ1",
            blocks: [],
            labels: {},
            provLinks: [
              makeProvLink({
                sourceBlockId: "s3",
                targetBlockId: "t3",
                targetNoteId: "note-2",
                targetNoteTitle: "ノート2",
              }),
            ],
            knowledgeLinks: [],
          },
        ],
      });

      buildVault(
        dir,
        { "note-1": doc1, "note-2": doc2, "note-3": doc3 },
        [
          makeEntry({ noteId: "note-1", title: "ノート1" }),
          makeEntry({ noteId: "note-2", title: "ノート2" }),
          makeEntry({ noteId: "note-3", title: "ノート3" }),
        ],
      );

      const shallow = traceLineage("note-3", { direction: "upstream", depth: 1 }, dir);
      expect(shallow.upstream.map((n) => n.noteId)).toEqual(["note-2"]);

      const deep = traceLineage("note-3", { direction: "upstream", depth: 2 }, dir);
      const ids = deep.upstream.map((n) => n.noteId).sort();
      expect(ids).toEqual(["note-1", "note-2"]);
      expect(deep.upstream.find((n) => n.noteId === "note-1")?.depth).toBe(2);
    });
  });

  function writeMediaIndex(media: { fileId: string; name: string; type: string; url?: string }[]) {
    writeFileSync(
      join(dir, "appdata", "media-index.json"),
      JSON.stringify({ version: 9, updatedAt: "2026-08-01T00:00:00.000Z", media }),
      "utf8",
    );
  }

  describe("取り込み元の資料", () => {
    it("PDF・Word・URL から作ったノートは元資料を上流（prov/used）に持ち、資料から逆引きできる", () => {
      buildVault(
        dir,
        {
          "note-pdf": makeDoc({ sourcePdfFileId: "pdf-1", sourcePdfName: "paper.pdf" }),
          "note-url": makeDoc({ sourceUrl: "https://example.com/a" }),
          // AI が書いたノートは元資料を来歴に出さない（アプリの来歴グラフと同じ）
          "note-ai": makeDoc({ source: "ai", sourcePdfFileId: "pdf-1" }),
        },
        [
          makeEntry({ noteId: "note-pdf", title: "論文から作った手順" }),
          makeEntry({ noteId: "note-url", title: "Web から作った手順" }),
          makeEntry({ noteId: "note-ai", title: "AI のノート" }),
        ],
      );
      writeMediaIndex([{ fileId: "pdf-1", name: "paper.pdf", type: "pdf" }]);

      const up = upstreamOf("note-pdf", dir);
      expect(up).toHaveLength(1);
      expect(up[0]).toMatchObject({ noteId: "pdf:pdf-1", title: "paper.pdf", type: "used", layer: "prov" });
      expect(upstreamOf("note-url", dir).map((e) => e.noteId)).toEqual(["url:https://example.com/a"]);
      expect(upstreamOf("note-ai", dir)).toEqual([]);

      expect(downstreamOf("pdf:pdf-1", dir).map((e) => e.noteId)).toEqual(["note-pdf"]);
      // 外部資料は来歴の終点。上流側へ辿っても資料の先へは進まない
      const result = traceLineage("note-pdf", { direction: "upstream", depth: 3 }, dir);
      expect(result.upstream.map((n) => n.noteId)).toEqual(["pdf:pdf-1"]);
    });
  });

  describe("ナレッジ層", () => {
    function makeWikiMeta(overrides: Partial<WikiMeta>): WikiMeta {
      return {
        kind: "claim",
        derivedFromNotes: [],
        derivedFromChats: [],
        generatedAt: "2026-09-01T00:00:00.000Z",
        generatedBy: { model: "test", version: "1" },
        ...overrides,
      };
    }

    /** topic-1 → claim-1 → note-1 の 2 ホップを持つ vault */
    function seedKnowledgeVault() {
      const note1 = makeDoc();
      const claim1 = makeDoc({
        wikiMeta: makeWikiMeta({ kind: "claim", derivedFromNotes: ["note-1"], topicIds: ["topic-1"] }),
      });
      const topic1 = makeDoc({
        wikiMeta: makeWikiMeta({ kind: "topic", derivedFromClaims: ["claim-1"] }),
      });

      buildVault(
        dir,
        { "note-1": note1, "claim-1": claim1, "topic-1": topic1 },
        [
          makeEntry({ noteId: "note-1", title: "実験ノート" }),
          makeEntry({
            noteId: "claim-1",
            title: "知見",
            source: "ai",
            wikiKind: "claim",
            derivedFromNotes: ["note-1"],
          }),
          makeEntry({ noteId: "topic-1", title: "トピック", source: "ai", wikiKind: "topic" }),
        ],
      );
    }

    it("upstreamKnowledgeOf: topic → メンバー知見、claim → 出どころノート", () => {
      seedKnowledgeVault();
      expect(upstreamKnowledgeOf("topic-1", dir).map((e) => e.noteId)).toEqual(["claim-1"]);
      expect(upstreamKnowledgeOf("claim-1", dir).map((e) => e.noteId)).toEqual(["note-1"]);
      expect(upstreamKnowledgeOf("topic-1", dir)[0].layer).toBe("knowledge");
      expect(upstreamKnowledgeOf("note-1", dir)).toEqual([]); // wikiMeta を持たないノートは空
    });

    it("downstreamKnowledgeOf: claim → それをメンバーにする topic、note → それを出どころにする claim", () => {
      seedKnowledgeVault();
      expect(downstreamKnowledgeOf("claim-1", dir).map((e) => e.noteId)).toEqual(["topic-1"]);
      expect(downstreamKnowledgeOf("note-1", dir).map((e) => e.noteId)).toEqual(["claim-1"]);
    });

    it("traceLineage は PROV 層とナレッジ層の両方を辿り、via.layer で区別する", () => {
      seedKnowledgeVault();
      const result = traceLineage("topic-1", { direction: "upstream", depth: 2 }, dir);
      const ids = result.upstream.map((n) => n.noteId).sort();
      expect(ids).toEqual(["claim-1", "note-1"]);
      expect(result.upstream.every((n) => n.via?.layer === "knowledge")).toBe(true);
    });

    it("資料から作ったトピックは、知見を経ずに資料（名前つき）を上流に持ち、資料からの逆引きでも出る", () => {
      const note1 = makeDoc();
      const topic2 = makeDoc({
        wikiMeta: makeWikiMeta({ kind: "topic", derivedFromNotes: ["document:doc-1", "note-1"] }),
      });
      buildVault(
        dir,
        { "note-1": note1, "topic-2": topic2 },
        [
          makeEntry({ noteId: "note-1", title: "実験ノート" }),
          makeEntry({
            noteId: "topic-2",
            title: "合成条件",
            source: "ai",
            wikiKind: "topic",
            derivedFromNotes: ["document:doc-1", "note-1"],
          }),
        ],
      );
      writeMediaIndex([{ fileId: "doc-1", name: "2012_05_22.docx", type: "document" }]);

      const up = upstreamKnowledgeOf("topic-2", dir);
      expect(up.map((e) => [e.noteId, e.title])).toEqual([
        ["document:doc-1", "2012_05_22.docx"],
        ["note-1", "実験ノート"],
      ]);
      // ノート側・資料側どちらから辿っても、それを引くトピックが下流に出る
      expect(downstreamKnowledgeOf("note-1", dir).map((e) => e.noteId)).toEqual(["topic-2"]);
      expect(traceLineage("document:doc-1", { direction: "downstream" }, dir).downstream.map((n) => n.noteId)).toEqual([
        "topic-2",
      ]);
    });

    it("既存ノート（wikiMeta なし）どうしの PROV 層のみの来歴は変わらない", () => {
      const doc1 = makeDoc();
      const doc2 = makeDoc({
        pages: [
          {
            id: "page-1",
            title: "ページ1",
            blocks: [],
            labels: {},
            provLinks: [makeProvLink({ sourceBlockId: "s", targetBlockId: "t", targetNoteId: "note-1" })],
            knowledgeLinks: [],
          },
        ],
      });
      buildVault(
        dir,
        { "note-1": doc1, "note-2": doc2 },
        [makeEntry({ noteId: "note-1" }), makeEntry({ noteId: "note-2" })],
      );

      const result = traceLineage("note-2", { direction: "upstream" }, dir);
      expect(result.upstream.map((n) => n.noteId)).toEqual(["note-1"]);
      expect(result.upstream[0].via?.layer).toBe("prov");
    });
  });
});

// 本文の @ でつないだだけの線（noteLinks のうち、相手の derivedFromNoteId が自分でない線）は
// 向きの無い「つながり」。上流・下流に入れず connections に出す（lib/note-link-kind.ts）
describe("本文の @ のつながり", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "graphium-mcp-"));
    resetSearchIndex();
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
    resetSearchIndex();
  });

  const mention = (targetNoteId: string, sourceBlockId = "b1"): NoteLink => ({
    targetNoteId,
    sourceBlockId,
    type: "derived_from",
  });

  /** 後の打ち合わせ（late）が前の回（early）を @ で引く。early は late から派生していない */
  function buildMentionVault(entries?: NoteIndexEntry[]) {
    const docs = {
      early: makeDoc({ title: "9/24 の回" }),
      late: makeDoc({ title: "10/19 の回", noteLinks: [mention("early")] }),
    };
    buildVault(
      dir,
      docs,
      // 既定はアプリが作るのと同じ索引（buildIndexEntry。v33 の via・derivedFromNoteId つき）
      entries ?? Object.entries(docs).map(([id, d]) => buildIndexEntry(id, d)),
    );
  }

  it("@ で引いた相手は下流にも上流にも入らず、両側から「つながり」として見える", () => {
    buildMentionVault();
    expect(downstreamOf("late", dir)).toEqual([]);
    expect(upstreamOf("early", dir)).toEqual([]);

    const fromLate = traceLineage("late", {}, dir);
    expect(fromLate.upstream).toEqual([]);
    expect(fromLate.downstream).toEqual([]);
    expect(fromLate.connections.map((n) => n.noteId)).toEqual(["early"]);
    expect(fromLate.connections[0].via).toMatchObject({ layer: "connection", type: "reference", sourceBlockId: "b1" });

    // 引かれた側からも同じ線が見える（向きが無いので、どちらから辿っても「つながり」）
    const fromEarly = traceLineage("early", {}, dir);
    expect(fromEarly.upstream).toEqual([]);
    expect(fromEarly.downstream).toEqual([]);
    expect(fromEarly.connections.map((n) => n.noteId)).toEqual(["late"]);
  });

  it("v33 の索引（via と derivedFromNoteId つき）でも同じに読める", () => {
    buildMentionVault([
      makeEntry({ noteId: "early", title: "9/24 の回" }),
      makeEntry({
        noteId: "late",
        title: "10/19 の回",
        outgoingLinks: [{ targetNoteId: "early", targetBlockId: "b1", layer: "prov", via: "noteLink" }],
      }),
    ]);
    expect(connectionsOf("early", dir).map((e) => e.noteId)).toEqual(["late"]);
    expect(connectionsOf("late", dir).map((e) => e.noteId)).toEqual(["early"]);
    expect(downstreamOf("late", dir)).toEqual([]);
  });

  it("v32 以前の索引（via なし）でも、本体の noteLinks を見て引いた側を見つける", () => {
    buildMentionVault([
      makeEntry({ noteId: "early", title: "9/24 の回" }),
      makeEntry({
        noteId: "late",
        title: "10/19 の回",
        outgoingLinks: [{ targetNoteId: "early", targetBlockId: "b1", layer: "prov" }],
      }),
    ]);
    expect(connectionsOf("early", dir).map((e) => e.noteId)).toEqual(["late"]);
  });

  it("派生で作ったノートは下流のまま。子が親を @ で引いても、つながりに重ねて出さない", () => {
    const docs = {
      parent: makeDoc({ title: "試作 5", noteLinks: [mention("child")] }),
      child: makeDoc({ title: "試作 6", derivedFromNoteId: "parent", noteLinks: [mention("parent", "c1")] }),
    };
    buildVault(dir, docs, [
      makeEntry({ noteId: "parent", title: "試作 5" }),
      makeEntry({ noteId: "child", title: "試作 6", derivedFromNoteId: "parent" }),
    ]);

    const fromParent = traceLineage("parent", {}, dir);
    expect(fromParent.downstream.map((n) => n.noteId)).toEqual(["child"]);
    expect(fromParent.connections).toEqual([]);

    const fromChild = traceLineage("child", {}, dir);
    expect(fromChild.upstream.map((n) => n.noteId)).toEqual(["parent"]);
    expect(fromChild.connections).toEqual([]);
  });

  it("派生とつながりが混ざっても、それぞれの欄に分かれる", () => {
    const docs = {
      hub: makeDoc({ title: "まとめ", noteLinks: [mention("kid"), mention("ref")] }),
      kid: makeDoc({ title: "派生させたノート", derivedFromNoteId: "hub" }),
      ref: makeDoc({ title: "前に書いたノート" }),
    };
    buildVault(dir, docs, [
      makeEntry({ noteId: "hub", title: "まとめ" }),
      makeEntry({ noteId: "kid", title: "派生させたノート" }),
      makeEntry({ noteId: "ref", title: "前に書いたノート" }),
    ]);
    const result = traceLineage("hub", {}, dir);
    expect(result.downstream.map((n) => n.noteId)).toEqual(["kid"]);
    expect(result.connections.map((n) => n.noteId)).toEqual(["ref"]);
  });
});
