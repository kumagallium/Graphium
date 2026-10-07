// export_prov の本体: ノート 1 件の PROV-DM（W3C PROV JSON-LD）を組む。
//
// アプリの「PROV を書き出す」と同じ入口（generateProvDocument → buildW3CProvJsonLd）を使う。
// 対象は pages[0]（Graphium の文書は 1 ページ）。他ノートへの informed_by は crossNoteLinks として渡す。

import type { GraphiumDocument } from "../lib/document-types";
import { syncLocale } from "../i18n";
import { generateProvDocument } from "../features/prov-generator/generator";
import { pageToGeneratorInput } from "../features/prov-generator/page-input";
import { buildW3CProvJsonLd } from "../features/prov-export/export-jsonld";
import type { BlockLink } from "../features/block-link/link-types";

/** ノートの PROV-DM を JSON-LD の文字列（整形済み）で返す。ページが無ければ null */
export function buildProvJsonLdText(doc: GraphiumDocument, noteId: string): string | null {
  const page = doc.pages?.[0];
  if (!page) return null;
  // ラベルの無い名前などを毎回同じ言語で出す
  syncLocale("ja");
  const provDoc = generateProvDocument({
    ...pageToGeneratorInput(page),
    documentProvenance: doc.documentProvenance,
  });
  const crossNoteLinks = (Array.isArray(page.provLinks) ? page.provLinks : []).filter(
    (l): l is BlockLink => l.type === "informed_by" && typeof l.targetNoteId === "string" && l.targetNoteId.length > 0,
  );
  const jsonLd = buildW3CProvJsonLd(provDoc, doc.title || noteId, undefined, crossNoteLinks);
  return JSON.stringify(jsonLd, null, 2);
}
