// create-note.ts の citations 引数の回帰テスト。
// ユーザーの実 vault には触らず、mkdtempSync で作った一時ディレクトリに書き込む。

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createNote, buildNoteDocument } from "./create-note";

describe("create-note", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "graphium-mcp-create-note-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  describe("既存の呼び出し（citations なし）", () => {
    it("従来どおりノートを作成できる（noteContexts も付かない）", () => {
      const result = createNote({ title: "タイトル", body: "本文" }, dir);
      expect(result.noteId).toBeTruthy();
      const saved = JSON.parse(readFileSync(result.filePath, "utf8"));
      expect(saved.noteContexts).toBeUndefined();
      expect(saved.pages[0].knowledgeLinks).toEqual([]);
    });
  });

  describe("citations", () => {
    function writeExistingNote(root: string, noteId: string, title: string) {
      const notes = join(root, "notes");
      mkdirSync(notes, { recursive: true });
      writeFileSync(
        join(notes, `${noteId}.json`),
        JSON.stringify({ version: 2, title, pages: [{ id: "main", title, blocks: [] }] }),
        "utf8",
      );
    }

    it("実在する id は @リンク化され knowledgeLinks が付く", () => {
      writeExistingNote(dir, "existing-note", "既存ノート");
      const doc = buildNoteDocument(
        { title: "t", body: "b", citations: [{ id: "existing-note" }] },
        dir,
      );
      const page = (doc.pages as any[])[0];
      const refBullet = page.blocks.find(
        (b: any) => b.type === "bulletListItem" && b.content[0]?.text === "@既存ノート",
      );
      expect(refBullet).toBeTruthy();
      expect(page.knowledgeLinks).toHaveLength(1);
      expect(page.knowledgeLinks[0]).toMatchObject({
        targetNoteId: "existing-note",
        type: "reference",
        layer: "knowledge",
      });
    });

    it("実在しない id はリンクにせず文字のまま残す（落とさない）", () => {
      const doc = buildNoteDocument(
        { title: "t", body: "b", citations: [{ id: "missing-id", title: "見出しタイトル" }] },
        dir,
      );
      const page = (doc.pages as any[])[0];
      const bullet = page.blocks.find(
        (b: any) => b.type === "bulletListItem" && b.content[0]?.text === "見出しタイトル",
      );
      expect(bullet).toBeTruthy();
      // リンクではないので @ プレフィックスは付かない
      expect(page.blocks.some((b: any) => b.content?.[0]?.text === "@見出しタイトル")).toBe(false);
      expect(page.knowledgeLinks).toEqual([]);
    });

    it("title 未指定・ノートも存在しない場合は id をそのまま文字として残す", () => {
      const doc = buildNoteDocument({ title: "t", body: "b", citations: [{ id: "missing-id" }] }, dir);
      const page = (doc.pages as any[])[0];
      const bullet = page.blocks.find(
        (b: any) => b.type === "bulletListItem" && b.content[0]?.text === "missing-id",
      );
      expect(bullet).toBeTruthy();
    });

    it("citations が空なら References 見出しを作らない", () => {
      const doc = buildNoteDocument({ title: "t", body: "b" }, dir);
      const page = (doc.pages as any[])[0];
      expect(page.blocks.some((b: any) => b.type === "heading")).toBe(false);
    });
  });
});
