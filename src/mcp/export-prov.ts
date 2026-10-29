// export_prov の本体: ノートの PROV-DM（W3C PROV JSON-LD）を組む。
//
// scope = "note": 1 件のノート（buildNoteProvJsonLd。メモ・素材・フォルダ・出典なども含む）
// scope = "plan": 計画ノートと工程ノート（入れ子も）をまとめた計画の PROV（buildPlanProvJsonLd）
// 対象は pages[0]（Graphium の文書は 1 ページ）。DOM には依存しない（MCP bundle は Node で動く）。
// バレル（prov-generator/index.ts）は通さず、個別ファイルから import する。

import type { GraphiumDocument } from "../lib/document-types";
import type { GraphiumIndex } from "../features/navigation/index-file";
import type { BlockLink } from "../features/block-link/link-types";
import { syncLocale } from "../i18n";
import { generateProvDocument } from "../features/prov-generator/generator";
import { pageToGeneratorInput } from "../features/prov-generator/page-input";
import { buildNoteProvJsonLd } from "../features/prov-export/note-export";
import { collectNoteProvExtras } from "../features/prov-export/note-extras";
import { buildPlanProvJsonLd, type PlanProvExportInput } from "../features/prov-export/plan-export";
import { collectOperationRows, findPlanNotesOf } from "../features/network-graph/plan-flow";
import { isPlanNote } from "../features/note-context/reserved-folders";
import { readCaptureIndex } from "./captures";
import { readMediaIndex } from "./sources";
import { readNote, readNoteIndex } from "./vault";

export type ExportProvScope = "note" | "plan";

export type ExportProvOptions = {
  /** 省略時: 対象が計画ノートなら plan、それ以外は note */
  scope?: ExportProvScope;
  /** チャットを含めるか（既定 false） */
  includeChats?: boolean;
  /** 本文（ノート全文）を含めるか（既定 true） */
  includeBody?: boolean;
  /** vault のルート。指定すると索引・メモ・素材・工程ノートを読む。省略時は doc 単体から組む */
  root?: string;
};

/** 入れ子の工程ノートを読む深さの上限（plan-flow と同じ） */
const MAX_DEPTH = 8;

/** ファイル名・label 用の表示名。title が空なら noteId を使う（アプリ側も同じ規則） */
export function exportDisplayTitle(title: string | undefined | null, noteId: string): string {
  return title && title.trim() ? title : noteId;
}

/**
 * 要求された scope を、対象ノートの種別と突き合わせて決める。
 * 種別は索引のエントリを優先し、エントリが無ければ doc.noteContexts で見る
 * （MCP が書いたノートは索引に載るまで時間がかかる）。
 */
export function resolveExportScope(
  requested: ExportProvScope | undefined,
  noteId: string,
  index: GraphiumIndex | null,
  doc?: Pick<GraphiumDocument, "noteContexts">,
): { scope: ExportProvScope } | { error: string } {
  // 明示した "plan" は、索引が読めないと種別を確かめられない
  if (requested === "plan" && !index && !doc?.noteContexts) {
    return { error: "索引を読めません。Graphium を一度起動してください" };
  }
  const entry = index?.notes.find((n) => n.noteId === noteId);
  const isPlan = isPlanNote(entry?.noteContexts ?? doc?.noteContexts);
  if (!requested) return { scope: isPlan ? "plan" : "note" };
  if (requested === "plan" && !isPlan) {
    return {
      error:
        `scope: "plan" は計画ノート（「計画」フォルダに入っているノート）にだけ使えます: ${noteId}\n` +
        "このノートは計画ノートではありません。scope を省略するか \"note\" にしてください。",
    };
  }
  return { scope: requested };
}

function noteProvDoc(doc: GraphiumDocument) {
  const page = doc.pages?.[0];
  if (!page) return null;
  const provDoc = generateProvDocument({
    ...pageToGeneratorInput(page),
    documentProvenance: doc.documentProvenance,
  });
  return { page, provDoc };
}

/**
 * 計画ノートから工程ノートを読み、docs に集める（幅優先）。
 * 索引で計画ノートと分かる行ノートだけ再帰する。深さは plan-flow と同じ
 * （ルートの行ノート = 0、MAX_DEPTH まで。循環は processed で止める）。
 */
function loadPlanDocs(
  planId: string,
  rootDoc: GraphiumDocument,
  index: GraphiumIndex,
  root: string,
): Map<string, GraphiumDocument> {
  const planIds = new Set(index.notes.filter((n) => isPlanNote(n.noteContexts)).map((n) => n.noteId));
  const docs = new Map<string, GraphiumDocument>([[planId, rootDoc]]);
  const processed = new Set<string>([planId]);
  let queue: { doc: GraphiumDocument; depth: number }[] = [{ doc: rootDoc, depth: 0 }];
  while (queue.length > 0) {
    const next: typeof queue = [];
    for (const { doc, depth } of queue) {
      for (const row of collectOperationRows(doc, index)) {
        if (row.state || !row.noteId) continue;
        let child = docs.get(row.noteId);
        if (!child) {
          child = readNote(row.noteId, root) ?? undefined;
          if (!child) continue;
          docs.set(row.noteId, child);
        }
        if (planIds.has(row.noteId) && !processed.has(row.noteId) && depth < MAX_DEPTH) {
          processed.add(row.noteId);
          next.push({ doc: child, depth: depth + 1 });
        }
      }
    }
    queue = next;
  }
  return docs;
}

/** ノートの PROV-DM を JSON-LD の文字列（整形済み）で返す。ページが無ければ null */
export function buildProvJsonLdText(
  doc: GraphiumDocument,
  noteId: string,
  opts: ExportProvOptions = {},
): string | null {
  const page = doc.pages?.[0];
  if (!page) return null;
  // ラベルの無い名前などを毎回同じ言語で出す
  syncLocale("ja");

  const root = opts.root;
  const index = root ? readNoteIndex(root) : null;
  const captureIndex = root ? readCaptureIndex(root) : null;
  const mediaIndex = root ? readMediaIndex(root) : undefined;
  const options = { includeBody: opts.includeBody ?? true, includeChats: opts.includeChats ?? false };

  const resolved = resolveExportScope(opts.scope, noteId, index, doc);
  if ("error" in resolved) throw new Error(resolved.error);

  if (resolved.scope === "plan" && root && index) {
    const docs = loadPlanDocs(noteId, doc, index, root);
    const notes: PlanProvExportInput["notes"] = new Map();
    for (const [id, d] of docs) {
      const built = noteProvDoc(d);
      if (!built) continue;
      notes.set(id, {
        provDoc: built.provDoc,
        title: exportDisplayTitle(d.title, id),
        page: built.page,
        extras: collectNoteProvExtras({
          doc: d,
          noteId: id,
          captureIndex,
          mediaIndex,
          planContext: { index, planDocs: docs },
        }),
      });
    }
    const out = buildPlanProvJsonLd({ planNoteId: noteId, index, docs, notes, options });
    return JSON.stringify(out, null, 2);
  }

  // note: このノートを工程に持つ計画ノートを読み、線の名前（実績）を引けるようにする
  const planDocs = new Map<string, GraphiumDocument>();
  if (root && index) {
    for (const p of findPlanNotesOf(index, noteId)) {
      const pd = readNote(p.noteId, root);
      if (pd) planDocs.set(p.noteId, pd);
    }
  }
  const built = noteProvDoc(doc)!;
  const crossNoteLinks = (Array.isArray(page.provLinks) ? page.provLinks : []).filter(
    (l): l is BlockLink => l.type === "informed_by" && typeof l.targetNoteId === "string" && l.targetNoteId.length > 0,
  );
  const extras = collectNoteProvExtras({
    doc,
    noteId,
    captureIndex,
    mediaIndex,
    planContext: { index, planDocs },
  });
  const out = buildNoteProvJsonLd({
    provDoc: built.provDoc,
    title: exportDisplayTitle(doc.title, noteId),
    noteId,
    page: built.page,
    crossNoteLinks,
    extras,
    options,
  });
  return JSON.stringify(out, null, 2);
}
