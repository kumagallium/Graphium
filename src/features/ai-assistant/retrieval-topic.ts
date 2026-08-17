// 横断検索（Wiki Retriever）に渡す検索クエリを、ノート本文から組み立てる。
//
// 背景:
//   ページ全体チャットでは、AI に渡すメッセージにノート本文が丸ごと同梱される。
//   これをそのまま検索クエリにすると (a) 数値テーブルや素材全文で embedding が
//   希釈されて質問と無関係な Wiki を拾い、(b) 埋め込みモデルの入力上限を超えて
//   400 になる（XRD テーブル入りノートで 28,836 トークン → e5-large の上限 512 を超過）。
//   逆に質問文だけにすると、「この内容全体について質問があります」のような質問では
//   ノートの主題（XRD / 焼結条件 …）が検索キーから消えてしまう。
//
// 方針:
//   ノート本文から「主題を表す部分」だけを拾い、「データ本体」は落とす。
//
//   残す                                     落とす
//   ─────────────────────────────────────    ────────────────────────────────
//   タイトル / 見出し（# 〜 ######）           テーブルの数値行（ヘッダー行と区切り行は残さない）
//   通常の段落（先頭から予算まで）             コードブロックの中身（fence ごと）
//   テーブルのヘッダー行（列名 = 主題）        画像 / 埋め込み（![...](...)）
//   箇条書きの本文                            数式ブロック（$$ 〜 $$）
//                                            素材の抽出全文（呼び出し側で同梱前に切る）
//
//   予算は文字数で持ち、見出し → 段落 の順に優先して詰める。見出しはノートの骨格
//   なので全部残し、段落は先頭から入るだけ入れる。全体は MAX_TOPIC_CHARS で切る。
//
// 引用チャットの buildQuotedRetrievalQuery（引用 + 質問）と対称の役割で、
// こちらは「本文の主題 + 質問」を返す。

/** 主題テキストの上限文字数。埋め込みクエリ全体は retriever 側でも切られるので、ここは意味の切れ目で先に絞る */
export const MAX_TOPIC_CHARS = 600;
/** 段落 1 本あたりの上限（長い段落の冒頭だけ拾う） */
const MAX_PARAGRAPH_CHARS = 200;
/** ヘッダー行として採用するテーブル行の上限（列名が異常に多い表は主題として弱い） */
const MAX_HEADER_CELLS = 12;

const HEADING_RE = /^\s{0,3}(#{1,6})\s+(.+?)\s*#*\s*$/;
const FENCE_RE = /^\s{0,3}(```|~~~)/;
const MATH_FENCE_RE = /^\s*\$\$\s*$/;
const TABLE_ROW_RE = /^\s*\|.*\|\s*$/;
const TABLE_SEPARATOR_RE = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/;
const IMAGE_RE = /^\s*!\[[^\]]*\]\([^)]*\)\s*$/;
const LIST_MARKER_RE = /^\s*(?:[-*+]|\d+[.)])\s+/;
const BLOCKQUOTE_MARKER_RE = /^\s*>\s?/;

/** テーブル行をセル配列に分ける（先頭・末尾のパイプは落とす） */
function splitTableCells(line: string): string[] {
  const inner = line.trim().replace(/^\|/, "").replace(/\|$/, "");
  return inner.split("|").map((c) => c.trim());
}

/** ヘッダー行らしさ: 空でないセルがあり、数値だけのセルが半数未満 */
function looksLikeHeaderRow(cells: string[]): boolean {
  const nonEmpty = cells.filter((c) => c !== "");
  if (nonEmpty.length === 0 || nonEmpty.length > MAX_HEADER_CELLS) return false;
  const numeric = nonEmpty.filter((c) => /^[-+]?\d[\d,.]*(e[-+]?\d+)?%?$/i.test(c)).length;
  return numeric * 2 < nonEmpty.length;
}

/**
 * Markdown 本文から主題テキストを抽出する。
 * 見出し・段落・テーブルのヘッダー行を残し、テーブル数値行・コード・数式・画像を落とす。
 */
export function extractTopicText(markdown: string, maxChars = MAX_TOPIC_CHARS): string {
  const lines = markdown.split(/\r?\n/);
  const headings: string[] = [];
  const paragraphs: string[] = [];
  const tableHeaders: string[] = [];

  let inFence = false;
  let fenceMarker = "";
  let inMath = false;
  // テーブルの中を歩いているとき: 直前の行がヘッダー候補か
  let pendingHeader: string[] | null = null;
  let inTable = false;
  let paragraphBuf: string[] = [];

  const flushParagraph = () => {
    if (paragraphBuf.length === 0) return;
    const text = paragraphBuf.join(" ").replace(/\s+/g, " ").trim();
    paragraphBuf = [];
    if (!text) return;
    paragraphs.push(text.length > MAX_PARAGRAPH_CHARS ? text.slice(0, MAX_PARAGRAPH_CHARS) : text);
  };

  for (const raw of lines) {
    const line = raw.replace(/\t/g, "    ");

    // コードフェンス: 開始〜終了まで丸ごと捨てる
    if (inFence) {
      if (line.trim().startsWith(fenceMarker)) inFence = false;
      continue;
    }
    const fence = line.match(FENCE_RE);
    if (fence) {
      flushParagraph();
      inFence = true;
      fenceMarker = fence[1];
      continue;
    }

    // 数式ブロック（$$ … $$）も捨てる
    if (inMath) {
      if (MATH_FENCE_RE.test(line)) inMath = false;
      continue;
    }
    if (MATH_FENCE_RE.test(line)) {
      flushParagraph();
      inMath = true;
      continue;
    }

    // テーブル: ヘッダー行（区切り行の直前）だけ拾い、数値行は捨てる
    if (TABLE_ROW_RE.test(line) || TABLE_SEPARATOR_RE.test(line)) {
      flushParagraph();
      if (TABLE_SEPARATOR_RE.test(line)) {
        if (pendingHeader && looksLikeHeaderRow(pendingHeader)) {
          tableHeaders.push(pendingHeader.filter((c) => c !== "").join(" / "));
        }
        pendingHeader = null;
        inTable = true;
        continue;
      }
      const cells = splitTableCells(line);
      if (!inTable) {
        // 区切り行がまだ来ていない → ヘッダー候補として保持
        pendingHeader = cells;
      } else if (pendingHeader === null && !looksLikeHeaderRow(cells)) {
        // データ行 → 捨てる
      } else if (pendingHeader === null && looksLikeHeaderRow(cells)) {
        // 区切り行を持たない表（BlockNote が空ヘッダー行を吐くことがある）で、
        // 先頭に文字列の行が来た場合はそれをヘッダーとして採用する
        tableHeaders.push(cells.filter((c) => c !== "").join(" / "));
        pendingHeader = [];
      }
      continue;
    }
    // テーブルを抜けた
    if (inTable || pendingHeader) {
      inTable = false;
      pendingHeader = null;
    }

    // 画像・埋め込みは捨てる
    if (IMAGE_RE.test(line)) {
      flushParagraph();
      continue;
    }

    // 見出し
    const h = line.match(HEADING_RE);
    if (h) {
      flushParagraph();
      const text = h[2].trim();
      if (text) headings.push(text);
      continue;
    }

    // 空行 = 段落の区切り
    if (line.trim() === "") {
      flushParagraph();
      continue;
    }

    // 箇条書き・引用のマーカーは落として本文として扱う
    const stripped = line.replace(LIST_MARKER_RE, "").replace(BLOCKQUOTE_MARKER_RE, "").trim();
    if (stripped) paragraphBuf.push(stripped);
  }
  flushParagraph();

  // 見出し → テーブルヘッダー → 段落 の順に予算に詰める。
  // 見出しとヘッダーはノートの骨格・主題語なので優先し、段落は入るだけ入れる。
  const parts: string[] = [];
  let used = 0;
  const push = (s: string): boolean => {
    const t = s.trim();
    if (!t) return true;
    // 少なくとも 1 本は入れる（最初の要素が上限を超えても先頭を切って入れる）
    if (used + t.length + 1 > maxChars) {
      if (parts.length === 0) {
        parts.push(t.slice(0, maxChars));
        used = maxChars;
      }
      return false;
    }
    parts.push(t);
    used += t.length + 1;
    return true;
  };

  for (const s of headings) if (!push(s)) break;
  for (const s of tableHeaders) if (!push(s)) break;
  for (const s of paragraphs) if (!push(s)) break;

  return parts.join("\n");
}

/**
 * ページ全体チャットの横断検索クエリ: 「タイトル + 本文の主題 + 質問」。
 *
 * 引用チャットの buildQuotedRetrievalQuery（引用 + 質問）と対称。
 * タイトルは本文の外にあるメタデータなので明示的に受け取る。
 */
export function buildPageRetrievalQuery(input: {
  title: string;
  pageMarkdown: string;
  question: string;
}): string {
  const topic = extractTopicText(input.pageMarkdown);
  return [input.title.trim(), topic, input.question.trim()].filter(Boolean).join("\n\n");
}
