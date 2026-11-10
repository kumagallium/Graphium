// MCP Apps（会話の中に画面を描く拡張）の道具と画面の登録。
//
// 対応しているホスト（Claude Desktop など）は、道具の _meta.ui.resourceUri を見て
// ui:// の HTML を iframe に描き、道具の結果（structuredContent）をその画面に渡す。
// 対応していないホスト（Claude Code・Codex など）には今までどおり文字の結果だけが届く。
// 画面は Mac の中で完結する — HTML は stdio で渡し、画面から外のサイトへは何も読みに行かない。

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import {
  RESOURCE_MIME_TYPE,
  RESOURCE_URI_META_KEY,
  registerAppResource,
  registerAppTool,
} from "@modelcontextprotocol/ext-apps/server";
import { readFileSync, statSync } from "node:fs";
import { extname } from "node:path";
import { z } from "zod";

import { getNotePreviewHtml } from "./apps/note-preview-html";
import { buildNotePreview, flattenPreviewBlocks, type NotePreview } from "./note-preview";
import type { ToolContext } from "./tools";
import { findMediaDataFile, mediaDir, validateMediaId } from "./media-tools";
import { getEntry } from "./search";
import { readNote, vaultExists } from "./vault";

export const NOTE_PREVIEW_URI = "ui://graphium/note-preview.html";

/** 道具の定義に付ける _meta（新旧どちらの書き方のホストでも読めるよう両方入れる） */
export const NOTE_PREVIEW_TOOL_META = {
  ui: { resourceUri: NOTE_PREVIEW_URI },
  [RESOURCE_URI_META_KEY]: NOTE_PREVIEW_URI,
} as const;

/** noteId のノートからプレビューを作る。見つからなければ null */
export function notePreviewFor(noteId: string): NotePreview | null {
  const doc = readNote(noteId);
  if (!doc) return null;
  return buildNotePreview({ noteId, doc: doc as any, modifiedAt: getEntry(noteId)?.modifiedAt });
}

/** 結果の _meta に画像を載せるキー（画面だけが読む。モデルの文脈には入らない） */
export const PREVIEW_IMAGES_META_KEY = "graphium/previewImages";

/** 画面に埋め込む画像の上限。会話の中の画面なので、大きな原寸画像は名前だけにする */
const IMAGE_MAX_BYTES = 2 * 1024 * 1024;
const IMAGES_MAX_TOTAL_BYTES = 8 * 1024 * 1024;
const IMAGES_MAX_COUNT = 20;

const IMAGE_MIME: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".avif": "image/avif",
};

/**
 * プレビューの画像ブロックのうち、手元の素材にあるものを data URL にする（blockId → data URL）。
 * 外のサイトの画像・見つからない素材・上限を超えるものは入れない（画面は名前だけを見せる）。
 * SVG は入れない（<img> 経由ならスクリプトは動かないが、中身を検査せずに配らない）。
 */
export function resolvePreviewImages(preview: NotePreview, root?: string): Record<string, string> {
  const out: Record<string, string> = {};
  const dir = mediaDir(root);
  let total = 0;
  let count = 0;
  for (const block of flattenPreviewBlocks(preview.blocks)) {
    if (block.kind !== "media" || block.mediaType !== "image" || !block.mediaId || !block.blockId) continue;
    if (count >= IMAGES_MAX_COUNT) break;
    if (validateMediaId(block.mediaId) !== null) continue;
    const file = findMediaDataFile(dir, block.mediaId);
    if (!file) continue;
    const mime = IMAGE_MIME[extname(file).toLowerCase()];
    if (!mime) continue;
    let size: number;
    try {
      size = statSync(file).size;
    } catch {
      continue;
    }
    if (size > IMAGE_MAX_BYTES || total + size > IMAGES_MAX_TOTAL_BYTES) continue;
    try {
      out[block.blockId] = `data:${mime};base64,${readFileSync(file).toString("base64")}`;
    } catch {
      continue;
    }
    total += size;
    count += 1;
  }
  return out;
}

function text(s: string): CallToolResult {
  return { content: [{ type: "text", text: s }] };
}

export function registerAppTools(server: McpServer, ctx: ToolContext = {}): void {
  registerAppResource(
    server,
    "Graphium note preview",
    NOTE_PREVIEW_URI,
    { description: "Graphium のノートを会話の中に読み取り専用で描く画面" },
    async () => ({
      contents: [
        {
          uri: NOTE_PREVIEW_URI,
          mimeType: RESOURCE_MIME_TYPE,
          text: await getNotePreviewHtml(),
          // 外から何も読まないので、接続先・読み込み元は空のまま（ホストの既定の最も狭い CSP）
          _meta: { ui: { csp: { connectDomains: [], resourceDomains: [] }, prefersBorder: false } },
        },
      ],
    }),
  );

  registerAppTool(
    server,
    "show_note",
    {
      title: "ノートを画面で見せる",
      description:
        "Graphium のノートを、会話の中に読み取り専用の画面として描く（対応しているクライアントのみ。" +
        "Claude Desktop など）。見出し・手順・表・PROV ラベルが見た目のまま分かる。" +
        "ユーザーが「見せて」「開いて」と言ったとき、ノートを作った直後に確かめてもらいたいときに使う。" +
        "本文を読んで答えたいだけなら get_note を使う（こちらは画面向けで、文字の結果は要約だけ）。",
      inputSchema: {
        noteId: z.string().describe("ノート ID（search_notes の結果に含まれる）"),
      },
      annotations: { readOnlyHint: true },
      _meta: NOTE_PREVIEW_TOOL_META,
    },
    async ({ noteId }) => {
      if (!vaultExists()) return text("Graphium の vault が見つかりません。");
      const preview = notePreviewFor(noteId);
      if (!preview) return text(`ノートが見つかりません: ${noteId}`);
      void ctx.usage?.recordRead(noteId);
      return {
        content: [
          {
            type: "text",
            text:
              `ノート「${preview.title}」を画面に表示しました（noteId: ${noteId}、${preview.blocks.length} ブロック）。` +
              "本文の中身が必要なら get_note で読んでください。",
          },
        ],
        structuredContent: { preview },
        _meta: { [PREVIEW_IMAGES_META_KEY]: resolvePreviewImages(preview) },
      };
    },
  );
}
