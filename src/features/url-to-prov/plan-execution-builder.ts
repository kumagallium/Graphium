// Plan ノート + 実施ノートの組み立て（external-source-extraction-prompt.md §6）。
//
// 抽出器の出力は `ProvIngesterOutput[]` で受け取る。要素 1 個が 1 procedure に対応する:
//   - N == 1 → 単一の実施ノート（plan ノートは作らない）
//   - N >= 2 → 1 つの plan ノート + N 個の実施ノート
//             実施ノートに partOfPlanNoteId（plan ノートのファイル ID）を付ける
//
// 現在の open-set prompt は 1 回の抽出につき 1 ProvIngesterOutput を返すため、
// 呼び出し側は通常 `[output]` として N=1 で渡す（→ plan ノートは作られない）。
// 将来、LLM 出力を procedureGroup 単位で複数 ProvIngesterOutput に分割するように
// なれば、その配列をそのまま渡すだけで plan + 実施構造に展開される。
//
// ノートファイル ID はストレージプロバイダーが保存時に発番するため、ここでは
// ドキュメント自体は組み立てるが ID 解決は呼び出し側の責務とする。設計は
// "two-pass save" を想定:
//   1. 実施ノートを順に保存して ID を得る
//   2. plan ノートを実施ノート ID 入りで組んで保存（→ plan ID を得る）
//   3. 各実施ノートに partOfPlanNoteId = plan ID を patch して再保存
//
// この helper は (1) (2) 用のドキュメント組み立てだけを担う。

import type { GraphiumDocument } from "../../lib/document-types";
import type { ProvIngesterOutput } from "../../server/services/prov-ingester";
import { buildProvNoteDocument } from "./prov-note-builder";

export type PlanExecutionSourceMeta = {
  /** 論文・URL のタイトル */
  paperTitle?: string;
  /** 元 URL（PDF 経路なら undefined） */
  sourceUrl?: string;
  /** PDF 経路の場合のメディア fileId */
  sourcePdfFileId?: string;
  /** 元 URL のページタイトル（fetch 時点） */
  sourceTitle?: string;
  /** ISO 8601 取得日時 */
  sourceFetchedAt: string;
  model?: string | null;
  tokenUsage?: { input_tokens: number; output_tokens: number; total_tokens: number };
  /** 論文 abstract（plan ノートの先頭に置く、optional） */
  abstract?: string;
};

export type PlanExecutionBuildResult = {
  /** 単一 procedure の場合は plan を作らず実施ノートだけを返す */
  planNote: GraphiumDocument | null;
  executionNotes: GraphiumDocument[];
  /** procedure 順に対応する title（plan ノートの index 行ラベルとして使う） */
  procedureLabels: string[];
};

/**
 * 抽出結果（procedure ごとの ProvIngesterOutput 配列）から plan/execution
 * ノートを組み立てる。
 *
 * planNote.partOfPlanNoteId は当然 undefined。executionNote.partOfPlanNoteId は
 * **未設定で返す**（plan ID が確定するのは保存後なので、呼び出し側で patch する）。
 */
export function buildPlanAndExecutionNotes(
  procedures: ProvIngesterOutput[],
  sourceMeta: PlanExecutionSourceMeta,
): PlanExecutionBuildResult {
  if (procedures.length === 0) {
    return { planNote: null, executionNotes: [], procedureLabels: [] };
  }

  const procedureLabels = procedures.map((p, i) => safeProcedureLabel(p, i));

  const executionNotes: GraphiumDocument[] = procedures.map((procedure) =>
    buildProvNoteDocument({
      title: procedure.title,
      blocks: procedure.blocks,
      sourceUrl: sourceMeta.sourceUrl,
      sourcePdfFileId: sourceMeta.sourcePdfFileId,
      sourceTitle: sourceMeta.sourceTitle,
      sourceFetchedAt: sourceMeta.sourceFetchedAt,
      model: sourceMeta.model,
      tokenUsage: sourceMeta.tokenUsage,
    }),
  );

  if (procedures.length === 1) {
    return { planNote: null, executionNotes, procedureLabels };
  }

  const planNote = buildPlanNote(procedures.length, sourceMeta, procedureLabels);
  return { planNote, executionNotes, procedureLabels };
}

function safeProcedureLabel(p: ProvIngesterOutput, index: number): string {
  return p.title?.trim() || `Procedure ${index + 1}`;
}

/**
 * Plan ノート（navigation note）を組み立てる。
 *
 * - source ヘッダ（URL or PDF 名）
 * - intro 段落（「この論文は N 本の合成手順を含む」など）
 * - 実施ノート一覧（bullet list、各行は実施ノート title — 保存後に内部 mention に置換）
 *
 * 注: 内部 mention（実施ノートへのリンク）は plan/execution の ID が揃った後に
 * patch するため、ここではプレースホルダ的に title のみを bullet 行に書く。
 */
function buildPlanNote(
  procedureCount: number,
  sourceMeta: PlanExecutionSourceMeta,
  procedureLabels: string[],
): GraphiumDocument {
  const now = new Date().toISOString();
  const planTitle = sourceMeta.paperTitle?.trim() || sourceMeta.sourceTitle?.trim() || "Synthesis procedures";

  const blocks: any[] = [buildSourceHeader(sourceMeta)];

  if (sourceMeta.abstract && sourceMeta.abstract.trim().length > 0) {
    blocks.push({
      id: crypto.randomUUID(),
      type: "heading",
      props: { textColor: "default", backgroundColor: "default", textAlignment: "left", level: 2 },
      content: [{ type: "text", text: "Abstract", styles: {} }],
      children: [],
    });
    blocks.push({
      id: crypto.randomUUID(),
      type: "paragraph",
      props: { textColor: "default", backgroundColor: "default", textAlignment: "left" },
      content: [{ type: "text", text: sourceMeta.abstract.trim(), styles: {} }],
      children: [],
    });
  }

  blocks.push({
    id: crypto.randomUUID(),
    type: "heading",
    props: { textColor: "default", backgroundColor: "default", textAlignment: "left", level: 2 },
    content: [{ type: "text", text: "Procedures", styles: {} }],
    children: [],
  });

  blocks.push({
    id: crypto.randomUUID(),
    type: "paragraph",
    props: { textColor: "default", backgroundColor: "default", textAlignment: "left" },
    content: [
      {
        type: "text",
        text: `This source describes ${procedureCount} distinct procedures.`,
        styles: {},
      },
    ],
    children: [],
  });

  for (const label of procedureLabels) {
    blocks.push({
      id: crypto.randomUUID(),
      type: "bulletListItem",
      props: { textColor: "default", backgroundColor: "default", textAlignment: "left" },
      content: [{ type: "text", text: label, styles: {} }],
      children: [],
    });
  }

  return {
    version: 5,
    title: planTitle,
    pages: [
      {
        id: "main",
        title: planTitle,
        blocks,
        labels: {},
        provLinks: [],
        knowledgeLinks: [],
      },
    ],
    sourceUrl: sourceMeta.sourceUrl,
    sourceFetchedAt: sourceMeta.sourceFetchedAt,
    sourceTitle: sourceMeta.sourceTitle,
    sourcePdfFileId: sourceMeta.sourcePdfFileId,
    sourcePdfName: sourceMeta.sourcePdfFileId ? sourceMeta.sourceTitle : undefined,
    generatedBy: {
      agent: "prov-ingester",
      sessionId: sourceMeta.sourcePdfFileId
        ? `pdf:${sourceMeta.sourcePdfFileId}`
        : `url:${sourceMeta.sourceUrl ?? ""}`,
      model: sourceMeta.model ?? undefined,
      tokenUsage: sourceMeta.tokenUsage,
    },
    createdAt: now,
    modifiedAt: now,
  };
}

function buildSourceHeader(meta: PlanExecutionSourceMeta): any {
  if (meta.sourcePdfFileId) {
    return {
      id: crypto.randomUUID(),
      type: "paragraph",
      props: { textColor: "default", backgroundColor: "default", textAlignment: "left" },
      content: [
        { type: "text", text: "Source: ", styles: { bold: true } },
        { type: "text", text: meta.sourceTitle || "PDF", styles: {} },
      ],
      children: [],
    };
  }
  const url = meta.sourceUrl ?? "";
  return {
    id: crypto.randomUUID(),
    type: "paragraph",
    props: { textColor: "default", backgroundColor: "default", textAlignment: "left" },
    content: [
      { type: "text", text: "Source: ", styles: { bold: true } },
      {
        type: "link",
        href: url,
        content: [{ type: "text", text: meta.sourceTitle || url, styles: {} }],
      },
    ],
    children: [],
  };
}

/**
 * 実施ノートに plan ノートの ID を付与する（two-pass save の 3rd pass 用）。
 * 元のドキュメントは破壊せず、コピーを返す。
 */
export function withPartOfPlanNoteId(
  doc: GraphiumDocument,
  planNoteId: string,
): GraphiumDocument {
  return { ...doc, partOfPlanNoteId: planNoteId };
}
