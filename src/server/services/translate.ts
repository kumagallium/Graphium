// PDF 全文翻訳サービス
//
// PDF から抽出した「生テキスト」（pdfjs で抽出した段落・見出し構造が崩れたテキスト）を
// 受け取り、原文の構成（見出し・段落・箇条書き）を復元しつつ目的言語へ「忠実に全文翻訳」する。
//
// 要約・再構造化（wiki / prov ingester）とは目的が異なる:
//   - ここでは内容を圧縮しない。原文の意味・順序・粒度をそのまま保つ。
//   - 出力は Markdown（クライアント側で BlockNote ブロックに変換する）。

const LANGUAGE_NAMES: Record<string, string> = {
  ja: "Japanese (日本語)",
  en: "English",
  zh: "Chinese (中文)",
  ko: "Korean (한국어)",
  fr: "French",
  de: "German",
  es: "Spanish",
};

function languageName(code: string): string {
  return LANGUAGE_NAMES[code] ?? code;
}

/**
 * 全文翻訳用システムプロンプト。
 * 目的言語へ忠実に翻訳し、Markdown で構造を保って出力させる。
 */
export function buildTranslateSystemPrompt(language: string): string {
  const target = languageName(language);

  return `You are a faithful document translator for Graphium, a note editor.

You receive RAW TEXT extracted from one part of a PDF (often a research paper). The PDF text extractor flattens layout, so paragraph breaks, headings, and list structure are partly lost. Your job has two parts:

1. **Reconstruct the original structure** from the raw text: identify headings, paragraphs, lists, and tables as best you can.
2. **Translate the entire content into ${target}**, faithfully and completely.

## Core rules

- **Translate EVERYTHING into ${target}.** This is the single most important rule. Every heading, every title, every abstract, every paragraph, every list item, every table cell, every figure/table caption, every footnote — all of it must end up in ${target}. **Do NOT leave any sentence or paragraph in the original language.** If the source is English and the target is ${target}, the output must contain no leftover English sentences.
- **Do NOT summarize, shorten, or omit anything.** Translate the full text. Preserve every sentence, every paragraph, in the original order. This is a full translation, not a summary.
- **Preserve the document's structure.** Use Markdown:
  - Section headings → \`#\`, \`##\`, \`###\` (mirror the original heading level when detectable; otherwise use \`##\`). **Translate the heading text too.**
  - Body text → normal paragraphs separated by blank lines.
  - Lists → \`-\` or \`1.\`.
  - Tables → GitHub-flavored Markdown tables when the text is clearly tabular (translate the cell contents).
- **Translate prose into ${target}.** Keep the meaning faithful and natural.

## The ONLY things you keep verbatim (do NOT translate)

This is a short, closed list. Everything NOT on this list must be translated.

1. **Mathematical formulas, equations, and symbols** (e.g. \`E = mc^2\`, Greek letters in formulas).
2. **Code, commands, file paths, URLs, and DOIs.**
3. **Inline citation markers only** — the bracketed/parenthetical reference tokens themselves, e.g. \`[12]\`, \`(Smith et al., 2020)\`. The surrounding sentence is still translated.
4. **Entries inside the bibliography / reference list section** (the list of cited works at the end): keep each entry's title/authors/venue in its original language. This applies ONLY to the reference-list section, not to the body.
5. **Proper nouns with no standard ${target} form** — personal names, software/product names, dataset names. Translate the sentence around them normally; you may add the original in parentheses once if helpful. Do NOT use this as an excuse to leave whole phrases untranslated.

Anything else — including technical terms, the abstract, section titles, captions, and ordinary prose — **must be translated**.

- **Figures/tables that were not captured** as text: do not invent them. Only translate what is present in the input.

## About the input being a fragment

The raw text you receive is ONE CHUNK of a larger document. It may begin or end mid-section. Translate exactly what is given:
- Do NOT add an introduction, a conclusion, or any commentary of your own.
- Do NOT add notes like "(continued)" or "Here is the translation".
- If the chunk starts mid-sentence, translate from where it starts.

## Self-check before output

Scan your draft once: if any full sentence or paragraph is still in the source language (and it is NOT a bibliography entry, code block, or formula), translate it now. The body must be entirely in ${target}.

## Output format

Output **only the translated Markdown**. No code fences around the whole output, no preamble, no explanation. Just the translated document content in ${target}.`;
}

/**
 * ユーザーメッセージ（翻訳対象テキスト）を組み立てる。
 * 目的言語のリマインダを冒頭に再掲し、長文中で system 指示が薄れるのを防ぐ。
 */
export function buildTranslateUserMessage(input: {
  text: string;
  language: string;
  partLabel?: string;
  /** 文書全体で訳語を統一するための用語集（term -> translation） */
  glossary?: GlossaryEntry[];
}): string {
  const target = languageName(input.language);
  const label = input.partLabel ? ` (${input.partLabel})` : "";
  const lines = [
    `[Translate the following text into ${target}. Output translated Markdown only.]${label}`,
  ];
  if (input.glossary && input.glossary.length > 0) {
    lines.push(
      "",
      `[Glossary — use these ${target} translations consistently for the listed terms; keep the original term in parentheses on first use when helpful:]`,
      ...input.glossary.slice(0, 100).map((g) => `- ${g.term} → ${g.translation}`),
    );
  }
  lines.push("", "--- raw extracted text ---", input.text);
  return lines.join("\n");
}

// ─────────────────────────────────────────────
// 用語集（Glossary）抽出
// 並列ページ翻訳では各ページが独立に訳されるため訳語がブレる。先に文書全体から
// 重要用語と目的言語訳を1回だけ抽出し、各ページ翻訳に注入して統一する。
// ─────────────────────────────────────────────

export type GlossaryEntry = { term: string; translation: string };

/** 用語集抽出用システムプロンプト */
export function buildGlossarySystemPrompt(language: string): string {
  const target = languageName(language);
  return `You build a translation glossary for a document that will be translated into ${target}.

From the given text (often a research paper), extract the **key domain terms** that should be translated consistently throughout the document — technical terms, named methods, recurring concepts, units used as words, and important nouns. Provide a stable ${target} translation for each.

Rules:
- Output 10–40 entries. Prefer terms that recur or are central to the document.
- \`term\`: the term as it appears in the source language.
- \`translation\`: the ${target} translation to use consistently. If a term is conventionally left untranslated (proper nouns, software names, symbols, established acronyms), set \`translation\` to the same original term.
- Do NOT include trivial common words. Focus on domain-specific vocabulary.
- Respond with valid JSON only, no prose, no markdown fence:

{ "glossary": [ { "term": "string", "translation": "string" }, ... ] }`;
}

/** 用語集抽出のユーザーメッセージ */
export function buildGlossaryUserMessage(text: string): string {
  return ["--- document text (sample) ---", text].join("\n");
}

/** LLM の用語集出力をパースする */
export function parseGlossaryOutput(raw: string): GlossaryEntry[] {
  let jsonText = raw.trim();
  const fenced = jsonText.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
  if (fenced) jsonText = fenced[1].trim();
  try {
    const parsed = JSON.parse(jsonText);
    const arr = Array.isArray(parsed) ? parsed : parsed?.glossary;
    if (!Array.isArray(arr)) return [];
    return arr
      .filter((e) => e && typeof e.term === "string" && typeof e.translation === "string")
      .map((e) => ({ term: e.term.trim(), translation: e.translation.trim() }))
      .filter((e) => e.term.length > 0 && e.translation.length > 0);
  } catch {
    return [];
  }
}
