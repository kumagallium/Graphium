// コードブロックの言語名を、エディタが描ける名前に読み替える。
//
// BlockNote の codeBlock は、props.language が supportedLanguages のキーに無いと
// 描画で throw し、エディタ全体が立ち上がらない（ノートが開けなくなる）。
// 別名（bash・sh・js など）はキーではないので、同じく throw する。
// Markdown のフェンス（```bash）から来た名前はここを通してから保存・表示する。
//
// 表は @blocknote/code-block の codeBlockOptions.supportedLanguages と同じ中身。
// MCP（node で動く別バンドル）からも使うので、BlockNote を import せずに写しを持つ。
// ずれは code-language.test.ts が検出する。

/** エディタが描ける言語名（キー）と、その別名 */
export const CODE_LANGUAGES: Readonly<Record<string, readonly string[]>> = {
  text: ["text", "txt", "plain"],
  c: ["c"],
  cpp: ["cpp", "c++"],
  css: ["css"],
  glsl: ["glsl"],
  graphql: ["graphql", "gql"],
  haml: ["haml"],
  html: ["html"],
  java: ["java"],
  javascript: ["javascript", "js"],
  json: ["json"],
  jsonc: ["jsonc"],
  jsonl: ["jsonl"],
  jsx: ["jsx"],
  julia: ["julia", "jl"],
  less: ["less"],
  markdown: ["markdown", "md"],
  mdx: ["mdx"],
  php: ["php"],
  postcss: ["postcss"],
  pug: ["pug", "jade"],
  python: ["python", "py"],
  r: ["r"],
  regexp: ["regexp", "regex"],
  sass: ["sass"],
  scss: ["scss"],
  shellscript: ["shellscript", "bash", "sh", "shell", "zsh"],
  sql: ["sql"],
  svelte: ["svelte"],
  typescript: ["typescript", "ts"],
  vue: ["vue"],
  "vue-html": ["vue-html"],
  wasm: ["wasm"],
  wgsl: ["wgsl"],
  xml: ["xml"],
  yaml: ["yaml", "yml"],
  tsx: ["tsx", "typescriptreact"],
  haskell: ["haskell", "hs"],
  csharp: ["c#", "csharp", "cs"],
  latex: ["latex"],
  lua: ["lua"],
  mermaid: ["mermaid", "mmd"],
  ruby: ["ruby", "rb"],
  rust: ["rust", "rs"],
  scala: ["scala"],
  swift: ["swift"],
  kotlin: ["kotlin", "kt", "kts"],
  "objective-c": ["objective-c", "objc"],
};

/** BlockNote の表には無いが、フェンスでよく使われる書き方 */
const EXTRA_ALIASES: Readonly<Record<string, string>> = {
  console: "shellscript",
  "shell-session": "shellscript",
  fish: "shellscript",
  tex: "latex",
  htm: "html",
  svg: "xml",
};

const ALIAS_TO_KEY: ReadonlyMap<string, string> = (() => {
  const m = new Map<string, string>();
  for (const [key, aliases] of Object.entries(CODE_LANGUAGES)) {
    m.set(key, key);
    for (const a of aliases) if (!m.has(a)) m.set(a, key);
  }
  for (const [a, key] of Object.entries(EXTRA_ALIASES)) if (!m.has(a)) m.set(a, key);
  return m;
})();

/**
 * 言語名を、エディタが描けるキーに読み替える。
 * 別名はキーへ寄せ、当てはまらないもの（env・dockerfile など）は "text" にする。
 * 大文字小文字と前後の空白は無視する。文字列でない値・空は "text"。
 */
export function normalizeCodeLanguage(lang: unknown): string {
  if (typeof lang !== "string") return "text";
  const k = lang.trim().toLowerCase();
  if (!k) return "text";
  return ALIAS_TO_KEY.get(k) ?? "text";
}
