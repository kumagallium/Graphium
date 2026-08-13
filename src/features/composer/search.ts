// Composer（Cmd+K）の即時検索ユーティリティ
// fm.noteIndex を入力に、タイトル / ラベル / 作者の単純フィルタを行う純関数。
// BM25・embedding・graph 近傍は別タスク（G-BM25 / G-GRAPHRAG）で hybrid 化する想定。
//
// 画像は別立ての searchMedia() で fm.mediaIndex から探す。ノートの検索軸
// （見出し・ラベル・作者）とは持っている情報が違うので、同じ関数に混ぜず
// 「ノートの結果」「画像の結果」を別セクションとして並べる。

import type { NoteIndexEntry } from "../navigation/index-file";
import type { MediaIndexEntry } from "../asset-browser/media-index";
import { getDisplayLabelName } from "../../i18n";

export type SearchHit = {
  entry: NoteIndexEntry;
  /** UI 上のマッチ強調用に、タイトル中のヒット範囲（複数）。空配列ならハイライトなし */
  titleMatches: { start: number; end: number }[];
  /** どこでヒットしたか（バッジ表示用） */
  reasons: SearchReason[];
  /** ソート用スコア（大きいほど上位） */
  score: number;
};

export type SearchReason = "title-prefix" | "title-contains" | "heading" | "label" | "author";

export type ParsedQuery = {
  /** タイトル / 見出し検索に使うフリーテキスト */
  text: string;
  /** `#xxx` で指定されたラベルクエリ（ロウケース） */
  labelTokens: string[];
  /** `@xxx` で指定された作者クエリ（ロウケース） */
  authorTokens: string[];
};

/** 入力をフリーテキスト・ラベル・作者に分解する */
export function parseQuery(raw: string): ParsedQuery {
  const labelTokens: string[] = [];
  const authorTokens: string[] = [];
  const textParts: string[] = [];
  const tokens = raw.split(/\s+/).filter(Boolean);
  for (const tok of tokens) {
    if (tok.startsWith("#") && tok.length > 1) {
      labelTokens.push(tok.slice(1).toLowerCase());
    } else if (tok.startsWith("@") && tok.length > 1) {
      authorTokens.push(tok.slice(1).toLowerCase());
    } else {
      textParts.push(tok);
    }
  }
  return {
    text: textParts.join(" "),
    labelTokens,
    authorTokens,
  };
}

/** 1 つのラベル（内部キー）が #token に該当するかどうか */
function labelMatchesToken(coreLabel: string, token: string): boolean {
  if (coreLabel.toLowerCase().includes(token)) return true;
  // i18n の表示名でも一致を許容（例: "step" / "ステップ" / "Step"）
  try {
    const display = getDisplayLabelName(coreLabel) ?? "";
    if (display.toLowerCase().includes(token)) return true;
  } catch {
    /* getDisplayLabelName がコア外を渡されたとき */
  }
  return false;
}

function findAllOccurrences(haystack: string, needle: string): { start: number; end: number }[] {
  if (!needle) return [];
  const ranges: { start: number; end: number }[] = [];
  const lowerHay = haystack.toLowerCase();
  const lowerNeedle = needle.toLowerCase();
  let from = 0;
  while (from <= lowerHay.length - lowerNeedle.length) {
    const idx = lowerHay.indexOf(lowerNeedle, from);
    if (idx < 0) break;
    ranges.push({ start: idx, end: idx + lowerNeedle.length });
    from = idx + lowerNeedle.length;
  }
  return ranges;
}

export type SearchOptions = {
  /** 最大ヒット数（既定値 8） */
  limit?: number;
  /** 結果に含める source の種類。既定では human + ai 両方を許可 */
  includeSources?: ("human" | "ai" | "skill")[];
};

/**
 * クエリを noteIndex に対して評価する。
 * クエリが空なら直近更新順 limit 件を返す（履歴ビュー）。
 */
export function searchNotes(
  query: string,
  entries: NoteIndexEntry[] | null | undefined,
  options: SearchOptions = {},
): SearchHit[] {
  const limit = options.limit ?? 8;
  // skill エントリは別ビューが必要なので Phase 1 では既定で除外
  const allowed = new Set(options.includeSources ?? ["human", "ai"]);

  if (!entries || entries.length === 0) return [];

  const filteredEntries = entries.filter((e) => allowed.has(e.source ?? "human"));

  // 空クエリ → 更新日降順で recent N
  if (!query.trim()) {
    return [...filteredEntries]
      .sort((a, b) => (b.modifiedAt > a.modifiedAt ? 1 : -1))
      .slice(0, limit)
      .map((entry) => ({
        entry,
        titleMatches: [],
        reasons: [],
        score: 0,
      }));
  }

  const parsed = parseQuery(query);
  const textLower = parsed.text.toLowerCase();
  const hits: SearchHit[] = [];

  for (const entry of filteredEntries) {
    let score = 0;
    const reasons: SearchReason[] = [];
    const titleLower = entry.title.toLowerCase();

    // ラベルフィルタ — 1 つでもマッチしないトークンがあれば除外。
    // step コンテナを持つノートは procedure ラベル相当として扱う
    // （v6 で procedure ラベルは step ブロックへ変換され labels から消えたため）
    if (parsed.labelTokens.length > 0) {
      const hasSteps = (entry.steps?.length ?? 0) > 0;
      const ok = parsed.labelTokens.every(
        (tok) =>
          entry.labels.some((l) => labelMatchesToken(l.label, tok)) ||
          (hasSteps && labelMatchesToken("procedure", tok)),
      );
      if (!ok) continue;
      score += 30;
      reasons.push("label");
    }

    // 作者フィルタ — author / model のいずれかに含まれればよい
    if (parsed.authorTokens.length > 0) {
      const author = (entry.author ?? "").toLowerCase();
      const model = (entry.model ?? "").toLowerCase();
      const ok = parsed.authorTokens.every(
        (tok) => author.includes(tok) || model.includes(tok),
      );
      if (!ok) continue;
      score += 20;
      reasons.push("author");
    }

    let titleMatches: SearchHit["titleMatches"] = [];

    // フリーテキスト
    if (textLower) {
      const occurrences = findAllOccurrences(entry.title, textLower);
      if (occurrences.length > 0) {
        titleMatches = occurrences;
        if (titleLower.startsWith(textLower)) {
          score += 100;
          reasons.push("title-prefix");
        } else {
          score += 50;
          reasons.push("title-contains");
        }
      } else {
        // 見出し / step タイトルヒット
        const headingHit = [...entry.headings, ...(entry.steps ?? [])].some(
          (h) => h.text.toLowerCase().includes(textLower),
        );
        if (headingHit) {
          score += 25;
          reasons.push("heading");
        } else if (parsed.labelTokens.length === 0 && parsed.authorTokens.length === 0) {
          // フィルタもタイトル/見出しも当たっていない → 落とす
          continue;
        }
      }
    } else if (parsed.labelTokens.length === 0 && parsed.authorTokens.length === 0) {
      // 全条件が空 — 既に上で空クエリ判定済みなので通常到達しない
      continue;
    }

    // 直近更新の微小ボーナス（同点時に新しい順にする程度）
    const ageBoost = entry.modifiedAt ? Math.min(5, Math.max(0, daysAgoBoost(entry.modifiedAt))) : 0;
    score += ageBoost;

    hits.push({ entry, titleMatches, reasons, score });
  }

  hits.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return b.entry.modifiedAt > a.entry.modifiedAt ? 1 : -1;
  });

  return hits.slice(0, limit);
}

// 直近 30 日以内なら 0–5 のスコアを返す（古いほど 0 に近づく）
function daysAgoBoost(modifiedAt: string): number {
  const t = new Date(modifiedAt).getTime();
  if (Number.isNaN(t)) return 0;
  const days = (Date.now() - t) / 86400000;
  if (days < 0) return 5;
  if (days > 30) return 0;
  return 5 * (1 - days / 30);
}

// ── 画像検索 ──

export type MediaSearchReason = "name-prefix" | "name-contains" | "ocr";

/** OCR テキスト中のヒット箇所を、前後の文脈ごと切り出したもの */
export type OcrSnippet = {
  /** 表示用の 1 行テキスト（改行は潰し、切り詰めた側に … を付ける） */
  text: string;
  /** text 内のマッチ範囲（強調用） */
  start: number;
  end: number;
};

export type MediaHit = {
  entry: MediaIndexEntry;
  /** ファイル名中のヒット範囲（複数）。空配列ならハイライトなし */
  nameMatches: { start: number; end: number }[];
  /** OCR テキストでヒットしたときの抜粋。ファイル名だけのヒットなら undefined */
  ocrSnippet?: OcrSnippet;
  reasons: MediaSearchReason[];
  score: number;
};

/** 抜粋でマッチの前後に残す文字数 */
const SNIPPET_BEFORE = 16;
const SNIPPET_AFTER = 48;

/**
 * OCR テキストからヒット箇所の抜粋を組み立てる。
 * 見つからなければ undefined。
 */
export function buildOcrSnippet(ocrText: string, needle: string): OcrSnippet | undefined {
  if (!needle) return undefined;
  // 複数画像の連結や改行を 1 行に潰してから切り出す（そのまま出すと行が崩れる）
  const flat = ocrText.replace(/\s+/g, " ").trim();
  const idx = flat.toLowerCase().indexOf(needle.toLowerCase());
  if (idx < 0) return undefined;

  const from = Math.max(0, idx - SNIPPET_BEFORE);
  const to = Math.min(flat.length, idx + needle.length + SNIPPET_AFTER);
  const head = from > 0 ? "…" : "";
  const tail = to < flat.length ? "…" : "";
  const start = head.length + (idx - from);
  return {
    text: head + flat.slice(from, to) + tail,
    start,
    end: start + needle.length,
  };
}

export type MediaSearchOptions = {
  /** 最大ヒット数（既定値 4）。ノートの結果を押しのけない程度に抑える */
  limit?: number;
};

/**
 * クエリを mediaIndex に対して評価し、画像だけを返す。
 *
 * ノート検索と違い、空クエリでは何も返さない（Cmd+K を開いただけの
 * 「最近のノート」ビューに画像を混ぜない）。`#ラベル` / `@作者` が
 * 指定されているときも、ノートを絞り込む意図なので画像は返さない。
 */
export function searchMedia(
  query: string,
  entries: MediaIndexEntry[] | null | undefined,
  options: MediaSearchOptions = {},
): MediaHit[] {
  const limit = options.limit ?? 4;
  if (!entries || entries.length === 0) return [];
  if (!query.trim()) return [];

  const parsed = parseQuery(query);
  // ノート専用の絞り込みが入っているクエリでは画像を出さない
  if (parsed.labelTokens.length > 0 || parsed.authorTokens.length > 0) return [];
  const textLower = parsed.text.trim().toLowerCase();
  if (!textLower) return [];

  const hits: MediaHit[] = [];

  for (const entry of entries) {
    // OCR を持つのは画像だけ。アーカイブ済みはギャラリー同様に隠す
    if (entry.type !== "image") continue;
    if (entry.archivedAt) continue;

    let score = 0;
    const reasons: MediaSearchReason[] = [];

    const nameMatches = findAllOccurrences(entry.name, textLower);
    if (nameMatches.length > 0) {
      if (entry.name.toLowerCase().startsWith(textLower)) {
        score += 100;
        reasons.push("name-prefix");
      } else {
        score += 50;
        reasons.push("name-contains");
      }
    }

    // 画像の中の文字。ファイル名より弱いが、これが今回の主目的
    const ocrSnippet = entry.ocrText
      ? buildOcrSnippet(entry.ocrText, parsed.text.trim())
      : undefined;
    if (ocrSnippet) {
      score += 40;
      reasons.push("ocr");
    }

    if (reasons.length === 0) continue;

    score += entry.uploadedAt ? daysAgoBoost(entry.uploadedAt) : 0;
    hits.push({ entry, nameMatches, ocrSnippet, reasons, score });
  }

  hits.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return b.entry.uploadedAt > a.entry.uploadedAt ? 1 : -1;
  });

  return hits.slice(0, limit);
}
