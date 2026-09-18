// save-answer.ts の回帰テスト。
// ユーザーの実 vault には触らず、mkdtempSync で作った一時ディレクトリに書き込む。

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { buildAnswerDocument, saveAnswer } from "./save-answer";
import { createNote } from "./create-note";

describe("save-answer", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "graphium-mcp-save-answer-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  function writeExistingNote(root: string, noteId: string, title: string) {
    const notes = join(root, "notes");
    mkdirSync(notes, { recursive: true });
    writeFileSync(
      join(notes, `${noteId}.json`),
      JSON.stringify({ version: 2, title, pages: [{ id: "main", title, blocks: [] }] }),
      "utf8",
    );
  }

  describe("buildAnswerDocument", () => {
    it("wikiMeta.kind が answer で、topicMarkdown に正本を持つ", () => {
      const doc = buildAnswerDocument({ question: "問い", answer: "回答本文です。" }, dir);
      expect(doc.wikiMeta?.kind).toBe("answer");
      expect(doc.wikiMeta?.topicMarkdown).toBe("回答本文です。");
      expect(doc.title).toBe("問い");
    });

    it("derivedFromNotes に citations の id が積まれ、derivedFromClaims は空", () => {
      writeExistingNote(dir, "note-1", "資料1");
      const doc = buildAnswerDocument(
        { question: "問い", answer: "本文 [[source:note-1]]", citations: [{ id: "note-1" }] },
        dir,
      );
      expect(doc.wikiMeta?.derivedFromNotes).toEqual(["note-1"]);
      expect(doc.wikiMeta?.derivedFromClaims).toEqual([]);
    });

    it("実在する id の citations は @リンクになり、References が付く", () => {
      writeExistingNote(dir, "note-1", "資料1");
      const doc = buildAnswerDocument(
        { question: "問い", answer: "本文 [[source:note-1]] を引用。", citations: [{ id: "note-1" }] },
        dir,
      );
      const page = (doc.pages as any[])[0];
      const heading = page.blocks.find((b: any) => b.type === "heading" && b.content[0]?.text === "References");
      expect(heading).toBeTruthy();
      expect(page.blocks.some((b: any) =>
        Array.isArray(b.content) && b.content.some((c: any) => c.text === "@資料1"),
      )).toBe(true);
      expect(page.knowledgeLinks.some((l: any) => l.targetNoteId === "note-1")).toBe(true);
    });

    it("実在しない id の citations は文字のまま残す（落とさない）", () => {
      const doc = buildAnswerDocument(
        {
          question: "問い",
          answer: "本文 [[source:missing-id]] を引用。",
          citations: [{ id: "missing-id", title: "存在しない資料" }],
        },
        dir,
      );
      const page = (doc.pages as any[])[0];
      const text = JSON.stringify(page.blocks);
      expect(text).toContain("存在しない資料");
      expect(text).not.toContain("@存在しない資料");
    });

    it("citations が空でも例外を投げない（References も付かない）", () => {
      const doc = buildAnswerDocument({ question: "問い", answer: "本文だけ" }, dir);
      const page = (doc.pages as any[])[0];
      expect(page.blocks.some((b: any) => b.type === "heading")).toBe(false);
    });

    it("question / answer が空なら例外", () => {
      expect(() => buildAnswerDocument({ question: "", answer: "本文" }, dir)).toThrow();
      expect(() => buildAnswerDocument({ question: "問い", answer: "" }, dir)).toThrow();
    });

    it("PROV: generatedBy に MCP クライアント名・model・sessionId が残る", () => {
      const doc = buildAnswerDocument(
        { question: "問い", answer: "本文", model: "claude-test", sessionId: "sess-1", client: "claude-code" },
        dir,
      );
      expect(doc.generatedBy?.agent).toBe("graphium-mcp (claude-code)");
      expect((doc.generatedBy as any)?.sessionId).toBe("sess-1");
      expect(doc.generatedBy?.model).toBe("claude-test");
    });
  });

  describe("saveAnswer", () => {
    it("wiki/ ディレクトリに保存され、notes/ には作らない", async () => {
      const result = await saveAnswer({ question: "問い", answer: "本文" }, dir);
      expect(existsSync(join(dir, "wiki", `${result.noteId}.json`))).toBe(true);
      expect(existsSync(join(dir, "notes", `${result.noteId}.json`))).toBe(false);
    });

    it("documentProvenance に wiki_ingest のリビジョンが記録される", async () => {
      const result = await saveAnswer({ question: "問い", answer: "本文" }, dir);
      const saved = JSON.parse(readFileSync(join(dir, "wiki", `${result.noteId}.json`), "utf8"));
      expect(saved.documentProvenance?.activities?.[0]?.type).toBe("wiki_ingest");
      expect(saved.documentProvenance?.revisions?.length).toBeGreaterThan(0);
    });
  });

  describe("既存の create_note には影響しない", () => {
    it("create_note は従来どおり notes/ に作成できる", () => {
      const result = createNote({ title: "タイトル", body: "本文" }, dir);
      expect(existsSync(result.filePath)).toBe(true);
      expect(result.filePath).toContain(join(dir, "notes"));
    });
  });
});
