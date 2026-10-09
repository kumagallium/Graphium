// export_asterism_claims の本体。wiki/ の知見を列挙して Asterism 向け flat JSON を組む。
// 変換は features/wiki/asterism-export.ts の純関数を共有する（GUI の書き出しと同じ列の契約）。
// 設定（asterism）は Node 側から localStorage を読めないため、引数で受ける。

import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

import type { WikiMeta } from "../lib/document-types";
import type { AsterismSettings } from "../features/settings/store";
import {
  buildAsterismExport,
  serializeAsterismExport,
  type AsterismSkipReason,
} from "../features/wiki/asterism-export";
import { readNote, readNoteIndex, resolveGraphiumRoot, wikiDir } from "./vault";

/** 設定が渡されないときの既定（全て空。type の IRI は展開できず null になる） */
export const EMPTY_ASTERISM: AsterismSettings = {
  vocabBaseIri: "",
  claimBaseIri: "",
  typeSlugs: { observation: "", interpretation: "", rule: "", judgment: "" },
};

export type ExportAsterismClaimsInput = {
  includeUntyped?: boolean;
  includeInferred?: boolean;
  ids?: string[];
  // 書き出しで使うのは語の基底 IRI と知見の基底 IRI だけ（型の語は各知見の asterism.typeSlug）
  asterism?: { vocabBaseIri?: string; claimBaseIri?: string };
};

export type ExportAsterismClaimsResult = {
  json: string;
  count: number;
  skipped: { id: string; reason: AsterismSkipReason }[];
};

/** 引数の asterism を既定で埋めて AsterismSettings にする */
function resolveAsterism(input: ExportAsterismClaimsInput["asterism"]): AsterismSettings {
  return {
    vocabBaseIri: input?.vocabBaseIri ?? "",
    claimBaseIri: input?.claimBaseIri ?? "",
    typeSlugs: EMPTY_ASTERISM.typeSlugs,
  };
}

export function exportAsterismClaims(
  input: ExportAsterismClaimsInput,
  exportedAt: string,
  root = resolveGraphiumRoot(),
): ExportAsterismClaimsResult {
  const dir = wikiDir(root);
  const fileIds = existsSync(dir)
    ? readdirSync(dir)
        .filter((f) => f.endsWith(".json"))
        .map((f) => f.slice(0, -".json".length))
    : [];
  const wikiIds = new Set(fileIds);
  // ゴミ箱・アーカイブ済みは一覧（GUI の書き出し）と同じく対象から外す
  const hidden = new Set(
    (readNoteIndex(root)?.notes ?? []).filter((n) => n.deletedAt || n.archivedAt).map((n) => n.noteId),
  );
  const allIds = fileIds.filter((id) => !hidden.has(id));
  const targets = input.ids && input.ids.length > 0 ? input.ids : allIds;

  const items: { id: string; meta: WikiMeta; title?: string }[] = [];
  for (const id of targets) {
    // wiki/ 直下のものだけを対象にする（notes/ のノートは知見ではない）
    if (!wikiIds.has(id) || hidden.has(id)) continue;
    const doc = readNote(id, root);
    if (!doc?.wikiMeta) continue;
    items.push({ id, meta: doc.wikiMeta, title: doc.title });
  }

  const { rows, skipped } = buildAsterismExport(items, resolveAsterism(input.asterism), {
    includeUntyped: input.includeUntyped ?? false,
    includeInferred: input.includeInferred ?? false,
    exportedAt,
    isWikiId: (id) => wikiIds.has(id),
  });
  // 知見以外（トピック等）は「除外」ではなく対象外なので skipped から外して件数を読みやすくする
  return {
    json: serializeAsterismExport(rows),
    count: rows.length,
    skipped: skipped.filter((s) => s.reason !== "not-claim"),
  };
}
