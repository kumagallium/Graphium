// verb 回答の手動取り込み（PR3 / Loop M2）の純関数テスト

import { describe, it, expect } from "vitest";
import {
  buildVerbSuggestionDocument,
  deriveSuggestionTitle,
  cleanSuggestionText,
} from "./verb-suggestion-doc";

describe("buildVerbSuggestionDocument", () => {
  it("選んだ kind で source:ai の wiki ノートを作る", () => {
    const doc = buildVerbSuggestionDocument({
      text: "A は B と矛盾する。\n\n根拠は C。",
      kind: "claim",
      title: "A と B の矛盾",
      sourceNoteId: "note-1",
      citedNoteIds: [],
    });
    expect(doc.source).toBe("ai");
    expect(doc.wikiMeta?.kind).toBe("claim");
    expect(doc.title).toBe("A と B の矛盾");
    // claim は新規生成時 candidate
    expect(doc.wikiMeta?.status).toBe("candidate");
    // 由来ノートが入る
    expect(doc.wikiMeta?.derivedFromNotes).toEqual(["note-1"]);
  });

  it("空行区切りで段落ブロックに分解する", () => {
    const doc = buildVerbSuggestionDocument({
      text: "段落1。\n\n段落2。\n\n段落3。",
      kind: "atom",
      title: "t",
      sourceNoteId: null,
      citedNoteIds: [],
    });
    const paragraphs = doc.pages[0].blocks.filter((b: any) => b.type === "paragraph");
    expect(paragraphs).toHaveLength(3);
    expect(paragraphs[0].content[0].text).toBe("段落1。");
  });

  it("atom は status を持たない", () => {
    const doc = buildVerbSuggestionDocument({
      text: "洞察本文",
      kind: "atom",
      title: "t",
      sourceNoteId: "note-1",
      citedNoteIds: [],
    });
    expect(doc.wikiMeta?.kind).toBe("atom");
    expect(doc.wikiMeta?.status).toBeUndefined();
  });

  it("引用ノートがあれば引用元セクション + reference リンクを張る", () => {
    const doc = buildVerbSuggestionDocument({
      text: "本文",
      kind: "claim",
      title: "t",
      sourceNoteId: "note-1",
      citedNoteIds: ["cited-a", "cited-b"],
    });
    const links = doc.pages[0].knowledgeLinks;
    expect(links).toHaveLength(2);
    expect(links.map((l: any) => l.targetNoteId).sort()).toEqual(["cited-a", "cited-b"]);
    expect(links.every((l: any) => l.type === "reference" && l.layer === "knowledge")).toBe(true);
    // 見出し「引用元」が入る
    const headings = doc.pages[0].blocks.filter((b: any) => b.type === "heading");
    expect(headings.some((h: any) => h.content[0].text === "引用元")).toBe(true);
  });

  it("引用ノートを重複排除する", () => {
    const doc = buildVerbSuggestionDocument({
      text: "本文",
      kind: "claim",
      title: "t",
      sourceNoteId: null,
      citedNoteIds: ["dup", "dup", "other"],
    });
    expect(doc.pages[0].knowledgeLinks).toHaveLength(2);
  });

  it("sourceNoteId が null なら derivedFromNotes は空", () => {
    const doc = buildVerbSuggestionDocument({
      text: "本文",
      kind: "claim",
      title: "t",
      sourceNoteId: null,
      citedNoteIds: [],
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

  it("フッターが無ければ本文をそのまま返す", () => {
    expect(cleanSuggestionText("ただの本文")).toBe("ただの本文");
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
    expect(deriveSuggestionTitle("   ")).toBe("無題");
  });
});
