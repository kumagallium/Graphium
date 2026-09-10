// 軸名・凡例の LaTeX 風記法（斜体・上付き・下付き・ギリシャ文字）
//
// 論文の図では `Cp`（比熱）の C は斜体、p は下付き、`cm^3` の 3 は上付き、
// `H2O` の 2 は下付き……という組版が当たり前で、プレーンテキストの軸名では
// 「それらしく見えない」。ECharts の rich text 機能（`{tag|文字}`）に載せれば
// 表現できるので、入力欄には記法で書かせ、ここで rich へ変換する。
//
// 記法は LaTeX に揃えてある:
//   \it{斜体}    → 斜体（LaTeX どおりの \textit{} も同じ）
//   ^{上付き}     → 上付き
//   _{下付き}     → 下付き
//   \theta \mu … → ギリシャ文字・よく使う記号
//   \\ \_ \^ \{  → その文字そのもの
//
// LaTeX に寄せたのは、Graphium の本文が既に数式ブロック（KaTeX）を持っている
// ためで、いつか軸名を KaTeX で組むところまで進めても、ユーザーが覚えた
// 書き方がそのまま通る。matplotlib の mathtext とも同じ体系になる。
//
// 上下付きの引数は LaTeX と同じで、中括弧・1 文字・コマンド 1 つのどれでも
// 取れる（`H_2O` も `H_{2}O` も同じ）。
//
// 記法を読むのは「ユーザーが軸名・表示名の欄に自分で打った文字列」だけで、
// 欄が空のときに入る列名やテーブル名は素通しにする（呼び出し側の責任）。
// 列名は表示のために書かれた文字ではなく生データの識別子なので、`temp_c` や
// `x_1` を勝手に添字にすると、過去のノートの図が黙って変わってしまう。
//
// 記法が 1 つも無いテキストは変換せず、素の文字列のまま扱う（従来どおり）。

/**
 * 図に出す名前と、その出どころ。
 *
 * `authored` が真なのは、ユーザーが軸名・表示名の欄に自分で打った文字列だけ。
 * 欄が空のときに入る列名やテーブル名は偽で、記法として読まない。
 */
export interface DisplayLabel {
  text: string;
  authored: boolean;
}

/** 記法を読む対象か（人が書いた文字列で、実際にスタイルの記法が入っている） */
export function isRich(label: DisplayLabel): boolean {
  return label.authored && hasRichMarkup(label.text);
}

/** ECharts に渡す文字列。人が書いたものだけ記法を解釈する */
export function textOf(label: DisplayLabel): string {
  if (!label.authored) return label.text;
  return hasRichMarkup(label.text)
    ? toEchartsRichText(label.text)
    : // スタイルは無くても `\theta` のような記号は文字に置き換える
      stripRichMarkup(label.text);
}

/** 系列の内部名・書き出しに使う素のテキスト */
export function plainOf(label: DisplayLabel): string {
  return label.authored ? stripRichMarkup(label.text) : label.text;
}

/** 変換後のセグメント種別。ECharts の rich に定義するタグ名と一対一 */
export type RichSegmentStyle = "plain" | "it" | "sup" | "sub" | "isup" | "isub";

export interface RichSegment {
  text: string;
  style: RichSegmentStyle;
}

/**
 * LaTeX のコマンドで書けるギリシャ文字と記号。
 *
 * 軸名で実際に要るもの（2θ、λ、μ、Δ、°、×、±）に絞ってある。ここに無い
 * コマンドは変換せずそのまま残す — 黙って消すと、書いた本人が気づけない。
 */
const SYMBOLS: Record<string, string> = {
  alpha: "α", beta: "β", gamma: "γ", delta: "δ", epsilon: "ε", zeta: "ζ",
  eta: "η", theta: "θ", iota: "ι", kappa: "κ", lambda: "λ", mu: "μ",
  nu: "ν", xi: "ξ", pi: "π", rho: "ρ", sigma: "σ", tau: "τ",
  upsilon: "υ", phi: "φ", chi: "χ", psi: "ψ", omega: "ω",
  Gamma: "Γ", Delta: "Δ", Theta: "Θ", Lambda: "Λ", Xi: "Ξ", Pi: "Π",
  Sigma: "Σ", Upsilon: "Υ", Phi: "Φ", Psi: "Ψ", Omega: "Ω",
  times: "×", pm: "±", mp: "∓", cdot: "·", deg: "°", infty: "∞",
  approx: "≈", neq: "≠", leq: "≤", geq: "≥", sim: "∼",
  AA: "Å", angstrom: "Å", perp: "⊥", parallel: "∥",
};

/** 上下付きの入れ子は 1 段まで。二重添字は軸名では使わない */
interface ParseContext {
  italic: boolean;
  script: "none" | "sup" | "sub";
}

function styleFor(ctx: ParseContext): RichSegmentStyle {
  if (ctx.script === "sup") return ctx.italic ? "isup" : "sup";
  if (ctx.script === "sub") return ctx.italic ? "isub" : "sub";
  return ctx.italic ? "it" : "plain";
}

/**
 * 記法をセグメントに分解する。
 *
 * `\it{...}` は領域、上下付きはその場の囲みなので、斜体の中に置かれた
 * 上下付きは isup / isub という合成スタイルになる。
 */
export function parseRichSegments(input: string): RichSegment[] {
  const segments: RichSegment[] = [];
  parseInto(segments, input, { italic: false, script: "none" });
  return mergeAdjacent(segments);
}

function parseInto(out: RichSegment[], input: string, ctx: ParseContext): void {
  let buffer = "";
  const flush = () => {
    if (buffer === "") return;
    out.push({ text: buffer, style: styleFor(ctx) });
    buffer = "";
  };

  for (let i = 0; i < input.length; i++) {
    const ch = input[i];

    if (ch === "\\") {
      const command = /^[A-Za-z]+/.exec(input.slice(i + 1))?.[0];

      // \it{...} / \textit{...}: 中身を斜体として読み直す。
      // 短く書きたい人と LaTeX どおり書きたい人のどちらも通す
      if (command === "it" || command === "textit") {
        const inner = readBraced(input, i + 1 + command.length);
        if (inner !== null) {
          flush();
          parseInto(out, inner.text, { ...ctx, italic: true });
          i = inner.end;
          continue;
        }
      }

      if (command !== undefined) {
        // 既知のコマンドは文字に、未知のコマンドは書かれたまま残す
        buffer += SYMBOLS[command] ?? `\\${command}`;
        i += command.length;
        continue;
      }

      // 記号のエスケープ（\\ \_ \^ \{ \} など）
      if (i + 1 < input.length) {
        buffer += input[i + 1];
        i++;
        continue;
      }
      buffer += ch;
      continue;
    }

    if ((ch === "^" || ch === "_") && ctx.script === "none") {
      const argument = readScriptArgument(input, i + 1);
      // 引数が無い（末尾の `^` など）ときは記法として扱わず、字として出す
      if (argument === null) {
        buffer += ch;
        continue;
      }
      flush();
      parseInto(out, argument.text, { ...ctx, script: ch === "^" ? "sup" : "sub" });
      i = argument.end;
      continue;
    }

    buffer += ch;
  }
  flush();
}

/**
 * 上下付きの引数を読む。LaTeX と同じく `{...}` のグループ、コマンド 1 つ
 * (`x_\alpha`)、文字 1 つ (`H_2O`) のどれでも取れる。
 */
function readScriptArgument(input: string, start: number): { text: string; end: number } | null {
  if (start >= input.length) return null;

  const braced = readBraced(input, start);
  if (braced !== null) return braced;

  if (input[start] === "\\") {
    const command = /^[A-Za-z]+/.exec(input.slice(start + 1))?.[0];
    // `\alpha` はコマンドごと、`\_` はエスケープされた 1 文字ごと引数にする
    const length = command !== undefined ? 1 + command.length : 2;
    if (start + length > input.length) return null;
    return { text: input.slice(start, start + length), end: start + length - 1 };
  }

  // 絵文字などのサロゲートペアを半分に割らない
  const codePoint = input.codePointAt(start);
  const length = codePoint !== undefined && codePoint > 0xffff ? 2 : 1;
  return { text: input.slice(start, start + length), end: start + length - 1 };
}

/**
 * `start` が `{` なら、対応する `}` までの中身を返す。入れ子の `{}` と
 * エスケープ（`\}`）を数える。
 *
 * 閉じ括弧が無いまま終わったら、残り全部を中身として返す。打っている途中の
 * `H_{2` が「2 が下付き」に見えるほうが、書き手の意図に沿うため。
 */
function readBraced(input: string, start: number): { text: string; end: number } | null {
  if (input[start] !== "{") return null;
  let depth = 1;
  let text = "";
  for (let i = start + 1; i < input.length; i++) {
    const ch = input[i];
    if (ch === "\\" && i + 1 < input.length) {
      text += ch + input[i + 1];
      i++;
      continue;
    }
    if (ch === "{") depth++;
    if (ch === "}") {
      depth--;
      if (depth === 0) return { text, end: i };
    }
    text += ch;
  }
  return { text, end: input.length - 1 };
}

/** 同じスタイルが続いたセグメントはまとめる（rich タグを無駄に増やさない） */
function mergeAdjacent(segments: RichSegment[]): RichSegment[] {
  const merged: RichSegment[] = [];
  for (const segment of segments) {
    const last = merged[merged.length - 1];
    if (last && last.style === segment.style) last.text += segment.text;
    else merged.push({ ...segment });
  }
  return merged;
}

/** 記法が使われているか（使われていなければ rich に載せない） */
export function hasRichMarkup(input: string): boolean {
  if (!/[\\^_]/.test(input)) return false;
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

/** 斜体コマンド。⌘I が挿入する形でもあるので、記法の実装と同じ場所に置く */
export const ITALIC_COMMAND = "\\it{";

/**
 * 選択範囲を斜体にした結果を返す（入力欄の ⌘I 用）。
 *
 * 既に `\it{...}` で囲まれた範囲を選び直して押したときは外す。押すたびに
 * 入れ子が深くなると、書いた本人にも読めない文字列になるため。
 */
export function toggleItalic(
  value: string,
  start: number,
  end: number,
): { value: string; start: number; end: number } {
  const selected = value.slice(start, end);
  const before = value.slice(0, start);
  const after = value.slice(end);

  // 選択の内側が丸ごと斜体なら外す
  const unwrapped = unwrapItalic(selected);
  if (unwrapped !== null) {
    return { value: before + unwrapped + after, start, end: start + unwrapped.length };
  }
  // 選択の外側が斜体で、その中身をちょうど選んでいるときも外す
  const opener = ITALIC_COMMAND;
  if (before.endsWith(opener) && after.startsWith("}")) {
    const head = before.slice(0, before.length - opener.length);
    return { value: head + selected + after.slice(1), start: head.length, end: head.length + selected.length };
  }

  const wrapped = `${opener}${selected}}`;
  return {
    value: before + wrapped + after,
    start: start + opener.length,
    end: start + opener.length + selected.length,
  };
}

/** `\it{...}` / `\textit{...}` がちょうど全体を包んでいれば中身を返す */
function unwrapItalic(text: string): string | null {
  for (const opener of [ITALIC_COMMAND, "\\textit{"]) {
    if (!text.startsWith(opener) || !text.endsWith("}")) continue;
    const inner = text.slice(opener.length, -1);
    // 閉じ括弧が最後まで対応していること（`\it{a}b\it{c}` を外さない）
    if (readBraced(text, opener.length - 1)?.end === text.length - 1) return inner;
  }
  return null;
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
 * スタイルを伴わない記法（`\theta` のような記号だけ）は、文字に置き換えた
 * 素のテキストで足りるので `rich` を付けない。記法をまったく含まないテキストは
 * 素通しになり、既存の描画とまったく同じ option になる。
 */
export function richTextOption(
  input: string,
  baseFontSize: number,
): { text: string; rich?: Record<string, Record<string, unknown>> } {
  if (!hasRichMarkup(input)) return { text: stripRichMarkup(input) };
  return { text: toEchartsRichText(input), rich: richStyleDefs(baseFontSize) };
}
