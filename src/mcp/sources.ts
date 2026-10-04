// 出どころ ID（ノート ID / 外部資料 ID）を、人とアシスタントが読める形に引く。
//
// ナレッジ層の derivedFromNotes や、資料から作ったトピックのメンバーには、ノート ID だけでなく
// `pdf:<fileId>` / `document:<fileId>` / `url:<URL>` / `chat:…` / `memo:…` のような
// 外部資料の ID が混ざる（src/features/network-graph/graph-builder.ts と同じ約束）。
// これを生の ID のまま返すと「document:3954…」としか読めず、アシスタントは出典を示せない。
// PDF・Word 等の名前は素材インデックス（appdata/media-index.json）にあるので、そこから引く。

import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import type { MediaIndexEntry } from "../features/asset-browser/media-index";
import { allEntries } from "./search";
import { appDataDir, resolveGraphiumRoot } from "./vault";

export type SourceKind = "note" | "pdf" | "document" | "url" | "chat" | "memo" | "unknown";

export type SourceRef = {
  /** 元の ID（そのまま返す。Graphium 側で開くときの手がかり） */
  id: string;
  /** 表示名。引けなければ ID を短くしたもの */
  title: string;
  kind: SourceKind;
};

/** 種類ごとの読み手向けの呼び名 */
export const SOURCE_KIND_LABEL: Record<SourceKind, string> = {
  note: "ノート",
  pdf: "PDF",
  document: "Word などの文書",
  url: "Web ページ",
  chat: "AI チャット",
  memo: "メモ",
  unknown: "不明",
};

// 素材インデックスは数百件で軽いが、ツール呼び出しのたびに読み直さないよう mtime で持つ
let mediaCache: { path: string; mtimeMs: number; byFileId: Map<string, MediaIndexEntry> } | null = null;

/** 素材インデックスを fileId で引ける形で読む。無い・壊れているときは空 */
export function readMediaIndex(root = resolveGraphiumRoot()): Map<string, MediaIndexEntry> {
  const path = join(appDataDir(root), "media-index.json");
  if (!existsSync(path)) return new Map();
  try {
    const mtimeMs = statSync(path).mtimeMs;
    if (mediaCache && mediaCache.path === path && mediaCache.mtimeMs === mtimeMs) {
      return mediaCache.byFileId;
    }
    const parsed = JSON.parse(readFileSync(path, "utf8")) as { media?: MediaIndexEntry[] };
    const byFileId = new Map((parsed.media ?? []).map((m) => [m.fileId, m]));
    mediaCache = { path, mtimeMs, byFileId };
    return byFileId;
  } catch {
    return new Map();
  }
}

/** テスト用: 素材インデックスのキャッシュを捨てる */
export function resetMediaIndexCache(): void {
  mediaCache = null;
}

/** 出どころ ID が外部資料（ノートでないもの）か */
export function isExternalSourceId(id: string): boolean {
  return /^(pdf|document|url|chat|memo):/.test(id);
}

/**
 * 出どころ ID 1 件を表示名つきで引く。
 * titles はノート ID → タイトルの表（呼び出し側で作ってあれば渡す。無ければ索引から作る）。
 */
export function describeSource(
  id: string,
  root = resolveGraphiumRoot(),
  titles?: Map<string, string>,
): SourceRef {
  const colon = id.indexOf(":");
  const prefix = colon > 0 ? id.slice(0, colon) : "";
  const rest = colon > 0 ? id.slice(colon + 1) : id;

  if (prefix === "pdf" || prefix === "document") {
    const m = readMediaIndex(root).get(rest);
    return {
      id,
      kind: prefix,
      title: m?.name ?? `${prefix === "pdf" ? "PDF" : "Document"} ${rest.slice(0, 8)}`,
    };
  }
  if (prefix === "url") {
    // URL 素材として登録されていればその名前（ページタイトル）を使う
    let name: string | undefined;
    for (const m of readMediaIndex(root).values()) {
      if (m.type === "url" && m.url === rest) {
        name = m.name;
        break;
      }
    }
    return { id, kind: "url", title: name ? `${name}（${rest}）` : rest };
  }
  if (prefix === "chat") return { id, kind: "chat", title: "AI チャット" };
  if (prefix === "memo") return { id, kind: "memo", title: "メモ" };

  const table = titles ?? new Map(allEntries(root).map((e) => [e.noteId, e.title]));
  const title = table.get(id);
  return title !== undefined ? { id, kind: "note", title } : { id, kind: "unknown", title: id };
}

/** 素材インデックスにも索引にも見当たらない外部資料 ID か（pdf:/document: の打ち間違いなど） */
export function isUnknownExternalSource(id: string, root = resolveGraphiumRoot()): boolean {
  const m = /^(pdf|document):(.+)$/.exec(id);
  return m ? !readMediaIndex(root).has(m[2]) : false;
}

/** 1 行の表示: 「名前（種類）[id: …]」 */
export function formatSource(ref: SourceRef): string {
  // 引けなかったノート ID（削除済みなど）は名前が ID そのものなので、二重に書かない
  if (ref.kind === "unknown") return `（見つからないノート）  [noteId: ${ref.id}]`;
  const idLabel = ref.kind === "note" ? "noteId" : "id";
  const kind = ref.kind === "note" ? "" : `（${SOURCE_KIND_LABEL[ref.kind]}）`;
  return `${ref.title}${kind}  [${idLabel}: ${ref.id}]`;
}
