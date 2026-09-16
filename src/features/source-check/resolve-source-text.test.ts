import { describe, expect, it, vi } from "vitest";
import { resolveSourceText, type ResolveSourceTextDeps } from "./resolve-source-text";
import type { GraphiumDocument } from "../../lib/document-types";

function noteDoc(title: string): GraphiumDocument {
  return {
    version: 2,
    title,
    pages: [
      {
        id: "p1",
        title: "Main",
        blocks: [
          { id: "b1", type: "paragraph", content: [{ type: "text", text: "1行目" }] },
          { id: "b2", type: "paragraph", content: [{ type: "text", text: "2行目" }] },
        ],
        labels: {},
        provLinks: [],
        knowledgeLinks: [],
      },
    ],
    createdAt: "2026-01-01T00:00:00Z",
    modifiedAt: "2026-01-01T00:00:00Z",
  } as GraphiumDocument;
}

function baseDeps(overrides: Partial<ResolveSourceTextDeps> = {}): ResolveSourceTextDeps {
  return {
    findNote: () => undefined,
    loadNoteDoc: async () => null,
    loadMediaBytes: async () => undefined,
    findCaptureText: () => undefined,
    ...overrides,
  };
}

describe("resolveSourceText - 通常ノート（プレフィックス無し）", () => {
  it("存在するノートは本文とブロックを返す（origin: stored）", async () => {
    const deps = baseDeps({
      findNote: (id) => (id === "note-1" ? {} : undefined),
      loadNoteDoc: async (id) => (id === "note-1" ? noteDoc("あるノート") : null),
    });
    const result = await resolveSourceText("note-1", deps);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect(result.kind).toBe("note");
    expect(result.title).toBe("あるノート");
    expect(result.text).toBe("1行目\n2行目");
    expect(result.origin).toBe("stored");
    expect(result.blocks).toEqual([
      { id: "b1", text: "1行目" },
      { id: "b2", text: "2行目" },
    ]);
  });

  it("ゴミ箱入りノートは deleted", async () => {
    const deps = baseDeps({ findNote: () => ({ deletedAt: "2026-02-01T00:00:00Z" }) });
    const result = await resolveSourceText("note-1", deps);
    expect(result).toEqual({ ok: false, kind: "note", reason: "deleted" });
  });

  it("存在しないノートは deleted", async () => {
    const deps = baseDeps({ findNote: () => undefined });
    const result = await resolveSourceText("note-1", deps);
    expect(result).toEqual({ ok: false, kind: "note", reason: "deleted" });
  });

  it("Wiki ページの ID が混入していたら unsupported-kind", async () => {
    const deps = baseDeps({ isWikiId: (id) => id === "wiki-1", findNote: () => ({}) });
    const result = await resolveSourceText("wiki-1", deps);
    expect(result).toEqual({ ok: false, kind: "unknown", reason: "unsupported-kind" });
  });

  it("本文が空なら empty", async () => {
    const empty = noteDoc("空ノート");
    empty.pages[0].blocks = [];
    const deps = baseDeps({
      findNote: () => ({}),
      loadNoteDoc: async () => empty,
    });
    const result = await resolveSourceText("note-1", deps);
    expect(result).toEqual({ ok: false, kind: "note", reason: "empty" });
  });
});

describe("resolveSourceText - pdf: / document:", () => {
  it("pdf: は media バイト列から extractPdfText で抽出する（origin: extracted）", async () => {
    const deps = baseDeps({
      loadMediaBytes: async (fileId) => {
        expect(fileId).toBe("file-1");
        return new Uint8Array([1, 2, 3]);
      },
      extractPdfText: async () => ({ title: "論文タイトル", text: "PDF本文" }),
    });
    const result = await resolveSourceText("pdf:file-1", deps);
    expect(result).toEqual({
      ok: true, kind: "pdf", title: "論文タイトル", text: "PDF本文", origin: "extracted",
    });
  });

  it("document: は mammoth 相当の extractDocxText で抽出する", async () => {
    const deps = baseDeps({
      loadMediaBytes: async () => new Uint8Array([1]),
      extractDocxText: async () => ({ value: "Word本文" }),
      findMediaName: () => "資料.docx",
    });
    const result = await resolveSourceText("document:file-2", deps);
    expect(result).toEqual({
      ok: true, kind: "document", title: "資料.docx", text: "Word本文", origin: "extracted",
    });
  });

  it("素材が読めなければ deleted", async () => {
    const deps = baseDeps({ loadMediaBytes: async () => undefined });
    const result = await resolveSourceText("pdf:missing", deps);
    expect(result).toEqual({ ok: false, kind: "pdf", reason: "deleted" });
  });

  it("抽出結果が空文字なら empty", async () => {
    const deps = baseDeps({
      loadMediaBytes: async () => new Uint8Array([1]),
      extractPdfText: async () => ({ title: "", text: "   " }),
    });
    const result = await resolveSourceText("pdf:file-3", deps);
    expect(result).toEqual({ ok: false, kind: "pdf", reason: "empty" });
  });

  it("抽出が例外を投げたら unreadable に degrade する（空なのではなく読めなかった）", async () => {
    const deps = baseDeps({
      loadMediaBytes: async () => new Uint8Array([1]),
      extractPdfText: async () => { throw new Error("corrupt pdf"); },
    });
    const result = await resolveSourceText("pdf:file-4", deps);
    expect(result).toEqual({ ok: false, kind: "pdf", reason: "unreadable" });
  });
});

describe("resolveSourceText - url:", () => {
  it("保存済み原文があれば stored origin でそれを使う（再取得しない）", async () => {
    const fetchUrlText = vi.fn();
    const deps = baseDeps({
      loadStoredUrlText: async () => "保存済み原文",
      fetchUrlText,
    });
    const result = await resolveSourceText("url:https://example.com/a", deps);
    expect(result).toEqual({
      ok: true, kind: "url", title: "https://example.com/a", text: "保存済み原文", origin: "stored",
    });
    expect(fetchUrlText).not.toHaveBeenCalled();
  });

  it("保存済み原文が無ければ再取得する（refetched origin）", async () => {
    const deps = baseDeps({
      fetchUrlText: async () => ({ title: "記事タイトル", text: "取得した本文" }),
    });
    const result = await resolveSourceText("url:https://example.com/b", deps);
    expect(result).toEqual({
      ok: true, kind: "url", title: "記事タイトル", text: "取得した本文", origin: "refetched",
    });
  });

  it("再取得手段が無ければ unreadable", async () => {
    const deps = baseDeps({});
    const result = await resolveSourceText("url:https://example.com/c", deps);
    expect(result).toEqual({ ok: false, kind: "url", reason: "unreadable" });
  });

  it("再取得が失敗（null）すれば unreadable", async () => {
    const deps = baseDeps({ fetchUrlText: async () => null });
    const result = await resolveSourceText("url:https://example.com/d", deps);
    expect(result).toEqual({ ok: false, kind: "url", reason: "unreadable" });
  });

  it("再取得が例外を投げても unreadable に degrade する", async () => {
    const deps = baseDeps({ fetchUrlText: async () => { throw new Error("network"); } });
    const result = await resolveSourceText("url:https://example.com/e", deps);
    expect(result).toEqual({ ok: false, kind: "url", reason: "unreadable" });
  });
});

describe("resolveSourceText - memo:", () => {
  it("capture 本文を返す（先頭行をタイトルに）", async () => {
    const deps = baseDeps({ findCaptureText: () => "見出し行\n続きの本文" });
    const result = await resolveSourceText("memo:cap-1", deps);
    expect(result).toEqual({
      ok: true, kind: "memo", title: "見出し行", text: "見出し行\n続きの本文", origin: "stored",
    });
  });

  it("メモが見つからなければ deleted", async () => {
    const deps = baseDeps({ findCaptureText: () => undefined });
    const result = await resolveSourceText("memo:cap-2", deps);
    expect(result).toEqual({ ok: false, kind: "memo", reason: "deleted" });
  });

  it("空文字メモは empty", async () => {
    const deps = baseDeps({ findCaptureText: () => "   " });
    const result = await resolveSourceText("memo:cap-3", deps);
    expect(result).toEqual({ ok: false, kind: "memo", reason: "empty" });
  });
});

describe("resolveSourceText - chat: / 出典として扱えない ID", () => {
  it("chat: は常に no-reference", async () => {
    const result = await resolveSourceText("chat:2026-01-01T00:00:00Z", baseDeps());
    expect(result).toEqual({ ok: false, kind: "chat", reason: "no-reference" });
  });

  it("shared: は unsupported-kind", async () => {
    const result = await resolveSourceText("shared:entry-1", baseDeps());
    expect(result).toEqual({ ok: false, kind: "unknown", reason: "unsupported-kind" });
  });

  it("data: / image: も unsupported-kind", async () => {
    expect(await resolveSourceText("data:file-1", baseDeps())).toEqual({
      ok: false, kind: "unknown", reason: "unsupported-kind",
    });
    expect(await resolveSourceText("image:file-1", baseDeps())).toEqual({
      ok: false, kind: "unknown", reason: "unsupported-kind",
    });
  });
});
