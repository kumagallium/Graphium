// Composer（Cmd+K）の即時検索ユーティリティ
// fm.noteIndex を入力に、タイトル / ラベル / 作者の単純フィルタを行う純関数。
// 本文（BM25 語彙インデックス）のヒットは呼び出し側が `bodyHits` として注入する
// （lexical-search の同期検索結果を noteId → ヒットに畳んだもの）。純関数のまま
// 保つために、ここからインデックスを直接引くことはしない。graph 近傍は別タスク（G-GRAPHRAG）。
//
// 素材は別立ての searchMedia() で fm.mediaIndex から探す。ノートの検索軸
// （見出し・ラベル・作者）とは持っている情報が違うので、同じ関数に混ぜず
// 「ノートの結果」「素材の結果」を別セクションとして並べる。素材のテキスト
// （画像 OCR / URL 抜粋 / PDF）のヒットも同じく `assetHits` として注入する。
//
// 共有ライブラリ（fork していない共有ルート上のエントリ）も 3 本目の軸として
// searchShared() で別立てにする。ラベルも見出しも持たず、代わりに作者と種別が
// 一級なので、ノート・素材のどちらにも混ぜない。

import type { NoteIndexEntry } from "../navigation/index-file";
import type { MediaIndexEntry } from "../asset-browser/media-index";
import type { SharedEntry } from "../../lib/storage/shared";
// 語彙索引に入れている type と揃える（片方だけ増えると「出るのに本文で当たらない」
// / 「索引にあるのに出ない」というズレになるので、定義は 1 か所から借りる）
import { SHARED_INDEXABLE_TYPES } from "../sharing/shared-entry-source";
import { getDisplayLabelName } from "../../i18n";

export type SearchHit = {
  entry: NoteIndexEntry;
  /** UI 上のマッチ強調用に、タイトル中のヒット範囲（複数）。空配列ならハイライトなし */
  titleMatches: { start: number; end: number }[];
  /** どこでヒットしたか（バッジ表示用） */
  reasons: SearchReason[];
  /** ソート用スコア（大きいほど上位） */
  score: number;
  /** 本文（語彙インデックス）でヒットしたときの抜粋。無ければ undefined */
  bodySnippet?: TextSnippet;
};

export type SearchReason = "title-prefix" | "title-contains" | "heading" | "label" | "author" | "body";

/** 抜粋（複数範囲を強調できる） */
export type TextSnippet = {
  /** 表示用の 1 行テキスト（改行は潰し、切り詰めた側に … を付ける） */
  text: string;
  /** text 内の強調範囲（複数） */
  ranges: { start: number; end: number }[];
};

/** 語彙インデックス由来のヒット（呼び出し側が noteId / fileId ごとに 1 件へ畳んで渡す） */
export type TextHit = {
  /** BM25 スコア（相対値）。同じクエリ内で正規化して加点に使う */
  score: number;
  snippet: TextSnippet;
};

/** 本文ヒットの加点: 見出し一致（25）より下、ラベル/作者フィルタ（30/20）とは独立 */
const BODY_BASE_SCORE = 12;
/** 本文ヒットの相対スコアによる上乗せの最大値 */
const BODY_RELATIVE_SCORE_MAX = 10;

/** 相対スコア（0..max）— 同クエリ内の最大値で正規化 */
function relativeBoost(score: number, maxScore: number, max: number): number {
  if (!(maxScore > 0)) return 0;
  return Math.max(0, Math.min(max, (score / maxScore) * max));
}

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
  /** 本文（語彙インデックス）のヒット。noteId → ヒット。無ければ本文では当てない */
  bodyHits?: ReadonlyMap<string, TextHit>;
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
  const bodyHits = options.bodyHits;
  let bodyMax = 0;
  if (bodyHits) for (const h of bodyHits.values()) bodyMax = Math.max(bodyMax, h.score);

  for (const entry of filteredEntries) {
    let score = 0;
    const reasons: SearchReason[] = [];
    const titleLower = entry.title.toLowerCase();
    const bodyHit = bodyHits?.get(entry.noteId);

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
    let bodySnippet: TextSnippet | undefined;

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
        } else if (!bodyHit && parsed.labelTokens.length === 0 && parsed.authorTokens.length === 0) {
          // フィルタもタイトル/見出し/本文も当たっていない → 落とす
          continue;
        }
      }
      // 本文（語彙インデックス）ヒット。タイトル・見出しに当たっていても抜粋は添える
      if (bodyHit) {
        score += BODY_BASE_SCORE + relativeBoost(bodyHit.score, bodyMax, BODY_RELATIVE_SCORE_MAX);
        reasons.push("body");
        bodySnippet = bodyHit.snippet;
      }
    } else if (parsed.labelTokens.length === 0 && parsed.authorTokens.length === 0) {
      // 全条件が空 — 既に上で空クエリ判定済みなので通常到達しない
      continue;
    }

    // 直近更新の微小ボーナス（同点時に新しい順にする程度）
    const ageBoost = entry.modifiedAt ? Math.min(5, Math.max(0, daysAgoBoost(entry.modifiedAt))) : 0;
    score += ageBoost;

    hits.push({ entry, titleMatches, reasons, score, ...(bodySnippet ? { bodySnippet } : {}) });
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

export type MediaSearchReason = "name-prefix" | "name-contains" | "ocr" | "text";

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
  /** 語彙インデックス（OCR / URL 抜粋 / PDF）でヒットしたときの抜粋。ocrSnippet が無いときの表示に使う */
  textSnippet?: TextSnippet;
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
  /** 素材テキスト（語彙インデックス）のヒット。fileId → ヒット。無ければテキストでは当てない */
  assetHits?: ReadonlyMap<string, TextHit>;
};

/** 素材テキストヒットの加点。OCR の句そのままの部分一致（40）よりは弱く、名前一致（50/100）よりも弱い */
const ASSET_TEXT_BASE_SCORE = 25;
const ASSET_TEXT_RELATIVE_SCORE_MAX = 10;

/** Cmd+K の素材検索で対象にする種類。memo は transient、video/audio は名前でしか当たらないので外す */
const SEARCHABLE_MEDIA_TYPES = new Set<MediaIndexEntry["type"]>(["image", "pdf", "url", "document"]);

/**
 * クエリを mediaIndex に対して評価し、素材を返す。
 * 画像はファイル名と OCR テキスト、PDF / URL / 文書はファイル名と索引済みテキスト
 * （`assetHits`）で当たる。
 *
 * ノート検索と違い、空クエリでは何も返さない（Cmd+K を開いただけの
 * 「最近のノート」ビューに素材を混ぜない）。`#ラベル` / `@作者` が
 * 指定されているときも、ノートを絞り込む意図なので素材は返さない。
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
  // ノート専用の絞り込みが入っているクエリでは素材を出さない
  if (parsed.labelTokens.length > 0 || parsed.authorTokens.length > 0) return [];
  const textLower = parsed.text.trim().toLowerCase();
  if (!textLower) return [];

  const assetHits = options.assetHits;
  let assetMax = 0;
  if (assetHits) for (const h of assetHits.values()) assetMax = Math.max(assetMax, h.score);

  const hits: MediaHit[] = [];

  for (const entry of entries) {
    if (!SEARCHABLE_MEDIA_TYPES.has(entry.type)) continue;
    // アーカイブ済みはギャラリー同様に隠す
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

    // 画像の中の文字（部分一致）。ファイル名より弱いが、これが画像検索の主目的
    const ocrSnippet = entry.type === "image" && entry.ocrText
      ? buildOcrSnippet(entry.ocrText, parsed.text.trim())
      : undefined;
    if (ocrSnippet) {
      score += 40;
      reasons.push("ocr");
    }

    // 語彙インデックスのテキストヒット（OCR の語一致 / URL 抜粋 / PDF 本文）
    const textHit = assetHits?.get(entry.fileId);
    let textSnippet: TextSnippet | undefined;
    if (textHit) {
      score += ASSET_TEXT_BASE_SCORE + relativeBoost(textHit.score, assetMax, ASSET_TEXT_RELATIVE_SCORE_MAX);
      reasons.push("text");
      textSnippet = textHit.snippet;
    }

    if (reasons.length === 0) continue;

    score += entry.uploadedAt ? daysAgoBoost(entry.uploadedAt) : 0;
    hits.push({ entry, nameMatches, ocrSnippet, ...(textSnippet ? { textSnippet } : {}), reasons, score });
  }

  hits.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return b.entry.uploadedAt > a.entry.uploadedAt ? 1 : -1;
  });

  return hits.slice(0, limit);
}

// ── 共有ライブラリ検索 ──

export type SharedSearchReason = "title-prefix" | "title-contains" | "author" | "body";

export type SharedHit = {
  entry: SharedEntry;
  /** 題名中のヒット範囲（複数）。空配列ならハイライトなし */
  titleMatches: { start: number; end: number }[];
  reasons: SharedSearchReason[];
  score: number;
  /** 本文（語彙索引の shared レーン）で当たったときの抜粋 */
  bodySnippet?: TextSnippet;
};

export type SharedSearchOptions = {
  /** 最大ヒット数（既定値 4）。素材と同じくノートの結果を押しのけない程度に抑える */
  limit?: number;
  /** 共有エントリの本文ヒット。entry.id → ヒット。無ければ題名・作者だけで当てる */
  sharedHits?: ReadonlyMap<string, TextHit>;
};

/**
 * 共有エントリの表示・検索用の題名。
 * 共有フォーマットでは題名は本体ではなく `extra` に入る（素材は元ファイル名しか無いこともある）。
 * 語彙索引側（sharedEntryToSourceInput）の title の決め方と揃えてある。
 */
export function sharedEntryTitle(entry: SharedEntry): string {
  const extra = entry.extra as Record<string, unknown> | undefined;
  const title = typeof extra?.title === "string" ? extra.title.trim() : "";
  if (title) return title;
  const filename = typeof extra?.original_filename === "string" ? extra.original_filename.trim() : "";
  return filename;
}

/**
 * クエリを共有ライブラリのエントリ一覧に対して評価する。
 *
 * 題名・作者は共有エントリのメタデータで当て、本文は語彙索引の shared レーンの
 * ヒット（`sharedHits`）を注入してもらう。スコアの重みは searchNotes の同名 reason と同じ。
 *
 * 素材検索と同じく、空クエリでは何も返さない（⌘K を開いただけの「最近のノート」
 * ビューに他人の共有物を混ぜない）。`#ラベル` は手元のノートを絞る記法で、共有
 * エントリはラベルを持たないので、そのクエリでも返さない。
 */
export function searchShared(
  query: string,
  entries: SharedEntry[] | null | undefined,
  options: SharedSearchOptions = {},
): SharedHit[] {
  const limit = options.limit ?? 4;
  if (!entries || entries.length === 0) return [];
  if (!query.trim()) return [];

  const parsed = parseQuery(query);
  if (parsed.labelTokens.length > 0) return [];
  const textLower = parsed.text.trim().toLowerCase();
  if (!textLower && parsed.authorTokens.length === 0) return [];

  const sharedHits = options.sharedHits;
  let bodyMax = 0;
  if (sharedHits) for (const h of sharedHits.values()) bodyMax = Math.max(bodyMax, h.score);

  const hits: SharedHit[] = [];

  for (const entry of entries) {
    // 索引に入れていない type（template / report）は本文で当たらないので一覧にも出さない
    if (!(SHARED_INDEXABLE_TYPES as readonly string[]).includes(entry.type)) continue;
    // tombstone は provider の list に載らないはずだが、DI 経由の一覧も受けるので念のため弾く
    if (entry.status === "unshared") continue;

    let score = 0;
    const reasons: SharedSearchReason[] = [];

    // @作者フィルタ — 表示名 / email のどちらかに含まれればよい（searchNotes と同じ重み）
    if (parsed.authorTokens.length > 0) {
      const name = (entry.author?.name ?? "").toLowerCase();
      const email = (entry.author?.email ?? "").toLowerCase();
      const ok = parsed.authorTokens.every((tok) => name.includes(tok) || email.includes(tok));
      if (!ok) continue;
      score += 20;
      reasons.push("author");
    }

    const title = sharedEntryTitle(entry);
    const bodyHit = sharedHits?.get(entry.id);
    let titleMatches: SharedHit["titleMatches"] = [];
    let bodySnippet: TextSnippet | undefined;

    if (textLower) {
      const occurrences = findAllOccurrences(title, textLower);
      if (occurrences.length > 0) {
        titleMatches = occurrences;
        if (title.toLowerCase().startsWith(textLower)) {
          score += 100;
          reasons.push("title-prefix");
        } else {
          score += 50;
          reasons.push("title-contains");
        }
      } else if (!bodyHit && parsed.authorTokens.length === 0) {
        // 題名にも本文にも当たらず、作者フィルタも無い → 落とす
        continue;
      }
      // 本文ヒットは題名に当たっていても抜粋として添える（ノート行と同じ扱い）
      if (bodyHit) {
        score += BODY_BASE_SCORE + relativeBoost(bodyHit.score, bodyMax, BODY_RELATIVE_SCORE_MAX);
        reasons.push("body");
        bodySnippet = bodyHit.snippet;
      }
    }

    if (reasons.length === 0) continue;

    score += entry.updated_at ? daysAgoBoost(entry.updated_at) : 0;
    hits.push({ entry, titleMatches, reasons, score, ...(bodySnippet ? { bodySnippet } : {}) });
  }

  hits.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return (b.entry.updated_at ?? "") > (a.entry.updated_at ?? "") ? 1 : -1;
  });

  return hits.slice(0, limit);
}
