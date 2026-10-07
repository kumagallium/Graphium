// 資料 id（ノート id / pdf: / document: / url: / chat: / memo:）を TopicSourceRef に解決する。
// 仕様: docs/internal/mcp-upkeep-stage3-spec-2026-10.md §3.1（sources.ts）
// 既存の ../sources.ts（表示用の引き当て）とは別。ここは「実在する出典だけ」を通すための解決。

import { existsSync } from "node:fs";
import { join } from "node:path";

import type { TopicSourceRef } from "../../features/wiki/wiki-service";
import { readNote, notesDir } from "../vault";
import { describeSource, readMediaIndex } from "../sources";

export type SourceRefResolution = { refs: TopicSourceRef[]; missing: string[] };

export function resolveSourceRefs(ids: string[], root: string): SourceRefResolution {
  const refs: TopicSourceRef[] = [];
  const missing: string[] = [];
  const seen = new Set<string>();

  for (const raw of ids) {
    const id = raw.trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);

    const title = resolveTitle(id, root);
    if (title) refs.push({ id, title });
    else missing.push(id);
  }
  return { refs, missing };
}

function resolveTitle(id: string, root: string): string | null {
  const colon = id.indexOf(":");
  const prefix = colon > 0 ? id.slice(0, colon) : "";
  const rest = colon > 0 ? id.slice(colon + 1) : id;

  if (prefix === "pdf" || prefix === "document") {
    return readMediaIndex(root).get(rest)?.name?.trim() || null;
  }
  if (prefix === "url") {
    for (const m of readMediaIndex(root).values()) {
      if (m.type === "url" && m.url === rest) return m.name?.trim() || rest;
    }
    return null;
  }
  if (prefix === "chat" || prefix === "memo") {
    return describeSource(id, root).title || null;
  }
  // ノート id。wiki/ のページは出典にできないので、notes/ に実在するものだけ通す
  if (!existsSync(join(notesDir(root), `${id}.json`))) return null;
  const doc = readNote(id, root);
  if (!doc) return null;
  return doc.title?.trim() || id;
}
