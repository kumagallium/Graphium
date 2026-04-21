// Skill サービス（プロンプトテンプレートの管理）

import type { GraphiumDocument, SkillMeta } from "../../lib/document-types";

/**
 * 新しい Skill ドキュメントを構築する
 */
export function buildSkillDocument(
  title: string,
  description: string,
  promptContent: string,
  availableForIngest: boolean = true,
): GraphiumDocument {
  const now = new Date().toISOString();

  const skillMeta: SkillMeta = {
    description,
    availableForIngest,
    createdAt: now,
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

  // プロンプト本文を段落ブロックに分割
  const paragraphs = promptContent.split("\n").filter(Boolean);
  for (const para of paragraphs) {
    blocks.push({
      id: crypto.randomUUID(),
      type: "paragraph",
      props: { textColor: "default", backgroundColor: "default", textAlignment: "left" },
      content: [{ type: "text", text: para, styles: {} }],
      children: [],
    });
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
 */
export function extractSkillPrompt(doc: GraphiumDocument): string {
  const page = doc.pages[0];
  if (!page) return "";

  const lines: string[] = [];
  let afterHeading = false;

  for (const block of page.blocks) {
    if (block.type === "heading") {
      afterHeading = true;
      continue;
    }
    if (afterHeading) {
      const text = extractInlineText(block.content);
      if (text) lines.push(text);
    }
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

function extractInlineText(content: any): string {
  if (!content) return "";
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content.map((c: any) => c.text ?? c.content ?? "").join("");
  }
  return "";
}
