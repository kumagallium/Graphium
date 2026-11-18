// export_asterism_knowledge の本体。wiki/ 直下の知見とトピックの全部を読んで「知識の束」にする。
// 変換は features/wiki/asterism-knowledge.ts の純関数。台帳（asterism-sent.json）は読まない・書かない。

import { existsSync, readdirSync } from "node:fs";

import type { WikiMeta } from "../lib/document-types";
import {
  buildKnowledgeBundle,
  type KnowledgeBundle,
} from "../features/wiki/asterism-knowledge";
import { allEntries } from "./search";
import { readMediaIndex } from "./sources";
import { readNote, readNoteIndex, resolveGraphiumRoot, wikiDir } from "./vault";

export type ExportAsterismKnowledgeInput = {
  claimBaseIri?: string;
  sourceBaseIri?: string;
  termBaseIri?: string;
  noteUrlBase?: string;
};

export type ExportAsterismKnowledgeResult = KnowledgeBundle | { error: string };

const ERRORS: Record<string, string> = {
  "claim-base-iri-invalid": "claimBaseIri が不正です（http(s) の URL で空白を含まないこと。末尾が / か # でなければ / を補う）。",
  "source-base-iri-invalid": "sourceBaseIri が不正です（http(s) の URL で空白を含まないこと。末尾が / か # でなければ / を補う）。",
  "term-base-iri-invalid": "termBaseIri が不正です（http(s) の URL で空白を含まないこと。末尾が / か # でなければ / を補う）。",
  "note-url-base-invalid": "noteUrlBase が不正です（http(s) の URL で、# や ? を含まないこと）。省略すると公開アプリの URL を使います。",
};

/** 資料の参照（pdf:… / document:… / url:… / ノート id）から名前を引く。引けなければ undefined */
function makeSourceName(root: string): (ref: string) => string | undefined {
  const media = readMediaIndex(root);
  let titles: Map<string, string> | undefined;
  return (ref) => {
    const colon = ref.indexOf(":");
    const prefix = colon > 0 ? ref.slice(0, colon) : "";
    const rest = colon > 0 ? ref.slice(colon + 1) : ref;
    if (prefix === "pdf" || prefix === "document" || prefix === "conversation") return media.get(rest)?.name || undefined;
    if (prefix === "url") {
      for (const m of media.values()) if (m.type === "url" && m.url === rest) return m.name || undefined;
      return undefined;
    }
    if (prefix) return undefined;
    titles ??= new Map(allEntries(root).map((e) => [e.noteId, e.title]));
    return titles.get(ref) || undefined;
  };
}

export function exportAsterismKnowledge(
  input: ExportAsterismKnowledgeInput,
  exportedAt: string,
  root = resolveGraphiumRoot(),
): ExportAsterismKnowledgeResult {
  const dir = wikiDir(root);
  const fileIds = existsSync(dir)
    ? readdirSync(dir)
        .filter((f) => f.endsWith(".json"))
        .map((f) => f.slice(0, -".json".length))
    : [];
  const wikiIds = new Set(fileIds);
  // ゴミ箱・アーカイブ済みは既存の送り口と同じく対象から外す
  const hidden = new Set(
    (readNoteIndex(root)?.notes ?? []).filter((n) => n.deletedAt || n.archivedAt).map((n) => n.noteId),
  );

  const items: { id: string; meta: WikiMeta; title?: string }[] = [];
  for (const id of fileIds) {
    if (hidden.has(id)) continue;
    const doc = readNote(id, root);
    const kind = doc?.wikiMeta?.kind;
    // 知見とトピックだけ（summary / atom / answer は出さない）
    if (!doc?.wikiMeta || (kind !== "claim" && kind !== "topic")) continue;
    items.push({ id, meta: doc.wikiMeta, title: doc.title });
  }

  const bundle = buildKnowledgeBundle(items, {
    exportedAt,
    claimBaseIri: input.claimBaseIri,
    sourceBaseIri: input.sourceBaseIri,
    termBaseIri: input.termBaseIri,
    noteUrlBase: input.noteUrlBase,
    isWikiId: (id) => wikiIds.has(id),
    sourceName: makeSourceName(root),
  });
  if ("error" in bundle) return { error: ERRORS[bundle.error] ?? bundle.error };
  return bundle;
}
