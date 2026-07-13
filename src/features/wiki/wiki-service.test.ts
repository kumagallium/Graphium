import { describe, expect, it } from "vitest";
import { parseInlineCitations, promoteClaimStatusIfCorroborated } from "./wiki-service";

const emptyIndex: any[] = [];

describe("parseInlineCitations - markdown inline", () => {
  it("**bold** をボールド スタイルに変換する", () => {
    const { inlineContent } = parseInlineCitations("これは **重要** な点", emptyIndex);
    expect(inlineContent).toEqual([
      { type: "text", text: "これは ", styles: {} },
      { type: "text", text: "重要", styles: { bold: true } },
      { type: "text", text: " な点", styles: {} },
    ]);
  });

  it("*italic* をイタリック スタイルに変換する", () => {
    const { inlineContent } = parseInlineCitations("これは *斜体* です", emptyIndex);
    expect(inlineContent).toContainEqual({ type: "text", text: "斜体", styles: { italic: true } });
  });

  it("`code` をコード スタイルに変換する", () => {
    const { inlineContent } = parseInlineCitations("`foo()` を呼ぶ", emptyIndex);
    expect(inlineContent[0]).toEqual({ type: "text", text: "foo()", styles: { code: true } });
  });

  it("[text](url) を BlockNote link に変換する", () => {
    const { inlineContent } = parseInlineCitations("見よ [これ](https://example.com) を", emptyIndex);
    expect(inlineContent).toContainEqual({
      type: "link",
      href: "https://example.com",
      content: [{ type: "text", text: "これ", styles: {} }],
    });
  });

  it("装飾を含まないテキストはプレーンのまま", () => {
    const { inlineContent } = parseInlineCitations("ただのテキスト", emptyIndex);
    expect(inlineContent).toEqual([{ type: "text", text: "ただのテキスト", styles: {} }]);
  });
});

describe("parseInlineCitations - citations", () => {
  it("既存ノートの [[title]] を青い @リンクに変換し knowledgeLinks を出力する", () => {
    const noteIndex = [{ id: "n1", title: "ZnO 還元実験", isWiki: false } as any];
    const { inlineContent, knowledgeLinks } = parseInlineCitations(
      "詳細は [[ZnO 還元実験]] を見よ",
      noteIndex,
    );
    expect(inlineContent).toContainEqual({
      type: "text",
      text: "@ZnO 還元実験",
      styles: { textColor: "blue" },
    });
    expect(knowledgeLinks).toHaveLength(1);
    expect(knowledgeLinks[0].targetNoteId).toBe("n1");
  });

  it("Wiki の [[title]] は 🤖 プレフィックス付きの青リンクになる", () => {
    const noteIndex = [{ id: "w1", title: "Wikiページ", isWiki: true } as any];
    const { inlineContent } = parseInlineCitations("[[Wikiページ]]", noteIndex);
    expect(inlineContent[0]).toEqual({
      type: "text",
      text: "@🤖 Wikiページ",
      styles: { textColor: "blue" },
    });
  });

  it("Chat: 引用はリンクできず、イタリック+グレーで描画される", () => {
    const { inlineContent, knowledgeLinks } = parseInlineCitations(
      "詳細は [[Chat: ある議論]] を",
      emptyIndex,
    );
    expect(inlineContent).toContainEqual({
      type: "text",
      text: "Chat: ある議論",
      styles: { italic: true, textColor: "gray" },
    });
    expect(knowledgeLinks).toHaveLength(0);
  });

  it("noteIndex にマッチしない [[title]] はプレーンテキスト化される", () => {
    const { inlineContent, knowledgeLinks } = parseInlineCitations(
      "[[未知のノート]]",
      emptyIndex,
    );
    expect(inlineContent[0]).toEqual({ type: "text", text: "未知のノート", styles: {} });
    expect(knowledgeLinks).toHaveLength(0);
  });

  it("自分自身のタイトルを引用した [[selfTitle]] はリンク化せずプレーンテキストになる", () => {
    // 再生成時は自 Wiki も noteIndex に乗るため、ガードがないと自己参照リンクになる。
    const selfTitle = "Al5Co2 は Γ-M·Γ-K·Γ-A 方向で金属的バンドがフェルム準位を横切る";
    const noteIndex = [{ id: "self", title: selfTitle, isWiki: true } as any];
    const { inlineContent, knowledgeLinks } = parseInlineCitations(
      `[[${selfTitle}]] がこの観測の根拠である。`,
      noteIndex,
      selfTitle,
    );
    expect(inlineContent[0]).toEqual({ type: "text", text: selfTitle, styles: {} });
    // 青リンク（@ プレフィックス）になっていないこと
    expect(inlineContent.some((c: any) => c.styles?.textColor === "blue")).toBe(false);
    // 自己参照の knowledgeLink を作らないこと
    expect(knowledgeLinks).toHaveLength(0);
  });

  it("selfTitle が指定されても別ノートの [[title]] は通常どおりリンク化される", () => {
    const noteIndex = [
      { id: "self", title: "自分の知見", isWiki: true } as any,
      { id: "n2", title: "別のノート", isWiki: false } as any,
    ];
    const { knowledgeLinks } = parseInlineCitations(
      "根拠は [[別のノート]] にある",
      noteIndex,
      "自分の知見",
    );
    expect(knowledgeLinks).toHaveLength(1);
    expect(knowledgeLinks[0].targetNoteId).toBe("n2");
  });

  it("[[https://...]] は BlockNote link に変換される", () => {
    const { inlineContent } = parseInlineCitations("[[https://example.com]]", emptyIndex);
    expect(inlineContent[0]).toEqual({
      type: "link",
      href: "https://example.com",
      content: [{ type: "text", text: "https://example.com", styles: {} }],
    });
  });

  it("LLM が稀に出す [Chat: ...]] (単一の `[`) を [[Chat: ...]] に補正する", () => {
    const { inlineContent } = parseInlineCitations("文脈は [Chat: 議論名]] にある", emptyIndex);
    expect(inlineContent).toContainEqual({
      type: "text",
      text: "Chat: 議論名",
      styles: { italic: true, textColor: "gray" },
    });
  });
});

describe("parseInlineCitations - 装飾と引用の組み合わせ", () => {
  it("**bold** と [[citation]] が同じテキスト内に共存できる", () => {
    const noteIndex = [{ id: "n1", title: "実験A", isWiki: false } as any];
    const { inlineContent, knowledgeLinks } = parseInlineCitations(
      "**結論**: [[実験A]] が成功した",
      noteIndex,
    );
    expect(inlineContent[0]).toEqual({ type: "text", text: "結論", styles: { bold: true } });
    expect(inlineContent).toContainEqual({
      type: "text",
      text: "@実験A",
      styles: { textColor: "blue" },
    });
    expect(knowledgeLinks).toHaveLength(1);
  });
});

describe("promoteClaimStatusIfCorroborated - candidate → verified 昇格", () => {
  const baseMeta = (over: Record<string, unknown> = {}) => ({
    kind: "claim",
    derivedFromNotes: ["note-a"],
    derivedFromChats: [],
    generatedAt: "2026-07-01T00:00:00Z",
    generatedBy: { model: "m", version: "1.0.0" },
    status: "candidate",
    ...over,
  }) as any;

  it("単一ソースの candidate は昇格しない", () => {
    const meta = promoteClaimStatusIfCorroborated(baseMeta());
    expect(meta.status).toBe("candidate");
  });

  it("2 ノート以上が依拠したら verified に昇格する", () => {
    const meta = promoteClaimStatusIfCorroborated(
      baseMeta({ derivedFromNotes: ["note-a", "note-b"] }),
    );
    expect(meta.status).toBe("verified");
  });

  it("重複・空文字は独立ソースとして数えない", () => {
    const meta = promoteClaimStatusIfCorroborated(
      baseMeta({ derivedFromNotes: ["note-a", "note-a", ""] }),
    );
    expect(meta.status).toBe("candidate");
  });

  it("外部ソース（pdf:/url:）も独立ソースとして数える", () => {
    const meta = promoteClaimStatusIfCorroborated(
      baseMeta({ derivedFromNotes: ["note-a", "pdf:paper-1"] }),
    );
    expect(meta.status).toBe("verified");
  });

  it("claim 以外は触らない", () => {
    const meta = promoteClaimStatusIfCorroborated(
      baseMeta({ kind: "summary", status: undefined, derivedFromNotes: ["a", "b"] }),
    );
    expect(meta.status).toBeUndefined();
  });

  it("既に verified なら何もしない（冪等）", () => {
    const meta = baseMeta({ status: "verified", derivedFromNotes: ["a", "b", "c"] });
    expect(promoteClaimStatusIfCorroborated(meta)).toBe(meta);
  });

  it("status 未設定（旧データ）の claim は昇格させない", () => {
    const meta = promoteClaimStatusIfCorroborated(
      baseMeta({ status: undefined, derivedFromNotes: ["a", "b"] }),
    );
    expect(meta.status).toBeUndefined();
  });

  it("selfId（自己参照混入）は独立ソースとして数えない", () => {
    const meta = promoteClaimStatusIfCorroborated(
      baseMeta({ derivedFromNotes: ["wiki-self", "note-a"] }),
      { selfId: "wiki-self" },
    );
    expect(meta.status).toBe("candidate");
  });

  it("isIndependentSource が false を返した ID（他 wiki ページ等）は数えない", () => {
    const wikiIds = new Set(["other-wiki"]);
    const meta = promoteClaimStatusIfCorroborated(
      baseMeta({ derivedFromNotes: ["note-a", "other-wiki"] }),
      { isIndependentSource: (id) => !wikiIds.has(id) },
    );
    expect(meta.status).toBe("candidate");
  });

  it("selfId と wiki ID を除いても 2 件残れば昇格する", () => {
    const wikiIds = new Set(["other-wiki"]);
    const meta = promoteClaimStatusIfCorroborated(
      baseMeta({ derivedFromNotes: ["wiki-self", "other-wiki", "note-a", "pdf:paper-1"] }),
      { selfId: "wiki-self", isIndependentSource: (id) => !wikiIds.has(id) },
    );
    expect(meta.status).toBe("verified");
  });
});
