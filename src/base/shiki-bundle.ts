// @blocknote/code-block が内蔵する Shiki のハイライタと同じ言語表（0.54 で内蔵ハイライタが
// 公開されなくなったので、こちらで同じものを組み立てる）。テーマは Graphium の方針で
// 低彩度の min-light だけを読む（editor.tsx のコメント参照）。
//
// 言語表は node_modules/@blocknote/code-block/dist/blocknote-code-block.js の `langs` から
// 機械的に起こしたもの。BlockNote を上げたら shiki-bundle.test.ts（codeBlockOptions の
// supportedLanguages と照合）で漏れを検知する
import { createBundledHighlighter } from "@shikijs/core";
import { createJavaScriptRegexEngine } from "@shikijs/engine-javascript";
import type { HighlighterGeneric } from "@shikijs/types";

export const SHIKI_LANGS = {
  c: () => import("@shikijs/langs-precompiled/c"),
  cpp: () => import("@shikijs/langs-precompiled/cpp"),
  "c++": () => import("@shikijs/langs-precompiled/cpp"),
  css: () => import("@shikijs/langs-precompiled/css"),
  glsl: () => import("@shikijs/langs-precompiled/glsl"),
  graphql: () => import("@shikijs/langs-precompiled/graphql"),
  gql: () => import("@shikijs/langs-precompiled/graphql"),
  haml: () => import("@shikijs/langs-precompiled/haml"),
  html: () => import("@shikijs/langs-precompiled/html"),
  java: () => import("@shikijs/langs-precompiled/java"),
  javascript: () => import("@shikijs/langs-precompiled/javascript"),
  js: () => import("@shikijs/langs-precompiled/javascript"),
  json: () => import("@shikijs/langs-precompiled/json"),
  jsonc: () => import("@shikijs/langs-precompiled/jsonc"),
  jsonl: () => import("@shikijs/langs-precompiled/jsonl"),
  jsx: () => import("@shikijs/langs-precompiled/jsx"),
  julia: () => import("@shikijs/langs-precompiled/julia"),
  jl: () => import("@shikijs/langs-precompiled/julia"),
  less: () => import("@shikijs/langs-precompiled/less"),
  markdown: () => import("@shikijs/langs-precompiled/markdown"),
  md: () => import("@shikijs/langs-precompiled/markdown"),
  mdx: () => import("@shikijs/langs-precompiled/mdx"),
  php: () => import("@shikijs/langs-precompiled/php"),
  postcss: () => import("@shikijs/langs-precompiled/postcss"),
  pug: () => import("@shikijs/langs-precompiled/pug"),
  jade: () => import("@shikijs/langs-precompiled/pug"),
  python: () => import("@shikijs/langs-precompiled/python"),
  py: () => import("@shikijs/langs-precompiled/python"),
  r: () => import("@shikijs/langs-precompiled/r"),
  regexp: () => import("@shikijs/langs-precompiled/regexp"),
  regex: () => import("@shikijs/langs-precompiled/regexp"),
  sass: () => import("@shikijs/langs-precompiled/sass"),
  scss: () => import("@shikijs/langs-precompiled/scss"),
  shellscript: () => import("@shikijs/langs-precompiled/shellscript"),
  bash: () => import("@shikijs/langs-precompiled/shellscript"),
  sh: () => import("@shikijs/langs-precompiled/shellscript"),
  shell: () => import("@shikijs/langs-precompiled/shellscript"),
  zsh: () => import("@shikijs/langs-precompiled/shellscript"),
  sql: () => import("@shikijs/langs-precompiled/sql"),
  svelte: () => import("@shikijs/langs-precompiled/svelte"),
  typescript: () => import("@shikijs/langs-precompiled/typescript"),
  ts: () => import("@shikijs/langs-precompiled/typescript"),
  vue: () => import("@shikijs/langs-precompiled/vue"),
  "vue-html": () => import("@shikijs/langs-precompiled/vue-html"),
  wasm: () => import("@shikijs/langs-precompiled/wasm"),
  wgsl: () => import("@shikijs/langs-precompiled/wgsl"),
  xml: () => import("@shikijs/langs-precompiled/xml"),
  yaml: () => import("@shikijs/langs-precompiled/yaml"),
  yml: () => import("@shikijs/langs-precompiled/yaml"),
  tsx: () => import("@shikijs/langs-precompiled/tsx"),
  typescriptreact: () => import("@shikijs/langs-precompiled/tsx"),
  haskell: () => import("@shikijs/langs-precompiled/haskell"),
  hs: () => import("@shikijs/langs-precompiled/haskell"),
  "c#": () => import("@shikijs/langs-precompiled/csharp"),
  csharp: () => import("@shikijs/langs-precompiled/csharp"),
  cs: () => import("@shikijs/langs-precompiled/csharp"),
  latex: () => import("@shikijs/langs-precompiled/latex"),
  lua: () => import("@shikijs/langs-precompiled/lua"),
  mermaid: () => import("@shikijs/langs-precompiled/mermaid"),
  mmd: () => import("@shikijs/langs-precompiled/mermaid"),
  ruby: () => import("@shikijs/langs-precompiled/ruby"),
  rb: () => import("@shikijs/langs-precompiled/ruby"),
  rust: () => import("@shikijs/langs-precompiled/rust"),
  rs: () => import("@shikijs/langs-precompiled/rust"),
  scala: () => import("@shikijs/langs-precompiled/scala"),
  swift: () => import("@shikijs/langs-precompiled/swift"),
  kotlin: () => import("@shikijs/langs-precompiled/kotlin"),
  kt: () => import("@shikijs/langs-precompiled/kotlin"),
  kts: () => import("@shikijs/langs-precompiled/kotlin"),
  "objective-c": () => import("@shikijs/langs-precompiled/objective-c"),
  objc: () => import("@shikijs/langs-precompiled/objective-c"),
} as const;

const createHighlighterWithLangs = createBundledHighlighter({
  langs: SHIKI_LANGS,
  themes: {
    "min-light": () => import("@shikijs/themes/min-light"),
  },
  engine: () => createJavaScriptRegexEngine(),
});

/**
 * コードブロック・数式のシンタックスハイライト用のハイライタ。
 * min-light だけを読む（dark 系を読まないことで、BlockNote 0.54 の「light/dark の対が
 * あれば CSS 変数で両方出す」経路に入らず、読み込み済みテーマの先頭 = min-light が使われる）。
 * 言語は使われたときに読み込む（langs: []）
 */
export function createGraphiumHighlighter(): Promise<HighlighterGeneric<any, any>> {
  return createHighlighterWithLangs({ themes: ["min-light"], langs: [] }) as Promise<HighlighterGeneric<any, any>>;
}
