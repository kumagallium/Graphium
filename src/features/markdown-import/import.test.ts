// @vitest-environment jsdom
//
// markdown-import（[[wikilink]] の 2 パス解決）のユニットテスト
//
// - buildWikiLinkResolver: 「今回のインポート → 既存ノート」の解決順
// - applyWikiLinkResolution: 全件未解決でも必ず updates に含める
//   （pass 1 で保存した本文にプレースホルダが残るのを防ぐ）
// - エクスポート → 再インポートのラウンドトリップ（[[タイトル]] の対称性）

import { describe, it, expect } from "vitest";
import {
  importMarkdownToGraphiumDoc,
  buildWikiLinkResolver,
  applyWikiLinkResolution,
  type WikiLinkRef,
} from "./import";
import type { GraphiumDocument } from "../../lib/document-types";
import { graphiumDocToMarkdown } from "../markdown-export/doc-to-markdown";

// pass 1 の出力相当（センチネル入り本文）のテスト用 doc
function makeDoc(texts: string[], mentions: { text: string; styles?: Record<string, unknown> }[] = []): GraphiumDocument {
  const now = "2026-08-04T00:00:00.000Z";
  const blocks = texts.map((t, i) => ({
    id: `b${i}`,
    type: "paragraph",
    props: {},
    content: [{ type: "text", text: t, styles: {} }],
    children: [],
  }));
  if (mentions.length > 0) {
    blocks.push({
      id: `b${texts.length}`,
      type: "paragraph",
      props: {},
      content: mentions.map((m) => ({ type: "text", text: m.text, styles: m.styles ?? {} })) as any,
      children: [],
    });
  }
  return {
    version: 5,
    title: "Imported",
    pages: [{
      id: "p1",
      title: "Imported",
      blocks,
      labels: {},
      provLinks: [],
      knowledgeLinks: [],
    }],
    createdAt: now,
    modifiedAt: now,
    source: "human",
  } as unknown as GraphiumDocument;
}

describe("buildWikiLinkResolver", () => {
  it("今回のインポート分を最優先で解決する", () => {
    const resolver = buildWikiLinkResolver(
      new Map([["note a", "imported-1"]]),
      [{ noteId: "existing-1", title: "Note A" }],
    );
    expect(resolver("Note A")).toBe("imported-1");
  });

  it("インポート分に無ければ既存ノートへフォールバックする（大文字小文字・前後空白を無視）", () => {
    const resolver = buildWikiLinkResolver(new Map(), [
      { noteId: "existing-1", title: "  Note A " },
    ]);
    expect(resolver("note a")).toBe("existing-1");
  });

  it("同名の既存ノートは modifiedAt が最新のものを選ぶ", () => {
    const resolver = buildWikiLinkResolver(new Map(), [
      { noteId: "old", title: "Dup", modifiedAt: "2026-01-01T00:00:00.000Z" },
      { noteId: "newer", title: "Dup", modifiedAt: "2026-06-01T00:00:00.000Z" },
    ]);
    expect(resolver("Dup")).toBe("newer");
  });

  it("どこにも一致が無ければ null を返す", () => {
    const resolver = buildWikiLinkResolver(new Map(), [{ noteId: "n", title: "Other" }]);
    expect(resolver("Nowhere")).toBeNull();
  });

  it("macOS の NFD ファイル名（濁点分解）と NFC の [[リンク]] を照合できる", () => {
    // macOS の File.name は「が」を「か + ゙」に分解した NFD で返す
    const nfdBaseName = "論理が正しくても、間違えている可能性を受け入れる姿勢が必要である".normalize("NFD");
    const resolver = buildWikiLinkResolver(
      new Map([[nfdBaseName.toLowerCase(), "imported-1"]]),
      [],
    );
    const nfcTarget = "論理が正しくても、間違えている可能性を受け入れる姿勢が必要である".normalize("NFC");
    expect(nfdBaseName).not.toBe(nfcTarget); // 前提: 素の比較では不一致
    expect(resolver(nfcTarget)).toBe("imported-1");
  });

  it("既存ノートの NFD タイトルにも NFC の [[リンク]] が一致する", () => {
    const resolver = buildWikiLinkResolver(new Map(), [
      { noteId: "n1", title: "人に届けるには論理と情理が必要である".normalize("NFD") },
    ]);
    expect(resolver("人に届けるには論理と情理が必要である".normalize("NFC"))).toBe("n1");
  });
});

describe("importMarkdownToGraphiumDoc のタイトル正規化", () => {
  it("NFD のファイル名から作るタイトルは NFC に正規化される", async () => {
    const nfdName = "時間の向きがない".normalize("NFD");
    const file = new File(["# heading\n\nbody"], `${nfdName}.md`, { type: "text/markdown" });
    const { doc } = await importMarkdownToGraphiumDoc(file);
    expect(doc.title).toBe("時間の向きがない".normalize("NFC"));
    expect(doc.title).not.toBe(nfdName);
  });
});

describe("applyWikiLinkResolution", () => {
  it("全件未解決でも updates に含め、プレースホルダを [[リンク]] テキストへ戻す", () => {
    const wikilinks: WikiLinkRef[] = [{ target: "Missing", display: "Missing" }];
    const doc = makeDoc(["see {{GWLINK_0}}"]);
    const { updates, resolvedCount, unresolvedCount } = applyWikiLinkResolution(
      new Map([["n1", { doc, wikilinks }]]),
      () => null,
    );
    expect(updates.has("n1")).toBe(true);
    const blocks = updates.get("n1")!.pages[0].blocks as any[];
    const joined = blocks[0].content.map((c: any) => c.text).join("");
    expect(joined).toBe("see [[Missing]]");
    expect(joined).not.toContain("GWLINK");
    expect(resolvedCount).toBe(0);
    expect(unresolvedCount).toBe(1);
  });

  it("エイリアス付きの未解決リンクは [[target|display]] に戻す", () => {
    const wikilinks: WikiLinkRef[] = [{ target: "Real Name", display: "alias" }];
    const doc = makeDoc(["{{GWLINK_0}}"]);
    const { updates } = applyWikiLinkResolution(new Map([["n1", { doc, wikilinks }]]), () => null);
    const blocks = updates.get("n1")!.pages[0].blocks as any[];
    expect(blocks[0].content.map((c: any) => c.text).join("")).toBe("[[Real Name|alias]]");
  });

  it("解決できたリンクは青字 @表示 + knowledgeLinks になる", () => {
    const wikilinks: WikiLinkRef[] = [{ target: "Other", display: "Other" }];
    const doc = makeDoc(["see {{GWLINK_0}}"]);
    const { updates, resolvedCount } = applyWikiLinkResolution(
      new Map([["n1", { doc, wikilinks }]]),
      (t) => (t === "Other" ? "other-id" : null),
    );
    const page = updates.get("n1")!.pages[0] as any;
    const mention = page.blocks[0].content.find((c: any) => c.text === "@Other");
    expect(mention?.styles?.textColor).toBe("blue");
    expect(page.knowledgeLinks).toHaveLength(1);
    expect(page.knowledgeLinks[0]).toMatchObject({
      sourceBlockId: "b0",
      targetNoteId: "other-id",
      type: "reference",
      layer: "knowledge",
      createdBy: "system",
    });
    expect(resolvedCount).toBe(1);
  });

  it("wikilinks の無いノートは updates に含めない", () => {
    const doc = makeDoc(["plain text"]);
    const { updates } = applyWikiLinkResolution(new Map([["n1", { doc, wikilinks: [] }]]), () => null);
    expect(updates.size).toBe(0);
  });
});

describe("エクスポート → 再インポートのラウンドトリップ", () => {
  const mentionDoc = () =>
    makeDoc(["intro"], [
      { text: "see " },
      { text: "@Other Note", styles: { textColor: "blue" } },
    ]);

  it("エクスポートはメンションをエスケープ無しの [[タイトル]] で書き出す", async () => {
    const md = await graphiumDocToMarkdown(mentionDoc());
    expect(md).toContain("[[Other Note]]");
    expect(md).not.toContain("\\[");
  });

  it("エクスポートした Markdown を再インポートするとリンクが復元される", async () => {
    const md = await graphiumDocToMarkdown(mentionDoc());
    const file = new File([md], "Imported.md", { type: "text/markdown" });
    const { doc, wikilinks } = await importMarkdownToGraphiumDoc(file);
    expect(wikilinks).toEqual([{ target: "Other Note", display: "Other Note" }]);

    const resolver = buildWikiLinkResolver(new Map(), [
      { noteId: "other-1", title: "Other Note" },
    ]);
    const { updates } = applyWikiLinkResolution(new Map([["n1", { doc, wikilinks }]]), resolver);
    const page = updates.get("n1")!.pages[0] as any;
    expect(page.knowledgeLinks).toHaveLength(1);
    expect(page.knowledgeLinks[0].targetNoteId).toBe("other-1");
    const allText = JSON.stringify(page.blocks);
    expect(allText).toContain("@Other Note");
    expect(allText).not.toContain("GWLINK");
  });
});
