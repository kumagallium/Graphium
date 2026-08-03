// ──────────────────────────────────────────────
// Note PROV Summary 抽出ユーティリティ
//
// GraphiumDocument を入力として、AI Wiki 生成プロンプトに流し込みやすい
// JSON 形式の PROV 構造サマリを返す。
//
// 設計方針:
// - 既存の PROV 抽出 (generateProvDocument) を再利用し、コンテキストラベル
//   解釈ロジックを重複実装しない
// - ラベルが不十分でも抽出可能な部分だけ返す（エラーで止まらない）
// - パラメータの数値・単位はテキストのまま渡す（正規化は Phase B 以降の課題）
//
// 関連:
//   - docs/internal/graphium-extension-v4-proposal.md Phase 2.1
// ──────────────────────────────────────────────

import type { GraphiumDocument, GraphiumPage } from "../../lib/document-types";
import {
  generateProvDocument,
  type ProvJsonLd,
  type ProvJsonLdNode,
} from "../prov-generator/generator";

/** 単一の手順（Activity）に対応するサマリ */
export interface ActivitySummary {
  /** 現状は "step" のみ。将来 plan / experiment 等を区別する余地 */
  type: "step";
  /** Activity ラベル（見出しテキスト） */
  label: string;
  /** [材料] として used されたエンティティのテキスト */
  inputs: string[];
  /** [ツール] として used されたエンティティのテキスト */
  tools: string[];
  /**
   * [属性] のテキスト配列。
   * Phase A では key/value 分離は heuristic のみ（コロン区切り）。
   * 分離に失敗した場合は raw として保持する。
   */
  parameters: ParameterEntry[];
  /** このActivity が wasGeneratedBy で生み出した output のテキスト */
  outputs: string[];
}

export interface ParameterEntry {
  /** "回転数: 300rpm" を heuristic 分離した場合のキー。失敗時は undefined */
  key?: string;
  /** 分離後の値。失敗時は元のテキスト全体 */
  value: string;
  /** 元のラベル文字列（デバッグ用） */
  raw: string;
}

/** 任意の Activity に紐づかない top-level の結果 Entity */
export interface ResultEntry {
  /** 結果の主名称（例: ゼーベック係数） */
  property: string;
  /** 構造化テーブルから抽出された属性（例: { value: "180μV/K", method: "ZEM-3" }） */
  attributes: Record<string, string>;
}

export interface NoteProvSummary {
  /** 任意のノート識別子（呼び出し側が指定） */
  noteId?: string;
  /** ドキュメントタイトル */
  title: string;
  /** 各手順（Activity）のサマリ */
  activities: ActivitySummary[];
  /** 任意 Activity に紐づかない top-level の結果 */
  results: ResultEntry[];
  /**
   * [計画] phase 配下から拾ったテキスト。
   * 空文字の場合は undefined（プロンプト挿入時の判定を簡単にするため）。
   */
  plan?: string;
}

export interface SummarizeNoteProvOptions {
  /** ノート ID。指定があればサマリにそのまま反映する */
  noteId?: string;
}

/**
 * GraphiumDocument から PROV 構造サマリを抽出する。
 *
 * 既存の generateProvDocument を呼び出して PROV-JSON-LD を構築し、
 * その結果を AI 向けの読みやすい JSON に reshape する。
 */
export function summarizeNoteProv(
  doc: GraphiumDocument,
  options: SummarizeNoteProvOptions = {},
): NoteProvSummary {
  const summary: NoteProvSummary = {
    noteId: options.noteId,
    title: doc.title,
    activities: [],
    results: [],
  };

  const planTexts: string[] = [];

  for (const page of doc.pages ?? []) {
    let prov: ProvJsonLd;
    try {
      prov = generateProvDocument({
        blocks: page.blocks ?? [],
        labels: toLabelsMap(page),
        links: collectPageLinks(page),
        mediaInlineLabels: toMediaInlineLabelsMap(page),
      });
    } catch {
      // ページ単位で失敗しても、他のページの抽出は続行する
      continue;
    }

    const graph = prov["@graph"] ?? [];

    // ── Activity サマリの組み立て ──
    const usedByActivity = new Map<string, ProvJsonLdNode[]>(); // activity @id → used entities
    const generatedByActivity = new Map<string, ProvJsonLdNode[]>(); // activity @id → output entities
    const nodeById = new Map<string, ProvJsonLdNode>();
    for (const n of graph) nodeById.set(n["@id"], n);

    for (const node of graph) {
      const used = node["prov:used"];
      if (used && Array.isArray(used)) {
        // prov:used は Activity 側に乗る関係
        for (const ref of used) {
          const target = nodeById.get(ref["@id"]);
          if (!target) continue;
          const list = usedByActivity.get(node["@id"]) ?? [];
          list.push(target);
          usedByActivity.set(node["@id"], list);
        }
      }
      const gen = node["prov:wasGeneratedBy"];
      if (gen) {
        // wasGeneratedBy は Entity 側に乗り、to が Activity（複数生成元があり得るため配列）
        for (const g of gen) {
          const list = generatedByActivity.get(g["@id"]) ?? [];
          list.push(node);
          generatedByActivity.set(g["@id"], list);
        }
      }
    }

    for (const node of graph) {
      if (node["@type"] !== "prov:Activity") continue;

      const used = usedByActivity.get(node["@id"]) ?? [];
      const generated = generatedByActivity.get(node["@id"]) ?? [];

      const inputs: string[] = [];
      const tools: string[] = [];
      for (const ent of used) {
        const subtype = ent["graphium:entityType"];
        const label = entityLabelText(ent);
        if (!label) continue;
        if (subtype === "tool") {
          tools.push(label);
        } else {
          // material またはサブタイプ未指定は inputs 扱い
          inputs.push(label);
        }
      }

      const outputs: string[] = [];
      for (const ent of generated) {
        const label = entityLabelText(ent);
        if (label) outputs.push(label);
      }

      const parameters = extractParameters(node);

      summary.activities.push({
        type: "step",
        label: node["rdfs:label"] ?? "",
        inputs: dedupe(inputs),
        tools: dedupe(tools),
        parameters,
        outputs: dedupe(outputs),
      });
    }

    // ── top-level results（どの Activity にも紐づかない output Entity） ──
    for (const node of graph) {
      if (node["@type"] !== "prov:Entity") continue;
      // output Entity の ID は result_ または result_media_ で始まる慣習
      const isOutput = node["@id"].startsWith("result_") || node["@id"].startsWith("result_media_");
      if (!isOutput) continue;
      if (node["prov:wasGeneratedBy"]) continue; // 任意 Activity に紐づくものは activity.outputs 側で扱う

      const attributes = extractStructuredAttributes(node);
      summary.results.push({
        property: node["rdfs:label"] ?? "",
        attributes,
      });
    }

    // ── [計画] phase 配下のテキストを収集 ──
    for (const node of graph) {
      const phase = node["graphium:phase"];
      if (phase !== "plan") continue;
      const label = entityLabelText(node);
      if (label) planTexts.push(label);
    }
  }

  if (planTexts.length > 0) {
    summary.plan = dedupe(planTexts).join(" / ");
  }

  return summary;
}

// ── 内部ヘルパー ──

function toLabelsMap(page: GraphiumPage): Map<string, string> {
  const map = new Map<string, string>();
  const raw = page.labels ?? {};
  for (const [blockId, label] of Object.entries(raw)) {
    if (typeof label === "string" && label.length > 0) {
      map.set(blockId, label);
    }
  }
  return map;
}

function collectPageLinks(page: GraphiumPage): any[] {
  const links: any[] = [];
  if (Array.isArray(page.provLinks)) links.push(...page.provLinks);
  // legacy v1 互換: page.links が残っていれば追加（generateProvDocument 内で
  // PROV 層のみフィルタされる）
  if (Array.isArray(page.links)) links.push(...page.links);
  return links;
}

function toMediaInlineLabelsMap(
  page: GraphiumPage,
): Map<string, { label: "material" | "tool" | "attribute" | "output"; entityId: string }> | undefined {
  const raw = page.mediaInlineLabels;
  if (!raw) return undefined;
  const map = new Map<string, { label: "material" | "tool" | "attribute" | "output"; entityId: string }>();
  for (const [blockId, entry] of Object.entries(raw)) {
    if (entry && entry.label && entry.entityId) {
      map.set(blockId, { label: entry.label, entityId: entry.entityId });
    }
  }
  return map.size > 0 ? map : undefined;
}

function entityLabelText(node: ProvJsonLdNode): string {
  const label = node["rdfs:label"];
  return typeof label === "string" ? label.trim() : "";
}

function extractParameters(activityNode: ProvJsonLdNode): ParameterEntry[] {
  const attrs = activityNode["graphium:attributes"];
  if (!Array.isArray(attrs)) return [];
  const result: ParameterEntry[] = [];
  for (const a of attrs) {
    const raw = (a as any)["rdfs:label"];
    if (typeof raw !== "string" || raw.length === 0) continue;
    result.push(parseParameterText(raw));
  }
  return result;
}

/**
 * "回転数: 300rpm" / "温度=850°C" のような表記を heuristic 分離する。
 * 区切り文字は : / ： / = のいずれか。最初に現れたものを採用。
 * 区切りがなければ value にそのまま入れて key は undefined。
 */
export function parseParameterText(raw: string): ParameterEntry {
  const trimmed = raw.trim();
  const separators = [":", "：", "="];
  let splitIndex = -1;
  for (const sep of separators) {
    const idx = trimmed.indexOf(sep);
    if (idx > 0 && (splitIndex === -1 || idx < splitIndex)) {
      splitIndex = idx;
    }
  }
  if (splitIndex === -1) {
    return { value: trimmed, raw };
  }
  const key = trimmed.slice(0, splitIndex).trim();
  const value = trimmed.slice(splitIndex + 1).trim();
  if (!key || !value) {
    return { value: trimmed, raw };
  }
  return { key, value, raw };
}

/**
 * 構造化テーブルから展開された Entity が持つ graphium:<header> プロパティを
 * 平坦な Record<string,string> として取り出す。
 * label / blockId / mediaUrl / mediaType / phase / entityType / attributes 等の
 * 内部メタはスキップする。
 */
function extractStructuredAttributes(node: ProvJsonLdNode): Record<string, string> {
  const out: Record<string, string> = {};
  const META_KEYS = new Set([
    "graphium:blockId",
    "graphium:mediaUrl",
    "graphium:mediaType",
    "graphium:phase",
    "graphium:entityType",
    "graphium:attributes",
    "graphium:warnings",
    "graphium:documentProvenance",
  ]);
  for (const [k, v] of Object.entries(node)) {
    if (!k.startsWith("graphium:")) continue;
    if (META_KEYS.has(k)) continue;
    if (typeof v === "string") {
      out[k.replace(/^graphium:/, "")] = v;
    }
  }
  return out;
}

function dedupe<T>(items: T[]): T[] {
  const seen = new Set<T>();
  const out: T[] = [];
  for (const it of items) {
    if (!seen.has(it)) {
      seen.add(it);
      out.push(it);
    }
  }
  return out;
}
