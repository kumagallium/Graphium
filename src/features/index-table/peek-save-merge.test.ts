import { describe, expect, it } from "vitest";
import type { GraphiumDocument, WikiMeta } from "../../lib/document-types";
import { applySavedToPeekDoc, pickPeekExternalFields } from "./peek-save-merge";

const wikiMeta = (extra?: Partial<WikiMeta>): WikiMeta => ({
  kind: "claim",
  derivedFromNotes: ["note-1"],
  derivedFromChats: [],
  generatedAt: "2026-09-01T00:00:00Z",
  generatedBy: { model: "m", version: "" },
  ...extra,
});

const doc = (extra?: Partial<GraphiumDocument>): GraphiumDocument =>
  ({
    version: 1,
    title: "t",
    pages: [],
    createdAt: "2026-09-01T00:00:00Z",
    modifiedAt: "2026-09-01T00:00:00Z",
    ...extra,
  }) as GraphiumDocument;

describe("pickPeekExternalFields", () => {
  it("キャッシュが無ければ何も上書きしない", () => {
    expect(pickPeekExternalFields("wiki:a", undefined)).toEqual({});
    expect(pickPeekExternalFields("wiki:a", null)).toEqual({});
  });

  it("wiki: はキャッシュ側の wikiMeta を採る（照合結果を旧い docRef で巻き戻さない）", () => {
    const meta = wikiMeta({
      sourceCheck: {
        verdict: "supported",
        entries: [],
        checkedAt: "2026-09-17T00:00:00Z",
        checkedBy: "local",
        claimHash: "h",
      },
    });
    expect(pickPeekExternalFields("wiki:a", doc({ source: "ai", wikiMeta: meta }))).toEqual({
      wikiMeta: meta,
    });
  });

  it("判定を消した後の wikiMeta（sourceCheck 無し）もそのまま採る", () => {
    const meta = wikiMeta();
    expect(pickPeekExternalFields("wiki:a", doc({ wikiMeta: meta })).wikiMeta).toBe(meta);
  });

  it("通常ノートでは wikiMeta を採らない", () => {
    expect(pickPeekExternalFields("note-1", doc({ wikiMeta: wikiMeta() }))).toEqual({});
  });

  it("chats はノートの種類を問わずキャッシュ側を採る", () => {
    const chats = [] as NonNullable<GraphiumDocument["chats"]>;
    expect(pickPeekExternalFields("note-1", doc({ chats }))).toEqual({ chats });
    expect(pickPeekExternalFields("wiki:a", doc({ chats }))).toEqual({ chats });
  });
});

describe("applySavedToPeekDoc", () => {
  const page = (text: string): GraphiumDocument["pages"][number] => ({
    id: "p",
    title: "",
    blocks: [{ id: "b1", type: "paragraph", content: [{ type: "text", text }] }],
    labels: {},
    provLinks: [],
    knowledgeLinks: [],
  });

  // doSave と同じ組み立て: 保存を始めた時点の docRef（base）を spread し、本文と更新時刻を差し替える
  const buildSaved = (
    base: GraphiumDocument,
    text: string,
    modifiedAt: string,
    externalFields: Partial<Pick<GraphiumDocument, "chats" | "wikiMeta">> = {},
  ): GraphiumDocument => ({
    ...base,
    ...externalFields,
    pages: [{ ...base.pages[0], blocks: page(text).blocks }],
    modifiedAt,
  });

  const opened = doc({
    title: "旧タイトル",
    pages: [page("開いたときの本文")],
    noteContexts: ["実験"],
  });

  it("保存を待つ間に何も書き換わっていなければ、保存した doc そのものを返す", () => {
    const saved = buildSaved(opened, "打った本文", "2026-09-25T01:00:00Z");
    expect(applySavedToPeekDoc(opened, opened, saved)).toBe(saved);
  });

  it("docRef が空なら保存した doc を返す", () => {
    const saved = buildSaved(opened, "打った本文", "2026-09-25T01:00:00Z");
    expect(applySavedToPeekDoc(null, opened, saved)).toBe(saved);
  });

  it("保存を待つ間のタイトル・文脈ラベル・引用素材・noteLinks の書き換えを残し、本文と更新時刻は保存した doc に揃える", () => {
    const saved = buildSaved(opened, "打った本文", "2026-09-25T01:00:00Z");
    // 書き込みを待つ間に、ピークの各書き換え口が `{ ...cur, 項目 }` で docRef を作り直す
    let current = opened;
    current = { ...current, title: "新タイトル" };
    current = { ...current, noteContexts: ["実験", "計画"] };
    current = { ...current, citedAssetFileIds: ["asset-1"] };
    current = {
      ...current,
      noteLinks: [{ targetNoteId: "note-2", sourceBlockId: "b1", type: "derived_from" }],
    };

    const merged = applySavedToPeekDoc(current, opened, saved);

    expect(merged.title).toBe("新タイトル");
    expect(merged.noteContexts).toEqual(["実験", "計画"]);
    expect(merged.citedAssetFileIds).toEqual(["asset-1"]);
    expect(merged.noteLinks).toEqual([
      { targetNoteId: "note-2", sourceBlockId: "b1", type: "derived_from" },
    ]);
    expect(merged.pages).toBe(saved.pages);
    expect(merged.modifiedAt).toBe("2026-09-25T01:00:00Z");
  });

  it("文脈ラベルを全部外した書き換え（noteContexts が undefined）も残す", () => {
    const saved = buildSaved(opened, "打った本文", "2026-09-25T01:00:00Z");
    const current = { ...opened, noteContexts: undefined };
    const merged = applySavedToPeekDoc(current, opened, saved);
    expect(merged.noteContexts).toBeUndefined();
    expect(merged.pages).toBe(saved.pages);
  });

  it("保存がキャッシュ側から採った chats / wikiMeta を載せる", () => {
    const chats = [] as NonNullable<GraphiumDocument["chats"]>;
    const meta = wikiMeta();
    const saved = buildSaved(opened, "打った本文", "2026-09-25T01:00:00Z", { chats, wikiMeta: meta });
    const current = { ...opened, title: "新タイトル" };
    const merged = applySavedToPeekDoc(current, opened, saved);
    expect(merged.chats).toBe(chats);
    expect(merged.wikiMeta).toBe(meta);
    expect(merged.title).toBe("新タイトル");
  });

  it("保存を待つ間に保存側と同じ項目を書き換えていたら、保存側が勝つ", () => {
    const chats = [] as NonNullable<GraphiumDocument["chats"]>;
    const saved = buildSaved(opened, "打った本文", "2026-09-25T01:00:00Z", { chats });
    const current = { ...opened, chats: [] as NonNullable<GraphiumDocument["chats"]> };
    expect(applySavedToPeekDoc(current, opened, saved).chats).toBe(chats);
  });

  it("前の保存が終わる前に次の保存が doc を組んでも、書き換えを残し、後の保存の本文で終わる", () => {
    // 1 本目の保存: 開いた doc から組む
    const saved1 = buildSaved(opened, "本文 1", "2026-09-25T01:00:00Z");
    // 1 本目を待つ間にタイトルを変え、2 本目の保存がその docRef から組む
    const titled = { ...opened, title: "新タイトル" };
    const saved2 = buildSaved(titled, "本文 2", "2026-09-25T01:00:03Z");

    // 1 本目が終わる
    let current = applySavedToPeekDoc(titled, opened, saved1);
    expect(current.title).toBe("新タイトル");
    expect(current.pages).toBe(saved1.pages);

    // 2 本目を待つ間に文脈ラベルを変える
    current = { ...current, noteContexts: ["計画"] };

    // 2 本目が終わる
    current = applySavedToPeekDoc(current, titled, saved2);
    expect(current.title).toBe("新タイトル");
    expect(current.noteContexts).toEqual(["計画"]);
    expect(current.pages).toBe(saved2.pages);
    expect(current.modifiedAt).toBe("2026-09-25T01:00:03Z");
  });

  it("後の保存が先に終わっても、書き換えは消えない", () => {
    const saved1 = buildSaved(opened, "本文 1", "2026-09-25T01:00:00Z");
    const titled = { ...opened, title: "新タイトル" };
    const saved2 = buildSaved(titled, "本文 2", "2026-09-25T01:00:03Z");

    let current = applySavedToPeekDoc(titled, titled, saved2);
    current = applySavedToPeekDoc(current, opened, saved1);
    // 本文の写しは 1 本目のものに戻るが、次の保存はエディタから本文を組み直す。
    // 保存の順番そのものは保存を並べる側の仕事で、ここはタイトルを落とさないことを持つ
    expect(current.title).toBe("新タイトル");
  });
});
