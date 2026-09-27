// 検索層のテスト。
//
// 特に「索引の鮮度」を守る。MCP のプロセスはクライアントが生きている間ずっと残るため、
// キャッシュが古いままだと Graphium 側で足したノートも、自分で作ったノートも検索に出ない。

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { buildNoteDocument, createNote } from "./create-note";
import { saveAnswer } from "./save-answer";
import { addCreatedNoteToIndex, addCreatedWikiToIndex, allEntries, resetSearchIndex, searchNotes } from "./search";

let root: string;

/** ノート本体を書く（step とインラインラベルを任意で持たせる） */
function writeNote(
  noteId: string,
  title: string,
  bodyText: string,
  opts: { stepTitle?: string } = {},
): void {
  const blocks: unknown[] = [
    {
      id: `${noteId}-p`,
      type: "paragraph",
      props: {},
      content: [{ type: "text", text: bodyText, styles: {} }],
      children: [],
    },
  ];
  if (opts.stepTitle) {
    blocks.unshift({
      id: `${noteId}-s`,
      type: "step",
      props: {},
      content: [{ type: "text", text: opts.stepTitle, styles: {} }],
      children: [],
    });
  }
  writeFileSync(
    join(root, "notes", `${noteId}.json`),
    JSON.stringify({
      version: 2,
      title,
      pages: [{ id: "main", title, blocks, labels: {}, provLinks: [], knowledgeLinks: [] }],
      source: "human",
    }),
  );
}

/** note-index を書く。mtime を明示できるようにして鮮度チェックを試験する */
function writeIndex(entries: unknown[], mtimeSec?: number): void {
  const path = join(root, "appdata", "note-index.json");
  writeFileSync(
    path,
    JSON.stringify({ version: 25, updatedAt: "2026-01-01T00:00:00.000Z", notes: entries }),
  );
  if (mtimeSec !== undefined) utimesSync(path, mtimeSec, mtimeSec);
}

const entry = (noteId: string, title: string, extra: Record<string, unknown> = {}) => ({
  noteId,
  title,
  modifiedAt: "2026-01-01T00:00:00.000Z",
  createdAt: "2026-01-01T00:00:00.000Z",
  headings: [],
  labels: [],
  outgoingLinks: [],
  source: "human",
  ...extra,
});

beforeEach(() => {
  resetSearchIndex();
  root = mkdtempSync(join(tmpdir(), "graphium-mcp-search-"));
  mkdirSync(join(root, "notes"), { recursive: true });
  mkdirSync(join(root, "appdata"), { recursive: true });
});

afterEach(() => {
  resetSearchIndex();
  rmSync(root, { recursive: true, force: true });
});

describe("searchNotes", () => {
  it("本文の語で引ける", () => {
    writeNote("n1", "焼結の記録", "グラファイトダイで焼結した");
    writeIndex([entry("n1", "焼結の記録")]);

    const hits = searchNotes("グラファイトダイ", {}, root);
    expect(hits.map((h) => h.noteId)).toEqual(["n1"]);
    expect(hits[0].snippet).toContain("グラファイトダイ");
  });

  it("上付きの本文は平文で索引する（「10⁵」「105」で当たり、タグ名 sup では当たらない）", () => {
    writeFileSync(
      join(root, "notes", "n1.json"),
      JSON.stringify({
        version: 2,
        title: "無題",
        pages: [{
          id: "main",
          title: "無題",
          blocks: [{
            id: "p",
            type: "paragraph",
            props: {},
            content: [
              { type: "text", text: "圧力 10", styles: {} },
              { type: "text", text: "5", styles: { superscript: true } },
              { type: "text", text: " Pa", styles: {} },
            ],
            children: [],
          }],
          labels: {},
          provLinks: [],
          knowledgeLinks: [],
        }],
        source: "human",
      }),
    );
    writeIndex([entry("n1", "無題")]);

    expect(searchNotes("10⁵", {}, root).map((h) => h.noteId)).toEqual(["n1"]);
    expect(searchNotes("105", {}, root).map((h) => h.noteId)).toEqual(["n1"]);
    expect(searchNotes("sup", {}, root)).toEqual([]);
  });

  it("手順名でも引ける（本文に無くても当たる）", () => {
    writeNote("n1", "無題", "内容は関係のない文", { stepTitle: "ホットプレス" });
    writeIndex([entry("n1", "無題", { steps: [{ blockId: "n1-s", text: "ホットプレス" }] })]);

    expect(searchNotes("ホットプレス", {}, root).map((h) => h.noteId)).toEqual(["n1"]);
  });

  it("インラインラベルの語でも引ける", () => {
    writeNote("n1", "無題", "本文にはこの語が無い");
    writeIndex([
      entry("n1", "無題", {
        inlineLabels: [{ blockId: "b1", label: "tool", text: "プラネタリーボールミル", entityId: "e1" }],
      }),
    ]);

    expect(searchNotes("プラネタリーボールミル", {}, root).map((h) => h.noteId)).toEqual(["n1"]);
  });

  it("kind で人のノートと Wiki を絞り込める", () => {
    writeNote("n1", "人のノート", "焼結");
    writeNote("w1", "AI のまとめ", "焼結");
    writeIndex([entry("n1", "人のノート"), entry("w1", "AI のまとめ", { source: "ai" })]);

    expect(searchNotes("焼結", { kind: "note" }, root).map((h) => h.noteId)).toEqual(["n1"]);
    expect(searchNotes("焼結", { kind: "wiki" }, root).map((h) => h.noteId)).toEqual(["w1"]);
  });

  it("kind でナレッジ層の細かい種別（topic/claim/insight）まで絞り込める", () => {
    writeNote("t1", "話題", "熱電");
    writeNote("c1", "知見", "熱電");
    writeNote("a1", "洞察", "熱電");
    writeIndex([
      entry("t1", "話題", { source: "ai", wikiKind: "topic" }),
      entry("c1", "知見", { source: "ai", wikiKind: "claim" }),
      entry("a1", "洞察", { source: "ai", wikiKind: "atom" }),
    ]);

    expect(searchNotes("熱電", { kind: "topic" }, root).map((h) => h.noteId)).toEqual(["t1"]);
    expect(searchNotes("熱電", { kind: "claim" }, root).map((h) => h.noteId)).toEqual(["c1"]);
    expect(searchNotes("熱電", { kind: "insight" }, root).map((h) => h.noteId)).toEqual(["a1"]);
    expect(searchNotes("熱電", { kind: "wiki" }, root).map((h) => h.noteId).sort()).toEqual([
      "a1",
      "c1",
      "t1",
    ]);
  });

  it("SearchHit.kind にナレッジ層の種別が入る（topic/claim/insight/summary）", () => {
    writeNote("t1", "話題", "焼結");
    writeNote("c1", "知見", "焼結");
    writeNote("a1", "洞察", "焼結");
    writeNote("s1", "要約", "焼結");
    writeIndex([
      entry("t1", "話題", { source: "ai", wikiKind: "topic" }),
      entry("c1", "知見", { source: "ai", wikiKind: "claim" }),
      entry("a1", "洞察", { source: "ai", wikiKind: "atom" }),
      entry("s1", "要約", { source: "ai", wikiKind: "summary" }),
    ]);

    const byId = new Map(searchNotes("焼結", {}, root).map((h) => [h.noteId, h.kind]));
    expect(byId.get("t1")).toBe("topic");
    expect(byId.get("c1")).toBe("claim");
    expect(byId.get("a1")).toBe("insight");
    expect(byId.get("s1")).toBe("summary");
  });

  it("空のクエリでは何も返さない", () => {
    writeNote("n1", "焼結の記録", "本文");
    writeIndex([entry("n1", "焼結の記録")]);

    expect(searchNotes("   ", {}, root)).toEqual([]);
  });
});

describe("索引の鮮度", () => {
  it("note-index が更新されたら組み直す（Graphium 側でノートが増えた場合）", () => {
    writeNote("n1", "最初のノート", "焼結");
    writeIndex([entry("n1", "最初のノート")], 1_700_000_000);
    expect(searchNotes("焼結", {}, root)).toHaveLength(1);

    // Graphium がノートを足して index を書き直した状況を作る
    writeNote("n2", "あとから増えたノート", "焼結");
    writeIndex([entry("n1", "最初のノート"), entry("n2", "あとから増えたノート")], 1_700_000_999);

    expect(searchNotes("焼結", {}, root)).toHaveLength(2);
  });

  it("note-index が変わらなければ組み直さない（キャッシュが効く）", () => {
    writeNote("n1", "最初のノート", "焼結");
    writeIndex([entry("n1", "最初のノート")], 1_700_000_000);
    expect(allEntries(root)).toHaveLength(1);

    // index を書き換えずにノートだけ増やしても、索引には出ない（= 再構築が走っていない）
    writeNote("n2", "index に載っていないノート", "焼結");
    expect(allEntries(root)).toHaveLength(1);
  });
});

describe("addCreatedNoteToIndex", () => {
  /** create_note が書くのと同じドキュメント */
  const noteDoc = (title: string, body: string) => buildNoteDocument({ title, body }, root);

  it("作った直後のノートを検索で引ける", () => {
    writeNote("n1", "既存ノート", "焼結");
    writeIndex([entry("n1", "既存ノート")]);
    searchNotes("焼結", {}, root); // 索引を組ませる

    addCreatedNoteToIndex("new1", noteDoc("MCP から作ったノート", "ボールミリングの考察"), root);

    expect(searchNotes("ボールミリング", {}, root).map((h) => h.noteId)).toEqual(["new1"]);
  });

  it("同じノートを二重に足しても壊れない", () => {
    writeNote("n1", "既存ノート", "焼結");
    writeIndex([entry("n1", "既存ノート")]);
    searchNotes("焼結", {}, root);

    const doc = noteDoc("MCP から作ったノート", "ボールミリング");
    addCreatedNoteToIndex("new1", doc, root);
    expect(() => addCreatedNoteToIndex("new1", doc, root)).not.toThrow();
    expect(searchNotes("ボールミリング", {}, root)).toHaveLength(1);
  });

  it("索引を組む前に呼ばれても落ちない（次の構築でファイルから拾われる）", () => {
    expect(() => addCreatedNoteToIndex("new1", noteDoc("タイトル", "本文"), root)).not.toThrow();
  });
});

describe("作った直後と組み直した後で同じ語が当たる", () => {
  // create_note / save_answer は保存した直後に索引へ足し、組み直し（Graphium が note-index を
  // 書き直したとき・サーバーの再起動）ではファイルから読み直す。二つの経路で本文の作り方が
  // ずれると、同じノートが作った直後だけ別の語で当たる（受け取った Markdown をそのまま入れて
  // いた頃は、作った直後だけタグ名 sup や引用の印 [[source:n1]] で当たり、「105」「H2O」や
  // References 節の引用先タイトルで外れた）
  const QUERIES = ["105", "H2O", "sup", "sub", "source", "n1", "資料1"];

  /** QUERIES のうち、そのノートに当たる語 */
  const matchingQueries = (noteId: string) =>
    QUERIES.filter((q) => searchNotes(q, {}, root).some((h) => h.noteId === noteId));

  beforeEach(() => {
    writeNote("n1", "資料1", "焼結");
    writeIndex([entry("n1", "資料1")], 1_700_000_000);
    searchNotes("焼結", {}, root); // 索引を組ませる
  });

  it("create_note で作ったノート", () => {
    const created = createNote(
      { title: "圧力の記録", body: "圧力 10<sup>5</sup> Pa と H<sub>2</sub>O", citations: [{ id: "n1" }] },
      root,
    );
    addCreatedNoteToIndex(created.noteId, created.doc, root);
    const justCreated = matchingQueries(created.noteId);

    // Graphium がこのノートを拾って note-index を書き直した → 次の検索で組み直す
    writeIndex([entry("n1", "資料1"), entry(created.noteId, "圧力の記録")], 1_700_000_999);
    const rebuilt = matchingQueries(created.noteId);

    expect(justCreated).toEqual(["105", "H2O", "資料1"]);
    expect(rebuilt).toEqual(justCreated);
  });

  it("save_answer で作った回答ページ", async () => {
    const saved = await saveAnswer(
      {
        question: "圧力はいくつだったか",
        answer: "圧力 10<sup>5</sup> Pa と H<sub>2</sub>O [[source:n1]]",
        citations: [{ id: "n1" }],
      },
      root,
    );
    addCreatedWikiToIndex(saved.noteId, saved.doc, "answer", root);
    const justCreated = matchingQueries(saved.noteId);

    writeIndex(
      [entry("n1", "資料1"), entry(saved.noteId, "圧力はいくつだったか", { source: "ai", wikiKind: "answer" })],
      1_700_000_999,
    );
    const rebuilt = matchingQueries(saved.noteId);

    expect(justCreated).toEqual(["105", "H2O", "資料1"]);
    expect(rebuilt).toEqual(justCreated);
  });
});

describe("MCP で作ったものは、アプリの note-index に載る前も索引から落ちない", () => {
  // note-index.json は Graphium アプリが書くもので、MCP が作ったファイルはアプリが一覧を取り直す
  // （起動・再読み込み）まで載らない。その間に索引を組むと、作ったものが落ちていた
  // （セッションの最初の呼び出しが保存だったとき・アプリが別のノートを保存して note-index を
  // 書き直したとき・MCP サーバーを立て直したとき）
  const WRITERS = [
    {
      tool: "create_note",
      kind: "note",
      write: async () => {
        const created = createNote({ title: "混合の記録", body: "遊星ボールミルで 12 時間混合した" }, root);
        addCreatedNoteToIndex(created.noteId, created.doc, root);
        return created.noteId;
      },
    },
    {
      tool: "save_answer",
      kind: "answer",
      write: async () => {
        const saved = await saveAnswer(
          {
            question: "混合は何時間だったか",
            answer: "遊星ボールミルで 12 時間混合した [[source:n1]]",
            citations: [{ id: "n1" }],
          },
          root,
        );
        addCreatedWikiToIndex(saved.noteId, saved.doc, "answer", root);
        return saved.noteId;
      },
    },
  ] as const;

  /** 作ったものの本文の語で引いたヒット（noteId と種別） */
  const createdHits = () => searchNotes("遊星ボールミル", {}, root).map((h) => [h.noteId, h.kind]);
  /** アプリ側のノートの本文の語で引いたヒット */
  const appHits = () => searchNotes("焼結", {}, root).map((h) => h.noteId).sort();

  describe.each(WRITERS)("$tool", ({ kind, write }) => {
    beforeEach(() => {
      writeNote("n1", "既存ノート", "焼結");
      writeIndex([entry("n1", "既存ノート")], 1_700_000_000);
    });

    it("索引を組む前に作っても、最初の検索で引ける", async () => {
      const noteId = await write();

      expect(createdHits()).toEqual([[noteId, kind]]);
    });

    it("組んだ後にアプリが（作ったものを含まない）note-index を書き直し、組み直しても引ける", async () => {
      searchNotes("焼結", {}, root); // 索引を組ませる
      const noteId = await write();

      // アプリで別のノートを保存した
      writeNote("n2", "アプリで書いたノート", "焼結");
      writeIndex([entry("n1", "既存ノート"), entry("n2", "アプリで書いたノート")], 1_700_000_999);

      expect(createdHits()).toEqual([[noteId, kind]]);
      expect(appHits()).toEqual(["n1", "n2"]);
    });

    it("作る前にアプリが note-index を書き直していても、アプリの変更を取りこぼさない", async () => {
      searchNotes("焼結", {}, root);
      writeNote("n2", "アプリで書いたノート", "焼結");
      writeIndex([entry("n1", "既存ノート"), entry("n2", "アプリで書いたノート")], 1_700_000_999);

      const noteId = await write();

      expect(appHits()).toEqual(["n1", "n2"]);
      expect(createdHits()).toEqual([[noteId, kind]]);
    });

    it("MCP サーバーを立て直しても（アプリが載せる前なら）引ける", async () => {
      searchNotes("焼結", {}, root);
      const noteId = await write();

      resetSearchIndex(); // プロセスを立て直した（メモリ上の索引は残らない）

      expect(createdHits()).toEqual([[noteId, kind]]);
    });

    it("アプリが note-index に載せた後はアプリの見え方に従う（ゴミ箱に入れたら出ない）", async () => {
      searchNotes("焼結", {}, root);
      const noteId = await write();

      const wiki = kind === "answer" ? { source: "ai", wikiKind: "answer" } : {};
      writeIndex(
        [entry("n1", "既存ノート"), entry(noteId, "作ったもの", { ...wiki, deletedAt: "2026-01-02T00:00:00.000Z" })],
        1_700_000_999,
      );

      expect(createdHits()).toEqual([]);
    });
  });

  it.each(WRITERS)(
    "note-index が無い vault（アプリをまだ開いていない）でも、組む前に $tool で作ったものを 1 件だけ引ける",
    async ({ kind, write }) => {
      writeNote("n1", "既存ノート", "焼結");
      const noteId = await write();

      expect(createdHits()).toEqual([[noteId, kind]]);
      expect(appHits()).toEqual(["n1"]);
    },
  );
});
