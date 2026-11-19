// 「何を索引するか」を noteIndex / mediaIndex から導く純関数群
//
// 索引の望ましいソース一覧（DesiredSource）は、ノート・Wiki は noteIndex（ゴミ箱・
// アーカイブ除外済みのビュー）から、素材は mediaIndex から導く。fingerprint は
// 「変わったら索引し直す」ための印で、ノートは modifiedAt、素材はテキストのハッシュ
// （画像 OCR / URL 抜粋）または uploadedAt（PDF）を使う。
//
// ここは React にも IndexedDB にも依存しない。テストしやすいよう純関数に留める。

import { sanitizeAltText, sanitizeOcrText } from "../../lib/ocr-text";
import type { NoteIndexEntry } from "../navigation/index-file";
import { isWordDocxEntry, type MediaIndexEntry } from "../asset-browser/media-index";
import type { DesiredSource } from "./service";
import type { SharedEntry } from "../../lib/storage/shared";
import { SHARED_INDEXABLE_TYPES, sharedEntryFingerprint } from "../sharing/shared-entry-source";

/** FNV-1a 32bit。テキストの「変わったか」を見るだけなので暗号強度は要らない */
export function fnv1a(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

/** ノート / Wiki の望ましいソース一覧（noteIndex のエントリから） */
export function desiredNoteSources(entries: NoteIndexEntry[]): DesiredSource[] {
  const out: DesiredSource[] = [];
  for (const n of entries) {
    if (n.deletedAt || n.archivedAt) continue;
    // skill エントリは検索対象外（Composer と同じ扱い）
    if (n.source === "skill") continue;
    out.push({
      kind: n.source === "ai" ? "wiki" : "note",
      sourceId: n.noteId,
      // タイトルも印に含める（本文と同じ保存で modifiedAt も動くが、外部変更などで
      // modifiedAt が同じままタイトルだけ違う索引が残るのを避ける）
      fingerprint: `${n.modifiedAt ?? ""}|${n.title ?? ""}`,
    });
  }
  return out;
}

/** 素材テキストの取り方（loader が使う） */
export type AssetTextPlan =
  | { mode: "inline"; text: string; altText?: string }
  | { mode: "pdf" }
  | { mode: "docx" }
  /** 録音・動画の文字起こし（素材のそばの transcript.json）。loader が読む */
  | { mode: "transcript" };

/**
 * 素材の望ましいソース一覧と、各素材のテキストの取り方。
 * - 画像: OCR テキストがあるものだけ（fingerprint = テキストのハッシュ）
 * - URL: Reader の抜粋があるものだけ（同上）
 * - PDF: すべて（fingerprint = uploadedAt。テキストは loader が抽出する）
 * - Word（.docx）: ocrText が無いものすべて（PDF と同じ考え方。旧形式 .doc は mammoth で読めないので除外）
 * アーカイブ済み素材は対象外。
 */
/**
 * 別の読み（macOS の Vision）から作った断片の chunkId の接頭辞。探すためだけに索引へ入れる断片で、
 * AI への文脈（wiki/retriever.ts の passages）からは外す
 */
export const ALT_CHUNK_PREFIX = "alt";

/** 別の読みの断片か（素材の断片だけ。ノートのチャンク id とは区別する） */
export function isAltChunk(kind: string, chunkId: string): boolean {
  return kind === "asset" && isAltChunkId(chunkId);
}

/** chunkId だけで見分ける版（断片の一覧から読むとき。素材の連番 `alt0`, `alt1`, … の形だけ） */
export function isAltChunkId(chunkId: string): boolean {
  return new RegExp(`^${ALT_CHUNK_PREFIX}\\d+$`).test(chunkId);
}

export function desiredAssetSources(
  media: MediaIndexEntry[],
  options: {
    includePdf?: boolean;
    includeDocx?: boolean;
    /**
     * 録音・動画の文字起こしを載せる。渡したときだけ対象にする（文字起こしを読めるのはデスクトップ版だけ）。
     * 返す値は印に混ぜる（文字起こしが終わるたびに値を変えると、その素材だけ読み直される）。
     * null を返した素材は載せない（この起動で読んで、文字起こしがまだ無いと分かっている素材）
     */
    transcriptEpoch?: (fileId: string) => number | null;
  } = {},
): { desired: DesiredSource[]; plans: Map<string, AssetTextPlan>; names: Map<string, string> } {
  const desired: DesiredSource[] = [];
  const plans = new Map<string, AssetTextPlan>();
  const names = new Map<string, string>();
  const includePdf = options.includePdf ?? true;
  const includeDocx = options.includeDocx ?? true;
  for (const m of media) {
    if (m.archivedAt) continue;
    if (m.type === "image" || m.type === "document") {
      // document の ocrText は PowerPoint のスライド文字（pptx.ts + persistOcrTextPatch）。
      // 画像の OCR テキストと同じ場所に書かれるので、同じ経路で索引に載せる
      // 素材索引の JSON から来る値。文字列でなければ無視し、長すぎれば切る
      const primary = sanitizeOcrText(m.ocrText);
      // 検索用の別の読み（macOS の Vision）は、探す経路である全文の索引にだけ足す（画像のみ）
      const alt = m.type === "image" ? sanitizeAltText(m.ocrAltText) : undefined;
      if (!primary && !alt) {
        // Word の本文は ocrText に載らないので、loader が mammoth で抽出する（PDF と同じ経路）
        if (includeDocx && m.type === "document" && isWordDocxEntry(m)) {
          desired.push({ kind: "asset", sourceId: m.fileId, fingerprint: `docx:${m.uploadedAt ?? ""}` });
          plans.set(m.fileId, { mode: "docx" });
          names.set(m.fileId, m.name);
        }
        continue;
      }
      // 別の読みがあるときだけ印に混ぜる（無いときは従来と同じ印のまま＝既存の索引を読み直さない）
      desired.push({ kind: "asset", sourceId: m.fileId, fingerprint: alt ? `ocr:${fnv1a(primary ?? "")}:alt:${fnv1a(alt)}` : `ocr:${fnv1a(primary ?? "")}` });
      plans.set(m.fileId, alt ? { mode: "inline", text: primary ?? "", altText: alt } : { mode: "inline", text: primary ?? "" });
      names.set(m.fileId, m.name);
    } else if (m.type === "url") {
      // 抜粋に加えて OGP の説明文も索引に含める（抜粋が無くても説明文だけで当たる）
      const parts = [m.urlMeta?.excerpt?.trim(), m.urlMeta?.description?.trim()].filter((s): s is string => Boolean(s));
      if (parts.length === 0) continue;
      const text = parts.join("\n\n");
      desired.push({ kind: "asset", sourceId: m.fileId, fingerprint: `url:${fnv1a(text)}` });
      plans.set(m.fileId, { mode: "inline", text });
      names.set(m.fileId, m.name);
    } else if (m.type === "pdf" && includePdf) {
      desired.push({ kind: "asset", sourceId: m.fileId, fingerprint: `pdf:${m.uploadedAt ?? ""}` });
      plans.set(m.fileId, { mode: "pdf" });
      names.set(m.fileId, m.name);
    } else if ((m.type === "audio" || m.type === "video") && options.transcriptEpoch) {
      // 文字起こしがあるかどうかは素材の索引に無いので、loader が読んでみて決める
      const epoch = options.transcriptEpoch(m.fileId);
      if (epoch === null) continue;
      desired.push({ kind: "asset", sourceId: m.fileId, fingerprint: `transcript:${m.uploadedAt ?? ""}:${epoch}` });
      plans.set(m.fileId, { mode: "transcript" });
      names.set(m.fileId, m.name);
    }
  }
  return { desired, plans, names };
}

/**
 * 共有ライブラリの望ましいソース一覧。
 *
 * 共有エントリは fork せず、共有ルートに置いたまま索引する。印は hash なので、
 * 誰かが上書きすれば（= hash が変われば）自動で索引し直される。
 * template / report は共有導線が無い（＝ライブラリに出ない）ので対象外。
 * tombstone はローダー側で除外済みなので、ここには active なものしか来ない。
 */
export function desiredSharedSources(entries: SharedEntry[]): DesiredSource[] {
  const out: DesiredSource[] = [];
  for (const e of entries) {
    if (!(SHARED_INDEXABLE_TYPES as readonly string[]).includes(e.type)) continue;
    out.push({ kind: "shared", sourceId: e.id, fingerprint: sharedEntryFingerprint(e) });
  }
  return out;
}
