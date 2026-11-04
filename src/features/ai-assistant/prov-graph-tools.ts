// チャットの agentic search の段 2: 来歴グラフを辿る道具（ブラウザで実行）
//
// 段 1 の search_my_knowledge / read_my_page は「語と意味で探す」道具。ここは
// ユーザーが付けた PROV ラベル（手順・材料・道具・条件・出力）と来歴リンクを
// 「構造で辿る」道具で、MCP の同名ツールと同じ本体（features/prov-graph）を使う。
//   - find_notes_using: この材料・道具・条件を使ったノートを横断で探す
//   - get_note_steps:   ノートの手順を順に、各手順の材料・道具・条件と一緒に取り出す
//   - trace_lineage:    ノートの上流（元にしたもの）・下流（元にしたノート）を辿る
//   - list_entities:    どんなラベルが記録されているかの一覧（探す語が分からないときの入口）
//
// データは noteIndex と doc キャッシュ（NoteApp が setProvGraphReader で渡す）。
// 結果に出したノートには [#N | "title"] の番号を振り、会話の引用と同じ番号空間に載せる。

import { buildIndexEntry } from "../navigation/index-file";
import type { MediaIndexEntry } from "../asset-browser/media-index";
import type { GraphiumDocument } from "../../lib/document-types";
import type { NoteIndexEntry } from "../navigation/index-file";
import { ENTITY_LABELS, findNotesUsing, listEntities, type EntityLabel } from "../prov-graph/entities";
import { traceLineage, type LineageNode } from "../prov-graph/lineage";
import type { ProvGraphReader } from "../prov-graph/reader";
import { isExternalSourceId } from "../prov-graph/source-id";
import { collectSteps } from "../../mcp/note-text";
import { t } from "../../i18n";

/** 同名のナレッジと区別するためにノートの題名へ添える語（表示言語に合わせる） */
export function noteTitleSuffix(): string {
  return t("aiChat.toolStep.noteSuffix");
}

export const FIND_NOTES_USING_TOOL = "find_notes_using";
export const GET_NOTE_STEPS_TOOL = "get_note_steps";
export const TRACE_LINEAGE_TOOL = "trace_lineage";
export const LIST_ENTITIES_TOOL = "list_entities";

export const PROV_TOOL_NAMES = [
  FIND_NOTES_USING_TOOL,
  GET_NOTE_STEPS_TOOL,
  TRACE_LINEAGE_TOOL,
  LIST_ENTITIES_TOOL,
] as const;

/** 1 回の結果の上限（会話の文脈を食い尽くさない） */
const MAX_OUTPUT_CHARS = 6_000;
/** find_notes_using で 1 ラベルあたりに並べるノート数 */
const MAX_NOTES_PER_GROUP = 12;
/** list_entities の既定件数 */
const DEFAULT_ENTITY_LIMIT = 60;

// ── アプリから渡される読み口 ──────────────────────────────

export type AppGraphData = {
  /** ゴミ箱・アーカイブを除いた索引エントリ（ノートとナレッジ） */
  entries: () => NoteIndexEntry[];
  /** doc キャッシュ（ノートは素の id、ナレッジは `wiki:<id>`）。無ければ undefined */
  getCachedDoc: (key: string) => GraphiumDocument | undefined;
  /** キャッシュに無いノートを読む（手順を取り出すときだけ使う） */
  loadDoc?: (noteId: string) => Promise<GraphiumDocument | null>;
  /** 素材の一覧（資料 ID の表示名に使う） */
  media: () => MediaIndexEntry[];
};

let appData: AppGraphData | null = null;

/** NoteApp が索引の変化に合わせて呼ぶ。null で外す */
export function setProvGraphData(data: AppGraphData | null): void {
  appData = data;
}

/** アプリのデータを読む reader（同期。本体を読めないノートは null） */
export function appGraphReader(data: AppGraphData): ProvGraphReader {
  return {
    entries: () => data.entries(),
    readNote: (id) => data.getCachedDoc(id) ?? data.getCachedDoc(`wiki:${id}`) ?? null,
    sourceTitle: (id, titles) => sourceTitleFrom(id, data, titles),
  };
}

/** 出どころ ID の表示名（src/mcp/sources.ts の describeSource と同じ規則） */
function sourceTitleFrom(id: string, data: AppGraphData, titles?: Map<string, string>): string {
  const colon = id.indexOf(":");
  const prefix = colon > 0 ? id.slice(0, colon) : "";
  const rest = colon > 0 ? id.slice(colon + 1) : id;
  if (prefix === "pdf" || prefix === "document") {
    const m = data.media().find((x) => x.fileId === rest);
    return m?.name ?? `${prefix === "pdf" ? "PDF" : "Document"} ${rest.slice(0, 8)}`;
  }
  if (prefix === "url") {
    const m = data.media().find((x) => x.type === "url" && x.url === rest);
    return m ? `${m.name} (${rest})` : rest;
  }
  if (prefix === "chat") return "AI chat";
  if (prefix === "memo") return "Memo";
  const table = titles ?? new Map(data.entries().map((e) => [e.noteId, e.title]));
  return table.get(id) ?? id;
}

// ── 会話側の採番・範囲 ───────────────────────────────────

export type ProvToolContext = {
  /** ノートに番号を振って見出しを返す（同じノートは同じ番号） */
  cite(noteId: string, title: string, isWiki: boolean): string;
  /** 番号・題名から既知のノートを引く（read_my_page と同じ番号空間） */
  titleOfNumber(n: number): string | undefined;
  /** 来歴の道具自身が番号を振ったノートの ID（題名に「（ノート）」を添えた場合も引ける） */
  idOfNumber?(n: number): string | undefined;
  /** フォルダで絞った会話の範囲。指定があればその外のノートは出さない */
  onlyIds?: ReadonlySet<string>;
};

/** `#N` / 題名 / ノート ID を索引のエントリに解決する */
function resolveEntry(ref: unknown, ctx: ProvToolContext, entries: NoteIndexEntry[]): NoteIndexEntry | null {
  if (typeof ref !== "string") return null;
  const trimmed = ref.trim();
  if (!trimmed) return null;
  const byId = entries.find((e) => e.noteId === trimmed);
  if (byId) return byId;
  const num = trimmed.match(/^\[?#?(\d+)\]?$/);
  if (num) {
    const id = ctx.idOfNumber?.(parseInt(num[1], 10));
    const hit = id ? entries.find((e) => e.noteId === id) : undefined;
    if (hit) return hit;
  }
  const title = num ? ctx.titleOfNumber(parseInt(num[1], 10)) : trimmed.replace(/^"|"$/g, "");
  if (!title) return null;
  const suffix = noteTitleSuffix();
  const bare = suffix && title.endsWith(suffix) ? title.slice(0, -suffix.length) : title;
  return entries.find((e) => e.title === title) ?? entries.find((e) => e.title === bare && !e.wikiKind) ?? null;
}

const inScope = (ctx: ProvToolContext, noteId: string) => !ctx.onlyIds || ctx.onlyIds.has(noteId);

const cap = (text: string) =>
  text.length > MAX_OUTPUT_CHARS ? `${text.slice(0, MAX_OUTPUT_CHARS)}\n…(truncated)` : text;

const isEntityLabel = (v: unknown): v is EntityLabel =>
  typeof v === "string" && (ENTITY_LABELS as string[]).includes(v);

// ── 道具の本体 ───────────────────────────────────────────

/**
 * 来歴の道具を 1 回実行する。name が来歴の道具でなければ null（呼び出し側が他の道具に回す）。
 * データがまだ渡されていないときは説明つきのエラー文字列を返す。
 */
export async function runProvTool(
  name: string,
  input: Record<string, unknown>,
  ctx: ProvToolContext,
): Promise<string | null> {
  if (!(PROV_TOOL_NAMES as readonly string[]).includes(name)) return null;
  const data = appData;
  if (!data) return "Error: the note graph is not loaded yet.";
  const reader = appGraphReader(data);
  const entries = data.entries().filter((e) => inScope(ctx, e.noteId));
  const isWiki = (e: NoteIndexEntry | undefined) => !!e?.wikiKind || e?.source === "ai";
  const entryById = new Map(entries.map((e) => [e.noteId, e]));

  if (name === LIST_ENTITIES_TOOL) {
    const label = isEntityLabel(input.label) ? input.label : undefined;
    const minNotes = typeof input.minNotes === "number" && input.minNotes >= 1 ? Math.floor(input.minNotes) : 1;
    const groups = listEntities(entries, { label, minNotes, limit: DEFAULT_ENTITY_LIMIT });
    if (groups.length === 0) return "No labeled materials, tools, conditions, or outputs yet.";
    const lines = groups.map((g) => `${g.label}: ${g.text} — ${g.noteCount} note(s)`);
    return cap(`Labels recorded in the user's notes (most shared first):\n${lines.join("\n")}`);
  }

  if (name === FIND_NOTES_USING_TOOL) {
    const text = typeof input.text === "string" ? input.text.trim() : "";
    if (!text) return "Error: text is required.";
    const label = isEntityLabel(input.label) ? input.label : undefined;
    const groups = findNotesUsing(entries, { text: text.slice(0, 200), label });
    if (groups.length === 0) {
      return `No notes label "${text}" as a material, tool, condition, or output. (Try list_entities to see what is labeled, or search_my_knowledge for plain text.)`;
    }
    const out = groups.map((g) => {
      const notes = g.notes.slice(0, MAX_NOTES_PER_GROUP).map((n) => {
        const header = ctx.cite(n.noteId, n.title, isWiki(entryById.get(n.noteId)));
        return `  ${header}`;
      });
      const more = g.notes.length > MAX_NOTES_PER_GROUP ? `\n  …and ${g.notes.length - MAX_NOTES_PER_GROUP} more` : "";
      return `■ ${g.label}: ${g.text} — ${g.noteCount} note(s)\n${notes.join("\n")}${more}`;
    });
    return cap(`Notes that use "${text}":\n\n${out.join("\n\n")}`);
  }

  if (name === GET_NOTE_STEPS_TOOL) {
    const entry = resolveEntry(input.ref, ctx, entries);
    if (!entry) return `Not found: ${String(input.ref ?? "")}`;
    let doc = reader.readNote(entry.noteId);
    if (!doc && data.loadDoc) doc = await data.loadDoc(entry.noteId);
    if (!doc) return `Not found: ${entry.title} (could not read the note)`;
    const header = ctx.cite(entry.noteId, entry.title, isWiki(entry));
    const steps = collectSteps(doc);
    if (steps.length === 0) {
      return `${header}\nThis note has no step blocks. (read_my_page reads its full text.)`;
    }
    const inline = buildIndexEntry(entry.noteId, doc).inlineLabels ?? [];
    const blocks = steps.map((s) => {
      const own = new Set([s.blockId, ...s.childBlockIds]);
      const labels = inline.filter((il) => own.has(il.blockId));
      const byLabel = ENTITY_LABELS.map((label) => {
        const items = Array.from(new Set(labels.filter((l) => l.label === label).map((l) => l.text)));
        return items.length ? `   ${label}: ${items.join(", ")}` : null;
      }).filter(Boolean);
      return [
        `${s.order}. ${s.title}`,
        ...byLabel,
        s.body ? `   ${s.body.replace(/\n/g, "\n   ")}` : null,
      ]
        .filter(Boolean)
        .join("\n");
    });
    return cap(`${header}\nSteps (${steps.length}, in order):\n\n${blocks.join("\n\n")}`);
  }

  // trace_lineage
  const entry = resolveEntry(input.ref, ctx, entries);
  if (!entry) return `Not found: ${String(input.ref ?? "")}`;
  const direction =
    input.direction === "upstream" || input.direction === "downstream" ? input.direction : "both";
  const depth = typeof input.depth === "number" ? Math.min(3, Math.max(1, Math.floor(input.depth))) : 2;
  const result = traceLineage(entry.noteId, { direction, depth }, reader);
  const fmt = (nodes: LineageNode[]) => {
    const shown = nodes.filter((n) => isExternalSourceId(n.noteId) || inScope(ctx, n.noteId));
    if (shown.length === 0) return "  (none)";
    return shown
      .map((n) => {
        const indent = "  ".repeat(n.depth);
        const via = n.via ? `[${n.via.layer}/${n.via.type}] ` : "";
        const label = isExternalSourceId(n.noteId)
          ? `${reader.sourceTitle(n.noteId)} (source file)`
          : ctx.cite(n.noteId, n.title || reader.sourceTitle(n.noteId), isWiki(entryById.get(n.noteId)));
        const step = n.via?.stepTitle ? ` ← step "${n.via.stepTitle}"` : "";
        return `${indent}└ ${via}${label}${step}`;
      })
      .join("\n");
  };
  const header = ctx.cite(entry.noteId, entry.title, isWiki(entry));
  return cap(
    [
      `Lineage of ${header}`,
      "",
      "Upstream (what this note was built from):",
      fmt(result.upstream),
      "",
      "Downstream (what was built from this note):",
      fmt(result.downstream),
    ].join("\n"),
  );
}
