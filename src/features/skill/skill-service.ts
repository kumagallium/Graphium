// Skill サービス（プロンプトテンプレートの管理）

import type { GraphiumDocument, SkillMeta } from "../../lib/document-types";
import type { SystemSkillDefinition } from "./system-skills";

/**
 * 新しい Skill ドキュメントを構築する
 */
export function buildSkillDocument(
  title: string,
  description: string,
  promptContent: string,
  availableForIngest: boolean = true,
  options?: { systemSkillId?: string; language?: "ja" | "en" },
): GraphiumDocument {
  const now = new Date().toISOString();

  const skillMeta: SkillMeta = {
    description,
    availableForIngest,
    createdAt: now,
    ...(options?.systemSkillId ? { systemSkillId: options.systemSkillId } : {}),
    ...(options?.language ? { language: options.language } : {}),
  };

  // プロンプトテンプレートの内容を BlockNote ブロックに変換
  const blocks: any[] = [];

  // 説明ブロック（H2）
  blocks.push({
    id: crypto.randomUUID(),
    type: "heading",
    props: { textColor: "default", backgroundColor: "default", textAlignment: "left", level: 2 },
    content: [{ type: "text", text: "Prompt Template", styles: {} }],
    children: [],
  });

  // プロンプト本文をマークダウンとしてパースしてブロックへ変換
  for (const block of parseMarkdownToBlocks(promptContent)) {
    blocks.push(block);
  }

  return {
    version: 2,
    title,
    pages: [{
      id: "main",
      title,
      blocks,
      labels: {},
      provLinks: [],
      knowledgeLinks: [],
    }],
    source: "skill",
    skillMeta,
    createdAt: now,
    modifiedAt: now,
  };
}

/**
 * Skill ドキュメントからプレーンテキストのプロンプトを抽出する
 *
 * BlockNote のブロック構造をマークダウンとして再シリアライズする。
 * "Prompt Template" 見出しブロック（buildSkillDocument が冒頭に挿入する区切り）は
 * 含めず、それ以降の本文ブロックだけを返す。
 */
export function extractSkillPrompt(doc: GraphiumDocument): string {
  const page = doc.pages[0];
  if (!page) return "";

  const lines: string[] = [];
  let afterDivider = false;

  // マルチカラム（columnList / column）はレイアウト用ラッパーなので透過して
  // 文書順の flat 列として走査する（カラム化した Skill 文書の本文が
  // プロンプトから落ちないように）
  const flattenColumns = (blocks: any[]): any[] =>
    (blocks ?? []).flatMap((block: any) =>
      block?.type === "columnList" || block?.type === "column"
        ? flattenColumns(block.children)
        : [block],
    );

  for (const block of flattenColumns(page.blocks)) {
    // 1 つめの見出しブロック（"Prompt Template" の区切り）はスキップ
    if (!afterDivider && block.type === "heading") {
      afterDivider = true;
      continue;
    }
    if (!afterDivider) continue;

    const md = blockToMarkdown(block);
    if (md !== null) lines.push(md);
  }

  return lines.join("\n");
}

/**
 * Ingest 用のスキルプロンプトセクションを構築する
 * 選択された Skill のプロンプ���テンプレートを結合して system prompt に注入するテキストを返す
 */
export function buildSkillPromptSection(
  skills: { title: string; prompt: string }[],
): string {
  if (skills.length === 0) return "";

  let section = "\n\n## Applied Skills\n\n";
  section += "The following skills should guide your analysis and output:\n\n";

  for (const skill of skills) {
    section += `### ${skill.title}\n\n${skill.prompt}\n\n`;
  }

  return section;
}

/**
 * Skill 一覧から、現在の生成言語に適用すべき Skill だけ抜き出して
 * `{ title, prompt }` 形式に変換する。`language` 未指定の Skill は全言語に適用する。
 *
 * docCacheRef を読み出すための関数を渡す形にすることで、UI 層と疎結合にする。
 */
export function pickActiveSkills(
  skillMetas: Map<string, { title: string; description: string; availableForIngest: boolean; systemSkillId?: string; language?: "ja" | "en" }>,
  getDoc: (skillId: string) => GraphiumDocument | undefined,
  generationLanguage: "ja" | "en",
): { title: string; prompt: string }[] {
  const result: { title: string; prompt: string }[] = [];
  for (const [skillId, meta] of skillMetas.entries()) {
    if (!meta.availableForIngest) continue;
    if (meta.language && meta.language !== generationLanguage) continue;
    const doc = getDoc(skillId);
    if (!doc) continue;
    result.push({ title: meta.title, prompt: extractSkillPrompt(doc) });
  }
  return result;
}

/**
 * システム同梱スキルから Skill ドキュメントを生成する。
 * 初回ブートストラップ時およびリセット時に使用する。
 */
export function buildSystemSkillDocument(def: SystemSkillDefinition): GraphiumDocument {
  return buildSkillDocument(
    def.title,
    def.description,
    def.prompt,
    def.availableForIngest,
    { systemSkillId: def.id, language: def.language },
  );
}

function extractInlineText(content: any): string {
  if (!content) return "";
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content.map((c: any) => c.text ?? c.content ?? "").join("");
  }
  return "";
}

// ----------------------------------------------------------------
// Markdown <-> BlockNote ブロックの相互変換
// ----------------------------------------------------------------

/**
 * インラインの太字 (`**text**`) とコード (`` `text` ``) をパースして
 * BlockNote の inline content 配列に変換する。
 */
function parseInlineMarkdown(line: string): { type: "text"; text: string; styles: Record<string, boolean> }[] {
  const out: { type: "text"; text: string; styles: Record<string, boolean> }[] = [];
  let i = 0;
  while (i < line.length) {
    // **bold**
    if (line[i] === "*" && line[i + 1] === "*") {
      const end = line.indexOf("**", i + 2);
      if (end > i + 2) {
        out.push({ type: "text", text: line.slice(i + 2, end), styles: { bold: true } });
        i = end + 2;
        continue;
      }
    }
    // `code`
    if (line[i] === "`") {
      const end = line.indexOf("`", i + 1);
      if (end > i + 1) {
        out.push({ type: "text", text: line.slice(i + 1, end), styles: { code: true } });
        i = end + 1;
        continue;
      }
    }
    // 通常テキスト（次のマークアップまで）
    let j = i;
    while (j < line.length) {
      if (line[j] === "*" && line[j + 1] === "*") break;
      if (line[j] === "`") break;
      j++;
    }
    if (j > i) {
      out.push({ type: "text", text: line.slice(i, j), styles: {} });
      i = j;
    } else {
      out.push({ type: "text", text: line[i] ?? "", styles: {} });
      i++;
    }
  }
  return out.length > 0 ? out : [{ type: "text", text: "", styles: {} }];
}

/**
 * マークダウン文字列を BlockNote ブロックの配列に変換する。
 * 対応: `## ` h2 / `### ` h3 / `- ` 箇条書き / `1. ` 番号付き箇条書き / `> ` 引用 / 空行 / 通常段落 / `**bold**` / `` `code` ``
 */
function parseMarkdownToBlocks(text: string): any[] {
  const blocks: any[] = [];
  const baseProps = { textColor: "default", backgroundColor: "default", textAlignment: "left" };

  const lines = text.split("\n");
  for (const rawLine of lines) {
    const line = rawLine.replace(/\r$/, "");

    // 空行は段落区切りとして空 paragraph を入れる（BlockNote 上で改行に見える）
    if (line.trim() === "") {
      blocks.push({
        id: crypto.randomUUID(),
        type: "paragraph",
        props: baseProps,
        content: [],
        children: [],
      });
      continue;
    }

    // 見出し ## / ###
    const headingMatch = /^(#{2,3})\s+(.*)$/.exec(line);
    if (headingMatch) {
      const level = headingMatch[1].length;
      blocks.push({
        id: crypto.randomUUID(),
        type: "heading",
        props: { ...baseProps, level },
        content: parseInlineMarkdown(headingMatch[2]),
        children: [],
      });
      continue;
    }

    // 箇条書き
    const bulletMatch = /^[-*]\s+(.*)$/.exec(line);
    if (bulletMatch) {
      blocks.push({
        id: crypto.randomUUID(),
        type: "bulletListItem",
        props: baseProps,
        content: parseInlineMarkdown(bulletMatch[1]),
        children: [],
      });
      continue;
    }

    // 番号付き箇条書き
    const numberedMatch = /^\d+\.\s+(.*)$/.exec(line);
    if (numberedMatch) {
      blocks.push({
        id: crypto.randomUUID(),
        type: "numberedListItem",
        props: baseProps,
        content: parseInlineMarkdown(numberedMatch[1]),
        children: [],
      });
      continue;
    }

    // 引用
    const quoteMatch = /^>\s?(.*)$/.exec(line);
    if (quoteMatch) {
      blocks.push({
        id: crypto.randomUUID(),
        type: "quote",
        props: baseProps,
        content: parseInlineMarkdown(quoteMatch[1]),
        children: [],
      });
      continue;
    }

    // 通常段落
    blocks.push({
      id: crypto.randomUUID(),
      type: "paragraph",
      props: baseProps,
      content: parseInlineMarkdown(line),
      children: [],
    });
  }

  return blocks;
}

/**
 * BlockNote のインラインコンテンツをマークダウン文字列に直す。
 * `bold` と `code` のスタイルを `**...**` / `` `...` `` に戻す。
 */
function inlineContentToMarkdown(content: any): string {
  if (!content) return "";
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((c: any) => {
      const text = c.text ?? c.content ?? "";
      if (!text) return "";
      const styles = c.styles ?? {};
      let result = text;
      if (styles.code) result = `\`${result}\``;
      if (styles.bold) result = `**${result}**`;
      return result;
    })
    .join("");
}

/**
 * BlockNote のブロックをマークダウン 1 行に直す。
 * 空 paragraph は空行として扱う（`""` を返す）。
 * 未対応のブロック種別は null を返してスキップする。
 */
function blockToMarkdown(block: any): string | null {
  if (!block) return null;
  const text = inlineContentToMarkdown(block.content);

  switch (block.type) {
    case "heading": {
      const level = Number(block.props?.level ?? 2);
      const hashes = "#".repeat(Math.max(2, Math.min(3, level)));
      return `${hashes} ${text}`;
    }
    case "bulletListItem":
      return `- ${text}`;
    case "numberedListItem":
      return `1. ${text}`;
    case "quote":
      return `> ${text}`;
    case "paragraph":
      return text; // 空文字も空行として保存
    default:
      // 未知のブロックはテキストだけ拾う
      return text || null;
  }
}
