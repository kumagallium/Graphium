// MCP Apps（会話の中に画面を描く拡張）の道具と画面の登録。
//
// 対応しているホスト（Claude Desktop など）は、道具の _meta.ui.resourceUri を見て
// ui:// の HTML を iframe に描き、道具の結果をその画面に渡す。
// 画面向けのデータは結果の _meta に載せる。structuredContent に入れると、Claude Code のように
// 画面を描かないクライアントがそれを文字の結果の代わりにモデルへ渡し、ノート全体が文脈に入るため。
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

import { getGraphViewHtml, getKnowledgeGraphHtml } from "./apps/graph-view-html";
import { getNotePreviewHtml } from "./apps/note-preview-html";
import { buildFlowPayload, buildKnowledgeAppPayload, buildLineagePayload, GRAPH_REF_KEY, type GraphPayload, type GraphRef, type KnowledgeAppPayload } from "./graph-views";
import { traceLineage } from "./lineage";
import { describeSource, isExternalSourceId, isUnknownExternalSource } from "./sources";
import { buildNotePreview, flattenPreviewBlocks, type NotePreview } from "./note-preview";
import type { ToolContext } from "./tools";
import { findMediaDataFile, mediaDir, validateMediaId } from "./media-tools";
import { getEntry } from "./search";
import { readNote, vaultExists } from "./vault";

export const NOTE_PREVIEW_URI = "ui://graphium/note-preview.html";
export const GRAPH_VIEW_URI = "ui://graphium/graph.html";
/** 全体グラフの画面（アプリの GlobalGraphView をそのまま描く。apps/graph-app/main.tsx） */
export const KNOWLEDGE_GRAPH_URI = "ui://graphium/knowledge-graph.html";

/** 全体グラフの道具の _meta */
export const KNOWLEDGE_GRAPH_TOOL_META = {
  ui: { resourceUri: KNOWLEDGE_GRAPH_URI },
  [RESOURCE_URI_META_KEY]: KNOWLEDGE_GRAPH_URI,
} as const;

/** グラフを描く道具の _meta（新旧どちらの書き方のホストでも読めるよう両方入れる） */
export const GRAPH_VIEW_TOOL_META = {
  ui: { resourceUri: GRAPH_VIEW_URI },
  [RESOURCE_URI_META_KEY]: GRAPH_VIEW_URI,
} as const;

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

/** 結果の _meta にプレビューを載せるキー（画面だけが読む。モデルの文脈には入らない） */
export const PREVIEW_META_KEY = "graphium/preview";

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

/** 結果に載せた参照（道具と引数）から、描くデータを vault から組み直す（どの MCP プロセスでも同じ図になる） */
export function buildGraphFromRef(ref: GraphRef): { payload: GraphPayload | KnowledgeAppPayload } | { error: string } {
  if (!vaultExists()) return { error: "Graphium の vault が見つかりません。" };
  if (ref.tool === "show_knowledge_graph") {
    const payload = buildKnowledgeAppPayload({ folder: ref.folder });
    return payload ? { payload } : { error: "NO_INDEX: Graphium を一度起動してください（note-index.json がありません）。" };
  }
  const noteId = ref.noteId ?? "";
  if (ref.tool === "show_steps") {
    const doc = readNote(noteId);
    if (!doc) return { error: `ノートが見つかりません: ${noteId}` };
    const payload = buildFlowPayload(doc as any);
    return payload ? { payload } : { error: `このノートには手順ブロックがありません: ${doc.title ?? noteId}` };
  }
  const external = isExternalSourceId(noteId);
  const doc = external ? null : readNote(noteId);
  if ((!external && !doc) || (external && isUnknownExternalSource(noteId))) return { error: `ノートまたは資料が見つかりません: ${noteId}` };
  const startTitle = doc ? (doc.title ?? noteId) : describeSource(noteId).title;
  return { payload: buildLineagePayload(traceLineage(noteId, { direction: ref.direction, depth: ref.depth }), startTitle) };
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
      annotations: { readOnlyHint: true, openWorldHint: false },
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
        _meta: { [PREVIEW_META_KEY]: preview, [PREVIEW_IMAGES_META_KEY]: resolvePreviewImages(preview) },
      };
    },
  );

  // ── グラフ（手順の流れ・来歴・全体グラフ） ─────────────────────
  registerAppResource(
    server,
    "Graphium graph",
    GRAPH_VIEW_URI,
    { description: "Graphium の手順の流れ・来歴・全体グラフを会話の中に描く画面" },
    async () => ({
      contents: [
        {
          uri: GRAPH_VIEW_URI,
          mimeType: RESOURCE_MIME_TYPE,
          text: await getGraphViewHtml(),
          _meta: { ui: { csp: { connectDomains: [], resourceDomains: [] }, prefersBorder: false } },
        },
      ],
    }),
  );

  // 結果には「何を描くか」（道具と引数）だけを載せ、グラフのデータは画面が graph_payload で取りに行く。
  // Claude Desktop では、モデルからの呼び出しと画面からの呼び出しが別の MCP プロセスに届くことがあり、
  // 大きな結果（全体グラフは数百 KB）の届け方もホスト次第なので、結果に頼らない。どのプロセスでも
  // vault から同じ図を組み直せるよう、参照は道具の名前と引数そのものにする。
  // structuredContent は画面を描かないクライアント（Claude Code）ではモデルに渡るので、小さく保ち、要約の文も入れる
  registerAppResource(
    server,
    "Graphium knowledge graph",
    KNOWLEDGE_GRAPH_URI,
    { description: "Graphium の全体グラフを、アプリと同じ見た目（島・印・光り方）で会話の中に描く画面" },
    async () => ({
      contents: [
        {
          uri: KNOWLEDGE_GRAPH_URI,
          mimeType: RESOURCE_MIME_TYPE,
          text: await getKnowledgeGraphHtml(),
          _meta: { ui: { csp: { connectDomains: [], resourceDomains: [] }, prefersBorder: false } },
        },
      ],
    }),
  );

  const graphResult = (summary: string, ref: GraphRef): CallToolResult => ({
    content: [{ type: "text", text: summary }],
    structuredContent: { summary, [GRAPH_REF_KEY]: ref },
  });

  registerAppTool(
    server,
    "show_steps",
    {
      title: "手順の流れを図で見せる",
      description:
        "ノート 1 件の手順の流れ（材料・装置 → 手順 → 生成物のつながりと条件）を、会話の中に図として描く（対応しているクライアントのみ）。" +
        "手順ノートを作った直後（submit_procedure のあと）に、つながりを確かめてもらうときにも使う。" +
        "中身を文字で読みたいだけなら get_note_steps を使う。",
      inputSchema: { noteId: z.string().describe("ノート ID") },
      annotations: { readOnlyHint: true, openWorldHint: false },
      _meta: GRAPH_VIEW_TOOL_META,
    },
    async ({ noteId }) => {
      if (!vaultExists()) return text("Graphium の vault が見つかりません。");
      const doc = readNote(noteId);
      if (!doc) return text(`ノートが見つかりません: ${noteId}`);
      const payload = buildFlowPayload(doc as any);
      if (!payload) return text(`このノートには手順ブロックがありません: ${doc.title ?? noteId}`);
      void ctx.usage?.recordRead(noteId);
      const steps = payload.nodes.filter((n) => n.kind === "step").length;
      return graphResult(
        `「${payload.title}」の手順の流れを図で表示しました（手順 ${steps} 件・実体 ${payload.nodes.length - steps} 件）。` +
          "文字で読むなら get_note_steps を使ってください。",
        { tool: "show_steps", noteId },
      );
    },
  );

  registerAppTool(
    server,
    "show_lineage",
    {
      title: "来歴を図で見せる",
      description:
        "ノート・ナレッジのページ・資料の来歴（派生元と派生先）を、会話の中に図として描く（対応しているクライアントのみ）。" +
        "「この結論はどこから来たのか」を見せたいときに使う。文字で知りたいだけなら trace_lineage を使う。",
      inputSchema: {
        noteId: z.string().describe("起点のノート ID（pdf:… / document:… / url:… の資料 id も可）"),
        direction: z.enum(["upstream", "downstream", "both"]).optional().describe("辿る向き（既定 both）"),
        depth: z.number().int().min(1).max(5).optional().describe("何段辿るか（既定 2）"),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
      _meta: GRAPH_VIEW_TOOL_META,
    },
    async ({ noteId, direction, depth }) => {
      if (!vaultExists()) return text("Graphium の vault が見つかりません。");
      const external = isExternalSourceId(noteId);
      const doc = external ? null : readNote(noteId);
      if ((!external && !doc) || (external && isUnknownExternalSource(noteId))) {
        return text(`ノートまたは資料が見つかりません: ${noteId}`);
      }
      const startTitle = doc ? (doc.title ?? noteId) : describeSource(noteId).title;
      const result = traceLineage(noteId, { direction, depth });
      for (const n of [...result.upstream, ...result.downstream]) ctx.activity?.push("walk", n.noteId, n.fromId ?? noteId);
      return graphResult(
        `「${startTitle}」の来歴を図で表示しました（上流 ${result.upstream.length} 件・下流 ${result.downstream.length} 件・つながり ${result.connections.length} 件）。` +
          "文字で読むなら trace_lineage を使ってください。",
        { tool: "show_lineage", noteId, ...(direction ? { direction } : {}), ...(depth ? { depth } : {}) },
      );
    },
  );

  registerAppTool(
    server,
    "show_knowledge_graph",
    {
      title: "全体グラフを見せる",
      description:
        "Graphium の全体グラフ（ノート・トピック・知見・洞察・資料のつながり）を、会話の中に描く（対応しているクライアントのみ）。" +
        "開いている間、この会話で読んだページ・たどった線・書いたページが光るので、" +
        "ユーザーが「どこを見て答えているか見ながら話したい」と言ったときに、会話の最初に開く。" +
        "folder を指定するとそのフォルダの外を薄く描く。ホストが対応していれば、会話の横に浮かせて表示できる。",
      inputSchema: {
        folder: z.string().optional().describe("範囲にするフォルダ（\"親\" または \"親/子\"）。外は薄く描く"),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
      _meta: KNOWLEDGE_GRAPH_TOOL_META,
    },
    async ({ folder }) => {
      if (!vaultExists()) return text("Graphium の vault が見つかりません。");
      const payload = buildKnowledgeAppPayload({ folder });
      if (!payload) return text("NO_INDEX: Graphium を一度起動してください（note-index.json がありません）。");
      return graphResult(
        `全体グラフを表示しました（${payload.data.nodes.length} ノード・${payload.data.edges.length} 本の線` +
          (payload.scopeIds ? `・フォルダの範囲 ${payload.scopeIds.length} 件` : "") +
          `）。この会話で読んだ・書いたページはグラフの上で光ります。`,
        { tool: "show_knowledge_graph", ...(folder ? { folder } : {}) },
      );
    },
  );

  // 画面だけが呼ぶ道具（モデルには見せない）。グラフのデータを、結果に載せた参照（道具と引数）から組み直して返す
  registerAppTool(
    server,
    "graph_payload",
    {
      title: "グラフのデータを受け取る",
      description: "グラフの画面が、show_steps / show_lineage / show_knowledge_graph の結果に載った参照から、描くデータを受け取る。画面専用。",
      inputSchema: {
        tool: z.enum(["show_steps", "show_lineage", "show_knowledge_graph"]).describe("どの道具の図か"),
        noteId: z.string().optional().describe("show_steps / show_lineage の起点"),
        direction: z.enum(["upstream", "downstream", "both"]).optional(),
        depth: z.number().int().min(1).max(5).optional(),
        folder: z.string().optional().describe("show_knowledge_graph の範囲"),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
      _meta: { ui: { resourceUri: GRAPH_VIEW_URI, visibility: ["app"] } },
    },
    async (ref) => {
      const r = buildGraphFromRef(ref as GraphRef);
      if ("error" in r) return { content: [{ type: "text", text: r.error }], isError: true };
      const n = "data" in r.payload ? r.payload.data.nodes.length : r.payload.nodes.length;
      return { content: [{ type: "text", text: `${n} nodes` }], structuredContent: { payload: r.payload } };
    },
  );

  // 画面だけが呼ぶ道具（モデルには見せない）。全体グラフが数秒おきに、触れたものを受け取る
  registerAppTool(
    server,
    "graph_activity",
    {
      title: "グラフに光らせる出来事を受け取る",
      description: "全体グラフの画面が、外の AI が触れたもの（読んだ・検索に出た・たどった・書いた）を受け取る。画面専用。",
      inputSchema: {
        since: z.number().int().min(0).optional().describe("前回の返事の cursor（既定 0）"),
        notBefore: z.string().optional().describe("これより前（ISO 時刻）の出来事は返さない"),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
      _meta: { ui: { resourceUri: GRAPH_VIEW_URI, visibility: ["app"] } },
    },
    async ({ since, notBefore }) => {
      const r = ctx.activity?.since(since ?? 0, notBefore ? { notBefore } : {}) ?? { events: [], cursor: since ?? 0 };
      return {
        content: [{ type: "text", text: `${r.events.length} events` }],
        structuredContent: r,
      };
    },
  );
}
