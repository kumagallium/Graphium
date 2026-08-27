// 検索層のテスト。
//
// 特に「索引の鮮度」を守る。MCP のプロセスはクライアントが生きている間ずっと残るため、
// キャッシュが古いままだと Graphium 側で足したノートも、自分で作ったノートも検索に出ない。

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { addCreatedNoteToIndex, allEntries, resetSearchIndex, searchNotes } from "./search";

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
  it("作った直後のノートを検索で引ける", () => {
    writeNote("n1", "既存ノート", "焼結");
    writeIndex([entry("n1", "既存ノート")]);
    searchNotes("焼結", {}, root); // 索引を組ませる

    addCreatedNoteToIndex("new1", "MCP から作ったノート", "ボールミリングの考察", root);

    expect(searchNotes("ボールミリング", {}, root).map((h) => h.noteId)).toEqual(["new1"]);
  });

  it("同じノートを二重に足しても壊れない", () => {
    writeNote("n1", "既存ノート", "焼結");
    writeIndex([entry("n1", "既存ノート")]);
    searchNotes("焼結", {}, root);

    addCreatedNoteToIndex("new1", "MCP から作ったノート", "ボールミリング", root);
    expect(() => addCreatedNoteToIndex("new1", "MCP から作ったノート", "ボールミリング", root)).not.toThrow();
    expect(searchNotes("ボールミリング", {}, root)).toHaveLength(1);
  });

  it("索引を組む前に呼ばれても落ちない（次の構築でファイルから拾われる）", () => {
    expect(() => addCreatedNoteToIndex("new1", "タイトル", "本文", root)).not.toThrow();
  });
});
