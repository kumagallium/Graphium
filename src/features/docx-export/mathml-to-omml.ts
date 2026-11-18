// MathML（KaTeX の出力）→ Word の数式（OMML）の木（純ロジック・同期）
//
// LaTeX の解釈は KaTeX に任せ（latex-to-omml.ts）、ここは KaTeX が出す MathML を
// Word の数式の要素へ写す。出来合いの変換（mathml2omml）は LGPL なので使わない。
//
// 決まり: 1 つの式は「全部写せたら数式、1 か所でも写せなければ全体をあきらめる」。
// 写せない要素（行列・複数行・囲み・式番号など）に出会ったら MathUnsupportedError を投げ、
// 呼び出し側が LaTeX の文字に戻す。一部だけ欠けた数式は作らない。
//
// 出力は docx ライブラリに依存しない素の木（OmmlNode）。Word の要素にするのは blocks-to-docx.ts。
// 要素の並び順は OOXML の定義（shared-math.xsd）のとおりにする（Word は順序の違いで開けなくなる）。

/** Word の数式の要素 1 個 */
export type OmmlNode = {
  name: string;
  attrs?: Record<string, string>;
  children?: OmmlNode[];
  text?: string;
};

/** この変換が写せない式 */
export class MathUnsupportedError extends Error {
  constructor(reason: string) {
    super(`unsupported math: ${reason}`);
    this.name = "MathUnsupportedError";
  }
}

// ─────────────────────────────────────────────
// MathML の読み取り（KaTeX の出力に絞った最小の XML 読み）
// ─────────────────────────────────────────────

type MNode = {
  tag: string;
  attrs: Record<string, string>;
  children: MNode[];
  /** 直下の文字（子要素の文字は含まない） */
  text: string;
};

const ENTITIES: Record<string, string> = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: "\u00a0",
};

function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (full, body: string) => {
    if (body[0] === "#") {
      const code = body[1] === "x" || body[1] === "X" ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      if (!Number.isFinite(code) || code <= 0 || code > 0x10ffff) return full;
      try {
        return String.fromCodePoint(code);
      } catch {
        return full;
      }
    }
    return ENTITIES[body.toLowerCase()] ?? full;
  });
}

const TOKEN_RE = /<(\/?)([A-Za-z][\w:.-]*)((?:\s+[\w:.-]+="[^"]*")*)\s*(\/?)>|([^<]+)/gy;
const ATTR_RE = /([\w:.-]+)="([^"]*)"/g;

/** 入れ子の深さの上限（深すぎる式は docx の書き出しで再帰が尽きるので、ここで止める） */
const MAX_DEPTH = 60;

/** MathML の文字列から <math> 要素を読む。読めなければ MathUnsupportedError */
export function parseMathML(markup: string): MNode {
  const start = markup.indexOf("<math");
  const end = markup.lastIndexOf("</math>");
  if (start < 0 || end < 0) throw new MathUnsupportedError("no math element");
  const src = markup.slice(start, end + "</math>".length);

  const root: MNode = { tag: "#root", attrs: {}, children: [], text: "" };
  const stack: MNode[] = [root];
  TOKEN_RE.lastIndex = 0;
  let pos = 0;
  while (pos < src.length) {
    TOKEN_RE.lastIndex = pos;
    const m = TOKEN_RE.exec(src);
    if (!m) throw new MathUnsupportedError("malformed markup");
    pos = TOKEN_RE.lastIndex;
    const top = stack[stack.length - 1];
    if (m[5] !== undefined) {
      top.text += decodeEntities(m[5]);
      continue;
    }
    const [, closing, tag, attrText, selfClosing] = m;
    if (closing) {
      if (stack.length < 2 || top.tag !== tag) throw new MathUnsupportedError("unbalanced markup");
      stack.pop();
      continue;
    }
    const attrs: Record<string, string> = {};
    for (const a of attrText.matchAll(ATTR_RE)) attrs[a[1]] = decodeEntities(a[2]);
    const node: MNode = { tag, attrs, children: [], text: "" };
    top.children.push(node);
    if (!selfClosing) {
      stack.push(node);
      if (stack.length > MAX_DEPTH * 2) throw new MathUnsupportedError("too deep");
    }
  }
  if (stack.length !== 1 || root.children.length !== 1 || root.children[0].tag !== "math") {
    throw new MathUnsupportedError("unbalanced markup");
  }
  return root.children[0];
}

// ─────────────────────────────────────────────
// 文字（m:r）
// ─────────────────────────────────────────────

const el = (name: string, children: OmmlNode[] = [], attrs?: Record<string, string>): OmmlNode =>
  attrs ? { name, attrs, children } : { name, children };
const val = (name: string, value: string): OmmlNode => ({ name, attrs: { "m:val": value } });

type RunStyle = {
  /** m:sty（p = 立体、b = 太字、i = 斜体、bi = 太字の斜体）。無ければ Word の既定（文字は斜体） */
  sty?: "p" | "b" | "i" | "bi";
  /** m:scr（黒板太字・筆記体など） */
  scr?: string;
  /** 数式ではなく普通の文字（\text）。書体は文書の本文に従う */
  normal?: boolean;
  bold?: boolean;
  italic?: boolean;
};

/** Word 自身が数式の文字に付ける書体の指定。付けておくと、文書の本文の書体に引きずられない */
const MATH_FONT = "Cambria Math";

function run(text: string, style: RunStyle = {}): OmmlNode {
  const children: OmmlNode[] = [];
  if (style.normal) {
    children.push(el("m:rPr", [{ name: "m:nor" }]));
    const w: OmmlNode[] = [];
    if (style.bold) w.push({ name: "w:b" });
    if (style.italic) w.push({ name: "w:i" });
    if (w.length > 0) children.push(el("w:rPr", w));
  } else {
    const props: OmmlNode[] = [];
    if (style.scr) props.push(val("m:scr", style.scr));
    if (style.sty) props.push(val("m:sty", style.sty));
    if (props.length > 0) children.push(el("m:rPr", props));
    children.push(el("w:rPr", [{ name: "w:rFonts", attrs: { "w:ascii": MATH_FONT, "w:hAnsi": MATH_FONT } }]));
  }
  // 前後の空白を Word が落とさないよう、常に preserve を付ける
  children.push({ name: "m:t", attrs: { "xml:space": "preserve" }, text });
  return el("m:r", children);
}

/** 空の引数に入れる幅ゼロの文字（空のままだと Word が点線の四角を出す） */
const emptyRun = () => run("\u200b");

/** 隣り合う同じ体裁の m:r を 1 つにまとめる */
function mergeRuns(nodes: OmmlNode[]): OmmlNode[] {
  const out: OmmlNode[] = [];
  const signature = (n: OmmlNode) => JSON.stringify((n.children ?? []).slice(0, -1));
  for (const node of nodes) {
    const prev = out[out.length - 1];
    if (prev && prev.name === "m:r" && node.name === "m:r" && signature(prev) === signature(node)) {
      const prevText = prev.children![prev.children!.length - 1];
      const nextText = node.children![node.children!.length - 1];
      out[out.length - 1] = {
        ...prev,
        children: [...prev.children!.slice(0, -1), { ...prevText, text: (prevText.text ?? "") + (nextText.text ?? "") }],
      };
    } else {
      out.push(node);
    }
  }
  return out;
}

/** mathvariant → 文字の体裁。知らない値は写せない式として扱う */
function styleOfVariant(variant: string | undefined): RunStyle {
  if (!variant) return {};
  const table: Record<string, RunStyle> = {
    normal: { sty: "p" },
    bold: { sty: "b" },
    italic: { sty: "i" },
    "bold-italic": { sty: "bi" },
    "double-struck": { scr: "double-struck" },
    script: { scr: "script" },
    "bold-script": { scr: "script", sty: "b" },
    fraktur: { scr: "fraktur" },
    "bold-fraktur": { scr: "fraktur", sty: "b" },
    "sans-serif": { scr: "sans-serif", sty: "p" },
    "bold-sans-serif": { scr: "sans-serif", sty: "b" },
    "sans-serif-italic": { scr: "sans-serif", sty: "i" },
    "sans-serif-bold-italic": { scr: "sans-serif", sty: "bi" },
    monospace: { scr: "monospace", sty: "p" },
  };
  const style = table[variant];
  if (!style) throw new MathUnsupportedError(`mathvariant ${variant}`);
  return style;
}

/** 見えない演算子（関数の適用・見えない掛け算など） */
const INVISIBLE_RE = /[\u2061-\u2064]/g;
const APPLY = "\u2061";
/** XML 1.0 に入れられない文字（blocks-to-docx.ts の cleanXmlText が取り除くもの） */
const XML_INVALID_RE = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\ufffe\uffff]|[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/;
const codePointLength = (s: string) => Array.from(s).length;

const isToken = (n: MNode) => n.tag === "mi" || n.tag === "mn" || n.tag === "mo" || n.tag === "mtext";
/** 子要素を持たない mo で、中身が text に等しいか */
const isMo = (n: MNode | undefined): boolean => !!n && n.tag === "mo" && n.children.length === 0;
const isApply = (n: MNode | undefined) => !!n && n.tag === "mo" && n.children.length === 0 && n.text === APPLY;

function convertToken(node: MNode, depth: number): OmmlNode[] {
  // \overset などは mo / mi の中に要素が入る。中身を並びとして写す
  if (node.children.length > 0) return convertRow(node.children, depth + 1);
  // XML に入れられない文字（制御文字・対になっていないサロゲートなど）は、あとの後始末で消える。
  // 消えると中身の欠けた数式になるので、ここで式ごとあきらめる
  if (XML_INVALID_RE.test(node.text)) throw new MathUnsupportedError("invalid character");
  if (node.tag === "mtext") {
    // \! （負の空き）は「空白＋見えない区切り」だけの mtext になる。Word に負の空きは無いので出さない
    if (node.text.includes("\u2063") && !/\S/.test(node.text.replace(INVISIBLE_RE, ""))) return [];
    const raw = node.text.replace(INVISIBLE_RE, "");
    // KaTeX は許可されていない命令（\href など）を、エラーにせず赤い命令名の文字にする
    if (raw.startsWith("\\")) throw new MathUnsupportedError("untrusted command");
    if (!raw) return [];
    if (/^\s+$/.test(raw)) return [run(raw)];
    const variant = node.attrs.mathvariant ?? "";
    return [run(raw, { normal: true, bold: variant.includes("bold"), italic: variant.includes("italic") })];
  }
  const text = node.text.replace(INVISIBLE_RE, "");
  if (!text) return [];
  if (node.tag === "mi") {
    // MathML の決まり: 1 文字の mi は斜体、2 文字以上（sin など）は立体
    const variant = node.attrs.mathvariant ?? (codePointLength(text) > 1 ? "normal" : undefined);
    return [run(text, styleOfVariant(variant))];
  }
  if (node.tag === "mo") {
    // 演算子はもともと立体なので normal は書かない（隣の文字とまとめやすくする）
    const variant = node.attrs.mathvariant === "normal" ? undefined : node.attrs.mathvariant;
    if (!variant && /^[A-Za-z]{2,}$/.test(text)) return [run(text, { sty: "p" })];
    return [run(text, styleOfVariant(variant))];
  }
  return [run(text, styleOfVariant(node.attrs.mathvariant))];
}

/** mspace の幅（em）→ 近い幅の空白文字 */
function convertSpace(node: MNode): OmmlNode[] {
  if (node.attrs.linebreak) throw new MathUnsupportedError("line break");
  const m = /^(-?[\d.]+)em$/.exec(node.attrs.width ?? "");
  const em = m ? Number(m[1]) : 0.17;
  if (!(em > 0)) return [];
  if (em < 0.2) return [run("\u2009")];
  if (em < 0.3) return [run("\u2005")];
  if (em < 0.42) return [run("\u2004")];
  if (em < 0.75) return [run("\u2002")];
  return [run("\u2003".repeat(Math.min(Math.round(em), 4)))];
}

// ─────────────────────────────────────────────
// 構造
// ─────────────────────────────────────────────

/** 中身をそのまま親の並びに流してよい入れ物（体裁の指定は Word 側に任せる） */
const TRANSPARENT = new Set(["mrow", "mstyle", "mpadded", "semantics"]);
/** 背景や枠を持つ入れ物（\colorbox・\fcolorbox）は、ほどくと枠が消えるので写せない式として扱う */
const isDecorated = (n: MNode) => n.tag === "mpadded" && (n.attrs.mathbackground !== undefined || n.attrs.style !== undefined);
const SCRIPT_TAGS = new Set(["msub", "msup", "msubsup", "munder", "mover", "munderover"]);

/** \left … \right の括弧（KaTeX は fence="true" を付ける。\big 系は minsize を伴うので別扱い） */
const isFence = (n: MNode | undefined) =>
  !!n && n.tag === "mo" && n.children.length === 0 && n.attrs.fence === "true" && !n.attrs.minsize;
const isFenced = (n: MNode) =>
  n.tag === "mrow" && n.children.length > 0 && (isFence(n.children[0]) || isFence(n.children[n.children.length - 1]));

/** 入れ物をほどいて 1 本の並びにする（\left … \right の組は 1 個の要素として残す） */
function flatten(nodes: MNode[], depth: number): MNode[] {
  if (depth > MAX_DEPTH) throw new MathUnsupportedError("too deep");
  const out: MNode[] = [];
  for (const node of nodes) {
    if (isDecorated(node)) throw new MathUnsupportedError("box");
    if (TRANSPARENT.has(node.tag) && !isFenced(node)) out.push(...flatten(node.children, depth + 1));
    else out.push(node);
  }
  return out;
}

/** 引数 1 個ぶんの要素（m:e・m:num など）。空なら幅ゼロの文字を入れる */
function arg(name: string, nodes: MNode[], depth: number): OmmlNode {
  const children = convertRow(nodes, depth + 1);
  return el(name, children.length > 0 ? children : [emptyRun()]);
}

const DELIMITER_CHARS: Record<string, string> = { "∣": "|", "∥": "‖" };
const delimiterChar = (n: MNode | undefined) => {
  if (!isFence(n)) return "";
  const c = n!.text.replace(INVISIBLE_RE, "");
  return DELIMITER_CHARS[c] ?? c;
};

/** \left … \right → m:d。\middle は、区切りがすべて同じ文字のときだけ写せる */
function convertFenced(node: MNode, depth: number): OmmlNode {
  const kids = node.children;
  // KaTeX は \left. を出力に残さない。括弧だけで中身が無いと、開きか閉じか決められない
  if (kids.every((k) => isFence(k)) && kids.length < 2) throw new MathUnsupportedError("lone delimiter");
  const hasOpen = isFence(kids[0]);
  const hasClose = kids.length > (hasOpen ? 1 : 0) && isFence(kids[kids.length - 1]);
  const inner = kids.slice(hasOpen ? 1 : 0, hasClose ? kids.length - 1 : kids.length);
  const segments: MNode[][] = [[]];
  let separator: string | null = null;
  for (const child of inner) {
    if (isFence(child)) {
      const c = delimiterChar(child);
      if (separator !== null && separator !== c) throw new MathUnsupportedError("mixed \\middle");
      separator = c;
      segments.push([]);
    } else {
      segments[segments.length - 1].push(child);
    }
  }
  const props: OmmlNode[] = [val("m:begChr", hasOpen ? delimiterChar(kids[0]) : "")];
  if (separator !== null) props.push(val("m:sepChr", separator));
  props.push(val("m:endChr", hasClose ? delimiterChar(kids[kids.length - 1]) : ""));
  return el("m:d", [el("m:dPr", props), ...segments.map((s) => arg("m:e", s, depth))]);
}

/** 上に載る記号 → 結合文字（m:acc の m:chr） */
const ACCENT_CHARS: Record<string, string> = {
  "^": "\u0302", "\u02c6": "\u0302",
  "~": "\u0303", "\u02dc": "\u0303",
  "\u02c9": "\u0304", "\u00af": "\u0304",
  "\u02d9": "\u0307",
  "\u00a8": "\u0308",
  "\u02da": "\u030a",
  "\u02c7": "\u030c",
  "\u02d8": "\u0306",
  "\u00b4": "\u0301", "\u02ca": "\u0301",
  "`": "\u0300", "\u02cb": "\u0300",
  "\u20d7": "\u20d7", "→": "\u20d7",
  "←": "\u20d6",
  "↔": "\u20e1",
};
const OVERLINE = "‾";
const OVER_BRACE = "⏞";
const UNDER_BRACE = "⏟";
const PRIMES_RE = /^[′-‴⁗]+$/;

/** 子要素の文字をすべてつなぐ（判定用） */
function textOf(node: MNode): string {
  return node.text + node.children.map(textOf).join("");
}

/** 上付き・下付き・上下の添え字（総和などの大きな演算子と関数は convertRow が先に拾う） */
function convertScript(node: MNode, depth: number): OmmlNode[] {
  const k = node.children;
  const need = node.tag === "msubsup" || node.tag === "munderover" ? 3 : 2;
  if (k.length !== need) throw new MathUnsupportedError(`${node.tag} arity`);
  const base = [k[0]];
  switch (node.tag) {
    case "msup": {
      // f' の ′ は上付きにせず、そのまま並べる（Word の数式の書体では、′ は並べるだけで上に付く）
      const sup = textOf(k[1]).replace(INVISIBLE_RE, "");
      if (PRIMES_RE.test(sup)) return [...convertRow(base, depth + 1), run(sup)];
      return [el("m:sSup", [arg("m:e", base, depth), arg("m:sup", [k[1]], depth)])];
    }
    case "msub":
      return [el("m:sSub", [arg("m:e", base, depth), arg("m:sub", [k[1]], depth)])];
    case "msubsup":
      return [el("m:sSubSup", [arg("m:e", base, depth), arg("m:sub", [k[1]], depth), arg("m:sup", [k[2]], depth)])];
    case "mover": {
      const mark = moText(k[1]);
      if (node.attrs.accent === "true") {
        if (mark === OVERLINE) return [el("m:bar", [el("m:barPr", [val("m:pos", "top")]), arg("m:e", base, depth)])];
        const chr = ACCENT_CHARS[mark];
        if (!chr) throw new MathUnsupportedError("accent");
        return [el("m:acc", [el("m:accPr", [val("m:chr", chr)]), arg("m:e", base, depth)])];
      }
      if (mark === OVER_BRACE) {
        return [el("m:groupChr", [
          el("m:groupChrPr", [val("m:chr", OVER_BRACE), val("m:pos", "top"), val("m:vertJc", "bot")]),
          arg("m:e", base, depth),
        ])];
      }
      return [el("m:limUpp", [arg("m:e", base, depth), arg("m:lim", [k[1]], depth)])];
    }
    case "munder": {
      const mark = moText(k[1]);
      if (node.attrs.accentunder === "true") {
        if (mark === OVERLINE) return [el("m:bar", [el("m:barPr", [val("m:pos", "bot")]), arg("m:e", base, depth)])];
        throw new MathUnsupportedError("under accent");
      }
      if (mark === UNDER_BRACE) {
        return [el("m:groupChr", [
          el("m:groupChrPr", [val("m:chr", UNDER_BRACE), val("m:pos", "bot"), val("m:vertJc", "top")]),
          arg("m:e", base, depth),
        ])];
      }
      return [el("m:limLow", [arg("m:e", base, depth), arg("m:lim", [k[1]], depth)])];
    }
    default: {
      // munderover: 下の添え字を付けたものに、上の添え字を付ける
      const lower = el("m:limLow", [arg("m:e", base, depth), arg("m:lim", [k[1]], depth)]);
      return [el("m:limUpp", [el("m:e", [lower]), arg("m:lim", [k[2]], depth)])];
    }
  }
}

function convertNode(node: MNode, depth: number): OmmlNode[] {
  if (depth > MAX_DEPTH) throw new MathUnsupportedError("too deep");
  if (isToken(node)) return convertToken(node, depth);
  if (TRANSPARENT.has(node.tag)) {
    return isFenced(node) ? [convertFenced(node, depth)] : convertRow(node.children, depth + 1);
  }
  if (SCRIPT_TAGS.has(node.tag)) return convertScript(node, depth);
  switch (node.tag) {
    case "mspace":
      return convertSpace(node);
    case "mfrac": {
      if (node.children.length !== 2) throw new MathUnsupportedError("mfrac arity");
      const noBar = /^0(px|pt|em)?$/.test(node.attrs.linethickness ?? "");
      return [el("m:f", [
        ...(noBar ? [el("m:fPr", [val("m:type", "noBar")])] : []),
        arg("m:num", [node.children[0]], depth),
        arg("m:den", [node.children[1]], depth),
      ])];
    }
    case "msqrt":
      return [el("m:rad", [el("m:radPr", [val("m:degHide", "1")]), el("m:deg"), arg("m:e", node.children, depth)])];
    case "mroot": {
      if (node.children.length !== 2) throw new MathUnsupportedError("mroot arity");
      return [el("m:rad", [arg("m:deg", [node.children[1]], depth), arg("m:e", [node.children[0]], depth)])];
    }
    default:
      // mtable（行列・複数行・場合分け・式番号）、menclose（囲み・打ち消し）、mphantom など
      throw new MathUnsupportedError(node.tag);
  }
}

// ─────────────────────────────────────────────
// 並び（総和・積分と関数は、後ろに続くものを引数に取る）
// ─────────────────────────────────────────────

const NARY_CHARS = new Set(Array.from("∑∏∐∫∬∭∮∯∰⋃⋂⋁⋀⨁⨂⨀⨄⨆"));
const INTEGRAL_CHARS = new Set(Array.from("∫∬∭∮∯∰"));
/** 総和・積分の中身をここで切る（関係を表す記号） */
const RELATION_CHARS = new Set(Array.from("=≠<>≤≥≪≫≈≃≅≡∼∝≲≳→←↔⇒⇐⇔↦∈∉⊂⊃⊆⊇"));
const OPEN_CHARS = new Set(["(", "[", "{"]);
const CLOSE_CHARS = new Set([")", "]", "}"]);

const moText = (n: MNode | undefined) => (n && isMo(n) ? n.text.replace(INVISIBLE_RE, "") : "");

/** 大きな演算子の記号（入れ物 1 枚だけは透かして見る） */
function naryChar(node: MNode | undefined): string | null {
  if (!node) return null;
  if (isMo(node)) {
    const c = moText(node);
    return NARY_CHARS.has(c) ? c : null;
  }
  if (TRANSPARENT.has(node.tag) && node.children.length === 1) return naryChar(node.children[0]);
  return null;
}

type Nary = { chr: string; limLoc: "undOvr" | "subSup"; sub?: MNode; sup?: MNode };

function asNary(node: MNode): Nary | null {
  const bare = isMo(node) ? naryChar(node) : null;
  if (bare) return { chr: bare, limLoc: INTEGRAL_CHARS.has(bare) ? "subSup" : "undOvr" };
  if (!SCRIPT_TAGS.has(node.tag)) return null;
  // \hat{\sum} のように記号が上に載るだけのものは、上限・下限ではない
  if (node.attrs.accent === "true" || node.attrs.accentunder === "true") return null;
  const chr = naryChar(node.children[0]);
  if (!chr) return null;
  const k = node.children;
  switch (node.tag) {
    case "msub": return k.length === 2 ? { chr, limLoc: "subSup", sub: k[1] } : null;
    case "msup": return k.length === 2 ? { chr, limLoc: "subSup", sup: k[1] } : null;
    case "msubsup": return k.length === 3 ? { chr, limLoc: "subSup", sub: k[1], sup: k[2] } : null;
    case "munder": return k.length === 2 ? { chr, limLoc: "undOvr", sub: k[1] } : null;
    case "mover": return k.length === 2 ? { chr, limLoc: "undOvr", sup: k[1] } : null;
    default: return k.length === 3 ? { chr, limLoc: "undOvr", sub: k[1], sup: k[2] } : null;
  }
}

/** 総和・積分の中身の終わり（関係の記号・区切り・広い空き・言葉・閉じていない括弧の手前） */
function operandEnd(nodes: MNode[], from: number): number {
  let depth = 0;
  let j = from;
  for (; j < nodes.length; j++) {
    const n = nodes[j];
    const c = moText(n);
    if (c && OPEN_CHARS.has(c)) depth++;
    else if (c && CLOSE_CHARS.has(c)) {
      if (depth === 0) break;
      depth--;
    } else if (depth === 0) {
      if (c && (RELATION_CHARS.has(c) || n.attrs.separator === "true")) break;
      if (n.tag === "mspace" && (n.attrs.linebreak || Number.parseFloat(n.attrs.width ?? "0") >= 1)) break;
      if (n.tag === "mtext" && n.children.length === 0 && /\S/.test(n.text) && !n.text.includes("\u2063")) break;
    }
  }
  return j;
}

/** 関数名で始まるか（sin x の sin、\lim_{x\to 0} のように添え字を持つものも）。次に読む位置を返す */
function functionNameEnd(nodes: MNode[], i: number): number {
  const n = nodes[i];
  if (n.tag === "mi" && n.children.length === 0 && isApply(nodes[i + 1])) return i + 2;
  if (SCRIPT_TAGS.has(n.tag)) {
    const base = n.children[0];
    if (base && base.tag === "mrow" && base.children.length >= 2 && isApply(base.children[base.children.length - 1])) {
      return isApply(nodes[i + 1]) ? i + 2 : i + 1;
    }
  }
  return -1;
}

/** 関数の引数の終わり。括弧で始まれば対の括弧まで、そうでなければ記号・言葉・空きの手前まで */
function argumentEnd(nodes: MNode[], from: number): number {
  const first = moText(nodes[from]);
  if (first === "(" || first === "[") {
    const close = first === "(" ? ")" : "]";
    let depth = 0;
    for (let j = from; j < nodes.length; j++) {
      const c = moText(nodes[j]);
      if (c === first) depth++;
      else if (c === close && --depth === 0) return j + 1;
    }
    return from;
  }
  let j = from;
  while (
    j < nodes.length &&
    nodes[j].tag !== "mo" && nodes[j].tag !== "mtext" && nodes[j].tag !== "mspace" &&
    functionNameEnd(nodes, j) < 0 && !asNary(nodes[j])
  ) j++;
  return j;
}

function convertRow(input: MNode[], depth: number): OmmlNode[] {
  const nodes = flatten(input, depth);
  const out: OmmlNode[] = [];
  let i = 0;
  while (i < nodes.length) {
    const node = nodes[i];

    const nary = asNary(node);
    if (nary) {
      const end = operandEnd(nodes, i + 1);
      const operand = end > i + 1 ? convertRow(nodes.slice(i + 1, end), depth + 1) : [];
      // 中身が無いとき（式の終わり・等号の直前）は、空の引数を作らず普通の添え字として出す
      if (operand.length > 0) {
        const props: OmmlNode[] = [val("m:chr", nary.chr), val("m:limLoc", nary.limLoc)];
        if (!nary.sub) props.push(val("m:subHide", "1"));
        if (!nary.sup) props.push(val("m:supHide", "1"));
        out.push(el("m:nary", [
          el("m:naryPr", props),
          nary.sub ? arg("m:sub", [nary.sub], depth) : el("m:sub"),
          nary.sup ? arg("m:sup", [nary.sup], depth) : el("m:sup"),
          el("m:e", operand),
        ]));
        i = end;
        continue;
      }
    }

    const nameEnd = functionNameEnd(nodes, i);
    if (nameEnd >= 0) {
      const name = convertNode(node, depth + 1);
      const end = argumentEnd(nodes, nameEnd);
      const body = end > nameEnd ? convertRow(nodes.slice(nameEnd, end), depth + 1) : [];
      if (body.length > 0 && name.length > 0) {
        out.push(el("m:func", [el("m:fName", name), el("m:e", body)]));
        i = end;
      } else {
        out.push(...name);
        i = nameEnd;
      }
      continue;
    }

    out.push(...convertNode(node, depth + 1));
    i++;
  }
  return mergeRuns(out);
}

/**
 * MathML（KaTeX の出力）を Word の数式（m:oMath）にする。
 * 写せない要素があれば MathUnsupportedError。中身が空なら null。
 */
export function mathMLToOmml(markup: string): OmmlNode | null {
  const math = parseMathML(markup);
  const semantics = math.children.find((c) => c.tag === "semantics");
  const body = semantics
    ? semantics.children.filter((c) => c.tag !== "annotation" && c.tag !== "annotation-xml")
    : math.children;
  const children = convertRow(body, 0);
  // 見えるものが 1 つも無い式（空白だけ）は数式にしない
  const visible = (n: OmmlNode): boolean =>
    n.name === "m:t" ? /[^\s\u200b]/.test(n.text ?? "") : (n.children ?? []).some(visible);
  if (!children.some(visible)) return null;
  return el("m:oMath", children);
}

/** OmmlNode を XML の文字列にする（テストと確認用） */
export function ommlToXml(node: OmmlNode): string {
  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  const attrs = Object.entries(node.attrs ?? {}).map(([k, v]) => ` ${k}="${esc(v)}"`).join("");
  const inner = (node.text !== undefined ? esc(node.text) : "") + (node.children ?? []).map(ommlToXml).join("");
  return inner ? `<${node.name}${attrs}>${inner}</${node.name}>` : `<${node.name}${attrs}/>`;
}
