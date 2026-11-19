// ノート 1 件の PROV-DM（W3C PROV JSON-LD）を、整形済みの文字列で組む共通の関数。
//
// MCP の export_prov（src/mcp/export-prov.ts）と、共有フォルダの「読める写し」
// （src/features/sharing/readable-copy.ts）が同じ手順で組むための置き場。
// ファイルや DOM には触れない純粋な関数（索引などは呼び出し側が読んで渡す）。
// バレル（prov-generator/index.ts）は通さず、個別ファイルから import する（MCP bundle は Node で動く）。

import type { GraphiumDocument } from "../../lib/document-types";
import type { BlockLink } from "../block-link/link-types";
import type { CaptureIndex } from "../mobile-capture/capture-store";
import type { MediaIndexEntry } from "../asset-browser/media-index";
import type { GraphiumIndex } from "../navigation/index-file";
import { generateProvDocument } from "../prov-generator/generator";
import { pageToGeneratorInput } from "../prov-generator/page-input";
import { buildNoteProvJsonLd, type NoteProvExportInput } from "./note-export";
import { collectNoteProvExtras, type CollectNoteProvExtrasInput } from "./note-extras";
import type { WikiEntityInfo } from "./export-jsonld";

export type NoteProvJsonLdTextInput = {
  /** ノートの索引（他ノートへのつながりの相手の種類と題を引く） */
  noteIndex?: GraphiumIndex | null;
  mediaIndex?: MediaIndexEntry[] | Map<string, MediaIndexEntry> | null;
  /** メモ（captures.json）。渡さなければメモは出さない */
  captureIndex?: CaptureIndex | null;
  /** 書き出す人 */
  identity?: { name?: string; email?: string };
  /** 計画の線の名前（実績）を引くための材料 */
  planContext?: CollectNoteProvExtrasInput["planContext"];
  wikiEntities?: WikiEntityInfo[];
  options?: NoteProvExportInput["options"];
  /** 素材に指定した元データを含めるか（既定は含める） */
  includeSourceData?: boolean;
};

/** ノートの PROV-DM を JSON-LD の文字列（整形済み）で返す。ページが無ければ null */
export function buildNoteProvJsonLdText(
  doc: GraphiumDocument,
  noteId: string,
  input: NoteProvJsonLdTextInput = {},
): string | null {
  const page = doc.pages?.[0];
  if (!page) return null;
  const provDoc = generateProvDocument({
    ...pageToGeneratorInput(page),
    documentProvenance: doc.documentProvenance,
  });
  const crossNoteLinks = (Array.isArray(page.provLinks) ? page.provLinks : []).filter(
    (l): l is BlockLink => l.type === "informed_by" && typeof l.targetNoteId === "string" && l.targetNoteId.length > 0,
  );
  const extras = collectNoteProvExtras({
    doc,
    noteId,
    captureIndex: input.captureIndex,
    mediaIndex: input.mediaIndex,
    wikiEntities: input.wikiEntities,
    identity: input.identity,
    noteIndex: input.noteIndex,
    planContext: input.planContext,
    includeSourceData: input.includeSourceData,
  });
  const out = buildNoteProvJsonLd({
    provDoc,
    title: doc.title && doc.title.trim() ? doc.title : noteId,
    noteId,
    page,
    wikiEntities: input.wikiEntities,
    crossNoteLinks,
    extras,
    options: input.options,
  });
  return JSON.stringify(out, null, 2);
}
