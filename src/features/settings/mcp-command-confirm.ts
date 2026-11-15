// stdio の MCP サーバーを足す前に見せる「実行されるコマンド」の表示文を作る純粋関数群。
//
// stdio のサーバーは、登録前の接続テストやチャットでこのパソコン上でそのまま実行される。
// README の JSON を中身を読まずに貼ると任意のコマンドが動くので、足す前に command・args・env の
// 名前を見せて確認する（env の値は秘密を含み得るので出さない）。
// 表示用の文字列は、制御文字・改行・双方向制御文字で見た目をごまかせないよう \uXXXX に置き換える。

import type { McpServerEntry, McpStdioServer } from "./store";

/** サーバー名に出す最大文字数（見出しなので切る。コマンド行と env 行は切らない） */
export const MCP_CONFIRM_NAME_MAX_CHARS = 80;

// 見た目をごまかせる文字: 制御文字(Cc)・書式文字(Cf: ゼロ幅・双方向制御・ソフトハイフン・タグ文字・BOM など)・
// 行/段落区切り・見えない詰め物（Hangul filler・Braille 空白）・結合/異体字セレクタ・
// 半角スペース以外の空白（U+00A0・全角スペースなど。普通の空白と見分けがつかない）
const UNSAFE_CHARS =
  /[\p{Cc}\p{Cf}\p{Cs}\u2028\u2029\u034f\u115f\u1160\u17b4\u17b5\u180b-\u180f\u2800\u3164\uffa0\ufe00-\ufe0f\u{e0100}-\u{e01ef}]|[^\S ]/gu;

/**
 * 表示用: バックスラッシュを \\ に、制御文字などを見える形（\uXXXX / \u{XXXXX}）に置き換える。
 * alsoQuotes を付けると " も \" にする（引用符で囲んで見せるとき用。バックスラッシュと同じ 1 回の置換で行う）
 */
export function escapeForDisplay(text: string, alsoQuotes = false): string {
  const escaped = alsoQuotes ? text.replace(/[\\"]/g, (c) => `\\${c}`) : text.replace(/\\/g, "\\\\");
  return escaped.replace(UNSAFE_CHARS, (c) => {
    const cp = c.codePointAt(0) as number;
    const hex = cp.toString(16).toUpperCase();
    return cp > 0xffff ? `\\u{${hex}}` : `\\u${hex.padStart(4, "0")}`;
  });
}

/** 最大文字数で切り、切ったときは … を付ける（サロゲートペアを割らない） */
export function truncateForDisplay(text: string, max = MCP_CONFIRM_NAME_MAX_CHARS): string {
  const chars = Array.from(text);
  return chars.length <= max ? text : `${chars.slice(0, max).join("")}…`;
}

/** 空白や引用符を含む引数は、境目が分かるよう "" で囲む */
function quoteArg(arg: string): string {
  return arg === "" || /[\s"]/.test(arg) ? `"${escapeForDisplay(arg, true)}"` : escapeForDisplay(arg);
}

/**
 * command と args を空白でつないだ 1 行（制御文字は置き換え済み）。
 *
 * 長くても切らない。切ると、詰め物の後ろに置いた部分（`bash -c "…長い詰め物…; curl … | sh"`）が
 * 見えないまま「次のコマンドを実行します」に承諾させることになる。長い分はダイアログの中で巻く
 */
export function formatCommandLine(entry: McpStdioServer): string {
  // command も空白を含むなら囲む（どこまでが実行ファイルかを見分けられるように）
  return [quoteArg(entry.command), ...entry.args.map(quoteArg)].join(" ");
}

/** env があれば "env: KEY1, KEY2"（値は出さない。名前は全部出す）。無ければ null */
export function formatEnvLine(entry: McpStdioServer): string | null {
  const keys = Object.keys(entry.env ?? {});
  if (keys.length === 0) return null;
  return `env: ${keys.map((k) => escapeForDisplay(k)).join(", ")}`;
}

function formatOne(entry: McpStdioServer): string {
  const env = formatEnvLine(entry);
  return env ? `${formatCommandLine(entry)}\n${env}` : formatCommandLine(entry);
}

/**
 * 確認ダイアログの {command} に入れる本文。
 * - 1 件: コマンド行（＋ env 行）だけ
 * - 複数件: サーバー名つきで 1 件ずつ、全部並べる。件数で打ち切らない
 *   （「ほか N 件」に畳むと、見せていないコマンドまで承諾させることになる。長ければダイアログの中で巻く）
 */
export function buildCommandSummary(entries: readonly McpStdioServer[]): string {
  if (entries.length === 1) return formatOne(entries[0]);
  return entries
    .map((e) => `${truncateForDisplay(escapeForDisplay(e.name))}:\n${formatOne(e)}`)
    .join("\n\n");
}

function sameEnv(a?: Record<string, string>, b?: Record<string, string>): boolean {
  const ka = Object.keys(a ?? {});
  const kb = Object.keys(b ?? {});
  if (ka.length !== kb.length) return false;
  return ka.every((k) => b !== undefined && k in b && (a as Record<string, string>)[k] === b[k]);
}

/** 新しく入る stdio か、既存の command・args・env が変わるなら true（remote は常に false） */
export function needsStdioConfirm(old: McpServerEntry | undefined, next: McpServerEntry): next is McpStdioServer {
  if (next.type !== "stdio") return false;
  if (!old || old.type !== "stdio") return true;
  return (
    old.command !== next.command ||
    old.args.length !== next.args.length ||
    old.args.some((a, i) => a !== next.args[i]) ||
    !sameEnv(old.env, next.env)
  );
}
