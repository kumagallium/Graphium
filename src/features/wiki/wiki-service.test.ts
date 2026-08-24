import { describe, expect, it } from "vitest";
import {
  parseInlineCitations,
  promoteClaimStatusIfCorroborated,
  reinforceAtomWithClaims,
  buildAtomDocument,
  buildWikiDocument,
  filterSelfFromDerivedFromClaims,
  type AtomCandidate,
} from "./wiki-service";
import type { IngesterOutput } from "../../server/services/wiki-ingester";

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

describe("reinforceAtomWithClaims - Atom の支持追加", () => {
  const atomDoc = (derivedFromClaims: string[]) => ({
    version: 2,
    title: "atom",
    pages: [{ id: "main", title: "atom", blocks: [], labels: {}, provLinks: [], knowledgeLinks: [] }],
    wikiMeta: {
      kind: "atom",
      derivedFromNotes: [],
      derivedFromChats: [],
      derivedFromClaims,
      generatedAt: "2026-07-01T00:00:00Z",
      generatedBy: { model: "m", version: "1.0.0" },
    },
    createdAt: "2026-07-01T00:00:00Z",
    modifiedAt: "2026-07-01T00:00:00Z",
  }) as any;

  it("新しい支持 Claim だけが末尾に追加される", () => {
    const result = reinforceAtomWithClaims(atomDoc(["claim-a"]), {
      derivedFromClaims: ["claim-a", "claim-b", "claim-c"],
    });
    expect(result).not.toBeNull();
    expect(result!.doc.wikiMeta!.derivedFromClaims).toEqual(["claim-a", "claim-b", "claim-c"]);
    expect(result!.addedClaimIds).toEqual(["claim-b", "claim-c"]);
  });

  it("既知の Claim のみ（差分なし）なら null（保存不要）", () => {
    expect(
      reinforceAtomWithClaims(atomDoc(["claim-a", "claim-b"]), { derivedFromClaims: ["claim-a"] }),
    ).toBeNull();
  });

  it("atom 以外の doc には何もしない", () => {
    const doc = atomDoc(["claim-a"]);
    doc.wikiMeta.kind = "claim";
    expect(reinforceAtomWithClaims(doc, { derivedFromClaims: ["claim-b"] })).toBeNull();
  });

  it("本文（pages）は変更しない", () => {
    const doc = atomDoc(["claim-a"]);
    const result = reinforceAtomWithClaims(doc, { derivedFromClaims: ["claim-b"] });
    expect(result!.doc.pages).toBe(doc.pages);
  });

  it("lastIngestedAt と modifiedAt が更新される", () => {
    const doc = atomDoc(["claim-a"]);
    const result = reinforceAtomWithClaims(doc, { derivedFromClaims: ["claim-b"] });
    expect(result!.doc.wikiMeta!.lastIngestedAt).toBeDefined();
    expect(result!.doc.modifiedAt).not.toBe(doc.modifiedAt);
  });

  it("空文字 ID は追加しない", () => {
    expect(
      reinforceAtomWithClaims(atomDoc(["claim-a"]), { derivedFromClaims: ["", "claim-a"] }),
    ).toBeNull();
  });
});

// Fix 4: 自己参照 knowledgeLink の生成抑止（3 経路）
describe("buildAtomDocument - 自己参照 knowledgeLink の生成抑止", () => {
  const candidate = (derivedFromClaims: string[]): AtomCandidate => ({
    title: "Atom title",
    body: "本文段落",
    derivedFromClaims,
    derivedFromConceptTitles: derivedFromClaims.map((id) => `title-of-${id}`),
    confidence: 0.9,
  });

  it("selfId を渡すと derivedFromClaims 中の自 ID を knowledgeLinks から除外する", () => {
    const doc = buildAtomDocument(candidate(["claim-a", "self-id", "claim-b"]), null, "ja", "self-id");
    const page = doc.pages[0];
    const targets = (page.knowledgeLinks as any[]).map((l) => l.targetNoteId);
    expect(targets).toEqual(["claim-a", "claim-b"]);
    expect(targets).not.toContain("self-id");
  });

  it("selfId を渡さない場合は従来通り全件が knowledgeLinks になる（新規生成時は自 ID 未確定）", () => {
    const doc = buildAtomDocument(candidate(["claim-a", "claim-b"]), null, "ja");
    const page = doc.pages[0];
    expect((page.knowledgeLinks as any[]).map((l) => l.targetNoteId)).toEqual(["claim-a", "claim-b"]);
  });

  it("自己参照が無ければ selfId を渡しても全件残る", () => {
    const doc = buildAtomDocument(candidate(["claim-a", "claim-b"]), null, "ja", "self-id");
    const page = doc.pages[0];
    expect((page.knowledgeLinks as any[]).map((l) => l.targetNoteId)).toEqual(["claim-a", "claim-b"]);
  });
});

describe("buildWikiDocument - relatedClaims の自己参照抑止", () => {
  const ingesterOutput = (title: string, relatedClaims: { title: string; citation: string }[]): IngesterOutput => ({
    kind: "claim",
    title,
    sections: [{ heading: "本文", content: "テスト本文" }],
    suggestedAction: "create",
    confidence: 0.9,
    relatedClaims,
    externalReferences: [],
  });

  it("relatedClaims が自 ID（selfId）に解決される場合は knowledgeLink を作らない", () => {
    const output = ingesterOutput("New Claim Title", [{ title: "旧タイトル", citation: "根拠" }]);
    const existingWikiTitles = [{ id: "self-id", title: "旧タイトル" }];
    const doc = buildWikiDocument(
      output,
      "source-note",
      null,
      "Source Note",
      existingWikiTitles,
      "ja",
      undefined,
      "self-id",
    );
    const links = doc.pages[0].knowledgeLinks as any[];
    expect(links.some((l) => l.targetNoteId === "self-id")).toBe(false);
  });

  it("relatedClaims が自タイトル（selfTitle = ingesterOutput.title）に解決される場合も除外する", () => {
    // ingesterOutput.title 自体が selfTitle として使われる（regenerate 時は旧タイトルの
    // Wiki がまだ existingWikiTitles に残っている場合があるため、ID だけでなくタイトルでも判定する）
    const selfTitle = "同名の知見";
    const output = ingesterOutput(selfTitle, [{ title: selfTitle, citation: "根拠" }]);
    const existingWikiTitles = [{ id: "other-id", title: selfTitle }];
    const doc = buildWikiDocument(output, "source-note", null, "Source Note", existingWikiTitles, "ja");
    const links = doc.pages[0].knowledgeLinks as any[];
    expect(links.some((l) => l.targetNoteId === "other-id")).toBe(false);
  });

  it("自己参照でない relatedClaims は通常どおり knowledgeLink になる", () => {
    const output = ingesterOutput("New Claim Title", [{ title: "別の知見", citation: "根拠" }]);
    const existingWikiTitles = [{ id: "other-id", title: "別の知見" }];
    const doc = buildWikiDocument(
      output,
      "source-note",
      null,
      "Source Note",
      existingWikiTitles,
      "ja",
      undefined,
      "self-id",
    );
    const links = doc.pages[0].knowledgeLinks as any[];
    expect(links.some((l) => l.targetNoteId === "other-id")).toBe(true);
  });
});

describe("filterSelfFromDerivedFromClaims - note-app.tsx の Atom re-lift 経路が使う自己参照フィルタ", () => {
  // note-app.tsx 側は wiki-service.ts が export するこの関数をそのまま呼ぶ
  // （filterSelfFromDerivedFromClaims が変更されれば、この検証も追従する）。
  it("自 ID（wikiId）を derivedFromClaims から除外する", () => {
    const preserved = filterSelfFromDerivedFromClaims(["claim-a", "wiki-self", "claim-b"], "wiki-self");
    expect(preserved).toEqual(["claim-a", "claim-b"]);
  });

  it("自 ID が含まれていなければ元のまま返す", () => {
    const preserved = filterSelfFromDerivedFromClaims(["claim-a", "claim-b"], "wiki-self");
    expect(preserved).toEqual(["claim-a", "claim-b"]);
  });
});
