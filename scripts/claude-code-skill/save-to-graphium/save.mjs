#!/usr/bin/env node
// Graphium のノートとして新規ファイルを書き込む軽量スクリプト。
// Claude Code Skill から呼ばれる想定。詳細は同ディレクトリの SKILL.md 参照。
//
// 入力: stdin に JSON { title: string, body: string, source?: string }
// 出力: stdout に JSON { noteId, filePath, title }
//
// 書き込み先は下記の優先順で解決する:
//   1. 環境変数 GRAPHIUM_NOTES_DIR
//   2. Graphium 本体の設定ファイル (<OS app config>/com.graphium.app/config.json)
//      → `graphiumRoot` が指定されていれば <graphiumRoot>/notes/
//   3. ~/Documents/Graphium/notes/ (Tauri アプリ既定)
//
// 依存なし (Node 20+ 標準ライブラリのみ)。

import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { homedir, userInfo } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

/** Graphium アプリの設定ディレクトリ（Tauri v2 の app_config_dir と一致させる） */
function graphiumAppConfigDir() {
  const id = "com.graphium.app";
  if (process.platform === "darwin") {
    return join(homedir(), "Library", "Application Support", id);
  }
  if (process.platform === "win32") {
    const appdata =
      process.env.APPDATA || join(homedir(), "AppData", "Roaming");
    return join(appdata, id);
  }
  // Linux / その他: XDG_CONFIG_HOME があればそれ、なければ ~/.config
  const xdg = process.env.XDG_CONFIG_HOME || join(homedir(), ".config");
  return join(xdg, id);
}

/** Graphium 本体の config.json から graphiumRoot を読む（未設定なら null） */
function readConfiguredGraphiumRoot() {
  const configPath = join(graphiumAppConfigDir(), "config.json");
  if (!existsSync(configPath)) return null;
  try {
    const raw = readFileSync(configPath, "utf8").trim();
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    const root = parsed?.graphiumRoot;
    if (typeof root === "string" && root.trim().length > 0) {
      return root.trim();
    }
    return null;
  } catch {
    // 壊れた config は無視してフォールバックへ
    return null;
  }
}

function resolveNotesDir() {
  if (process.env.GRAPHIUM_NOTES_DIR) {
    return process.env.GRAPHIUM_NOTES_DIR;
  }
  const configured = readConfiguredGraphiumRoot();
  if (configured) {
    return join(configured, "notes");
  }
  return join(homedir(), "Documents", "Graphium", "notes");
}

async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString("utf8");
}

// ─────────────────────────────────────────────
// Markdown → BlockNote ブロックの変換
// ─────────────────────────────────────────────
//
// Graphium の MCP サーバーの create_note（src/mcp/markdown-to-blocks.ts）と同じ変換。
// このスクリプトは Node 標準ライブラリだけで動かすため、あちらを import せず複製している。
// **片方を直したらもう片方も必ず直すこと。** 同じ Markdown から同じブロック JSON が出ることを
// src/mcp/markdown-to-blocks.test.ts がこのスクリプトを実際に動かして突き合わせる。

// BlockNote のブロックひな形を作る共通部分
function makeProps(extra = {}) {
  return {
    textColor: "default",
    backgroundColor: "default",
    textAlignment: "left",
    ...extra,
  };
}

// ── 数式と上付き・下付きの退避 ──
//
// Graphium の get_note はノート本文の数式を $…$ / $$ … $$、上付き・下付きを <sup> / <sub>
// で返す。それを引用して保存したときに文字のまま残らないよう、行やインライン装飾を解釈する
// 前に数式とタグを目印へ退避し、解釈し終えた所で inlineMath / math ブロック / 上付き・下付き
// の書式に戻す。
//
// 何を数式・タグとみなすかは、Graphium の Markdown 取り込み（features/math/markdown-math.ts の
// stashMath と lib/script-styles.ts の markScriptTags）と同じ規則にする:
//   - 数式は $$ … $$ → \[ … \] → \( … \) → $ … $ の順に拾う。$ … $ は「開きの直後と閉じの
//     直前が非空白」「閉じの直後が数字でない」を課す（金額「$100 と $200」や価格帯
//     「$50-$75」を数式にしない）。インライン数式は 200 字まで
//   - <sup>…</sup> / <sub>…</sub> は 1 行の中で閉じていて、中に表の区切り（|）と入れ子の
//     タグを含まないもの。中身は書き出し側のエスケープ（\* や &lt;）を戻して文字にする
//   - コード（``` / ~~~ フェンスと `インラインコード`）の中はどちらも拾わない
// 数式ブロックにするのは、ブロック数式が行に単独で立っているとき（get_note が書く形）だけ。
// 文中・見出し・箇条書き・表のセルにある $$ … $$ は、その行を割らずにインライン数式にする。
//
// 退避した中身（stash の 1 要素）は次のどちらか。raw は退避前の表記:
//   { kind: "math", latex, display, raw } / { kind: "script", style, text, raw }

// 目印は私用領域の文字で挟む。本文に偶然現れず、Markdown の記号とも重ならない
// （{{GWMATH_0}} のような ASCII の目印だと、ノートにその文字列を書いたときに化ける）
const STASH_OPEN = "";
const STASH_CLOSE = "";
const STASH_RE = /(\d+)/g;
const CODE_OPEN = "";
const CODE_CLOSE = "";
const CODE_RE = /(\d+)/g;

// インライン数式として認める最大文字数（長すぎるものは誤検出とみなす）
const MAX_INLINE_LATEX = 200;

// 1 行の中で閉じている <sup>…</sup> / <sub>…</sub>（markScriptTags と同じ条件）
const SCRIPT_TAG_RE = /<(sup|sub)(?:\s[^<>]*)?>((?:(?!<\/?(?:sup|sub)\b)[^\n|])+?)<\/\1\s*>/gi;

// タグの中身の、書き出し側（lib/script-styles.ts の escapeForScriptTag）のエスケープを戻す
function unescapeScriptText(text) {
  return text
    .replace(/\\([\\`*_[\]~])/g, "$1")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

// 目印を元の表記に戻す（コードの中やリンクの URL など、数式や書式にしない所で使う）
function restoreRaw(text, stash) {
  return text.replace(STASH_RE, (sentinel, n) => stash[Number(n)]?.raw ?? sentinel);
}

// Markdown 中の数式と <sup> / <sub> を目印に置き換える。
// 戻り値の stash[n] が、本文中の目印 n（私用領域の文字で n を挟んだもの）の中身。
function stashMathAndScripts(markdown) {
  const stash = [];
  const codes = [];
  const push = (entry) => {
    stash.push(entry);
    return `${STASH_OPEN}${stash.length - 1}${STASH_CLOSE}`;
  };
  const maskCode = (code) => {
    codes.push(code);
    return `${CODE_OPEN}${codes.length - 1}${CODE_CLOSE}`;
  };
  const unmaskCode = (text) =>
    text.replace(CODE_RE, (sentinel, n) => codes[Number(n)] ?? sentinel);

  // コード領域を先に退避する（中の $ やタグを拾わない。lib/markdown-code-regions.ts と同じ範囲）
  let text = markdown
    .replace(/```[\s\S]*?```|~~~[\s\S]*?~~~/g, maskCode)
    .replace(/`[^`\n]*`/g, maskCode);

  const mathReplacer = (display) => (full, inner) => {
    const latex = unmaskCode(inner.trim());
    if (!latex || (!display && latex.length > MAX_INLINE_LATEX)) return full;
    return push({ kind: "math", latex, display, raw: unmaskCode(full) });
  };
  // ブロック数式: $$ ... $$ / \[ ... \]
  text = text.replace(/\$\$([\s\S]+?)\$\$/g, mathReplacer(true));
  text = text.replace(/\\\[([^]+?)\\\]/g, mathReplacer(true));
  // インライン数式: \( ... \) / $ ... $（条件は stashMath と同じ。退避済みの数式はまたがない）
  text = text.replace(/\\\(([^]+?)\\\)/g, mathReplacer(false));
  text = text.replace(/(?<![$\\])\$(?!\s)([^$\n]*[^\s$])\$(?![$\d])/g, mathReplacer(false));

  // 上付き・下付き（数式の後に拾うので、タグの中の $…$ は目印のまま中身に入る）
  text = text.replace(SCRIPT_TAG_RE, (full, tag, inner) => {
    // タグの中の \[ \] や \( \) は、書き出し側がかっこや \ に付けたエスケープ
    // （上付きの「[1]」は「<sup>\[1\]</sup>」になる）。数式として拾っていても文字に戻す
    const body = inner.replace(STASH_RE, (sentinel, n) => {
      const entry = stash[Number(n)];
      return entry && entry.raw.startsWith("\\") ? entry.raw : sentinel;
    });
    return push({
      kind: "script",
      style: tag.toLowerCase() === "sup" ? "superscript" : "subscript",
      text: unmaskCode(unescapeScriptText(body)),
      raw: unmaskCode(restoreRaw(full, stash)),
    });
  });

  return { text: unmaskCode(text), stash };
}

// ── インライン ──

// text インラインを積む。直前と同じ styles ならマージして出力量を抑える
function pushText(out, t, styles = {}) {
  if (!t) return;
  const last = out[out.length - 1];
  if (
    last &&
    last.type === "text" &&
    JSON.stringify(last.styles) === JSON.stringify(styles)
  ) {
    last.text += t;
  } else {
    out.push({ type: "text", text: t, styles: { ...styles } });
  }
}

// 目印を戻しながら積む。数式は inlineMath に、上付き・下付きはその書式を足した text にする。
// inlineMath を置けない所（リンクの中身）では mathAsText にして、数式を元の表記の文字で残す。
function pushFormatted(out, t, styles, stash, mathAsText = false) {
  let last = 0;
  for (const m of t.matchAll(STASH_RE)) {
    const at = m.index ?? 0;
    pushText(out, t.slice(last, at), styles);
    const entry = stash[Number(m[1])];
    if (!entry) {
      pushText(out, m[0], styles);
    } else if (entry.kind === "script") {
      pushFormatted(out, entry.text, { ...styles, [entry.style]: true }, stash, mathAsText);
    } else if (mathAsText) {
      pushText(out, entry.raw, styles);
    } else {
      out.push({ type: "inlineMath", props: { latex: entry.latex } });
    }
    last = at + m[0].length;
  }
  pushText(out, t.slice(last), styles);
}

// BlockNote のインライン content にパースする。
// 対応: **bold**, *italic*, `code`, [text](url), 数式（$…$ / \(…\)。行の中の $$ … $$ も
//       インライン数式にする）, <sup>…</sup> / <sub>…</sub>
// 未クローズや他の記法は plain text として扱う。
// stash を渡すと、markdownToBlocks が Markdown 全体で退避した目印を戻す。省略時は
// このテキストの数式とタグをここで退避する。
function parseInlineContent(text, stash) {
  if (!text) return [{ type: "text", text: "", styles: {} }];

  const stashed = stash ? { text, stash } : stashMathAndScripts(text);
  const entries = stashed.stash;
  const result = [];
  let remaining = stashed.text;

  while (remaining.length > 0) {
    // **bold**
    const boldMatch = remaining.match(/^\*\*([^*\n]+?)\*\*/);
    if (boldMatch) {
      pushFormatted(result, boldMatch[1], { bold: true }, entries);
      remaining = remaining.slice(boldMatch[0].length);
      continue;
    }

    // `code`（中身は解釈しない。目印が紛れ込んでいたら元の表記に戻す）
    const codeMatch = remaining.match(/^`([^`\n]+?)`/);
    if (codeMatch) {
      pushText(result, restoreRaw(codeMatch[1], entries), { code: true });
      remaining = remaining.slice(codeMatch[0].length);
      continue;
    }

    // [text](url)（リンクの中身は書式付きの文字だけ置ける。数式は元の表記のまま残す）
    const linkMatch = remaining.match(/^\[([^\]\n]+?)\]\(([^)\n]+?)\)/);
    if (linkMatch) {
      const content = [];
      pushFormatted(content, linkMatch[1], {}, entries, true);
      result.push({
        type: "link",
        href: restoreRaw(linkMatch[2], entries),
        content,
      });
      remaining = remaining.slice(linkMatch[0].length);
      continue;
    }

    // *italic* (bold より後でチェックし、** を巻き込まないように)
    const italicMatch = remaining.match(/^\*([^*\n]+?)\*/);
    if (italicMatch) {
      pushFormatted(result, italicMatch[1], { italic: true }, entries);
      remaining = remaining.slice(italicMatch[0].length);
      continue;
    }

    // plain text: 次の特殊記号まで取り込む
    const nextSpecial = remaining.search(/\*\*|`|\[|\*/);
    if (nextSpecial === -1) {
      pushFormatted(result, remaining, {}, entries);
      break;
    } else if (nextSpecial === 0) {
      // 特殊記号で始まるが match できなかった（未クローズ）→ 1文字だけ plain として消費
      pushText(result, remaining[0]);
      remaining = remaining.slice(1);
    } else {
      pushFormatted(result, remaining.slice(0, nextSpecial), {}, entries);
      remaining = remaining.slice(nextSpecial);
    }
  }

  return result.length > 0 ? result : [{ type: "text", text: "", styles: {} }];
}

// ── ブロック ──

function headingBlock(level, text, stash) {
  return {
    id: randomUUID(),
    type: "heading",
    props: makeProps({ level }),
    content: parseInlineContent(text, stash),
    children: [],
  };
}

function paragraphBlock(text, stash) {
  return {
    id: randomUUID(),
    type: "paragraph",
    props: makeProps(),
    content: parseInlineContent(text, stash),
    children: [],
  };
}

function bulletListItemBlock(text, stash) {
  return {
    id: randomUUID(),
    type: "bulletListItem",
    props: makeProps(),
    content: parseInlineContent(text, stash),
    children: [],
  };
}

function codeBlock(lang, code) {
  return {
    id: randomUUID(),
    type: "codeBlock",
    props: { language: lang || "text" },
    // コードブロックはインライン装飾を解釈しない（そのまま出力）
    content: [{ type: "text", text: code, styles: {} }],
    children: [],
  };
}

// 数式ブロック（LaTeX はデリミタを除いた中身だけを持つ）
function mathBlock(latex) {
  return {
    id: randomUUID(),
    type: "math",
    props: { latex },
    children: [],
  };
}

// "| a | b | c |" → ["a", "b", "c"]
function splitTableRow(line) {
  return line
    .replace(/^\s*\|/, "")
    .replace(/\|\s*$/, "")
    .split("|")
    .map((c) => c.trim());
}

// テーブルセパレータ行の判定（|---|---|---| 形式、: で alignment）
function isTableSeparator(line) {
  return /^\s*\|[\s\-:|]+\|\s*$/.test(line) && /-/.test(line);
}

function tableBlock(rows, stash) {
  return {
    id: randomUUID(),
    type: "table",
    content: {
      type: "tableContent",
      rows: rows.map((cells) => ({
        cells: cells.map((cell) => parseInlineContent(cell, stash)),
      })),
    },
    children: [],
  };
}

// 行がブロック数式の目印だけなら、その LaTeX を返す（数式ブロックにする行か）
function soleDisplayMath(line, stash) {
  const m = /^\s*(\d+)\s*$/.exec(line);
  const entry = m ? stash[Number(m[1])] : undefined;
  return entry && entry.kind === "math" && entry.display ? entry.latex : null;
}

// Markdown -> BlockNote ブロック配列の最小変換。
// 対応: h1-h3, 箇条書き (-,*), 番号なしと番号付きは区別せず bulletListItem として扱う,
//       フェンス付きコードブロック (```lang), 行に単独のブロック数式 ($$ … $$ / \[ … \]。
//       複数行にまたがってよい) を math ブロックに, 空行区切りのパラグラフ。
// それ以外はすべて paragraph として保持する。
function markdownToBlocks(md) {
  // 数式とタグを先に目印へ退避する（複数行の $$ … $$ も 1 つの目印になる）
  const { text, stash } = stashMathAndScripts(md.replace(/\r\n/g, "\n"));
  const lines = text.split("\n");
  const blocks = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    // コードブロック（中身は解釈しない。目印が紛れ込んでいたら元の表記に戻す）
    const fence = line.match(/^```(\w*)\s*$/);
    if (fence) {
      const lang = fence[1] || "text";
      const buf = [];
      i++;
      while (i < lines.length && !/^```\s*$/.test(lines[i])) {
        buf.push(lines[i]);
        i++;
      }
      if (i < lines.length) i++;
      blocks.push(codeBlock(lang, restoreRaw(buf.join("\n"), stash)));
      continue;
    }

    // 数式ブロック（ブロック数式が行に単独で立っているとき）
    const displayLatex = soleDisplayMath(line, stash);
    if (displayLatex !== null) {
      blocks.push(mathBlock(displayLatex));
      i++;
      continue;
    }

    // 見出し
    const heading = line.match(/^(#{1,3})\s+(.+?)\s*$/);
    if (heading) {
      blocks.push(headingBlock(heading[1].length, heading[2], stash));
      i++;
      continue;
    }

    // テーブル（| col | col | ...  +  次行が |---|---| セパレータ）
    if (
      /^\s*\|(.+)\|\s*$/.test(line) &&
      i + 1 < lines.length &&
      isTableSeparator(lines[i + 1])
    ) {
      const rows = [splitTableRow(line)];
      i += 2; // ヘッダー行とセパレータ行をスキップ
      while (i < lines.length && /^\s*\|(.+)\|\s*$/.test(lines[i])) {
        rows.push(splitTableRow(lines[i]));
        i++;
      }
      blocks.push(tableBlock(rows, stash));
      continue;
    }

    // 箇条書き (ネスト非対応: 先頭記号をそのまま除去)
    if (/^\s*[-*]\s+/.test(line)) {
      blocks.push(bulletListItemBlock(line.replace(/^\s*[-*]\s+/, ""), stash));
      i++;
      continue;
    }
    if (/^\s*\d+\.\s+/.test(line)) {
      blocks.push(bulletListItemBlock(line.replace(/^\s*\d+\.\s+/, ""), stash));
      i++;
      continue;
    }

    // 空行はスキップ
    if (line.trim() === "") {
      i++;
      continue;
    }

    // パラグラフ (空行または別種ブロックまで連結)
    const buf = [line];
    i++;
    while (
      i < lines.length &&
      lines[i].trim() !== "" &&
      !/^#{1,3}\s+/.test(lines[i]) &&
      !/^```/.test(lines[i]) &&
      !/^\s*[-*]\s+/.test(lines[i]) &&
      !/^\s*\d+\.\s+/.test(lines[i]) &&
      !/^\s*\|.+\|\s*$/.test(lines[i]) &&
      soleDisplayMath(lines[i], stash) === null
    ) {
      buf.push(lines[i]);
      i++;
    }
    blocks.push(paragraphBlock(buf.join(" "), stash));
  }

  if (blocks.length === 0) {
    blocks.push(paragraphBlock(""));
  }
  return blocks;
}

// 誰が保存したかを解決する。プライバシーに配慮し、
// - username は常に OS から取得 (識別性のための最小情報)
// - email は明示的な opt-in (env var または author.email) があった時のみ記録
function resolveAuthor(inputAuthor) {
  const user = { username: userInfo().username };
  const explicitEmail =
    (typeof inputAuthor === "object" && inputAuthor?.email) ||
    process.env.GRAPHIUM_USER_EMAIL ||
    null;
  if (explicitEmail) user.email = explicitEmail;
  return user;
}

function buildDocument({ title, body, source, author, model }) {
  const now = new Date().toISOString();
  const generatedBy = {
    agent: "claude-code",
    sessionId: source ?? "unknown",
    user: resolveAuthor(author),
  };
  if (typeof model === "string" && model.trim()) {
    generatedBy.model = model.trim();
  }
  return {
    version: 2,
    title,
    pages: [
      {
        id: "main",
        title,
        blocks: markdownToBlocks(body),
        labels: {},
        provLinks: [],
        knowledgeLinks: [],
      },
    ],
    generatedBy,
    source: "human",
    createdAt: now,
    modifiedAt: now,
  };
}

async function main() {
  const raw = await readStdin();
  if (!raw.trim()) {
    console.error("save.mjs: stdin is empty. expected JSON {title, body}.");
    process.exit(1);
  }
  let input;
  try {
    input = JSON.parse(raw);
  } catch (e) {
    console.error(`save.mjs: invalid JSON: ${e.message}`);
    process.exit(1);
  }
  if (!input.title || typeof input.title !== "string") {
    console.error("save.mjs: 'title' is required (string).");
    process.exit(1);
  }
  if (typeof input.body !== "string") {
    console.error("save.mjs: 'body' is required (string).");
    process.exit(1);
  }

  const notesDir = resolveNotesDir();
  mkdirSync(notesDir, { recursive: true });

  const noteId = randomUUID();
  const filePath = join(notesDir, `${noteId}.json`);
  const doc = buildDocument(input);
  writeFileSync(filePath, JSON.stringify(doc, null, 2), "utf8");

  process.stdout.write(
    JSON.stringify({
      noteId,
      filePath,
      title: input.title,
      author: doc.generatedBy.user,
    }) + "\n"
  );
}

main().catch((err) => {
  console.error(`save.mjs: ${err?.stack || err}`);
  process.exit(1);
});
