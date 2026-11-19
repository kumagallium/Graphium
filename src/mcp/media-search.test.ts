// media-search.ts（search_media の本体）の回帰テスト。

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { resetSearchIndex } from "./search";
import { resetMediaIndexCache } from "./sources";
import { conversationSearchHint, formatMediaHit, mediaSourceId, resetMediaSearchIndex, searchMedia } from "./media-search";

function entry(over: Record<string, unknown>) {
  return { url: "", thumbnailUrl: "", uploadedAt: "2026-10-01T00:00:00Z", usedIn: [], mimeType: "", ...over };
}

describe("searchMedia", () => {
  let root: string;

  function writeMedia(media: object[]) {
    writeFileSync(join(root, "appdata", "media-index.json"), JSON.stringify({ version: 1, media }));
    resetMediaIndexCache();
    resetMediaSearchIndex();
  }

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "graphium-mcp-media-search-"));
    mkdirSync(join(root, "notes"), { recursive: true });
    mkdirSync(join(root, "appdata"), { recursive: true });
    writeFileSync(
      join(root, "notes", "n1.json"),
      JSON.stringify({ version: 2, title: "焼結の実験", pages: [{ id: "p", blocks: [] }] }),
    );
    resetSearchIndex();
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
    resetSearchIndex();
  });

  it("名前・OCR の文字・URL の説明・ドメインで引ける", () => {
    writeMedia([
      entry({ fileId: "a1", name: "熱電変換の総説.pdf", type: "pdf" }),
      entry({ fileId: "i1", name: "IMG_0001.jpg", type: "image", ocrText: "Seebeck coefficient 測定結果" }),
      entry({
        fileId: "u1",
        name: "Thermoelectric materials",
        type: "url",
        url: "https://example.org/te",
        urlMeta: { domain: "example.org", description: "廃熱から電気をつくる材料の解説" },
      }),
    ]);
    expect(searchMedia("総説", {}, root).map((h) => h.id)).toEqual(["pdf:a1"]);
    expect(searchMedia("Seebeck", {}, root).map((h) => h.id)).toEqual(["image:i1"]);
    expect(searchMedia("廃熱", {}, root).map((h) => h.id)).toEqual(["url:https://example.org/te"]);
    expect(searchMedia("example.org", {}, root).map((h) => h.id)).toContain("url:https://example.org/te");
  });

  it("アーカイブ済みは除き、type で絞れる", () => {
    writeMedia([
      entry({ fileId: "a1", name: "焼結 資料.pdf", type: "pdf" }),
      entry({ fileId: "a2", name: "焼結 古い.pdf", type: "pdf", archivedAt: "2026-09-01T00:00:00Z" }),
      entry({ fileId: "d1", name: "焼結 報告.docx", type: "document" }),
    ]);
    const ids = searchMedia("焼結", {}, root).map((h) => h.id).sort();
    expect(ids).toEqual(["document:d1", "pdf:a1"]);
    expect(searchMedia("焼結", { type: "document" }, root).map((h) => h.id)).toEqual(["document:d1"]);
  });

  it("使っているノートを索引のタイトルで返し、同じノートは 1 行にまとめる", () => {
    writeMedia([
      entry({
        fileId: "a1",
        name: "焼結 資料.pdf",
        type: "pdf",
        usedIn: [
          { noteId: "n1", noteTitle: "古い題", blockId: "b1" },
          { noteId: "n1", noteTitle: "古い題", blockId: "b2" },
        ],
      }),
    ]);
    const [hit] = searchMedia("焼結", {}, root);
    expect(hit.usedIn).toEqual([{ noteId: "n1", title: "焼結の実験" }]);
  });

  it("media-index.json が書き換わったら組み直す", () => {
    writeMedia([entry({ fileId: "a1", name: "alpha 資料.pdf", type: "pdf" })]);
    expect(searchMedia("beta", {}, root)).toEqual([]);
    // mtime が同じ値にならないよう少し進める
    writeFileSync(
      join(root, "appdata", "media-index.json"),
      JSON.stringify({ version: 1, media: [entry({ fileId: "a2", name: "beta 資料.pdf", type: "pdf" })] }),
    );
    const later = new Date(Date.now() + 5000);
    utimesSync(join(root, "appdata", "media-index.json"), later, later);
    expect(searchMedia("beta", {}, root).map((h) => h.id)).toEqual(["pdf:a2"]);
  });

  it("mediaSourceId は種類ごとの形にする", () => {
    expect(mediaSourceId({ type: "pdf", fileId: "x", url: "" })).toBe("pdf:x");
    expect(mediaSourceId({ type: "url", fileId: "x", url: "https://a/b" })).toBe("url:https://a/b");
    expect(mediaSourceId({ type: "memo", fileId: "x", url: "" })).toBe("memo:x");
  });

  describe("AI との会話の本文", () => {
    const FILE = "conv-claude-code-11111111-2222-4333-8444-555555555555";
    const conversationEntry = (over: Record<string, unknown> = {}) =>
      entry({
        fileId: FILE,
        name: "全粒粉の配合",
        type: "conversation",
        uploadedAt: "2026-11-10T00:00:00Z",
        conversation: { provider: "claude-code", sessionId: "s", workdir: "", startedAt: "2026-10-05T00:00:00Z", endedAt: "2026-10-06T00:00:00Z", ownTurns: 1, ownChars: 10, bodyChars: 10, importedAt: "2026-11-10T00:00:00Z" },
        ...over,
      });
    const BODY = "この資料は会話の記録である。\n\n## 2026-10-05\n\n- 私（09:12）: 酸味は控えめにしたいので、発酵は 6 時間で止めます\n";

    beforeEach(() => {
      mkdirSync(join(root, "media"), { recursive: true });
      writeFileSync(join(root, "media", `${FILE}.txt`), BODY);
    });

    it("本文の言葉で見つかり、抜粋と会話の日付が付く", () => {
      writeMedia([conversationEntry()]);
      const hits = searchMedia("酸味 発酵", {}, root);
      expect(hits).toHaveLength(1);
      expect(hits[0].id).toBe(`conversation:${FILE}`);
      expect(hits[0].name).toBe("全粒粉の配合");
      expect(hits[0].snippet).toContain("酸味は控えめ");
      expect(hits[0].conversationDate).toBe("2026-10-06T00:00:00Z");
    });

    it("会話があるときだけ search_notes に探し方の案内を添える", () => {
      writeMedia([entry({ fileId: "a1", name: "総説.pdf", type: "pdf" })]);
      expect(conversationSearchHint(root)).toBe("");
      writeMedia([conversationEntry({ archivedAt: "2026-11-11T00:00:00Z" })]);
      expect(conversationSearchHint(root)).toBe("");
      writeMedia([conversationEntry()]);
      expect(conversationSearchHint(root)).toContain("search_media");
    });

    it("結果の文には、話した日と当たった箇所が出る", () => {
      writeMedia([conversationEntry()]);
      const line = formatMediaHit(searchMedia("酸味 発酵", {}, root)[0], 0);
      expect(line).toContain("会話 2026-10-06");
      expect(line).not.toContain("取り込み 2026-11-10");
      expect(line).toContain("当たった箇所: ");
      expect(line).toContain("酸味は控えめ");
    });

    it("ほかの素材の結果の文は、これまでどおり取り込みの日", () => {
      writeMedia([entry({ fileId: "a1", name: "熱電変換の総説.pdf", type: "pdf" })]);
      const line = formatMediaHit(searchMedia("熱電変換", {}, root)[0], 0);
      expect(line).toContain("取り込み 2026-10-01");
      expect(line).not.toContain("当たった箇所");
    });

    it("同じ会話の断片がいくつ当たっても 1 件にまとまる", () => {
      const many = Array.from({ length: 6 }, (_, i) => `- 私（09:1${i}）: ${"酸味の話を続けます。".repeat(70)}`).join("\n");
      writeFileSync(join(root, "media", `${FILE}.txt`), `## 2026-10-05\n\n${many}\n`);
      writeMedia([conversationEntry()]);
      expect(searchMedia("酸味", {}, root)).toHaveLength(1);
    });

    it("冒頭の説明の語では当たらない", () => {
      writeMedia([conversationEntry()]);
      expect(searchMedia("資料", {}, root)).toEqual([]);
    });

    it("アーカイブ済みの会話は本文でも出ない", () => {
      writeMedia([conversationEntry({ archivedAt: "2026-11-11T00:00:00Z" })]);
      expect(searchMedia("酸味", {}, root)).toEqual([]);
    });

    it("種類で絞れて、本文が無い会話は名前でだけ当たる", () => {
      rmSync(join(root, "media", `${FILE}.txt`));
      writeMedia([conversationEntry()]);
      expect(searchMedia("酸味", { type: "conversation" }, root)).toEqual([]);
      expect(searchMedia("全粒粉", { type: "conversation" }, root)).toHaveLength(1);
    });
  });
});
