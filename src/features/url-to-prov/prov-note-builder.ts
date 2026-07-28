// PROV Ingester 出力 → GraphiumDocument 組み立て
//
// LLM の階層ブロック出力を BlockNote のブロックツリーにマップし、
// LLM が出した依存関係（material.derivedFrom / procedure.dependsOn）から
// informed_by リンク（次手順→前手順）を組み立てる。
//
// 依存情報が一切無い場合は文書順の線形連鎖にフォールバック。
// （LLM が依存判定をサボっても最低限手順が繋がる保険）

import type { GraphiumDocument } from "../../lib/document-types";
import {
  LATEST_DOCUMENT_VERSION,
  convertProcedureHeadingsToSteps,
} from "../../lib/document-migration";
import { normalizeLabel, CORE_LABELS, type CoreLabel } from "../context-label/labels";

// Phase E (2026-04-30): material/tool/attribute/output は block-level ラベルから
// インラインハイライト（BlockNote inline style）に移行。
// ProvIngester は LLM 出力の role: "material" 等を、ブロック内テキスト全体に適用する
// inline style として書き戻す。
const INLINE_SCOPE_LABELS = new Set<CoreLabel>(["material", "tool", "attribute", "output"]);
const INLINE_LABEL_TO_STYLE_KEY: Record<string, string> = {
  material: "inlineMaterial",
  tool: "inlineTool",
  attribute: "inlineAttribute",
  output: "inlineOutput",
};

function makeInlineEntityId(label: CoreLabel): string {
  const rand = Math.random().toString(36).slice(2, 10);
  return `ent_${label}_${rand}`;
}

export type ProvSpan = {
  text: string;
  role?: string;
  derivedFrom?: string;
};

export type ProvIngesterBlock = {
  /** 単一テキスト（heading や span 表現を使わない旧形式の本文） */
  text?: string;
  /** Phase F (2026-05-07): 散文の本文を span の連なりで表す */
  content?: ProvSpan[];
  role?: string;
  blockType?: "paragraph" | "heading" | "bulletListItem" | "numberedListItem";
  level?: 1 | 2 | 3;
  children?: ProvIngesterBlock[];
  stepId?: string;
  derivedFrom?: string;
  dependsOn?: string[];
};

export type BuildProvNoteParams = {
  title: string;
  blocks: ProvIngesterBlock[];
  /** 出典が外部 URL の場合のみ設定（URLtoPROV 経路） */
  sourceUrl?: string;
  /** 出典が PDF の場合に設定（PDFtoPROV 経路）。メディアインデックス上の fileId */
  sourcePdfFileId?: string;
  /** 出典が Word 等のドキュメント素材の場合に設定。メディアインデックス上の fileId */
  sourceDocumentFileId?: string;
  sourceTitle?: string;
  sourceFetchedAt: string;
  model?: string | null;
  tokenUsage?: { input_tokens: number; output_tokens: number; total_tokens: number };
};

// 内部中間表現: 変換中に追跡する手順情報
type ProcedureRecord = {
  blockId: string;
  stepId: string | null;
  /** 文書順のインデックス（fallback 連鎖に使う） */
  order: number;
};

// 変換中に蓄積する依存関係（source step ← target step）
type Dependency = {
  fromBlockId: string; // informed_by の「source」= 次手順
  toBlockId: string;   // informed_by の「target」= 前手順
};

/**
 * PROV Ingester 出力から GraphiumDocument を構築する
 */
export function buildProvNoteDocument(params: BuildProvNoteParams): GraphiumDocument {
  const now = new Date().toISOString();

  const labels: Record<string, string> = {};
  const procedures: ProcedureRecord[] = [];
  const dependencies: Dependency[] = [];
  const stepIdToBlockId = new Map<string, string>();

  // 変換時に「現在の手順 scope」を追跡する。material.derivedFrom を受け取ったら
  // 「（scope 手順）→ derivedFrom 手順」の informed_by として記録する。
  const ctx: BuildContext = {
    labels,
    procedures,
    dependencies,
    stepIdToBlockId,
    currentProcedureBlockId: null,
    pendingDerivedFrom: [],
    pendingDependsOn: [],
  };

  const noteBlocks: any[] = [buildSourceHeaderBlock(params)];
  for (const b of params.blocks) {
    const converted = convertBlock(b, ctx);
    if (converted) noteBlocks.push(converted);
  }

  // 第 2 パス: 蓄積した pending 依存情報を解決して dependencies に流し込む
  //   （LLM は derivedFrom / dependsOn に任意の stepId を書けるので、
  //    stepId → blockId マップが全て揃った後にリンクを解決する）
  resolvePendingDependencies(ctx);

  const provLinks = buildProvLinks(procedures, dependencies);

  // 組み立ては旧語彙（procedure ラベル付き見出し）のまま行い、最後に step へ変換する。
  // 見出し id を step が引き継ぐので、上で組んだ provLinks（informed_by）は
  // そのまま step 間のリンクとして機能する。
  const steppedBlocks = convertProcedureHeadingsToSteps(noteBlocks, labels);

  return {
    version: LATEST_DOCUMENT_VERSION,
    title: params.title,
    pages: [
      {
        id: "main",
        title: params.title,
        blocks: steppedBlocks,
        labels,
        provLinks,
        knowledgeLinks: [],
      },
    ],
    sourceUrl: params.sourceUrl,
    sourceFetchedAt: params.sourceFetchedAt,
    sourceTitle: params.sourceTitle,
    sourcePdfFileId: params.sourcePdfFileId,
    sourceDocumentFileId: params.sourceDocumentFileId,
    sourceDocumentName: params.sourceDocumentFileId ? params.sourceTitle : undefined,
    sourcePdfName: params.sourcePdfFileId ? params.sourceTitle : undefined,
    generatedBy: {
      agent: "prov-ingester",
      sessionId: params.sourcePdfFileId
        ? `pdf:${params.sourcePdfFileId}`
        : `url:${params.sourceUrl ?? ""}`,
      model: params.model ?? undefined,
      tokenUsage: params.tokenUsage,
    },
    createdAt: now,
    modifiedAt: now,
  };
}

// ── 内部実装 ──

type PendingDep = {
  /** informed_by の source: この材料/手順を含む scope の procedure blockId */
  fromBlockId: string;
  /** informed_by の target stepId（後で blockId に解決する） */
  toStepId: string;
};

type BuildContext = {
  labels: Record<string, string>;
  procedures: ProcedureRecord[];
  dependencies: Dependency[];
  stepIdToBlockId: Map<string, string>;
  /** 現在の scope の procedure H2 の blockId（material が derivedFrom を持つとき参照） */
  currentProcedureBlockId: string | null;
  pendingDerivedFrom: PendingDep[];
  pendingDependsOn: PendingDep[];
};

function buildSourceHeaderBlock(params: BuildProvNoteParams): any {
  // PDF 出典: 外部リンクを張らず、ファイル名のテキスト表示にする
  if (params.sourcePdfFileId) {
    return {
      id: crypto.randomUUID(),
      type: "paragraph",
      props: {
        textColor: "default",
        backgroundColor: "default",
        textAlignment: "left",
      },
      content: [
        { type: "text", text: "Source: ", styles: { bold: true } },
        { type: "text", text: params.sourceTitle || "PDF", styles: {} },
      ],
      children: [],
    };
  }

  // URL 出典: 既存通りリンクとして表示
  const url = params.sourceUrl ?? "";
  return {
    id: crypto.randomUUID(),
    type: "paragraph",
    props: {
      textColor: "default",
      backgroundColor: "default",
      textAlignment: "left",
    },
    content: [
      { type: "text", text: "Source: ", styles: { bold: true } },
      {
        type: "link",
        href: url,
        content: [
          { type: "text", text: params.sourceTitle || url, styles: {} },
        ],
      },
    ],
    children: [],
  };
}

/**
 * ingester の 1 ブロック → BlockNote ブロック（再帰）
 * ctx に副作用で labels / procedures / pending deps を蓄積する。
 */
function convertBlock(b: ProvIngesterBlock, ctx: BuildContext): any | null {
  // ── 本文を取り出す ──
  // span 表現があればそれを優先、無ければ flat text を 1 span として扱う。
  const flatText = b.text?.trim() ?? "";
  const hasSpans = Array.isArray(b.content) && b.content.length > 0;
  if (!hasSpans && !flatText) return null;

  const id = crypto.randomUUID();
  const blockType = b.blockType ?? "paragraph";

  const props: Record<string, any> = {
    textColor: "default",
    backgroundColor: "default",
    textAlignment: "left",
  };
  if (blockType === "heading") {
    props.level = b.level ?? 2;
  }

  // block-level role（procedure や旧 schema の単一 role）
  let coreLabel: CoreLabel | null = null;
  if (b.role) {
    const normalized = normalizeLabel(b.role);
    if ((CORE_LABELS as string[]).includes(normalized)) {
      coreLabel = normalized as CoreLabel;
    }
  }

  // procedure H2/H3 → scope を更新し、stepId → blockId マップに登録
  const isProcedureHeading =
    coreLabel === "procedure" &&
    blockType === "heading" &&
    (props.level === 2 || props.level === 3);

  // ── スコープ外の material/tool/result の block-level ラベルは剥がす ──
  // Graphium の prov-generator は H2 procedure スコープの外にある
  // material/tool/result を孤立 Entity として扱ってしまう。
  // span 単位の inline ラベルでも同様に scope 外なら drop する（後段で span ごとに判定）。
  const ENTITY_LIKE: CoreLabel[] = ["material", "tool", "result"];
  const isEntityLike = coreLabel !== null && ENTITY_LIKE.includes(coreLabel);
  const insideProcedureScope = ctx.currentProcedureBlockId !== null;

  if (isEntityLike && !insideProcedureScope) {
    coreLabel = null;
  }

  // Phase E: block-level の inline-scope ラベル（旧 schema 互換）は labels に登録せず、
  // テキスト全体に inline style として書き戻す。procedure だけ block-level に残す。
  if (coreLabel && !INLINE_SCOPE_LABELS.has(coreLabel)) {
    ctx.labels[id] = coreLabel;
  }

  if (isProcedureHeading) {
    ctx.currentProcedureBlockId = id;
    const record: ProcedureRecord = {
      blockId: id,
      stepId: b.stepId ?? null,
      order: ctx.procedures.length,
    };
    ctx.procedures.push(record);
    if (b.stepId) ctx.stepIdToBlockId.set(b.stepId, id);

    if (b.dependsOn && b.dependsOn.length > 0) {
      for (const dep of b.dependsOn) {
        ctx.pendingDependsOn.push({ fromBlockId: id, toStepId: dep });
      }
    }
  }

  // 旧 schema 互換: block-level の derivedFrom（material/tool）
  if (
    b.derivedFrom &&
    (coreLabel === "material" || coreLabel === "tool") &&
    ctx.currentProcedureBlockId
  ) {
    ctx.pendingDerivedFrom.push({
      fromBlockId: ctx.currentProcedureBlockId,
      toStepId: b.derivedFrom,
    });
  }

  // 子ブロックを再帰変換
  const children: any[] = [];
  if (b.children && b.children.length > 0) {
    for (const c of b.children) {
      const childBlock = convertBlock(c, ctx);
      if (childBlock) children.push(childBlock);
    }
  }

  // ── BlockNote content[] を組み立てる ──
  let bnContent: any[];
  if (hasSpans) {
    bnContent = buildSpanContent(b.content!, ctx);
  } else {
    // flat text 1 span として扱う。block-level coreLabel が inline-scope なら全文に当てる。
    const styles: Record<string, unknown> =
      coreLabel && INLINE_SCOPE_LABELS.has(coreLabel)
        ? { [INLINE_LABEL_TO_STYLE_KEY[coreLabel]]: makeInlineEntityId(coreLabel) }
        : {};
    bnContent = [{ type: "text", text: flatText, styles }];
  }

  return {
    id,
    type: blockType,
    props,
    content: bnContent,
    children,
  };
}

/**
 * span 配列 → BlockNote content[]。
 * 各 span に role があれば inline style を生成し、material/tool で
 * derivedFrom があれば現在の procedure scope から informed_by を pending に積む。
 */
function buildSpanContent(spans: ProvSpan[], ctx: BuildContext): any[] {
  const out: any[] = [];
  for (const span of spans) {
    if (!span.text) continue;
    let styles: Record<string, unknown> = {};
    let label: CoreLabel | null = null;
    if (span.role) {
      const normalized = normalizeLabel(span.role);
      if ((CORE_LABELS as string[]).includes(normalized) && INLINE_SCOPE_LABELS.has(normalized as CoreLabel)) {
        label = normalized as CoreLabel;
      }
    }
    // scope 外の material/tool/output は inline 化を諦めてプレーン span にする（attribute は許容）
    if (label && (label === "material" || label === "tool" || label === "output") && !ctx.currentProcedureBlockId) {
      label = null;
    }
    if (label) {
      styles[INLINE_LABEL_TO_STYLE_KEY[label]] = makeInlineEntityId(label);
      if (
        span.derivedFrom &&
        (label === "material" || label === "tool") &&
        ctx.currentProcedureBlockId
      ) {
        ctx.pendingDerivedFrom.push({
          fromBlockId: ctx.currentProcedureBlockId,
          toStepId: span.derivedFrom,
        });
      }
    }
    out.push({ type: "text", text: span.text, styles });
  }
  // 全 span が捨てられた場合のフォールバック（理論上 sanitize で防がれる）
  if (out.length === 0) out.push({ type: "text", text: "", styles: {} });
  return out;
}

/**
 * pending 依存（stepId 参照）を解決して最終的な Dependency (blockId ↔ blockId) に変換する。
 * 未解決・自己参照・重複は除外する。
 */
function resolvePendingDependencies(ctx: BuildContext): void {
  const seen = new Set<string>();
  const push = (fromBlockId: string, toStepId: string) => {
    const toBlockId = ctx.stepIdToBlockId.get(toStepId);
    if (!toBlockId) return; // 未定義 stepId
    if (toBlockId === fromBlockId) return; // 自己参照
    const key = `${fromBlockId} ${toBlockId}`;
    if (seen.has(key)) return;
    seen.add(key);
    ctx.dependencies.push({ fromBlockId, toBlockId });
  };
  for (const p of ctx.pendingDerivedFrom) push(p.fromBlockId, p.toStepId);
  for (const p of ctx.pendingDependsOn) push(p.fromBlockId, p.toStepId);
}

/**
 * 最終的な provLinks を組み立てる。
 *
 * - LLM が依存関係を出した場合: その DAG をそのまま informed_by リンクに変換
 * - LLM が一切依存を出さなかった場合: 文書順の線形連鎖にフォールバック
 *   （手順が完全に孤立するよりは隣接を繋いでおいた方がグラフが読みやすい）
 */
function buildProvLinks(
  procedures: ProcedureRecord[],
  dependencies: Dependency[],
): any[] {
  const edges =
    dependencies.length > 0
      ? dependencies
      : procedures.slice(1).map((p, i) => ({
          fromBlockId: p.blockId,
          toBlockId: procedures[i].blockId,
        }));

  return edges.map((e) => ({
    id: crypto.randomUUID(),
    sourceBlockId: e.fromBlockId,
    targetBlockId: e.toBlockId,
    type: "informed_by",
    layer: "prov",
    createdBy: "ai",
  }));
}
