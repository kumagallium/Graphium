// メモ（CaptureEntry）を取り込み用の一時ドキュメントにする。
// アプリ（note-app.tsx のメモのナレッジ化）と MCP（start_claim_task の memo:）が使う。
// ノートは作らず、行ごとに段落ブロック化して ingest に流す。

import type { GraphiumDocument } from "../../lib/document-types";

export function buildMemoNoteDoc(text: string, fallbackTitle: string): GraphiumDocument {
  const baseProps = { textColor: "default", backgroundColor: "default", textAlignment: "left" };
  // 行ごとに段落ブロック化（空行は空 paragraph = BlockNote 上の改行）
  const blocks = text.split("\n").map((rawLine) => {
    const line = rawLine.replace(/\r$/, "");
    return {
      id: crypto.randomUUID(),
      type: "paragraph",
      props: baseProps,
      content: line.trim() === "" ? [] : [{ type: "text", text: line, styles: {} }],
      children: [],
    };
  });
  // タイトルは先頭の非空行を 40 字で切る
  const firstLine = text.split("\n").map((l) => l.trim()).find((l) => l.length > 0) ?? "";
  const title = (firstLine || fallbackTitle).slice(0, 40);
  const now = new Date().toISOString();
  return {
    version: 5,
    title,
    pages: [{
      id: crypto.randomUUID(),
      title,
      blocks,
      labels: {},
      provLinks: [],
      knowledgeLinks: [],
    }],
    createdAt: now,
    modifiedAt: now,
    source: "human",
  };
}
