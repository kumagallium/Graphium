// verb 回答の手動取り込み（PR3 / Loop M2）の純関数テスト

import { describe, it, expect, beforeAll } from "vitest";
import {
  buildVerbSuggestionDocument,
  deriveSuggestionTitle,
  cleanSuggestionText,
  splitTitleAndBody,
} from "./verb-suggestion-doc";
import { syncLocale } from "../../i18n";

// 生成文言は i18n 化されたため、既存の日本語アサーションに合わせて ja 固定にする
beforeAll(() => {
  syncLocale("ja");
});

// editor.tryParseMarkdownToBlocks の出力を模したダミーブロック
const block = (text: string) => ({
  id: "b",
  type: "paragraph",
  props: {},
  content: [{ type: "text", text, styles: {} }],
  children: [],
});

describe("buildVerbSuggestionDocument", () => {
  it("選んだ kind で source:ai の wiki ノートを作る", () => {
    const doc = buildVerbSuggestionDocument({
      bodyBlocks: [block("A は B と矛盾する。")],
      kind: "claim",
      title: "A と B の矛盾",
      sourceNoteId: "note-1",
      citedNotes: [],
    });
    expect(doc.source).toBe("ai");
    expect(doc.wikiMeta?.kind).toBe("claim");
    expect(doc.title).toBe("A と B の矛盾");
    // claim は新規生成時 candidate
    expect(doc.wikiMeta?.status).toBe("candidate");
    // 由来ノートが入る
    expect(doc.wikiMeta?.derivedFromNotes).toEqual(["note-1"]);
  });

  it("渡されたブロックをそのまま本文に使う", () => {
    const doc = buildVerbSuggestionDocument({
      bodyBlocks: [block("段落1。"), block("段落2。")],
      kind: "atom",
      title: "t",
      sourceNoteId: null,
      citedNotes: [],
    });
    const paragraphs = doc.pages[0].blocks.filter((b: any) => b.type === "paragraph");
    expect(paragraphs).toHaveLength(2);
    expect(paragraphs[0].content[0].text).toBe("段落1。");
  });

  it("atom は status を持たない", () => {
    const doc = buildVerbSuggestionDocument({
      bodyBlocks: [block("洞察本文")],
      kind: "atom",
      title: "t",
      sourceNoteId: "note-1",
      citedNotes: [],
    });
    expect(doc.wikiMeta?.kind).toBe("atom");
    expect(doc.wikiMeta?.status).toBeUndefined();
  });

  it("引用ノートがあれば引用元セクション + @title + reference リンクを張る", () => {
    const doc = buildVerbSuggestionDocument({
      bodyBlocks: [block("本文")],
      kind: "claim",
      title: "t",
      sourceNoteId: "note-1",
      citedNotes: [
        { noteId: "cited-a", title: "知見A" },
        { noteId: "cited-b", title: "知見B" },
      ],
    });
    const links = doc.pages[0].knowledgeLinks;
    expect(links).toHaveLength(2);
    expect(links.map((l: any) => l.targetNoteId).sort()).toEqual(["cited-a", "cited-b"]);
    expect(links.every((l: any) => l.type === "reference" && l.layer === "knowledge")).toBe(true);
    // 見出し「引用元」が入る
    const headings = doc.pages[0].blocks.filter((b: any) => b.type === "heading");
    expect(headings.some((h: any) => h.content[0].text === "引用元")).toBe(true);
    // bullet は @<title> 形式（cite-picker と同じ）
    const bullets = doc.pages[0].blocks.filter((b: any) => b.type === "bulletListItem");
    expect(bullets.map((b: any) => b.content[0].text).sort()).toEqual(["@知見A", "@知見B"]);
    // PR4 / L2: 引用元 ID を PROV エクスポート用に wikiMeta へ記録
    expect(doc.wikiMeta?.citedKnowledgeIds?.sort()).toEqual(["cited-a", "cited-b"]);
  });

  it("引用が無ければ citedKnowledgeIds は undefined（フィールドを増やさない）", () => {
    const doc = buildVerbSuggestionDocument({
      bodyBlocks: [block("本文")],
      kind: "claim",
      title: "t",
      sourceNoteId: "note-1",
      citedNotes: [],
    });
    expect(doc.wikiMeta?.citedKnowledgeIds).toBeUndefined();
  });

  it("引用ノートを noteId で重複排除する", () => {
    const doc = buildVerbSuggestionDocument({
      bodyBlocks: [block("本文")],
      kind: "claim",
      title: "t",
      sourceNoteId: null,
      citedNotes: [
        { noteId: "dup", title: "x" },
        { noteId: "dup", title: "x" },
        { noteId: "other", title: "y" },
      ],
    });
    expect(doc.pages[0].knowledgeLinks).toHaveLength(2);
    expect(doc.wikiMeta?.citedKnowledgeIds).toEqual(["dup", "other"]);
  });

  it("sourceNoteId が null なら derivedFromNotes は空", () => {
    const doc = buildVerbSuggestionDocument({
      bodyBlocks: [block("本文")],
      kind: "claim",
      title: "t",
      sourceNoteId: null,
      citedNotes: [],
    });
    expect(doc.wikiMeta?.derivedFromNotes).toEqual([]);
  });
});

describe("cleanSuggestionText", () => {
  it("PROV inline marker を除去する", () => {
    expect(cleanSuggestionText("[[m]]材料[[/m]] を使う")).toBe("材料 を使う");
    expect(cleanSuggestionText("[[label:procedure]] 手順")).toBe("手順");
  });

  it("Knowledge referenced フッター（** 形式）を落とす", () => {
    const input = "本文です。\n\n---\n**Knowledge referenced:**\n  - [Source: \"A\"]\n  - [Source: \"B\"]";
    expect(cleanSuggestionText(input)).toBe("本文です。");
  });

  it("Knowledge referenced フッター（絵文字形式）を落とす", () => {
    const input = "本文です。\n\n---\n📎 *Knowledge referenced*";
    expect(cleanSuggestionText(input)).toBe("本文です。");
  });

  it("i18n 化した新フッター見出し（📓 ノート内の知識）を構造で落とす", () => {
    const input = "本文です。\n\n---\n**📓 ノート内の知識**\n  - [Source: \"A\"]";
    expect(cleanSuggestionText(input)).toBe("本文です。");
  });

  it("英語ロケールの新フッター見出し（📓 From your notes）も落とす", () => {
    const input = "Body text.\n\n---\n**📓 From your notes**\n  - [Source: \"A\"]";
    expect(cleanSuggestionText(input)).toBe("Body text.");
  });

  it("フッターが無ければ本文をそのまま返す", () => {
    expect(cleanSuggestionText("ただの本文")).toBe("ただの本文");
  });
});

describe("splitTitleAndBody", () => {
  it("先頭 H1 をタイトルに、残りを本文にする", () => {
    const { title, body } = splitTitleAndBody("# 見出し\n\n本文1\n\n本文2");
    expect(title).toBe("見出し");
    expect(body).toBe("本文1\n\n本文2");
  });

  it("先頭の空行を読み飛ばす", () => {
    const { title, body } = splitTitleAndBody("\n\n# T\n本文");
    expect(title).toBe("T");
    expect(body).toBe("本文");
  });

  it("H1 が無ければタイトルは空、本文はそのまま", () => {
    const { title, body } = splitTitleAndBody("## 小見出しのみ\n本文");
    expect(title).toBe("");
    expect(body).toBe("## 小見出しのみ\n本文");
  });
});

describe("deriveSuggestionTitle", () => {
  it("先頭の非空行をタイトルにする", () => {
    expect(deriveSuggestionTitle("最初の行\n2行目")).toBe("最初の行");
  });

  it("markdown 見出し・箇条書き記号を落とす", () => {
    expect(deriveSuggestionTitle("## 見出し")).toBe("見出し");
    expect(deriveSuggestionTitle("- 箇条書き")).toBe("箇条書き");
  });

  it("長すぎる場合は省略する", () => {
    const long = "あ".repeat(50);
    const title = deriveSuggestionTitle(long, 10);
    expect(title).toBe("あ".repeat(10) + "…");
  });

  it("空文字は無題にフォールバック", () => {
    // i18n 化に伴い nav.untitled（ja: "(無題)"）を使う
    expect(deriveSuggestionTitle("   ")).toBe("(無題)");
  });
});
