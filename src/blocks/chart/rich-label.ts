// 軸名・凡例の軽量リッチテキスト記法（斜体・上付き・下付き）
//
// 論文の図では `Cp`（比熱）の C は斜体、p は下付き、`cm^3` の 3 は上付き、
// `H2O` の 2 は下付き……という組版が当たり前で、プレーンテキストの軸名では
// 「それらしく見えない」。ECharts の rich text 機能（`{tag|文字}`）に載せれば
// 表現できるので、入力欄には軽い記法で書かせ、ここで rich へ変換する。
//
// 記法（中括弧を必須にしてある）:
//   *斜体*      → 斜体
//   ^{上付き}    → 上付き
//   _{下付き}    → 下付き
//   \* \^ \_ \\ → その文字そのもの
//
// 上下付きで中括弧を必須にしたのは、既存ノートの図を変えないため。凡例は
// ユーザーが名前を付けていなければ列名がそのまま出るので、`temp_c` や
// `x_1` のような列名を勝手に下付きにすると、過去のノートの見た目が黙って
// 変わってしまう。`_{...}` の形は偶然一致しない。
//
// 記法が 1 つも無いテキストは変換せず、素の文字列のまま扱う（従来どおり）。

/** 変換後のセグメント種別。ECharts の rich に定義するタグ名と一対一 */
export type RichSegmentStyle = "plain" | "it" | "sup" | "sub" | "isup" | "isub";

export interface RichSegment {
  text: string;
  style: RichSegmentStyle;
}

/**
 * 軽量記法をセグメントに分解する。
 *
 * 斜体は領域（`*...*`）、上下付きはその場の囲み（`^{...}`）なので、
 * 斜体の中に置かれた上下付きは isup / isub という合成スタイルになる。
 */
export function parseRichSegments(input: string): RichSegment[] {
  const segments: RichSegment[] = [];
  let buffer = "";
  let italic = false;

  // 直前までの平文を、その時点の斜体状態で確定する
  const flush = () => {
    if (buffer === "") return;
    segments.push({ text: buffer, style: italic ? "it" : "plain" });
    buffer = "";
  };

  for (let i = 0; i < input.length; i++) {
    const ch = input[i];

    // エスケープ: 次の 1 文字をそのまま平文として扱う
    if (ch === "\\" && i + 1 < input.length) {
      buffer += input[i + 1];
      i++;
      continue;
    }

    if (ch === "*") {
      flush();
      italic = !italic;
      continue;
    }

    if (ch === "^" || ch === "_") {
      const inner = readBraced(input, i + 1);
      // `{` が続かない、または閉じていない場合は記法として扱わない。
      // `x_1` のような既存の列名を巻き込まないための分岐
      if (inner === null) {
        buffer += ch;
        continue;
      }
      flush();
      const sup = ch === "^";
      segments.push({
        text: inner.text,
        style: italic ? (sup ? "isup" : "isub") : sup ? "sup" : "sub",
      });
      i = inner.end;
      continue;
    }

    buffer += ch;
  }
  flush();

  return segments;
}

/**
 * `start` が `{` なら、対応する `}` までの中身を返す。
 * 中身のエスケープ（`\}`）は解除する。閉じていなければ null。
 */
function readBraced(input: string, start: number): { text: string; end: number } | null {
  if (input[start] !== "{") return null;
  let text = "";
  for (let i = start + 1; i < input.length; i++) {
    const ch = input[i];
    if (ch === "\\" && i + 1 < input.length) {
      text += input[i + 1];
      i++;
      continue;
    }
    if (ch === "}") return { text, end: i };
    text += ch;
  }
  return null;
}

/** 記法が使われているか（使われていなければ rich に載せない） */
export function hasRichMarkup(input: string): boolean {
  return parseRichSegments(input).some((s) => s.style !== "plain");
}

/**
 * 記法を落とした素のテキスト。ツールチップ・Markdown 書き出し・
 * ECharts の系列名（内部キー）に使う。
 */
export function stripRichMarkup(input: string): string {
  return parseRichSegments(input)
    .map((s) => s.text)
    .join("");
}

/**
 * ECharts の rich text 文字列にする。
 *
 * rich が有効なとき ECharts は `{` `}` をタグ記法として読むので、中身に
 * 残っているリテラルの中括弧は落とす（エスケープする手段が ECharts 側に無い）。
 */
export function toEchartsRichText(input: string): string {
  return parseRichSegments(input)
    .map(({ text, style }) => {
      const safe = text.replace(/[{}]/g, "");
      return style === "plain" ? safe : `{${style}|${safe}}`;
    })
    .join("");
}

/** 上下付きの文字サイズ比。論文の組版に寄せた値 */
const SMALL_RATIO = 0.68;

/**
 * ECharts の `rich` 定義。基準サイズごとに作る（軸名と凡例で字が違うため）。
 *
 * 上下付きは ECharts に真のベースラインシフトが無いので、字を小さくして
 * 行内の上端・下端に寄せることで近似する。
 */
export function richStyleDefs(baseFontSize: number): Record<string, Record<string, unknown>> {
  const small = Math.round(baseFontSize * SMALL_RATIO);
  return {
    it: { fontStyle: "italic" },
    sup: { fontSize: small, verticalAlign: "top" },
    sub: { fontSize: small, verticalAlign: "bottom" },
    isup: { fontSize: small, verticalAlign: "top", fontStyle: "italic" },
    isub: { fontSize: small, verticalAlign: "bottom", fontStyle: "italic" },
  };
}

/**
 * ECharts のテキスト系オプションに載せる形へ変換する。
 *
 * 記法が無ければ `rich` を付けない（既存の描画とバイト単位で同じ結果になる）。
 */
export function richTextOption(
  input: string,
  baseFontSize: number,
): { text: string; rich?: Record<string, Record<string, unknown>> } {
  if (!hasRichMarkup(input)) return { text: input };
  return { text: toEchartsRichText(input), rich: richStyleDefs(baseFontSize) };
}
