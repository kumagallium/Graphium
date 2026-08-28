// MCP 経由で新しいノートを書き込む。
//
// 既存ノートは一切変更しない（Phase 1 の方針）。新規ファイルを足すだけなので
// 競合・ロック・インデックス再構築の設計を持ち込まずに済む。note-index には
// 書かない（フロントの ensureIndex が次回起動時に拾う）。
//
// 書き込み形式は scripts/claude-code-skill/save-to-graphium/save.mjs と揃える。
// 片方を変えたら両方直すこと。
//
// generatedBy は「誰がこのノートを書いたか」の観測記録として残す。会話から手順を
// 推論して PROV を捏造するのではなく、**実際に起きた書き込みという事実**だけを
// 記録する（PROVision と同じ流儀）。

import { mkdirSync, writeFileSync } from "node:fs";
import { userInfo } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

import { markdownToBlocks } from "./markdown-to-blocks";
import { notesDir, resolveGraphiumRoot } from "./vault";

export type CreateNoteInput = {
  title: string;
  /** Markdown 本文 */
  body: string;
  /** 呼び出し側のセッション識別子（あれば） */
  sessionId?: string;
  /** 書記役の LLM モデル ID（例: claude-opus-5） */
  model?: string;
  /** MCP クライアント名（claude-desktop / claude-code など）。initialize の clientInfo 由来 */
  client?: string;
};

export type CreateNoteResult = {
  noteId: string;
  filePath: string;
  title: string;
  author: { username: string; email?: string };
};

/**
 * 誰が保存したかを解決する。
 * username は識別のため常に記録し、email は明示的な opt-in があるときだけ入れる。
 */
function resolveAuthor(): { username: string; email?: string } {
  const user: { username: string; email?: string } = { username: userInfo().username };
  const email = process.env.GRAPHIUM_USER_EMAIL?.trim();
  if (email) user.email = email;
  return user;
}

export function buildNoteDocument(input: CreateNoteInput): Record<string, unknown> {
  const now = new Date().toISOString();
  const generatedBy: Record<string, unknown> = {
    // どの経路で書かれたかが後から分かるように、クライアント名まで残す
    agent: input.client ? `graphium-mcp (${input.client})` : "graphium-mcp",
    sessionId: input.sessionId ?? "unknown",
    user: resolveAuthor(),
  };
  if (input.model?.trim()) generatedBy.model = input.model.trim();

  return {
    version: 2,
    title: input.title,
    pages: [
      {
        id: "main",
        title: input.title,
        blocks: markdownToBlocks(input.body),
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

export function createNote(
  input: CreateNoteInput,
  root = resolveGraphiumRoot(),
): CreateNoteResult {
  if (!input.title?.trim()) throw new Error("title is required");
  if (typeof input.body !== "string") throw new Error("body is required");

  const dir = notesDir(root);
  mkdirSync(dir, { recursive: true });

  const noteId = randomUUID();
  const filePath = join(dir, `${noteId}.json`);
  const doc = buildNoteDocument(input);
  writeFileSync(filePath, JSON.stringify(doc, null, 2), "utf8");

  return {
    noteId,
    filePath,
    title: input.title,
    author: (doc.generatedBy as { user: { username: string; email?: string } }).user,
  };
}
