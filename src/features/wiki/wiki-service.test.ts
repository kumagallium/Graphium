import { describe, expect, it } from "vitest";
import {
  parseInlineCitations,
  promoteClaimStatusIfCorroborated,
  reinforceAtomWithClaims,
  buildAtomDocument,
  buildWikiDocument,
  filterSelfFromDerivedFromClaims,
  normalizeTopicTitle,
  matchTopicsByTitle,
  resolveTopicsForClaim,
  linkClaimAndTopic,
  unlinkClaimFromTopic,
  buildTopicDocument,
  rebuildTopicDocument,
  type AtomCandidate,
  type ExistingTopicRef,
} from "./wiki-service";
import type { WikiMeta } from "../../lib/document-types";
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

describe("normalizeTopicTitle - 話題名の一致判定用正規化", () => {
  it("前後空白と大小文字を無視する", () => {
    expect(normalizeTopicTitle("  Reduction Kinetics  ")).toBe("reduction kinetics");
  });

  it("NFC 正規化で結合文字の表記ゆれを吸収する", () => {
    // "が" (U+304C) と "か" + 濁点結合文字 (U+304B U+3099) は NFC で同じコードポイント列になる
    const composed = "が"; // が（合成済み）
    const decomposed = "が"; // か + ゛（結合文字）
    expect(normalizeTopicTitle(composed)).toBe(normalizeTopicTitle(decomposed));
  });
});

describe("matchTopicsByTitle - タイトル正規化一致（同期版）", () => {
  const existing: ExistingTopicRef[] = [
    { id: "topic-1", title: "還元の反応速度" },
    { id: "topic-2", title: "SPS 焼結条件" },
  ];

  it("正規化後に一致する既存話題を matched として返す", () => {
    const result = matchTopicsByTitle(["  還元の反応速度  "], existing);
    expect(result).toEqual([
      { status: "matched", title: "  還元の反応速度  ", topicId: "topic-1", via: "title" },
    ]);
  });

  it("大小文字違いでも一致する（英語話題名）", () => {
    const result = matchTopicsByTitle(["sps 焼結条件"], existing);
    expect(result[0]).toMatchObject({ status: "matched", topicId: "topic-2" });
  });

  it("一致しなければ new を返す", () => {
    const result = matchTopicsByTitle(["まったく新しい話題"], existing);
    expect(result).toEqual([{ status: "new", title: "まったく新しい話題" }]);
  });

  it("既存話題が空なら全件 new", () => {
    const result = matchTopicsByTitle(["a", "b"], []);
    expect(result.every((m) => m.status === "new")).toBe(true);
  });
});

describe("resolveTopicsForClaim - 話題の割り当て（正規化一致 → embedding → 新規）", () => {
  it("タイトル一致する話題名は embedding を経由せず matched を返す", async () => {
    const existing: ExistingTopicRef[] = [{ id: "topic-1", title: "還元の反応速度" }];
    const result = await resolveTopicsForClaim(["還元の反応速度"], existing);
    expect(result).toEqual([
      { status: "matched", title: "還元の反応速度", topicId: "topic-1", via: "title" },
    ]);
  });

  it("既存話題が無ければ即 new（embedding API を叩かない）", async () => {
    const result = await resolveTopicsForClaim(["新しい話題"], []);
    expect(result).toEqual([{ status: "new", title: "新しい話題" }]);
  });

  it("一致しない話題名は embedding モデル未設定時 fail-open で new になる", async () => {
    // テスト環境では embedding モデル未設定 → partitionCandidatesByEmbedding が
    // fail-open（全件 kept）で返るため、タイトル一致しない話題名は new に倒れる。
    const existing: ExistingTopicRef[] = [{ id: "topic-1", title: "既存の話題" }];
    const result = await resolveTopicsForClaim(["未知の話題"], existing);
    expect(result).toEqual([{ status: "new", title: "未知の話題" }]);
  });

  it("同一呼び出し内の重複話題名（正規化後に同じ）は 1 件に畳む", async () => {
    const result = await resolveTopicsForClaim(["話題A", " 話題A "], []);
    expect(result).toHaveLength(1);
  });

  it("入力が空なら空配列", async () => {
    expect(await resolveTopicsForClaim([], [])).toEqual([]);
  });
});

describe("linkClaimAndTopic - claim ⇔ topic の双方向リンク", () => {
  const baseClaimMeta = (topicIds?: string[]): WikiMeta => ({
    kind: "claim",
    derivedFromNotes: ["note-1"],
    derivedFromChats: [],
    generatedAt: "2026-07-01T00:00:00Z",
    generatedBy: { model: "m", version: "1.0.0" },
    topicIds,
  });
  const baseTopicMeta = (derivedFromClaims?: string[]): WikiMeta => ({
    kind: "topic",
    derivedFromNotes: [],
    derivedFromChats: [],
    generatedAt: "2026-07-01T00:00:00Z",
    generatedBy: { model: "m", version: "1.0.0" },
    derivedFromClaims,
  });

  it("claim.topicIds と topic.derivedFromClaims の双方に追加する", () => {
    const { claimMeta, topicMeta } = linkClaimAndTopic(
      baseClaimMeta([]),
      "claim-1",
      baseTopicMeta([]),
      "topic-1",
    );
    expect(claimMeta.topicIds).toEqual(["topic-1"]);
    expect(topicMeta.derivedFromClaims).toEqual(["claim-1"]);
  });

  it("既存のリストを保持したまま追加する", () => {
    const { claimMeta, topicMeta } = linkClaimAndTopic(
      baseClaimMeta(["topic-0"]),
      "claim-1",
      baseTopicMeta(["claim-0"]),
      "topic-1",
    );
    expect(claimMeta.topicIds).toEqual(["topic-0", "topic-1"]);
    expect(topicMeta.derivedFromClaims).toEqual(["claim-0", "claim-1"]);
  });

  it("既にリンク済みなら冪等（同じ配列インスタンスを保つ）", () => {
    const claimMeta0 = baseClaimMeta(["topic-1"]);
    const topicMeta0 = baseTopicMeta(["claim-1"]);
    const { claimMeta, topicMeta } = linkClaimAndTopic(claimMeta0, "claim-1", topicMeta0, "topic-1");
    expect(claimMeta).toBe(claimMeta0);
    expect(topicMeta).toBe(topicMeta0);
  });

  it("claim.topicIds は最大 3 件に切り詰める", () => {
    const { claimMeta } = linkClaimAndTopic(
      baseClaimMeta(["t1", "t2", "t3"]),
      "claim-1",
      baseTopicMeta([]),
      "t4",
    );
    expect(claimMeta.topicIds).toEqual(["t1", "t2", "t3"]);
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

describe("buildTopicDocument / rebuildTopicDocument - 保存経路で topicIds/derivedFromClaims が落ちない", () => {
  it("buildTopicDocument は derivedFromClaims にメンバー知見 ID をすべて積む", () => {
    const doc = buildTopicDocument(
      "話題タイトル",
      "## 定義\n本文です。",
      ["claim-a", "claim-b"],
      "test-model",
      "ja",
    );
    expect(doc.wikiMeta?.kind).toBe("topic");
    expect(doc.wikiMeta?.derivedFromClaims).toEqual(["claim-a", "claim-b"]);
  });

  it("本文の `## 見出し` はブロック化され、段落テキストも保持される", () => {
    const doc = buildTopicDocument("t", "## 定義\n本文です。", ["claim-a"], null);
    const blocks = doc.pages[0].blocks as any[];
    expect(blocks.some((b) => b.type === "heading")).toBe(true);
    expect(blocks.some((b) => b.type === "paragraph")).toBe(true);
  });

  it("rebuildTopicDocument は既存 doc の他フィールド（documentProvenance 等）を保持しつつ derivedFromClaims を更新する", () => {
    const existing: any = {
      version: 2,
      title: "話題タイトル",
      pages: [{ id: "main", title: "話題タイトル", blocks: [], labels: {}, provLinks: [], knowledgeLinks: [] }],
      wikiMeta: {
        kind: "topic",
        derivedFromNotes: [],
        derivedFromChats: [],
        derivedFromClaims: ["claim-a"],
        generatedAt: "2026-07-01T00:00:00Z",
        generatedBy: { model: "m", version: "1.0.0" },
      },
      documentProvenance: { revisions: [{ id: "rev-1" }], activities: [], agents: [] },
      createdAt: "2026-07-01T00:00:00Z",
      modifiedAt: "2026-07-01T00:00:00Z",
    };
    const next = rebuildTopicDocument(existing, "## 定義\n更新後の本文。", ["claim-a", "claim-b"], "m2");
    expect(next.wikiMeta?.derivedFromClaims).toEqual(["claim-a", "claim-b"]);
    expect(next.documentProvenance).toBe(existing.documentProvenance);
  });
});
