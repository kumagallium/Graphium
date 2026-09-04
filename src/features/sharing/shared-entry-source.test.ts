// 共有エントリ → 語彙索引の投入単位の変換
// - note は本文チャンク、knowledge は H2 セクション（chunkId = sectionId）
// - reference / data-manifest はメタデータのテキスト
// - hash 不一致（verified=false）は chunks 空
// - 対象外の type は null

import { describe, expect, it, vi } from "vitest";
import type { SharedEntry } from "../../lib/storage/shared";
import type { GraphiumDocument } from "../../lib/document-types";
import {
  sharedEntryToSourceInput,
  sharedEntryFingerprint,
  extractSharedDerivedMeta,
} from "./shared-entry-source";

const entry = (over: Partial<SharedEntry>): SharedEntry =>
  ({
    id: "0195e000-0000-7000-8000-000000000001",
    type: "note",
    author: { name: "Ada", email: "a@b.co" },
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-02T00:00:00Z",
    hash: "sha256:abc",
    prov: { derived_from: [] },
    ...over,
  }) as SharedEntry;

const encode = (doc: unknown): Uint8Array => new TextEncoder().encode(JSON.stringify(doc));

const noteDoc: GraphiumDocument = {
  title: "本文タイトル",
  pages: [
    {
      id: "p1",
      title: "本文タイトル",
      blocks: [
        { id: "b1", type: "paragraph", content: [{ type: "text", text: "焼結温度は 1200 度にした。", styles: {} }] },
      ],
    },
  ],
} as unknown as GraphiumDocument;

const wikiDoc: GraphiumDocument = {
  title: "乾燥剤の知見",
  wikiMeta: { kind: "claim" },
  pages: [
    {
      id: "p1",
      title: "乾燥剤の知見",
      blocks: [
        { id: "h1", type: "heading", props: { level: 2 }, content: [{ type: "text", text: "背景", styles: {} }] },
        { id: "b1", type: "paragraph", content: [{ type: "text", text: "湿度が高いと劣化する。", styles: {} }] },
      ],
    },
  ],
} as unknown as GraphiumDocument;

describe("sharedEntryToSourceInput", () => {
  it("note は本文をチャンクにし、title は extra.title を優先する", () => {
    const e = entry({ type: "note", extra: { title: "共有時のタイトル" } });
    const input = sharedEntryToSourceInput(e, encode(noteDoc), true);
    expect(input).toMatchObject({ kind: "shared", sourceId: e.id, title: "共有時のタイトル" });
    expect(input?.chunks).toHaveLength(1);
    expect(input?.chunks[0].text).toContain("焼結温度");
    expect(input?.fingerprint).toBe(sharedEntryFingerprint(e));
  });

  it("extra.title が無ければ本文の title を使う", () => {
    const input = sharedEntryToSourceInput(entry({ type: "note" }), encode(noteDoc), true);
    expect(input?.title).toBe("本文タイトル");
  });

  it("knowledge は H2 セクション単位（chunkId = sectionId）", () => {
    const e = entry({ type: "knowledge", extra: { title: "乾燥剤の知見" } });
    const input = sharedEntryToSourceInput(e, encode(wikiDoc), true);
    expect(input?.chunks.map((c) => c.chunkId)).toEqual(["h1"]);
    expect(input?.chunks[0].text).toContain("湿度が高いと劣化する");
  });

  it("reference は題名・URL・ドメイン・説明を索引する", () => {
    const e = entry({
      type: "reference",
      extra: { title: "論文A", url: "https://example.com/a", domain: "example.com", description: "焼結の総説" },
    });
    const input = sharedEntryToSourceInput(e, new Uint8Array(), true);
    const text = input?.chunks.map((c) => c.text).join("\n") ?? "";
    expect(text).toContain("論文A");
    expect(text).toContain("https://example.com/a");
    expect(text).toContain("焼結の総説");
  });

  it("data-manifest は題名・説明・元ファイル名を索引する", () => {
    const e = entry({
      type: "data-manifest",
      extra: { title: "XRD データ", description: "300K 測定", original_filename: "xrd_300k.csv", media_type: "other" },
    });
    const input = sharedEntryToSourceInput(e, new Uint8Array(), true);
    const text = input?.chunks.map((c) => c.text).join("\n") ?? "";
    expect(text).toContain("XRD データ");
    expect(text).toContain("xrd_300k.csv");
    expect(input?.title).toBe("XRD データ");
  });

  it("hash が合わないときは空で索引する（本文は読まない）", () => {
    const e = entry({ type: "note", extra: { title: "壊れたもの" } });
    const input = sharedEntryToSourceInput(e, encode(noteDoc), false);
    expect(input).toEqual({
      kind: "shared",
      sourceId: e.id,
      fingerprint: sharedEntryFingerprint(e),
      title: "壊れたもの",
      chunks: [],
    });
  });

  it("本文が JSON として壊れていても空で索引する", () => {
    const input = sharedEntryToSourceInput(entry({ type: "note" }), new TextEncoder().encode("{ broken"), true);
    expect(input?.chunks).toEqual([]);
  });

  it("対象外の type は null（索引から外す）", () => {
    expect(sharedEntryToSourceInput(entry({ type: "template" }), new Uint8Array(), true)).toBeNull();
    expect(sharedEntryToSourceInput(entry({ type: "report" }), new Uint8Array(), true)).toBeNull();
  });

  it("fingerprint は hash と type で決まる", () => {
    const a = sharedEntryFingerprint(entry({ hash: "sha256:1", type: "note" }));
    const b = sharedEntryFingerprint(entry({ hash: "sha256:2", type: "note" }));
    const c = sharedEntryFingerprint(entry({ hash: "sha256:1", type: "knowledge" }));
    expect(a).not.toBe(b);
    expect(a).not.toBe(c);
  });
});

describe("extractSharedDerivedMeta", () => {
  const noteWithContexts = { ...noteDoc, noteContexts: ["卒論/焼結", " 共通/装置 "] };

  it("note かつ verified なら本文のフォルダを正規化して返す", () => {
    const meta = extractSharedDerivedMeta(entry({}), encode(noteWithContexts), true);
    expect(meta).toEqual({ noteContexts: ["卒論/焼結", "共通/装置"] });
  });

  it("フォルダ未設定のノートは空配列", () => {
    expect(extractSharedDerivedMeta(entry({}), encode(noteDoc), true)).toEqual({ noteContexts: [] });
  });

  it("hash 不一致（未検証）の本文からは何も取らない", () => {
    expect(extractSharedDerivedMeta(entry({}), encode(noteWithContexts), false)).toBeNull();
  });

  it("note 以外（knowledge）は対象外", () => {
    const meta = extractSharedDerivedMeta(
      entry({ type: "knowledge" }),
      encode(noteWithContexts),
      true,
    );
    expect(meta).toBeNull();
  });

  it("本文が壊れていれば null", () => {
    expect(extractSharedDerivedMeta(entry({}), new TextEncoder().encode("{"), true)).toBeNull();
  });
});

describe("パース済み本文の受け取り", () => {
  // 語彙索引レーン（shared-library-sync）は同じ body を投影にも渡す。両方が
  // 別々に JSON.parse すると本文の大きいノートで丸ごと 2 回走るので、
  // 呼び出し側が 1 回だけパースして配れるようにしてある
  it("パース済みの doc を渡されたら body を読み直さない", () => {
    const parseSpy = vi.spyOn(JSON, "parse");
    // body はわざと壊す。パースし直していれば chunks が空になる
    const input = sharedEntryToSourceInput(
      entry({}),
      new TextEncoder().encode("{ not json"),
      true,
      noteDoc,
    );
    expect(parseSpy).not.toHaveBeenCalled();
    expect(input?.chunks.length).toBeGreaterThan(0);
    parseSpy.mockRestore();
  });

  it("パース済みが null（呼び出し側で壊れていた）なら chunks は空", () => {
    const input = sharedEntryToSourceInput(entry({}), encode(noteDoc), true, null);
    expect(input?.chunks).toEqual([]);
  });
});
