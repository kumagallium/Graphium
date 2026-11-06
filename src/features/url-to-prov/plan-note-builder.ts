// チャットの回答から作る「計画ノート＋工程ノート」の組み立て（純関数）。
//
// 形は計画テンプレート（template/templates.ts の planTemplate）に揃える:
//   # 題
//   ## 背景・目的 … 本文と、参考にしたノートへの @ リンク
//   ## 対象と条件 … 1 列目が工程ノートを指す表（note-link 列）。2 列目からが振る条件
//   ## 共通の手順 … 手順名の一覧（中身は各行のノートにある）
//   ## 期待する成果
// 計画ノートは予約フォルダ「計画」に入れるので、表の行がそのまま工程として並ぶ。
//
// 保存の順序（ID の確定）は呼び出し側:
//   1. 計画ノートを保存して ID を得る（表のセルはまだ平文）
//   2. 行ごとの工程ノートを derivedFromNoteId = 計画ノートで保存する
//   3. linkRunsInPlan で計画ノートの表を @ リンクにして保存し直す
// （表の「ノートを作る」= index-table/create-note-from-row.ts と同じつながり方）

import type { GraphiumDocument, NoteLink } from "../../lib/document-types";
import type { BlockLink } from "../../lib/block-link-types";
import { LATEST_DOCUMENT_VERSION } from "../../lib/document-migration";
import { canonicalLabelKey } from "./label-alignment";
import type { ProvIngesterBlock } from "./prov-note-builder";

export type PlanVariable = { key: string; label: string; unit?: string };
export type PlanRun = { name: string; values: Record<string, string> };
export type ExperimentPlanDraft = {
  title: string;
  background: string;
  expectedOutcome: string;
  variables: PlanVariable[];
  runs: PlanRun[];
  procedure: string;
};

/** 見出しなどの文言（i18n はクライアントで解決して渡す） */
export type PlanNoteWords = {
  background: string;
  samples: string;
  sampleColumn: string;
  procedure: string;
  procedureHint: string;
  outcome: string;
  references: string;
  /** 工程ノートの冒頭の 1 文。{plan} と {conditions} を差し込む */
  runOverview: string;
};

const newId = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `b-${Math.random().toString(36).slice(2)}-${Date.now().toString(36)}`;

const text = (s: string, styles: Record<string, unknown> = {}) => ({ type: "text", text: s, styles });

function heading(level: 1 | 2, s: string) {
  return { id: newId(), type: "heading", props: { level }, content: [text(s)], children: [] };
}

function paragraph(content: unknown[]) {
  return { id: newId(), type: "paragraph", content, children: [] };
}

function bullet(s: string) {
  return { id: newId(), type: "bulletListItem", content: [text(s)], children: [] };
}

function splitAttribute(s: string): { key: string; rest: string } | null {
  const m = s.match(/^([^:：]{1,24})[:：]\s*(.+)$/s);
  return m ? { key: m[1].trim(), rest: m[2] } : null;
}

/** 表の見出し（単位があれば添える） */
export function variableHeader(v: PlanVariable): string {
  return v.unit ? `${v.label} (${v.unit})` : v.label;
}

/** 条件の要約（工程ノートの冒頭と表の行で使う） */
export function runConditionSummary(run: PlanRun, variables: PlanVariable[]): string {
  return variables
    .map((v) => (run.values[v.key] ? `${v.label} = ${run.values[v.key]}` : null))
    .filter(Boolean)
    .join(", ");
}

/**
 * 共通手順のブロックを 1 行分にする。振る条件のキーと同じキーのパラメータ（attribute span）の
 * 値をこの行の値に差し替える。キーは表記ゆれを畳んで照合する（Temperature と temperature）。
 * 先頭に「どの計画の、どの条件の行か」の 1 文を置く。
 */
export function buildRunBlocks(
  blocks: ProvIngesterBlock[],
  plan: Pick<ExperimentPlanDraft, "title" | "variables">,
  run: PlanRun,
  words: Pick<PlanNoteWords, "runOverview">,
): ProvIngesterBlock[] {
  const byKey = new Map<string, string>();
  for (const v of plan.variables) {
    const value = run.values[v.key];
    if (value) byKey.set(canonicalLabelKey(v.key), value);
  }
  const walk = (list: ProvIngesterBlock[]): ProvIngesterBlock[] =>
    list.map((b) => {
      const next: ProvIngesterBlock = { ...b };
      if (b.content) {
        next.content = b.content.map((sp) => {
          if (sp.role !== "attribute") return sp;
          const a = splitAttribute(sp.text);
          const value = a ? byKey.get(canonicalLabelKey(a.key)) : undefined;
          return a && value ? { ...sp, text: `${a.key}: ${value}` } : sp;
        });
      }
      if (b.children) next.children = walk(b.children);
      return next;
    });
  const overview = words.runOverview
    .replace("{plan}", plan.title)
    .replace("{conditions}", runConditionSummary(run, plan.variables));
  return [{ blockType: "paragraph", content: [{ text: overview }] }, ...walk(blocks)];
}

/** 共通手順の手順名（見出し）を文書順に */
export function procedureStepNames(blocks: ProvIngesterBlock[]): string[] {
  const out: string[] = [];
  const walk = (list: ProvIngesterBlock[]) => {
    for (const b of list) {
      if (b.role === "procedure" && b.blockType === "heading" && b.text?.trim()) out.push(b.text.trim());
      if (b.children) walk(b.children);
    }
  };
  walk(blocks);
  return out;
}

export type PlanDocumentResult = {
  doc: GraphiumDocument;
  /** 対象と条件の表のブロック ID（工程ノートの derivedFromBlockId・表のリンクに使う） */
  tableBlockId: string;
};

/**
 * 計画ノートを組み立てる。表のセルは平文のまま（工程ノートの ID が確定してから linkRunsInPlan で
 * @ リンクにする）。参考にしたノートは背景の下に @ リンクで並べ、ノート間のつながりにも書く。
 */
export function buildPlanDocument(params: {
  plan: ExperimentPlanDraft;
  stepNames: string[];
  references: { id: string; title: string }[];
  folder: string;
  words: PlanNoteWords;
  model?: string | null;
}): PlanDocumentResult {
  const { plan, words } = params;
  const blocks: any[] = [heading(1, plan.title), heading(2, words.background)];
  if (plan.background) blocks.push(paragraph([text(plan.background)]));

  const knowledgeLinks: BlockLink[] = [];
  const noteLinks: NoteLink[] = [];
  if (params.references.length > 0) {
    const content: unknown[] = [text(`${words.references}: `)];
    params.references.forEach((r, i) => {
      if (i > 0) content.push(text(" "));
      content.push(text(`@${r.title}`, { textColor: "blue" }));
    });
    const refBlock = paragraph(content);
    blocks.push(refBlock);
    for (const r of params.references) {
      knowledgeLinks.push({
        id: newId(),
        sourceBlockId: refBlock.id,
        targetBlockId: "",
        targetNoteId: r.id,
        type: "reference",
        layer: "knowledge",
        createdBy: "ai",
      });
      noteLinks.push({ targetNoteId: r.id, sourceBlockId: refBlock.id, type: "derived_from" });
    }
  }

  blocks.push(heading(2, words.samples));
  const header = [words.sampleColumn, ...plan.variables.map(variableHeader)];
  const table = {
    id: newId(),
    type: "table",
    content: {
      type: "tableContent",
      rows: [
        { cells: header.map((h) => [text(h)]) },
        ...plan.runs.map((run) => ({
          cells: [[text(run.name)], ...plan.variables.map((v) => [text(run.values[v.key] ?? "")])],
        })),
      ],
    },
    children: [],
  };
  blocks.push(table);

  if (params.stepNames.length > 0) {
    blocks.push(heading(2, words.procedure));
    blocks.push(paragraph([text(words.procedureHint)]));
    for (const name of params.stepNames) blocks.push(bullet(name));
  }

  blocks.push(heading(2, words.outcome));
  blocks.push(paragraph([text(plan.expectedOutcome)]));

  const now = new Date().toISOString();
  const doc: GraphiumDocument = {
    version: LATEST_DOCUMENT_VERSION,
    title: plan.title,
    pages: [
      {
        id: "main",
        title: plan.title,
        blocks,
        labels: {},
        provLinks: [],
        knowledgeLinks,
        tableMeta: { [table.id]: { columns: { [words.sampleColumn]: ["note-link"] } } },
      },
    ],
    noteContexts: [params.folder],
    ...(noteLinks.length > 0 ? { noteLinks } : {}),
    ...(params.model ? { generatedBy: { agent: "graphium-plan", sessionId: "", model: params.model } } : {}),
    createdAt: now,
    modifiedAt: now,
  };
  return { doc, tableBlockId: table.id };
}

/**
 * 工程ノートの ID が確定したあと、計画ノートの表の 1 列目を @ リンクにする。
 * 表の「ノートを作る」と同じく、セルは青い「@題」、tableMeta.noteLinks は「題」「@題」の両方、
 * ノート間のつながり（noteLinks）にも 1 本ずつ足す。
 */
export function linkRunsInPlan(
  doc: GraphiumDocument,
  tableBlockId: string,
  runNoteIds: { name: string; id: string }[],
): GraphiumDocument {
  const byName = new Map(runNoteIds.map((r) => [r.name, r.id]));
  const page = doc.pages[0];
  const blocks = (page.blocks as any[]).map((b) => {
    if (b.id !== tableBlockId) return b;
    const rows = b.content.rows.map((row: any, i: number) => {
      if (i === 0) return row;
      const name = (row.cells[0] ?? []).map((c: any) => c.text ?? "").join("");
      if (!byName.has(name)) return row;
      return { ...row, cells: [[text(`@${name}`, { textColor: "blue" })], ...row.cells.slice(1)] };
    });
    return { ...b, content: { ...b.content, rows } };
  });
  const meta = page.tableMeta?.[tableBlockId] ?? {};
  const links: Record<string, string> = { ...(meta.noteLinks ?? {}) };
  for (const r of runNoteIds) {
    links[r.name] = r.id;
    links[`@${r.name}`] = r.id;
  }
  const noteLinks: NoteLink[] = [
    ...(doc.noteLinks ?? []),
    ...runNoteIds.map((r) => ({ targetNoteId: r.id, sourceBlockId: tableBlockId, type: "derived_from" as const })),
  ];
  return {
    ...doc,
    noteLinks,
    pages: [
      {
        ...page,
        blocks,
        tableMeta: { ...(page.tableMeta ?? {}), [tableBlockId]: { ...meta, noteLinks: links } },
      },
      ...doc.pages.slice(1),
    ],
    modifiedAt: new Date().toISOString(),
  };
}

/** 回答の `[Source: "題"]` から、参考にしたノートを引く（題が一致するノートだけ・出現順・重複なし） */
export function resolveAnswerReferences(
  answer: string,
  notes: { id: string; title: string }[],
): { id: string; title: string }[] {
  const strip = (s: string) =>
    s
      .normalize("NFKC")
      .replace(/\s*[(（](?:note|ノート|노트)[)）]\s*$/i, "")
      .trim()
      .toLowerCase();
  const byTitle = new Map<string, { id: string; title: string }>();
  for (const n of notes) {
    const k = strip(n.title);
    if (k && !byTitle.has(k)) byTitle.set(k, n);
  }
  const out: { id: string; title: string }[] = [];
  const seen = new Set<string>();
  const re = /\[Source:\s*"([^"]+)"\]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(answer)) !== null) {
    const hit = byTitle.get(strip(m[1]));
    if (hit && !seen.has(hit.id)) {
      seen.add(hit.id);
      out.push(hit);
    }
  }
  return out;
}
