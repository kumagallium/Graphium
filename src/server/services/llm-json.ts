// LLM が返した JSON を、文字列の中身の崩れだけ直して読む。
//
// 本文（markdown）を JSON の文字列に入れて返させると、モデルによっては次の 2 つで
// JSON.parse が落ちる:
//   - 数式の `\alpha` や `\mathrm` など、JSON に無いエスケープ（Bad escaped character）
//   - 文字列の中の生の改行・タブ（Bad control character）
// どちらも中身は読めているのに、出力が丸ごと捨てられていた（呼び出し 1 回ぶんの無駄と、
// その資料の内容がページに入らない取りこぼし）。
//
// 正しい JSON は JSON.parse の結果をそのまま返し、ここの修復は通さない。
// ここで直すのは文字列の中の 1 文字単位の崩れだけ。括弧の閉じ忘れや途中切断は直さない —
// 途中で切れた本文を「読めた」ことにして保存すると、既存のページを短い本文で上書きするため。
// （途中切断の救済が要る一覧系の出力は、各サービスが jsonrepair を使っている）

const VALID_ESCAPES = new Set(['"', "\\", "/", "b", "f", "n", "r", "t"]);

// 修復に入った出力は、バックスラッシュをエスケープせずに数式を書いている。そのとき
// `\beta` `\frac` `\nu` `\rho` `\times` は JSON として有効なエスケープ（\b \f \n \r \t）
// に見えるので、そのまま読むと制御文字に化ける。`\alpha` だけ直って `\beta` が化けた本文を
// 「読めた」ことにしないよう、数式の命令と分かるものはバックスラッシュとして残す。
//   - \b \f \r の直後が英字: 文章に backspace / form feed / 単独の CR は出ないので、常に命令
//   - \n \t の直後が英字: 改行・タブの直後に語が続くのは普通なので、知っている命令名で、
//     かつ命令名の直後が英字でないときだけ（`\nu` は命令、`\number` や `\nAl` は改行＋語）
const LATEX_AFTER_N_OR_T = new Set([
  "nu", "nabla", "ne", "neq", "neg", "not", "notin", "ni", "nmid", "nolimits", "nonumber", "ngtr", "nless", "nleq", "ngeq",
  "tau", "theta", "times", "text", "textrm", "textit", "textbf", "texttt", "textsf", "tfrac", "tilde", "to", "top",
  "tan", "tanh", "triangle", "therefore", "thicksim", "thickapprox", "tiny", "tag",
]);
const LETTER = /[A-Za-z]/;
const LEADING_LETTERS = /^[A-Za-z]+/;

/** `\` の直後から始まる文字列が、数式の命令か（JSON のエスケープに見えるが制御文字ではない） */
function looksLikeLatexCommand(rest: string): boolean {
  const first = rest[0];
  if (first === "b" || first === "f" || first === "r") return LETTER.test(rest[1] ?? "");
  if (first === "n" || first === "t") {
    const word = rest.slice(0, 16).match(LEADING_LETTERS)?.[0] ?? "";
    return LATEX_AFTER_N_OR_T.has(word);
  }
  return false;
}
const HEX4 = /^[0-9a-fA-F]{4}$/;

/** 文字列リテラルの中の「JSON に無いエスケープ」と「生の制御文字」をエスケープし直す */
export function repairJsonStringEscapes(text: string): string {
  let out = "";
  let inString = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (!inString) {
      if (ch === '"') inString = true;
      out += ch;
      continue;
    }
    if (ch === '"') {
      inString = false;
      out += ch;
      continue;
    }
    if (ch === "\\") {
      const next = text[i + 1];
      if (next === "u") {
        if (HEX4.test(text.slice(i + 2, i + 6))) {
          out += text.slice(i, i + 6);
          i += 5;
        } else {
          // `\underline` など。バックスラッシュそのものとして残す
          out += "\\\\";
        }
        continue;
      }
      if (next !== undefined && VALID_ESCAPES.has(next)) {
        if (looksLikeLatexCommand(text.slice(i + 1, i + 18))) {
          out += "\\\\";
          continue;
        }
        out += ch + next;
        i += 1;
        continue;
      }
      // `\alpha` など JSON に無いエスケープ。バックスラッシュそのものとして残す
      out += "\\\\";
      continue;
    }
    const code = ch.charCodeAt(0);
    if (code < 0x20) {
      if (ch === "\n") out += "\\n";
      else if (ch === "\r") out += "\\r";
      else if (ch === "\t") out += "\\t";
      else out += `\\u${code.toString(16).padStart(4, "0")}`;
      continue;
    }
    out += ch;
  }
  return out;
}

/**
 * JSON.parse を試し、落ちたら文字列の中の崩れだけ直してもう一度読む。
 * それでも読めなければ、最初のエラーを投げる（呼び出し側の「変更しない」に落ちる）。
 */
export function parseJsonLenient(jsonText: string): unknown {
  try {
    return JSON.parse(jsonText);
  } catch (err) {
    const repaired = repairJsonStringEscapes(jsonText);
    if (repaired === jsonText) throw err;
    try {
      return JSON.parse(repaired);
    } catch {
      throw err;
    }
  }
}

/**
 * 説明文の中に埋まった JSON オブジェクトを取り出す（「The source ... Here is the routing: {...}」
 * のように、JSON だけを返す指示に反して前後に文章が付いた出力向け）。
 * 文字列の中の括弧は数えずに、対応の取れた一番外側の `{...}` を後ろから順に試し、
 * 読めて accept を満たした最初のもの（＝最後に書かれたもの）を返す。無ければ undefined。
 * 途中で切れたものは直さない（parseJsonLenient と同じ方針）。
 */
export function extractJsonObjectFromProse(
  text: string,
  accept: (value: Record<string, unknown>) => boolean,
): Record<string, unknown> | undefined {
  const spans: Array<[number, number]> = [];
  let depth = 0;
  let start = -1;
  let inString = false;
  let escaped = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') {
      // 外側の文章に出る引用符は数えない（オブジェクトの中だけ文字列として扱う）
      if (depth > 0) inString = true;
    } else if (ch === "{") {
      if (depth === 0) start = i;
      depth++;
    } else if (ch === "}" && depth > 0) {
      depth--;
      if (depth === 0) spans.push([start, i + 1]);
    }
  }
  for (const [s, e] of spans.reverse()) {
    try {
      const value = parseJsonLenient(text.slice(s, e));
      if (value && typeof value === "object" && !Array.isArray(value) && accept(value as Record<string, unknown>)) {
        return value as Record<string, unknown>;
      }
    } catch {
      // 次の候補へ
    }
  }
  return undefined;
}
