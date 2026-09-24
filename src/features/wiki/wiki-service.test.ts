import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import {
  parseInlineCitations,
  promoteClaimStatusIfCorroborated,
  reinforceAtomWithClaims,
  buildAtomDocument,
  buildWikiDocument,
  filterSelfFromDerivedFromClaims,
  normalizeTopicTitle,
  unlinkClaimFromTopic,
  buildSourceTopicDocument,
  rebuildSourceTopicDocument,
  buildSourceBackedWikiDocument,
  rebuildSourceBackedWikiDocument,
  stripEmptyMarkdownSections,
  resolveSourceCitations,
  resolveAtomDuplicates,
  mergeIntoWikiDocument,
  rewriteAndMerge,
  buildWikiSnapshots,
  rewriteAnswerFromConversation,
  formatWikiIndexForLLM,
  type AtomCandidate,
  type ExistingTopicRef,
  type WikiIndexEntry,
} from "./wiki-service";
import type { WikiMeta, SourceCheckProfile, WikiMetaSummary } from "../../lib/document-types";
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

  it("noteIndex に無くても extraTitleToId（資料一覧）にあれば青リンクになる", () => {
    // PDF・URL 等の素材は noteIndex に載らない。References の行と同じ資料一覧を渡せば
    // 本文側の [[title]] もリンク化できる（食い違いの修正）
    const extraTitleToId = new Map([["実験手順書.pdf", "pdf:asset-1"]]);
    const { inlineContent, knowledgeLinks } = parseInlineCitations(
      "詳細は [[実験手順書.pdf]] を参照",
      emptyIndex,
      undefined,
      extraTitleToId,
    );
    expect(inlineContent).toContainEqual({
      type: "text",
      text: "@実験手順書.pdf",
      styles: { textColor: "blue" },
    });
    expect(knowledgeLinks).toHaveLength(1);
    expect(knowledgeLinks[0].targetNoteId).toBe("pdf:asset-1");
  });

  it("extraTitleToId にも無ければ従来どおりプレーンテキストのまま", () => {
    const extraTitleToId = new Map([["別の資料", "pdf:asset-2"]]);
    const { inlineContent, knowledgeLinks } = parseInlineCitations(
      "[[未知の資料]]",
      emptyIndex,
      undefined,
      extraTitleToId,
    );
    expect(inlineContent[0]).toEqual({ type: "text", text: "未知の資料", styles: {} });
    expect(knowledgeLinks).toHaveLength(0);
  });

  it("selfTitle と一致する引用は extraTitleToId にあってもリンク化しない（自己引用ガード優先）", () => {
    const selfTitle = "自分自身のタイトル";
    const extraTitleToId = new Map([[selfTitle, "pdf:self"]]);
    const { inlineContent, knowledgeLinks } = parseInlineCitations(
      `[[${selfTitle}]]`,
      emptyIndex,
      selfTitle,
      extraTitleToId,
    );
    expect(inlineContent[0]).toEqual({ type: "text", text: selfTitle, styles: {} });
    expect(knowledgeLinks).toHaveLength(0);
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

describe("resolveAtomDuplicates - embedding 候補を LLM 判定（same/contradiction/different）で振り分ける", () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    global.fetch = vi.fn();
  });

  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  const dup = (title: string, matchedDocId: string, score = 0.95) => ({
    candidate: { title, body: `body of ${title}` },
    matchedDocId,
    score,
  });

  it("same 判定は same に、different 判定は different に振り分ける", async () => {
    (global.fetch as any).mockResolvedValue({
      ok: true,
      json: async () => ({
        verdicts: [
          { index: 1, existingId: "e1", verdict: "same", reason: "identical" },
          { index: 2, existingId: "e2", verdict: "different", reason: "unrelated" },
        ],
      }),
    });
    const loadExisting = vi.fn(async (id: string) => ({ title: `existing ${id}`, body: "..." }));
    const result = await resolveAtomDuplicates(
      [dup("A", "e1"), dup("B", "e2")],
      loadExisting,
      "ja",
    );
    expect(result.same).toHaveLength(1);
    expect(result.same[0].matchedDocId).toBe("e1");
    expect(result.different).toHaveLength(1);
    expect(result.different[0].title).toBe("B");
    expect(result.contradiction).toHaveLength(0);
  });

  it("contradiction 判定は contradiction バケットに入る（統合しない）", async () => {
    (global.fetch as any).mockResolvedValue({
      ok: true,
      json: async () => ({
        verdicts: [{ index: 1, existingId: "e1", verdict: "contradiction", reason: "opposite direction" }],
      }),
    });
    const loadExisting = vi.fn(async () => ({ title: "existing", body: "..." }));
    const result = await resolveAtomDuplicates([dup("A", "e1")], loadExisting, "ja");
    expect(result.contradiction).toHaveLength(1);
    expect(result.contradiction[0].matchedDocId).toBe("e1");
    expect(result.same).toHaveLength(0);
    expect(result.different).toHaveLength(0);
  });

  it("既存 doc を取得できない候補は fail-closed で different に倒す（LLM を呼ばない）", async () => {
    const loadExisting = vi.fn(async () => null);
    const result = await resolveAtomDuplicates([dup("A", "e1")], loadExisting, "ja");
    expect(result.different).toHaveLength(1);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("API 失敗（judge 呼び出し失敗）は fail-closed で全て different に倒す", async () => {
    (global.fetch as any).mockResolvedValue({ ok: false, status: 500 });
    const loadExisting = vi.fn(async () => ({ title: "existing", body: "..." }));
    const result = await resolveAtomDuplicates([dup("A", "e1")], loadExisting, "ja");
    expect(result.different).toHaveLength(1);
    expect(result.same).toHaveLength(0);
    expect(result.contradiction).toHaveLength(0);
  });

  it("候補が 0 件なら fetch を呼ばず空の振り分けを返す", async () => {
    const loadExisting = vi.fn(async () => null);
    const result = await resolveAtomDuplicates([], loadExisting, "ja");
    expect(result).toEqual({ different: [], same: [], contradiction: [] });
    expect(global.fetch).not.toHaveBeenCalled();
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
    )!;
    const links = doc.pages[0].knowledgeLinks as any[];
    expect(links.some((l) => l.targetNoteId === "self-id")).toBe(false);
  });

  it("relatedClaims が自タイトル（selfTitle = ingesterOutput.title）に解決される場合も除外する", () => {
    // ingesterOutput.title 自体が selfTitle として使われる（regenerate 時は旧タイトルの
    // Wiki がまだ existingWikiTitles に残っている場合があるため、ID だけでなくタイトルでも判定する）
    const selfTitle = "同名の知見";
    const output = ingesterOutput(selfTitle, [{ title: selfTitle, citation: "根拠" }]);
    const existingWikiTitles = [{ id: "other-id", title: selfTitle }];
    const doc = buildWikiDocument(output, "source-note", null, "Source Note", existingWikiTitles, "ja")!;
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
    )!;
    const links = doc.pages[0].knowledgeLinks as any[];
    expect(links.some((l) => l.targetNoteId === "other-id")).toBe(true);
  });
});

describe("buildWikiDocument - summary の新規生成停止（PR3）", () => {
  it("kind が summary の場合は null を返し、保存対象を作らない", () => {
    const output: IngesterOutput = {
      kind: "summary",
      title: "旧要約タイトル",
      sections: [{ heading: "", content: "本文" }],
      suggestedAction: "create",
      confidence: 0.7,
      relatedClaims: [],
      externalReferences: [],
    };
    const doc = buildWikiDocument(output, "source-note", null, "Source Note", [], "ja");
    expect(doc).toBeNull();
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

describe("normalizeTopicTitle - 話題名の一致判定用正規化", () => {
  it("前後・内部の空白と大小文字を無視する（D: 空白差の名寄せ）", () => {
    expect(normalizeTopicTitle("  Reduction Kinetics  ")).toBe("reductionkinetics");
    expect(normalizeTopicTitle("Reduction  Kinetics")).toBe("reductionkinetics");
  });

  it("NFC 正規化で結合文字の表記ゆれを吸収する", () => {
    // "が" (U+304C) と "か" + 濁点結合文字 (U+304B U+3099) は NFC で同じコードポイント列になる
    const composed = "が"; // が（合成済み）
    const decomposed = "が"; // か + ゛（結合文字）
    expect(normalizeTopicTitle(composed)).toBe(normalizeTopicTitle(decomposed));
  });
});

describe("unlinkClaimFromTopic - 知見削除時のメンバー除外", () => {
  it("derivedFromClaims から対象 claim id を除く", () => {
    const topicMeta: WikiMeta = {
      kind: "topic",
      derivedFromNotes: [],
      derivedFromChats: [],
      derivedFromClaims: ["claim-a", "claim-b"],
      generatedAt: "2026-07-01T00:00:00Z",
      generatedBy: { model: "m", version: "1.0.0" },
    };
    const next = unlinkClaimFromTopic(topicMeta, "claim-a");
    expect(next.derivedFromClaims).toEqual(["claim-b"]);
  });

  it("対象 id が含まれていなければ元のまま返す（冪等）", () => {
    const topicMeta: WikiMeta = {
      kind: "topic",
      derivedFromNotes: [],
      derivedFromChats: [],
      derivedFromClaims: ["claim-b"],
      generatedAt: "2026-07-01T00:00:00Z",
      generatedBy: { model: "m", version: "1.0.0" },
    };
    expect(unlinkClaimFromTopic(topicMeta, "claim-a")).toBe(topicMeta);
  });

  it("0 件になっても配列は残す（話題ページ自体は削除しない）", () => {
    const topicMeta: WikiMeta = {
      kind: "topic",
      derivedFromNotes: [],
      derivedFromChats: [],
      derivedFromClaims: ["claim-a"],
      generatedAt: "2026-07-01T00:00:00Z",
      generatedBy: { model: "m", version: "1.0.0" },
    };
    expect(unlinkClaimFromTopic(topicMeta, "claim-a").derivedFromClaims).toEqual([]);
  });
});

describe("stripEmptyMarkdownSections - 空の見出しを機械的に除去する", () => {
  it("本文が無い見出しを除去する", () => {
    const md = "## 定義\n本文A\n\n## 食い違い・未解決\n\n## 要点\n本文B";
    const result = stripEmptyMarkdownSections(md);
    expect(result).not.toContain("食い違い・未解決");
    expect(result).toContain("定義");
    expect(result).toContain("要点");
  });

  it("すべての見出しに本文があれば変更しない", () => {
    const md = "## 定義\n本文A\n\n## 要点\n本文B";
    expect(stripEmptyMarkdownSections(md)).toBe(md);
  });

  it("見出しが無い markdown はそのまま返す", () => {
    const md = "見出しの無い本文だけ。";
    expect(stripEmptyMarkdownSections(md)).toBe(md);
  });

  it("末尾の見出しが空でも除去する", () => {
    const md = "## 定義\n本文A\n\n## 食い違い・未解決";
    const result = stripEmptyMarkdownSections(md);
    expect(result).not.toContain("食い違い・未解決");
    expect(result.trim()).toBe("## 定義\n本文A");
  });
});

describe("resolveSourceCitations - [[source:<id>]] の解決", () => {
  it("既知の id をタイトルへ解決する", () => {
    const sources = [{ id: "note-1", title: "元ノート" }];
    const result = resolveSourceCitations("XRD パターンが取得された。[[source:note-1]]", sources);
    expect(result).toBe("XRD パターンが取得された。[[元ノート]]");
  });

  it("未知の id は引用ごと落とさず残す", () => {
    const result = resolveSourceCitations("何らかの知見。[[source:unknown-id]]", []);
    expect(result).toContain("unknown-id");
  });
});

describe("buildSourceTopicDocument / rebuildSourceTopicDocument - 新形式トピックの土台", () => {
  it("derivedFromNotes に資料 id を積み、derivedFromClaims は空、topicMarkdown を保存する", () => {
    const sources = [{ id: "note-a", title: "資料A" }, { id: "pdf:file-1", title: "資料B（PDF）" }];
    const doc = buildSourceTopicDocument(
      "話題タイトル",
      "## 定義\n本文です。",
      sources,
      "test-model",
    );
    expect(doc.wikiMeta?.kind).toBe("topic");
    expect(doc.wikiMeta?.derivedFromNotes).toEqual(["note-a", "pdf:file-1"]);
    expect(doc.wikiMeta?.derivedFromClaims).toEqual([]);
    expect(doc.wikiMeta?.topicMarkdown).toBe("## 定義\n本文です。");
  });

  it("保存前に空見出しを除去してから topicMarkdown に保存する", () => {
    const doc = buildSourceTopicDocument(
      "t",
      "## 定義\n本文です。\n\n## 食い違い・未解決\n",
      [{ id: "note-a", title: "資料A" }],
      null,
    );
    expect(doc.wikiMeta?.topicMarkdown).not.toContain("食い違い・未解決");
  });

  it("[[source:<id>]] 引用を資料の現在のタイトルへ解決し @リンク化する", () => {
    const sources = [{ id: "note-a", title: "Al3V の格子定数" }];
    const doc = buildSourceTopicDocument(
      "Al3V 合金",
      "## 要点\nXRD パターンが取得された。[[source:note-a]]",
      sources,
      "test-model",
      [{ id: "note-a", title: "Al3V の格子定数", isWiki: false } as any],
    );
    const blocks = doc.pages[0].blocks as any[];
    const para = blocks.find((b) => b.type === "paragraph");
    const linkText = para.content.find((c: any) => c.text?.includes("Al3V の格子定数"));
    expect(linkText).toBeDefined();
    expect(doc.pages[0].knowledgeLinks.some((l: any) => l.targetNoteId === "note-a")).toBe(true);
  });

  it("末尾に References（資料一覧の @リンク）を必ず付ける", () => {
    const sources = [{ id: "note-a", title: "資料A" }, { id: "url:https://example.com", title: "資料B" }];
    const doc = buildSourceTopicDocument("話題タイトル", "## 定義\n本文です。", sources, null);
    const blocks = doc.pages[0].blocks as any[];
    const headingIdx = blocks.findIndex((b) => b.type === "heading" && b.content[0].text === "References");
    expect(headingIdx).toBeGreaterThan(-1);
    const refItems = blocks.slice(headingIdx + 1).filter((b) => b.type === "bulletListItem");
    expect(refItems).toHaveLength(2);
  });

  it("rebuildSourceTopicDocument は既存 doc の他フィールドを保持しつつ derivedFromNotes/topicMarkdown を更新する", () => {
    const existing: any = {
      version: 2,
      title: "話題タイトル",
      pages: [{ id: "main", title: "話題タイトル", blocks: [], labels: {}, provLinks: [], knowledgeLinks: [] }],
      wikiMeta: {
        kind: "topic",
        derivedFromNotes: ["note-a"],
        derivedFromChats: [],
        derivedFromClaims: [],
        topicMarkdown: "## 定義\n旧本文。",
        generatedAt: "2026-09-01T00:00:00Z",
        generatedBy: { model: "m", version: "1.0.0" },
      },
      documentProvenance: { revisions: [{ id: "rev-1" }], activities: [], agents: [] },
      createdAt: "2026-09-01T00:00:00Z",
      modifiedAt: "2026-09-01T00:00:00Z",
    };
    const next = rebuildSourceTopicDocument(
      existing,
      "## 定義\n更新後の本文。",
      [{ id: "note-a", title: "資料A" }, { id: "note-b", title: "資料B" }],
      "m2",
    );
    expect(next.wikiMeta?.derivedFromNotes).toEqual(["note-a", "note-b"]);
    expect(next.wikiMeta?.topicMarkdown).toBe("## 定義\n更新後の本文。");
    expect(next.documentProvenance).toBe(existing.documentProvenance);
  });

  it("rebuildSourceTopicDocument で書き直しても References は 1 つだけ（重複しない）", () => {
    const sources = [{ id: "note-a", title: "資料A" }];
    const first = buildSourceTopicDocument("話題タイトル", "## 定義\n本文です。", sources, null);
    const rewritten = rebuildSourceTopicDocument(first, "## 定義\n更新後の本文。", sources, null);
    const blocks = rewritten.pages[0].blocks as any[];
    const headings = blocks.filter((b) => b.type === "heading" && b.content[0].text === "References");
    expect(headings).toHaveLength(1);
  });
});

describe("buildSourceBackedWikiDocument - kind を受け取る出典つきページ組み立て（answer）", () => {
  it("kind に answer を渡すと wikiMeta.kind が answer になり、topic と同じ土台（derivedFromNotes/topicMarkdown/References）を持つ", () => {
    const sources = [{ id: "note-a", title: "資料A" }];
    const doc = buildSourceBackedWikiDocument(
      "answer",
      "この現象はなぜ起きますか？",
      "## 回答\n本文です。[[source:note-a]]",
      sources,
      "test-model",
    );
    expect(doc.wikiMeta?.kind).toBe("answer");
    expect(doc.title).toBe("この現象はなぜ起きますか？");
    expect(doc.wikiMeta?.derivedFromNotes).toEqual(["note-a"]);
    expect(doc.wikiMeta?.derivedFromClaims).toEqual([]);
    expect(doc.wikiMeta?.topicMarkdown).toContain("本文です。");
    const blocks = doc.pages[0].blocks as any[];
    const headingIdx = blocks.findIndex((b) => b.type === "heading" && b.content[0].text === "References");
    expect(headingIdx).toBeGreaterThan(-1);
  });

  it("素材（noteIndex に載らない資料）の引用も References と同じく本文で青リンクになる", () => {
    // PDF/URL 等の素材は noteIndex に載らないため、以前は本文だけプレーン文字に落ちていた
    // （References 側は sources から直接リンクにしていて食い違っていた）
    const sources = [{ id: "pdf:asset-1", title: "実験手順書.pdf" }];
    const doc = buildSourceBackedWikiDocument(
      "topic",
      "手順の要点",
      "## 概要\n手順は [[source:pdf:asset-1]] にまとめた。",
      sources,
      "test-model",
    );
    const blocks = doc.pages[0].blocks as any[];
    const bodyParagraph = blocks.find(
      (b) => b.type === "paragraph" && b.content.some((c: any) => c.text?.includes("手順は")),
    );
    expect(bodyParagraph.content).toContainEqual({
      type: "text",
      text: "@実験手順書.pdf",
      styles: { textColor: "blue" },
    });
    expect(bodyParagraph.knowledgeLinks).toBeUndefined(); // knowledgeLinks はブロックでなくページ側
    const pageLinks = doc.pages[0].knowledgeLinks as any[];
    expect(pageLinks.some((l) => l.targetNoteId === "pdf:asset-1")).toBe(true);
  });

  it("既定（kind 未指定の buildSourceTopicDocument）は topic のまま", () => {
    const doc = buildSourceTopicDocument("t", "## 定義\n本文。", [{ id: "note-a", title: "資料A" }], null);
    expect(doc.wikiMeta?.kind).toBe("topic");
  });

  it("rebuildSourceBackedWikiDocument に kind を渡すと wikiMeta.kind が更新される", () => {
    const sources = [{ id: "note-a", title: "資料A" }];
    const first = buildSourceBackedWikiDocument("answer", "問い", "## 回答\n本文。", sources, null);
    const rewritten = rebuildSourceBackedWikiDocument(first, "## 回答\n更新後の本文。", sources, null, undefined, "answer");
    expect(rewritten.wikiMeta?.kind).toBe("answer");
    expect(rewritten.wikiMeta?.topicMarkdown).toBe("## 回答\n更新後の本文。");
  });

  it("rebuildSourceBackedWikiDocument は kind 未指定なら既存 doc の kind を引き継ぐ", () => {
    const sources = [{ id: "note-a", title: "資料A" }];
    const first = buildSourceBackedWikiDocument("answer", "問い", "## 回答\n本文。", sources, null);
    const rewritten = rebuildSourceBackedWikiDocument(first, "## 回答\n更新後。", sources, null);
    expect(rewritten.wikiMeta?.kind).toBe("answer");
  });
});

describe("buildWikiSnapshots - answer（回答ページ）も点検スナップショットに含める", () => {
  it("kind: answer の wiki を含める（早期 continue で除外しない）", () => {
    const doc = buildSourceBackedWikiDocument(
      "answer",
      "この現象はなぜ起きますか？",
      "## 回答\n本文です。[[source:note-a]]",
      [{ id: "note-a", title: "資料A" }],
      "test-model",
    );
    const wikiMetas = new Map<string, WikiMetaSummary>([
      ["answer-1", { title: doc.title, kind: "answer" }],
    ]);
    const snapshots = buildWikiSnapshots(
      [{ id: "answer-1", modifiedTime: "2026-09-18T00:00:00.000Z" }],
      wikiMetas,
      (id) => (id === "wiki:answer-1" ? doc : null),
    );
    expect(snapshots).toHaveLength(1);
    expect(snapshots[0]).toMatchObject({ id: "answer-1", kind: "answer", derivedFromNotes: ["note-a"] });
  });
});

describe("convertSectionsToBlocks（buildSourceTopicDocument 経由）- 箇条書き / 番号付きリストの変換", () => {
  it("`- ` 始まりの行を bulletListItem ブロックに変換する", () => {
    const doc = buildSourceTopicDocument(
      "話題タイトル",
      "## 要点\n- 1 つ目の要点\n- 2 つ目の要点",
      [{ id: "note-a", title: "資料A" }],
      null,
    );
    const blocks = doc.pages[0].blocks as any[];
    const items = blocks.filter((b) => b.type === "bulletListItem");
    // References の @リンク行と紛れないよう本文由来だけを見る
    const bodyItems = items.filter((b) => !b.content.some((c: any) => c.text?.startsWith("@")));
    expect(bodyItems).toHaveLength(2);
    expect(bodyItems[0].content[0].text).toBe("1 つ目の要点");
  });

  it("`1. ` 始まりの行を numberedListItem ブロックに変換する", () => {
    const doc = buildSourceTopicDocument(
      "話題タイトル",
      "## 要点\n1. 最初の手順\n2. 次の手順",
      [{ id: "note-a", title: "資料A" }],
      null,
    );
    const blocks = doc.pages[0].blocks as any[];
    const items = blocks.filter((b) => b.type === "numberedListItem");
    expect(items).toHaveLength(2);
    expect(items[0].content[0].text).toBe("最初の手順");
    expect(items[1].content[0].text).toBe("次の手順");
  });
});

describe("normalizeTopicTitle - 空白差・NFKC の吸収（D）", () => {
  it("半角スペースの有無を同一視する", () => {
    expect(normalizeTopicTitle("Al3V合金")).toBe(normalizeTopicTitle("Al3V 合金"));
  });

  it("全角スペースも同一視する", () => {
    expect(normalizeTopicTitle("Al3V　合金")).toBe(normalizeTopicTitle("Al3V合金"));
  });

  it("大文字小文字を同一視する", () => {
    expect(normalizeTopicTitle("AI3V")).not.toBe(normalizeTopicTitle("Al3V")); // 別文字（I と l）は区別する
    expect(normalizeTopicTitle("ABC")).toBe(normalizeTopicTitle("abc"));
  });
});

describe("本文を作り直す merge/regenerate 系は古い sourceCheck を引き継がない", () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  const staleSourceCheck: SourceCheckProfile = {
    verdict: "supported",
    entries: [],
    checkedAt: "2026-08-01T00:00:00Z",
    checkedBy: "test-model",
    claimHash: "old-hash",
  };

  const claimDocWithSourceCheck = (): any => ({
    version: 2,
    title: "知見タイトル",
    pages: [{
      id: "main",
      title: "知見タイトル",
      blocks: [],
      labels: {},
      provLinks: [],
      knowledgeLinks: [],
    }],
    wikiMeta: {
      kind: "claim",
      derivedFromNotes: ["note-1"],
      derivedFromChats: [],
      generatedAt: "2026-07-01T00:00:00Z",
      generatedBy: { model: "m", version: "1.0.0" },
      sourceCheck: staleSourceCheck,
    },
    createdAt: "2026-07-01T00:00:00Z",
    modifiedAt: "2026-07-01T00:00:00Z",
  });

  const ingesterOutput: IngesterOutput = {
    kind: "claim",
    title: "知見タイトル",
    sections: [{ heading: "節1", content: "新しい内容。" }],
    suggestedAction: "merge",
    confidence: 0.9,
    relatedClaims: [],
    externalReferences: [],
  };

  it("mergeIntoWikiDocument は本文を書き換えるので sourceCheck を落とす", () => {
    const existing = claimDocWithSourceCheck();
    const next = mergeIntoWikiDocument(existing, ingesterOutput, "note-2", "m2");
    expect(next.wikiMeta?.sourceCheck).toBeUndefined();
    // 他フィールドは保持される
    expect(next.wikiMeta?.derivedFromNotes).toContain("note-2");
  });

  it("rewriteAndMerge は rewrite API 失敗時のフォールバック（append merge）でも sourceCheck を落とす", async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 500 });
    const existing = claimDocWithSourceCheck();
    existing.pages[0].blocks = [
      { id: "h1", type: "heading", props: { level: 2 }, content: [{ type: "text", text: "節1", styles: {} }], children: [] },
    ];
    const next = await rewriteAndMerge(existing, ingesterOutput, "note-2", "m2");
    expect(next.wikiMeta?.sourceCheck).toBeUndefined();
  });

  it("rewriteAndMerge は rewrite API 成功時（本文を再構成）でも sourceCheck を落とす", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ sections: [{ heading: "節1", content: "書き直された内容。" }] }),
    });
    const existing = claimDocWithSourceCheck();
    existing.pages[0].blocks = [
      { id: "h1", type: "heading", props: { level: 2 }, content: [{ type: "text", text: "節1", styles: {} }], children: [] },
    ];
    const next = await rewriteAndMerge(existing, ingesterOutput, "note-2", "m2");
    expect(next.wikiMeta?.sourceCheck).toBeUndefined();
  });


  it("rewriteAnswerFromConversation は API 失敗時に null を返す（呼び出し側は元の回答文にフォールバックできる）", async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 500 });
    const result = await rewriteAnswerFromConversation(
      "それの単位は？",
      "それは W/mK である。",
      [{ role: "user", content: "熱伝導率の話" }, { role: "assistant", content: "熱伝導率は…" }],
      [{ id: "wiki-1", title: "資料A" }],
      "ja",
    );
    expect(result).toBeNull();
  });

  it("rewriteAnswerFromConversation は出典マーカーが書き起こしで消えていたら null を返す（出典消失ガード）", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ title: "焼結条件の目安", body: "出典の痕跡が消えた本文。" }),
    });
    const result = await rewriteAnswerFromConversation(
      "それの単位は？",
      "焼結条件はこうだ。[Source: \"焼結メモ\"]",
      [],
      [],
      "ja",
    );
    expect(result).toBeNull();
  });

  it("rewriteAnswerFromConversation はサーバーが title を返さないとき空文字にする（呼び出し側は deriveSuggestionTitle にフォールバックできる）", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ body: "書き起こした本文。" }),
    });
    const result = await rewriteAnswerFromConversation(
      "それの単位は？",
      "それは W/mK である。",
      [],
      [],
      "ja",
    );
    expect(result).toEqual({ title: "", body: "書き起こした本文。" });
  });

  it("rebuildSourceTopicDocument は本文を作り直すので sourceCheck を落とす", () => {
    const existing = claimDocWithSourceCheck();
    existing.wikiMeta.kind = "topic";
    existing.wikiMeta.derivedFromNotes = ["note-a"];
    existing.wikiMeta.derivedFromClaims = [];
    const next = rebuildSourceTopicDocument(
      existing,
      "## 定義\n更新後の本文。",
      [{ id: "note-a", title: "資料A" }],
      "m2",
    );
    expect(next.wikiMeta?.sourceCheck).toBeUndefined();
  });
});

describe("formatWikiIndexForLLM - 索引はタイトルのみ（プレビューは載せない・summary は除外）", () => {
  function entry(overrides: Partial<WikiIndexEntry>): WikiIndexEntry {
    return {
      id: overrides.id ?? "id-1",
      title: overrides.title ?? "タイトル",
      kind: overrides.kind ?? "claim",
      bodyPreview: overrides.bodyPreview ?? "本文のプレビュー文字列がここに入る",
      level: overrides.level,
      derivedFromNotes: overrides.derivedFromNotes ?? [],
      relatedClaims: overrides.relatedClaims ?? [],
      modifiedAt: overrides.modifiedAt ?? "2026-01-01T00:00:00.000Z",
    };
  }

  it("bodyPreview を出力に含めない", () => {
    const text = formatWikiIndexForLLM([
      entry({ kind: "claim", title: "熱電材料の基礎", bodyPreview: "これはプレビュー本文です" }),
    ]);
    expect(text).not.toContain("これはプレビュー本文です");
    expect(text).toContain("熱電材料の基礎");
  });

  it("summary（旧種別）は索引に載せない", () => {
    const text = formatWikiIndexForLLM([
      entry({ kind: "summary", title: "古い要約ページ" }),
      entry({ kind: "claim", title: "残る知見" }),
    ]);
    expect(text).not.toContain("古い要約ページ");
    expect(text).not.toContain("Summaries");
    expect(text).toContain("残る知見");
  });

  it("Topics / Concepts / Syntheses / Atoms の見出しと [level] タグを残す", () => {
    const text = formatWikiIndexForLLM([
      entry({ kind: "topic", title: "話題A" }),
      entry({ kind: "claim", title: "概念B", level: "principle" }),
      entry({ kind: "synthesis", title: "統合C" }),
      entry({ kind: "atom", title: "断片D" }),
    ]);
    expect(text).toContain("### Topics (1)");
    expect(text).toContain("### Concepts (1)");
    expect(text).toContain("### Syntheses (1)");
    expect(text).toContain("### Atoms (1)");
    expect(text).toContain("**概念B** [principle]");
  });

  it("件数表記は summary を除いた実際に渡した数になる", () => {
    const text = formatWikiIndexForLLM([
      entry({ kind: "summary", title: "要約1" }),
      entry({ kind: "summary", title: "要約2" }),
      entry({ kind: "claim", title: "知見1" }),
    ]);
    expect(text).toContain("## Wiki Index (1 pages)");
  });

  it("空配列なら空文字列を返す", () => {
    expect(formatWikiIndexForLLM([])).toBe("");
  });
});
