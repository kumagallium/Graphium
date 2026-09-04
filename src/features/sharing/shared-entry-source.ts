// 共有エントリ 1 件を語彙索引の投入単位（LexicalSourceInput）に変換する純関数
//
// 手元のノート・Wiki と同じ切り方に揃える:
//   - note      … chunkNoteDocument（本文ブロックを ~600 字の塊に）
//   - knowledge … extractWikiSections の H2 セクション（chunkId = sectionId）。
//                 埋め込み側の `documentId:sectionId` と揃うので RRF で束ねられる
//   - reference / data-manifest … 本体を持たない（メタデータだけ）ので、
//                 題名・URL・説明などを繋いだテキストを索引する
//
// hash が合わなかった（verified === false）ときは chunks: [] で「空で索引済み」に
// する。索引側は fingerprint（= hash）が変わるまで再試行しないので、壊れた／
// 書き換え中のエントリを毎回読み直す無駄が出ない。
//
// ここは React にも IndexedDB にも Tauri にも依存しない（テストしやすさのため）。

import type { GraphiumDocument } from "../../lib/document-types";
import type { LexicalSourceInput } from "../lexical-search/lexical-index";
import { chunkNoteDocument, chunkPlainText } from "../lexical-search/chunk";
import { extractWikiSections } from "../wiki/section-extract";
import { normalizeNoteContexts } from "../note-context/context-tags";
import type { SharedEntry } from "../../lib/storage/shared";

/** 索引対象にする共有エントリの type（template / report は共有導線が無いので対象外） */
export const SHARED_INDEXABLE_TYPES = ["note", "knowledge", "reference", "data-manifest"] as const;

/** 索引の印。hash が変われば内容が変わったことになる（type も混ぜて取り違えを防ぐ） */
export function sharedEntryFingerprint(entry: SharedEntry): string {
  return `${entry.hash}|${entry.type}`;
}

function extraString(entry: SharedEntry, key: string): string {
  const v = (entry.extra as Record<string, unknown> | undefined)?.[key];
  return typeof v === "string" ? v.trim() : "";
}

/**
 * 本文（JSON テキスト）を GraphiumDocument として読む。壊れていれば null。
 *
 * export しているのは、同じ body を索引と投影の両方に渡す呼び出し側
 * （shared-library-sync の loader）が 1 回だけパースして配れるようにするため。
 */
export function parseSharedBody(body: Uint8Array): GraphiumDocument | null {
  try {
    const doc = JSON.parse(new TextDecoder().decode(body)) as GraphiumDocument;
    return doc && typeof doc === "object" && Array.isArray(doc.pages) ? doc : null;
  } catch {
    return null;
  }
}

/**
 * 共有エントリを語彙索引に入れる形にする。
 * 対象外の type（template / report）は null（＝索引から外す）。
 */
export function sharedEntryToSourceInput(
  entry: SharedEntry,
  body: Uint8Array,
  verified: boolean,
  /**
   * 既にパース済みの本文。投影（shared-projection）と同じ body を使うので、
   * 呼び出し側が 1 回だけパースして両方に配れるようにする。
   * undefined = 未パース（ここで読む）／null = パースしたが壊れていた。
   */
  parsed?: GraphiumDocument | null,
): LexicalSourceInput | null {
  if (!(SHARED_INDEXABLE_TYPES as readonly string[]).includes(entry.type)) return null;

  const base = {
    kind: "shared" as const,
    sourceId: entry.id,
    fingerprint: sharedEntryFingerprint(entry),
  };
  const metaTitle = extraString(entry, "title");

  // 改ざん / 書き換え中で hash が合わないものは中身を索引しない
  if (!verified) return { ...base, title: metaTitle, chunks: [] };

  if (entry.type === "note" || entry.type === "knowledge") {
    const doc = parsed === undefined ? parseSharedBody(body) : parsed;
    if (!doc) return { ...base, title: metaTitle, chunks: [] };
    const title = metaTitle || doc.title || "";
    const chunks =
      entry.type === "knowledge"
        ? extractWikiSections(entry.id, doc).map((s) => ({ chunkId: s.sectionId, text: s.text }))
        : chunkNoteDocument(doc);
    return { ...base, title, chunks };
  }

  if (entry.type === "reference") {
    // URL ブックマークの共有。本体は無く、題名・URL・ドメイン・説明で当てる
    const text = [metaTitle, extraString(entry, "url"), extraString(entry, "domain"), extraString(entry, "description")]
      .filter(Boolean)
      .join("\n");
    return { ...base, title: metaTitle, chunks: chunkPlainText(text) };
  }

  // data-manifest（素材）。実体は blob にあるので、題名・説明・元ファイル名だけ索引する
  const filename = extraString(entry, "original_filename");
  const text = [metaTitle, extraString(entry, "description"), filename].filter(Boolean).join("\n");
  return { ...base, title: metaTitle || filename, chunks: chunkPlainText(text) };
}

// ── 本文由来の派生メタ ──

/**
 * 共有エントリの本文からしか取れない、一覧・検索が使うメタデータ。
 *
 * なぜ本文から拾うか: `extra.noteContexts` を書くようになったのは途中からで、
 * それ以前に共有されたエントリのメタデータにはフォルダが入っていない。本文
 * （共有ノート JSON）には元々 `noteContexts` が入っているので、そこから補える。
 */
export type SharedDerivedMeta = {
  /** 共有した時点のノートのフォルダ（正規化済み。無ければ空配列） */
  noteContexts: string[];
};

/**
 * 読み出した本文から派生メタを取り出す（純関数）。
 * 対象は type=note かつ hash 照合済み（verified）のときだけ。
 * それ以外は null を返し、呼び出し側は何も記録しない
 * （改ざん・書き換え中の本文から一覧の表示値を作らないため）。
 */
export function extractSharedDerivedMeta(
  entry: SharedEntry,
  body: Uint8Array,
  verified: boolean,
): SharedDerivedMeta | null {
  if (entry.type !== "note" || !verified) return null;
  const doc = parseSharedBody(body);
  if (!doc) return null;
  return { noteContexts: normalizeNoteContexts(doc.noteContexts) ?? [] };
}
