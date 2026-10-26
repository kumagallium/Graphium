// 素材（PDF・Word・URL）とメモを「知見の取り込み」に渡す入力の組み立て（純関数）。
// アプリの ingestFromPdf / ingestFromDocx / ingestFromUrl（wiki-service.ts）と、MCP の
// start_claim_task（src/mcp/claim-tools.ts）の両方が使う。ここを 1 か所にして、
// タイトルの決め方・出力言語ヒント・本文の丸め・短すぎる本文の扱いがずれないようにする。
//
// ブラウザ専用の pdfjs（react-pdf）に依存しないので Node（MCP）からも import できる。

import { isBlankText, visibleTextLength } from "../../lib/blank-text";

// 1 回の呼び出しで全文を LLM に渡す経路（route-topics を経ない旧来の ingest 等）だけが使う
// 上限。窓分割で読む新経路（トピック段）はこの上限を経由せず全文を読む。
// 日本語混じりで概ね 60-90 ページぶん。それ以上はコスト・レイテンシが急増するので打ち切る。
export const SINGLE_CALL_MAX_CHARS = 80_000;

// 打ち切り注記の先頭（出典照合の quote-match.ts が「出現位置がこの注記内か」を
// 判定するのに使う。バンドル境界の事情で quote-match.ts 側にも複製してある —
// 値を変えるときは両方直すこと）。
export const PDF_TRUNCATION_MARKER = "\n\n[... truncated: read ";

/**
 * 「1 回の呼び出しで全文を LLM に渡す」経路のためだけに使う上限適用。
 * 窓分割で読む経路（トピック段）は使わない — extractPdfText の全文をそのまま渡す。
 * ページ数が分かれば「何ページ中何ページ相当まで」、分からなければ文字数で打ち切り注記を付ける。
 */
export function capForSingleCall(text: string, pageCount?: number): string {
  if (text.length <= SINGLE_CALL_MAX_CHARS) return text;
  const capped = text.slice(0, SINGLE_CALL_MAX_CHARS);
  if (pageCount && pageCount > 0) {
    // 文字数比から「概ね何ページぶん読めたか」を見積もる（正確なページ境界は分からないため概算）
    const estimatedPagesRead = Math.max(1, Math.round((SINGLE_CALL_MAX_CHARS / text.length) * pageCount));
    return `${capped}${PDF_TRUNCATION_MARKER}${estimatedPagesRead} of ${pageCount} pages]`;
  }
  return `${capped}${PDF_TRUNCATION_MARKER}${SINGLE_CALL_MAX_CHARS} of ${text.length} characters]`;
}

/** 素材の本文として受け付ける「見える文字」の下限 */
export const MIN_VISIBLE_SOURCE_CHARS = 50;

/** 抽出テキスト冒頭に出力言語ヒントを再掲する（システムプロンプト末尾の指示が長文中で軽視されるケースへの近接リマインダ） */
export function outputLanguageHint(language: string): string {
  return language === "ja"
    ? "[出力言語: 日本語で書いてください。Summary も Claim もすべて日本語にしてください]"
    : `[Output language: ${language}]`;
}

export type SourceIngestInput =
  | { ok: true; noteTitle: string; noteContent: string; sourceText: string }
  | { ok: false; reason: "no_text" };

/**
 * PDF の抽出結果から取り込みの入力を作る。
 * 50 文字の下限は不可視文字を除いた「見える文字」の長さで数える。
 * 本文に CJK 文字が一定比率含まれていれば、PDF メタデータ Title が ASCII のみ
 * （LaTeX 等が埋める英語タイトル）の場合は捨ててファイル名を使う（LLM の出力言語に引きずられるため）。
 */
export function buildPdfIngestInput(
  extracted: { text: string; title: string; pageCount: number },
  fileName: string,
  language: string,
): SourceIngestInput {
  if (!extracted.text || visibleTextLength(extracted.text) < MIN_VISIBLE_SOURCE_CHARS) {
    return { ok: false, reason: "no_text" };
  }
  const bodyHasCJK = /[぀-ヿ一-鿿]/.test(extracted.text);
  const titleIsAsciiOnly = extracted.title.length > 0 && /^[\x00-\x7F]+$/.test(extracted.title);
  const fallbackTitle = fileName.replace(/\.pdf$/i, "");
  const noteTitle = bodyHasCJK && titleIsAsciiOnly ? fallbackTitle : extracted.title || fallbackTitle;
  // /api/wiki/ingest は 1 回の呼び出しで全文を渡す経路なので上限を掛ける。
  // sourceText は全文のまま（トピック段は窓に分けて読むため上限を経由しない）。
  const noteContent = `${outputLanguageHint(language)}\n\n${capForSingleCall(extracted.text, extracted.pageCount)}`;
  return { ok: true, noteTitle, noteContent, sourceText: extracted.text };
}

/** Word（.docx）の抽出結果（extractDocxText の value）から取り込みの入力を作る */
export function buildDocxIngestInput(rawText: string, fileName: string, language: string): SourceIngestInput {
  const text = (rawText ?? "").trim();
  if (!text || visibleTextLength(text) < MIN_VISIBLE_SOURCE_CHARS) return { ok: false, reason: "no_text" };
  const noteTitle = fileName.replace(/\.(docx|doc)$/i, "");
  return { ok: true, noteTitle, noteContent: `${outputLanguageHint(language)}\n\n${text}`, sourceText: text };
}

/**
 * URL の取得結果から取り込みの入力を作る。送る本文（説明文＋本文）が空か不可視文字だけのときは blank。
 * description は trim() してから使う。空白だけの description だと `> ${description}` が "> " になり、
 * 本文が実質空でも空判定をすり抜けるため、「あるか」自体も isBlankText で判定する。
 */
export function buildUrlIngestInput(
  page: { title?: string; description?: string; text: string },
  url: string,
): { noteTitle: string; noteContent: string; blank: boolean } {
  const description = (page.description ?? "").trim();
  const hasDescription = !isBlankText(description);
  const noteContent = [hasDescription && `> ${description}`, "", page.text].filter(Boolean).join("\n");
  return { noteTitle: page.title || url, noteContent, blank: isBlankText(noteContent) };
}
