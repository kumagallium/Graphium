// 音声ノートのブロックが持つ「清書」と「要約」（AI が作る派生物）の型と読み書き
//
// 文字起こし（transcript.json）と同じく、ノートではなく録音素材のそばに保存する
// （media/<fileId>.cleanup.json と media/<fileId>.summary.json）。長い会議でもノートが重くならず、
// ノートに入れるかどうかはユーザーが「ノートに書き出す」で選ぶ。
//
// 根拠は文字起こしの発言を (track, startMs) で指す。発言に id は無く、文字起こしをやり直すと
// 並びが変わるため、添字ではなく時刻で引く。

import { invoke } from "@tauri-apps/api/core";

export type ArtifactTrack = "system" | "mic" | null;

/** 根拠の発言（文字起こしの 1 行） */
export type ArtifactSource = { track: ArtifactTrack; startMs: number };

/** 清書の 1 段落。同じ話者の続いた発言をまとめ、言いよどみ・聞き違いを整えた文 */
export type CleanupParagraph = {
  /** 清書の中での id（c1, c2, …）。要約の根拠に使う */
  id: string;
  track: ArtifactTrack;
  startMs: number;
  text: string;
  sources: ArtifactSource[];
};

export type CleanupDoc = {
  version: 1;
  createdAt: string;
  /** 使ったモデルの表示名 */
  model: string;
  paragraphs: CleanupParagraph[];
  /** AI が直した語（聞こえたまま → 直した語）。画面に出して、外れた直しに気付けるようにする */
  fixes?: Array<{ heard: string; meant: string }>;
};

export type SummaryDocItem = { text: string; sources: ArtifactSource[] };
export type SummaryDocTodo = SummaryDocItem & { owner?: string; due?: string };

export type SummaryDoc = {
  version: 1;
  createdAt: string;
  model: string;
  /** 何から作ったか（清書があれば清書から） */
  basedOn: "cleanup" | "transcript";
  decisions: SummaryDocItem[];
  todos: SummaryDocTodo[];
  issues: SummaryDocItem[];
};

export type ArtifactKind = "cleanup" | "summary";

function isTrack(v: unknown): v is ArtifactTrack {
  return v === "system" || v === "mic" || v === null;
}

function parseSources(v: unknown): ArtifactSource[] {
  if (!Array.isArray(v)) return [];
  return v
    .filter((s): s is { track: unknown; startMs: unknown } => !!s && typeof s === "object")
    .filter((s) => isTrack(s.track) && typeof s.startMs === "number" && Number.isFinite(s.startMs))
    .map((s) => ({ track: s.track as ArtifactTrack, startMs: s.startMs as number }));
}

function parseRoot(json: string | null): Record<string, unknown> | null {
  if (!json) return null;
  try {
    const v = JSON.parse(json);
    return v && typeof v === "object" && !Array.isArray(v) && v.version === 1 ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** cleanup.json を読む。壊れている・版が違う・段落が無ければ null */
export function parseCleanupDoc(json: string | null): CleanupDoc | null {
  const r = parseRoot(json);
  if (!r || !Array.isArray(r.paragraphs)) return null;
  const paragraphs: CleanupParagraph[] = [];
  for (const p of r.paragraphs) {
    if (!p || typeof p !== "object") continue;
    const x = p as Record<string, unknown>;
    if (typeof x.id !== "string" || typeof x.text !== "string" || !x.text.trim()) continue;
    if (!isTrack(x.track) || typeof x.startMs !== "number") continue;
    paragraphs.push({ id: x.id, track: x.track, startMs: x.startMs, text: x.text, sources: parseSources(x.sources) });
  }
  if (paragraphs.length === 0) return null;
  const fixes = Array.isArray(r.fixes)
    ? r.fixes
        .filter((f): f is { heard: string; meant: string } => !!f && typeof f.heard === "string" && typeof f.meant === "string")
        .map((f) => ({ heard: f.heard, meant: f.meant }))
    : [];
  return {
    version: 1,
    createdAt: typeof r.createdAt === "string" ? r.createdAt : "",
    model: typeof r.model === "string" ? r.model : "",
    paragraphs,
    ...(fixes.length > 0 ? { fixes } : {}),
  };
}

function parseItems(v: unknown, withMeta: boolean): SummaryDocTodo[] {
  if (!Array.isArray(v)) return [];
  const out: SummaryDocTodo[] = [];
  for (const it of v) {
    if (!it || typeof it !== "object") continue;
    const x = it as Record<string, unknown>;
    if (typeof x.text !== "string" || !x.text.trim()) continue;
    const item: SummaryDocTodo = { text: x.text, sources: parseSources(x.sources) };
    if (withMeta) {
      if (typeof x.owner === "string" && x.owner) item.owner = x.owner;
      if (typeof x.due === "string" && x.due) item.due = x.due;
    }
    out.push(item);
  }
  return out;
}

/** summary.json を読む。壊れている・版が違う・項目が 1 つも無ければ null */
export function parseSummaryDoc(json: string | null): SummaryDoc | null {
  const r = parseRoot(json);
  if (!r) return null;
  const doc: SummaryDoc = {
    version: 1,
    createdAt: typeof r.createdAt === "string" ? r.createdAt : "",
    model: typeof r.model === "string" ? r.model : "",
    basedOn: r.basedOn === "cleanup" ? "cleanup" : "transcript",
    decisions: parseItems(r.decisions, false),
    todos: parseItems(r.todos, true),
    issues: parseItems(r.issues, false),
  };
  return doc.decisions.length + doc.todos.length + doc.issues.length > 0 ? doc : null;
}

/** 素材のそばの付属ファイル（cleanup / summary）を読む。無ければ null（デスクトップ版のみ） */
export const readArtifact = (fileId: string, kind: ArtifactKind) =>
  invoke<string | null>("read_media_sidecar", { fileId, kind });

/** 素材のそばの付属ファイル（cleanup / summary）を書く（デスクトップ版のみ） */
export const saveArtifact = (fileId: string, kind: ArtifactKind, json: string) =>
  invoke<void>("save_media_sidecar", { fileId, kind, json });
