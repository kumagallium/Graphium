// ──────────────────────────────────────────────
// PROV-JSONLD 生成器
//
// ドキュメント全体を走査して PROV-JSONLD を生成する。
// thought-provenance-spec.md § 0-E の 5 ステップに従う。
// ──────────────────────────────────────────────

import { CORE_LABELS, normalizeLabel, classifyLabel, getHeadingLabelRole, type CoreLabel } from "../context-label/labels";
import { parseSampleTable, validateSampleIds, type SampleTable } from "../sample-branch/parser";
import { expandSampleBranch, propagateBranches, type BranchExpansion } from "../sample-branch/expander";
import type { BlockLink } from "../block-link/link-types";
import { createWarning, type ProvWarning } from "./errors";

// ── PROV-JSONLD の型定義 ──

export type ProvNode = {
  "@id": string;
  "@type": string;
  label: string;
  blockId: string;
  sampleId?: string;
  params?: Record<string, string>;
};

export type ProvRelation = {
  "@type": string;
  from: string;
  to: string;
  linkId?: string;
};

export type ProvDocument = {
  "@context": {
    prov: string;
    matprov: string;
    eureco: string;
  };
  "@graph": ProvNode[];
  relations: ProvRelation[];
  warnings: ProvWarning[];
};

// ── 入力データの型 ──

type GeneratorInput = {
  /** BlockNote のブロック配列 */
  blocks: any[];
  /** blockId → ラベル文字列 */
  labels: Map<string, string>;
  /** ブロック間リンク */
  links: BlockLink[];
};

// ── メイン生成関数 ──

export function generateProvDocument(input: GeneratorInput): ProvDocument {
  const { blocks, labels, links } = input;
  const warnings: ProvWarning[] = [];
  const nodes: ProvNode[] = [];
  const relations: ProvRelation[] = [];

  console.group("[PROV] 生成開始");
  console.log("ブロック数:", blocks.length, "ラベル数:", labels.size, "リンク数:", links.length);

  const flatBlocks = flattenBlocks(blocks);

  // ── Step 1: ラベルパーサー ──
  // ブロックからラベルを抽出し、コアラベルに正規化

  type LabeledBlock = {
    block: any;
    label: string;
    coreLabel: CoreLabel | null;
    provRole: string | null;
  };

  const labeledBlocks: LabeledBlock[] = [];

  for (const block of flatBlocks) {
    const rawLabel = labels.get(block.id);
    if (!rawLabel) continue;

    const normalized = normalizeLabel(rawLabel);
    const layer = classifyLabel(normalized);

    if (layer === "free") {
      warnings.push(createWarning("unknown-label", block.id, `"${rawLabel}" はフリーラベル — PROVに変換しません`));
      continue;
    }

    const coreLabel = (layer === "core" ? normalized : null) as CoreLabel | null;
    const provRole = coreLabel ? coreToProvRole(coreLabel, block) : null;

    labeledBlocks.push({ block, label: normalized, coreLabel, provRole });
  }

  // ── Step 2: @リンク解析 ──
  // informed_by リンクを wasInformedBy として記録

  const informedByMap = new Map<string, BlockLink[]>(); // targetBlockId → リンク元一覧
  for (const link of links) {
    if (link.type === "informed_by") {
      // リンク先が存在するか確認
      const targetExists = blocks.some((b: any) => findBlockById(b, link.targetBlockId));
      if (!targetExists) {
        warnings.push(createWarning("broken-link", link.sourceBlockId, `前手順リンク先 ${link.targetBlockId} が存在しません`));
      }

      const existing = informedByMap.get(link.sourceBlockId) ?? [];
      existing.push(link);
      informedByMap.set(link.sourceBlockId, existing);
    }
  }

  // ── Step 3: 試料分岐の展開 ──

  // [手順] Activity を収集
  const activities = labeledBlocks.filter((lb) => lb.provRole === "prov:Activity");

  // [試料] テーブルを収集し、スコープ（直前のH2 Activity）と紐付け
  const sampleTables = labeledBlocks
    .filter((lb) => lb.coreLabel === "[試料]" && lb.block.type === "table")
    .map((lb) => ({ block: lb.block, table: parseSampleTable(lb.block) }))
    .filter((x): x is { block: any; table: SampleTable } => x.table !== null);

  // [条件] と [試料] の共存チェック
  const conditionBlockIds = new Set(
    labeledBlocks.filter((lb) => lb.coreLabel === "[条件]").map((lb) => lb.block.id)
  );

  const branchMap = new Map<string, BranchExpansion>();
  const usedSampleTables = new Set<string>(); // 使用済み試料テーブルのブロックID

  for (const act of activities) {
    const blockId = act.block.id;
    const actLabel = getBlockText(act.block);

    // このActivity配下（同一H2スコープ内）の [試料] テーブルを探す
    const actIdx = flatBlocks.indexOf(act.block);
    // 次のH1/H2見出しの位置を探す（スコープ境界）
    let scopeEnd = flatBlocks.length;
    for (let i = actIdx + 1; i < flatBlocks.length; i++) {
      if (flatBlocks[i].type === "heading" && (flatBlocks[i].props?.level ?? 2) <= 2) {
        scopeEnd = i;
        break;
      }
    }
    const sampleEntry = sampleTables.find((st) => {
      if (usedSampleTables.has(st.block.id)) return false;
      const stIdx = flatBlocks.indexOf(st.block);
      // Activity の後 かつ 次のH2の前（同一スコープ内）
      return stIdx > actIdx && stIdx < scopeEnd;
    });

    if (sampleEntry && sampleEntry.table.rows.length > 0) {
      usedSampleTables.add(sampleEntry.block.id);
      // [試料] と [条件] の共存チェック
      if (conditionBlockIds.has(sampleEntry.block.id)) {
        warnings.push(createWarning(
          "sample-condition-coexist",
          sampleEntry.block.id,
          "[試料] と [条件] が共存 — [試料] を優先、[条件] は全試料共通として処理"
        ));
      }

      const expansion = expandSampleBranch(blockId, actLabel, sampleEntry.table);
      branchMap.set(blockId, expansion);

      // 分岐 Activity をノードに追加
      for (const a of expansion.activities) {
        nodes.push({
          "@id": a.id,
          "@type": "prov:Activity",
          label: a.label,
          blockId: a.blockId,
          sampleId: a.sampleId,
        });
      }

      // 試料 Entity をノードに追加
      for (const e of expansion.entities) {
        nodes.push({
          "@id": e.id,
          "@type": "prov:Entity",
          label: e.label,
          blockId: e.blockId,
          sampleId: e.sampleId,
          params: e.params,
        });
        // used 関係
        relations.push({
          "@type": "prov:used",
          from: `${blockId}__sample_${e.sampleId}`,
          to: e.id,
        });
      }
    } else {
      // 分岐なし → 通常の Activity

      // informed_by による伝播チェック
      const informedLinks = informedByMap.get(blockId) ?? [];
      const propagated = propagateBranches(blockId, actLabel, informedLinks, branchMap);

      if (propagated) {
        branchMap.set(blockId, propagated);
        for (const a of propagated.activities) {
          nodes.push({
            "@id": a.id,
            "@type": "prov:Activity",
            label: a.label,
            blockId: a.blockId,
            sampleId: a.sampleId,
          });
        }
      } else {
        // 単体 Activity
        nodes.push({
          "@id": `activity_${blockId}`,
          "@type": "prov:Activity",
          label: actLabel,
          blockId,
        });
      }
    }
  }

  // ── スコープ解決: 見出しレベルに基づくスコープツリー ──
  // H2 [手順] でActivityスコープ開始、同レベル以上の見出し(H1/H2)でスコープ終了
  const blockToActivityId = new Map<string, string>();
  let currentActivityId: string | null = null;
  for (const block of flatBlocks) {
    // 見出しブロックが来たらスコープを再評価
    if (block.type === "heading") {
      const level = block.props?.level ?? 2;
      const label = labels.get(block.id);
      const normalized = label ? normalizeLabel(label) : null;

      if (level <= 2) {
        // H1 または H2 → 前のスコープをリセット
        currentActivityId = null;

        // [手順] H2 なら新しいActivityスコープを開始
        if (normalized === "[手順]") {
          const role = getHeadingLabelRole(level, normalized);
          if (role === "activity") {
            const branch = branchMap.get(block.id);
            currentActivityId = branch
              ? branch.activities[0]?.id ?? `activity_${block.id}`
              : `activity_${block.id}`;
          }
        }
      }
      // H3以下は現在のスコープを維持（サブセクション扱い）
    }
    if (currentActivityId) {
      blockToActivityId.set(block.id, currentActivityId);
    }
  }

  /** スコープ内の Activity ID を取得（分岐なら全分岐、単体なら1つ） */
  function getActivityIdsForScope(blockId: string): string[] {
    // このブロックのスコープ Activity を特定
    const scopeActId = blockToActivityId.get(blockId);
    if (!scopeActId) return [];
    // 分岐 Activity かチェック
    for (const [, branch] of branchMap) {
      if (branch.activities.some((a) => a.id === scopeActId)) {
        return branch.activities.map((a) => a.id);
      }
    }
    return [scopeActId];
  }

  // ── [使用したもの] → Entity + used 関係 ──
  for (const lb of labeledBlocks) {
    if (lb.coreLabel === "[使用したもの]") {
      const entityId = `entity_${lb.block.id}`;
      nodes.push({
        "@id": entityId,
        "@type": "prov:Entity",
        label: getBlockText(lb.block),
        blockId: lb.block.id,
      });
      // スコープ内の Activity に used 関係を追加
      for (const actId of getActivityIdsForScope(lb.block.id)) {
        relations.push({ "@type": "prov:used", from: actId, to: entityId });
      }
    }
  }

  // ── [条件] → Parameter + 関係 ──
  for (const lb of labeledBlocks) {
    if (lb.coreLabel === "[条件]") {
      const entityId = `param_${lb.block.id}`;
      nodes.push({
        "@id": entityId,
        "@type": "matprov:Parameter",
        label: getBlockText(lb.block),
        blockId: lb.block.id,
      });
      for (const actId of getActivityIdsForScope(lb.block.id)) {
        relations.push({ "@type": "matprov:parameter", from: actId, to: entityId });
      }
    }
  }

  // ── [結果] → Entity + wasGeneratedBy 関係 ──
  for (const lb of labeledBlocks) {
    if (lb.coreLabel === "[結果]") {
      const entityId = `result_${lb.block.id}`;
      nodes.push({
        "@id": entityId,
        "@type": "prov:Entity",
        label: getBlockText(lb.block),
        blockId: lb.block.id,
      });
      // スコープ内の Activity から wasGeneratedBy 関係
      for (const actId of getActivityIdsForScope(lb.block.id)) {
        relations.push({ "@type": "prov:wasGeneratedBy", from: entityId, to: actId });
      }

      // 結果テーブルの試料ID照合
      if (lb.block.type === "table" && sampleTables.length > 0) {
        const resultTable = parseSampleTable(lb.block);
        if (resultTable) {
          for (const st of sampleTables) {
            const { unmatched } = validateSampleIds(st.table, resultTable);
            if (unmatched.length > 0) {
              warnings.push(createWarning(
                "sample-id-mismatch",
                lb.block.id,
                `試料ID不一致: ${unmatched.join(", ")}`
              ));
            }
          }
        }
      }
    }
  }

  // ── informed_by → 前手順の結果を経由してリンク ──
  // 「前手順の結果 Entity」を現在の手順が used する形でグラフを繋ぐ
  // 前手順が分岐済みの場合は試料ごとに対応付ける
  for (const link of links) {
    if (link.type === "informed_by") {
      // link.sourceBlockId = 現在の手順（例: アニールする）
      // link.targetBlockId = 前の手順（例: 封入する）

      const prevBranch = branchMap.get(link.targetBlockId);
      const currentBranch = branchMap.get(link.sourceBlockId);

      // 前手順の Activity ID 一覧
      const prevActIds = prevBranch
        ? prevBranch.activities.map((a) => ({ id: a.id, sampleId: a.sampleId }))
        : [{ id: `activity_${link.targetBlockId}`, sampleId: undefined as string | undefined }];

      // 現在の手順の Activity ID 一覧
      const currentActIds = currentBranch
        ? currentBranch.activities.map((a) => ({ id: a.id, sampleId: a.sampleId }))
        : [{ id: `activity_${link.sourceBlockId}`, sampleId: undefined as string | undefined }];

      // 前手順の [結果] Entity を探す（スコープ内）
      const findResultForActivity = (actId: string) =>
        nodes.find((n) => n["@id"].startsWith("result_") && blockToActivityId.get(n.blockId) === actId);

      // 前手順の合成結果ノードを生成
      const getOrCreateSynthetic = (prevActId: string, sampleId?: string) => {
        const suffix = sampleId ? `${link.targetBlockId}__${sampleId}` : link.targetBlockId;
        const syntheticId = `result_synthetic_${suffix}`;

        if (!nodes.find((n) => n["@id"] === syntheticId)) {
          const prevActLabel = nodes.find((n) => n["@id"] === prevActId)?.label ?? "前手順";
          nodes.push({
            "@id": syntheticId,
            "@type": "prov:Entity",
            label: `${prevActLabel} の結果`,
            blockId: link.targetBlockId,
            sampleId,
          });
          relations.push({
            "@type": "prov:wasGeneratedBy",
            from: syntheticId,
            to: prevActId,
          });
        }
        return syntheticId;
      };

      // 両方分岐 → 試料ごとに 1:1 対応
      if (prevBranch && currentBranch) {
        for (const curr of currentActIds) {
          const prev = prevActIds.find((p) => p.sampleId === curr.sampleId);
          if (!prev) continue;
          const resultNode = findResultForActivity(prev.id);
          const resultId = resultNode?.["@id"] ?? getOrCreateSynthetic(prev.id, prev.sampleId);
          relations.push({ "@type": "prov:used", from: curr.id, to: resultId, linkId: link.id });
        }
      }
      // 前手順のみ分岐 → 各分岐の結果を現在の手順が used
      else if (prevBranch && !currentBranch) {
        for (const prev of prevActIds) {
          const resultNode = findResultForActivity(prev.id);
          const resultId = resultNode?.["@id"] ?? getOrCreateSynthetic(prev.id, prev.sampleId);
          relations.push({ "@type": "prov:used", from: currentActIds[0].id, to: resultId, linkId: link.id });
        }
      }
      // 現在のみ分岐 or 両方未分岐 → 前手順の結果を全分岐が共有
      else {
        const prev = prevActIds[0];
        const resultNode = findResultForActivity(prev.id);
        const resultId = resultNode?.["@id"] ?? getOrCreateSynthetic(prev.id, prev.sampleId);
        for (const curr of currentActIds) {
          relations.push({ "@type": "prov:used", from: curr.id, to: resultId, linkId: link.id });
        }
      }
    }
  }

  console.log("生成ノード:", nodes.map((n) => `${n["@type"]} "${n.label}" (${n["@id"]})`));
  console.log("生成リレーション:", relations.map((r) => `${r["@type"]} ${r.from} → ${r.to}`));
  console.log("警告:", warnings);
  console.groupEnd();

  return {
    "@context": {
      prov: "http://www.w3.org/ns/prov#",
      matprov: "http://matprov.org/ns#",
      eureco: "http://eureco.app/ns#",
    },
    "@graph": nodes,
    relations,
    warnings,
  };
}

// ── ヘルパー関数 ──

/** コアラベル → PROVロール */
function coreToProvRole(label: CoreLabel, block: any): string | null {
  switch (label) {
    case "[手順]": {
      // 見出しレベルで Activity 生成判定
      if (block.type === "heading") {
        const role = getHeadingLabelRole(block.props?.level ?? 2, label);
        return role === "activity" ? "prov:Activity" : null; // section-marker は Activity 生成しない
      }
      return "prov:Activity";
    }
    case "[使用したもの]": return "prov:Entity";
    case "[条件]": return "matprov:Parameter";
    case "[試料]": return null; // 分岐展開のデータソース（ノード自体は生成しない）
    case "[結果]": return "prov:Entity";
    default: return null;
  }
}

/** ブロックのテキスト内容を取得 */
function getBlockText(block: any): string {
  if (block.content) {
    if (Array.isArray(block.content)) {
      return block.content
        .map((c: any) => (c.type === "text" ? c.text : ""))
        .join("");
    }
  }
  return block.id?.slice(0, 8) ?? "";
}

/** ネストされたブロックをフラット化 */
function flattenBlocks(blocks: any[]): any[] {
  const result: any[] = [];
  for (const block of blocks) {
    result.push(block);
    if (block.children && Array.isArray(block.children)) {
      result.push(...flattenBlocks(block.children));
    }
  }
  return result;
}

/** ブロックツリーからIDで検索 */
function findBlockById(block: any, id: string): any | null {
  if (block.id === id) return block;
  if (block.children) {
    for (const child of block.children) {
      const found = findBlockById(child, id);
      if (found) return found;
    }
  }
  return null;
}
