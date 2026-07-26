// ──────────────────────────────────────────────
// PROV-JSON-LD 生成器
//
// ドキュメント全体を走査して PROV-JSON-LD を生成する。
// Phase 3: 関係を埋め込み形式に、テーブルを構造化属性に展開
// ──────────────────────────────────────────────

import { CORE_LABELS, normalizeLabel, classifyLabel, getHeadingLabelRole, LABEL_TO_ENTITY_SUBTYPE, type CoreLabel } from "../context-label/labels";
import { deriveActivityName } from "../context-label/activity-name";
import { parseAttributeBinding, PARENT_ACTIVITY_MARKER } from "../inline-label/attribute-binding";
import type { BlockLink } from "../block-link/link-types";
import { isProvLink } from "../block-link/link-types";
import { createWarning, type ProvWarning } from "./errors";
import { buildDocumentProvenanceBundle, type DocumentProvenanceBundle } from "../document-provenance/prov-output";
import { t } from "../../i18n";

// ── PROV-JSON-LD の型定義（Phase 3: 埋め込み形式） ──

/** 埋め込み属性（[属性] ラベルの段落テキスト、またはメディア子ブロック） */
export type ProvAttribute = {
  "rdfs:label": string;
  "graphium:blockId"?: string;
  "graphium:mediaUrl"?: string;
  "graphium:mediaType"?: string;
};

export type ProvJsonLdNode = {
  "@id": string;
  "@type": string;
  "rdfs:label": string;
  "prov:used"?: { "@id": string }[];
  /** 同一 Entity が複数 Activity に生成され得るため配列（PROV-DM 上 Generation に
   *  cardinality 上限はない）。単一値だと最後の生成元で上書きされ生成エッジが欠落する。 */
  "prov:wasGeneratedBy"?: { "@id": string }[];
  /** Phase D-2: execution Entity から plan Entity への derivation 関係 */
  "prov:wasDerivedFrom"?: { "@id": string }[];
  "graphium:attributes"?: ProvAttribute[];
  "graphium:blockId"?: string;
  [key: `graphium:${string}`]: any;
};

export type ProvJsonLd = {
  "@context": {
    prov: "http://www.w3.org/ns/prov#";
    graphium: "https://graphium.app/ns#";
    rdfs: "http://www.w3.org/2000/01/rdf-schema#";
    xsd: "http://www.w3.org/2001/XMLSchema#";
  };
  "@graph": ProvJsonLdNode[];
  "graphium:warnings"?: ProvWarning[];
  /** ドキュメント来歴（Content Provenance とは分離した prov:Bundle） */
  "graphium:documentProvenance"?: DocumentProvenanceBundle;
};

// 後方互換: 旧型名をエイリアスとして維持
export type ProvDocument = ProvJsonLd;
export type ProvNode = ProvJsonLdNode;

// ── 内部中間表現（生成中に使用） ──

type InternalNode = {
  "@id": string;
  "@type": string;
  label: string;
  blockId: string;
  params?: Record<string, string>;
  attributes?: { label: string; blockId: string; mediaUrl?: string; mediaType?: string }[];
  /** Entity サブタイプ（material / tool） */
  entitySubtype?: import("../context-label/labels").EntitySubtype;
  /** メディアブロックの種類（image / video / audio / pdf / file） */
  mediaType?: string;
  /** メディア URL */
  mediaUrl?: string;
};

type InternalRelation = {
  "@type": string;
  from: string;
  to: string;
  linkId?: string;
};

// ── 入力データの型 ──

type GeneratorInput = {
  /** BlockNote のブロック配列 */
  blocks: any[];
  /** blockId → ラベル文字列 */
  labels: Map<string, string>;
  /** ブロック間リンク（全リンク渡し可 — PROV 層のみ使用） */
  links: BlockLink[];
  /** ドキュメント来歴（オプション） */
  documentProvenance?: import("../document-provenance/types").DocumentProvenance;
  /**
   * メディアブロック (image/video/audio/file/pdf) のインラインラベル
   * (Phase D-3-β, 2026-04-30)。テキストハイライトと同等の役割を持ち、
   * 設計メモ §8.6 に従い blockId → {label, entityId} のサイドストアで保存される。
   */
  mediaInlineLabels?: Map<string, { label: CoreLabel; entityId: string }>;
};

// ── テーブル構造化パーサー ──

type StructuredTableRow = {
  name: string;
  attrs: Record<string, string>;
};

type StructuredTable = {
  rows: StructuredTableRow[];
};

/** [使用したもの]/[結果] ラベル付きテーブルのヘッダーをkey、セルをvalueとして構造化 */
export function parseStructuredTable(block: any): StructuredTable | null {
  if (block.type !== "table") return null;

  const rows = block.content?.rows;
  if (!rows || rows.length < 2) return null;

  // ヘッダー行
  const headerRow = rows[0];
  const headers = headerRow.cells.map((cell: any) => extractCellText(cell));

  const dataRows: StructuredTableRow[] = [];
  for (let i = 1; i < rows.length; i++) {
    const cells = rows[i].cells;
    const name = extractCellText(cells[0]);
    if (!name) continue;

    const attrs: Record<string, string> = {};
    for (let j = 1; j < cells.length && j < headers.length; j++) {
      const value = extractCellText(cells[j]);
      if (value) {
        attrs[headers[j]] = value;
      }
    }
    dataRows.push({ name, attrs });
  }

  return { rows: dataRows };
}

/**
 * [パラメータ] ラベルのテーブルを key=value のパラメータ集合として構造化する。
 * 案B（列名=key）: ヘッダー行をパラメータ名（key）、先頭データ行を値（value）として扱う。
 * 手順（Activity）や親 Entity の params に展開して使う。
 * データ行が複数ある場合は先頭行を採用する（1 ステップのパラメータは 1 行を想定）。
 */
export function parseParameterTable(block: any): Record<string, string> | null {
  if (block.type !== "table") return null;

  const rows = block.content?.rows;
  if (!rows || rows.length < 2) return null;

  const headers = rows[0].cells.map((cell: any) => extractCellText(cell));
  const valueCells = rows[1].cells;

  const params: Record<string, string> = {};
  for (let j = 0; j < headers.length && j < valueCells.length; j++) {
    const key = headers[j];
    const value = extractCellText(valueCells[j]);
    if (key && value) {
      params[key] = value;
    }
  }

  return Object.keys(params).length > 0 ? params : null;
}

// ── メイン生成関数 ──

export function generateProvDocument(input: GeneratorInput): ProvJsonLd {
  const { blocks, labels } = input;
  // PROV 層のリンクのみ使用（知識層は PROV グラフに含めない）
  const links = input.links.filter((l) => !l.layer || isProvLink(l.type));
  const warnings: ProvWarning[] = [];
  const nodes: InternalNode[] = [];
  const relations: InternalRelation[] = [];

  if (import.meta.env.DEV) {
    console.group("[PROV] 生成開始");
    console.log("ブロック数:", blocks.length, "ラベル数:", labels.size, "リンク数:", links.length);
  }

  const flatBlocks = flattenBlocks(blocks);

  // ── Step 0: step コンテナの containment 解決 ──
  // 「手順」は 2 通りの書き方がある:
  //   (旧) 見出し + procedure ラベル → 見出しのスコープ範囲が Activity の境界
  //   (新) step コンテナブロック     → 子孫（親子関係）が Activity の境界
  // どちらも「内側にある Entity はその Activity のもの」という同じ不変量を表す。
  // ここでは後者を先に解決し、blockId → その Activity を引ける表を作る。
  //
  // step はラベルを持たない（labels は context-label 由来）ので、ラベル経由の
  // Activity 判定（coreToProvRole）には乗らない。Activity ノードは別途 emit する。
  const stepOwner = new Map<string, string>();
  const stepBlocks: any[] = [];
  // step 内の「モード帯」。計画（plan）ラベルの付いた子から、次の区切り
  // （result ラベル / step の終わり）までが計画モード。既定は実施（＝タグ無し）。
  // 帯であってコンテナではないので、子は step 直下のまま（階層は増えない）。
  const stepPhase = new Map<string, "plan" | "result">();
  const collectSteps = (list: any[], inherited: string | null) => {
    for (const b of list) {
      if (!b || typeof b !== "object") continue;
      // 入れ子の step は内側が勝つ（＝最も近い祖先 step に束縛される）
      const owner = b.type === "step" ? `activity_${b.id}` : inherited;
      if (b.type === "step") stepBlocks.push(b);
      if (owner && b.id) stepOwner.set(b.id, owner);
      if (Array.isArray(b.children)) {
        if (b.type === "step") markStepPhases(b.children);
        collectSteps(b.children, owner);
      }
    }
  };
  // step の子を順に見て、モード帯を子孫へ伝播させる
  const markStepPhases = (children: any[]) => {
    let current: "plan" | "result" | undefined;
    const assign = (b: any, phase: "plan" | "result") => {
      if (b?.id) stepPhase.set(b.id, phase);
      if (Array.isArray(b?.children)) for (const c of b.children) assign(c, phase);
    };
    for (const child of children) {
      if (!child || typeof child !== "object") continue;
      const raw = child.id ? labels.get(child.id) : undefined;
      const normalized = raw ? normalizeLabel(raw) : null;
      if (normalized === "plan" || normalized === "result") {
        current = normalized;
      }
      // 内側の step は自前の帯を持つので、外側の帯を持ち込まない
      if (current && child.type !== "step") assign(child, current);
    }
  };
  collectSteps(blocks, null);

  // ── Step 1: ラベルパーサー ──

  type LabeledBlock = {
    block: any;
    rawLabel: string;
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

    labeledBlocks.push({ block, rawLabel, label: normalized, coreLabel, provRole });
  }

  // ── Step 2: @リンク解析 ──

  // 孤立リンク（削除済みブロックへの参照）を除外し、有効なリンクのみ処理する
  const validLinks: BlockLink[] = [];
  const informedByMap = new Map<string, BlockLink[]>();
  for (const link of links) {
    const sourceExists = blocks.some((b: any) => findBlockById(b, link.sourceBlockId));
    const targetExists = blocks.some((b: any) => findBlockById(b, link.targetBlockId));

    if (!sourceExists || !targetExists) {
      warnings.push(createWarning("broken-link", link.sourceBlockId,
        `リンク ${link.type} の${!sourceExists ? "元" : "先"} ${!sourceExists ? link.sourceBlockId : link.targetBlockId} が存在しません — スキップ`));
      continue;
    }

    validLinks.push(link);
    if (link.type === "informed_by") {
      const existing = informedByMap.get(link.sourceBlockId) ?? [];
      existing.push(link);
      informedByMap.set(link.sourceBlockId, existing);
    }
  }

  // ── Step 3: Activity ノード生成 ──

  // step の中にある procedure 見出しからは Activity を作らない。
  // step が既に Activity 境界なので、二重に作ると同じ内容が 2 つの Activity に
  // 束縛されてしまう（containment を優先する）。
  const activities = labeledBlocks.filter(
    (lb) => lb.provRole === "prov:Activity" && !stepOwner.has(lb.block.id),
  );

  for (const act of activities) {
    const blockId = act.block.id;
    // 見出しの連番プレフィックス（"1. " "1.1 " "a. " 等）は activity 名から除く（非破壊）
    const actLabel = deriveActivityName(getBlockText(act.block));
    nodes.push({
      "@id": `activity_${blockId}`,
      "@type": "prov:Activity",
      label: actLabel,
      blockId,
    });
  }

  // step コンテナ → Activity。ラベルを持たないので上のループとは別に emit する。
  // タイトルは block の content（inline content）にあるので、見出しと同じ経路で読める。
  for (const step of stepBlocks) {
    nodes.push({
      "@id": `activity_${step.id}`,
      "@type": "prov:Activity",
      label: deriveActivityName(getBlockText(step)),
      blockId: step.id,
    });
  }

  // ── スコープ解決 ──
  // Phase D-2 (2026-04-30): Activity スコープに加え、Plan/Result phase のスコープも追跡。
  //   - phase 見出し (#plan / #result) は Activity スコープを **作らない**（Activity は procedure のみ）
  //   - phase 見出しは「現在の Activity 内における phase コンテキスト」を切り替えるだけ
  //   - 同レベル以上の見出しが現れたら phase もクリア（procedure と同じ pop ルール）
  type Phase = "plan" | "result" | undefined;
  const blockToActivityId = new Map<string, string>();
  const blockToPhase = new Map<string, Phase>();
  const scopeStack: { level: number; activityId: string }[] = [];
  const phaseStack: { level: number; phase: Phase }[] = [];
  for (const block of flatBlocks) {
    // step の内側にある見出しは、外側の見出しスコープを操作しない。
    // step が Activity 境界なので、中の見出しは単なる小見出しとして扱う
    // （ここで pop/push させると step を跨いでスコープが壊れる）。
    if (block.type === "heading" && !stepOwner.has(block.id)) {
      const level = block.props?.level ?? 2;
      const label = labels.get(block.id);
      const normalized = label ? normalizeLabel(label) : null;

      while (scopeStack.length > 0 && scopeStack[scopeStack.length - 1].level >= level) {
        scopeStack.pop();
      }
      while (phaseStack.length > 0 && phaseStack[phaseStack.length - 1].level >= level) {
        phaseStack.pop();
      }

      if (normalized === "procedure") {
        const role = getHeadingLabelRole(level, normalized);
        if (role === "activity") {
          scopeStack.push({ level, activityId: `activity_${block.id}` });
        }
      } else if (normalized === "plan" || normalized === "result") {
        phaseStack.push({ level, phase: normalized });
      }
    }
    // step の子孫は containment で束縛する（見出しスコープより優先）。
    // step 外のブロックは従来どおり見出しスコープに従う。
    const currentActivityId =
      stepOwner.get(block.id) ??
      (scopeStack.length > 0 ? scopeStack[scopeStack.length - 1].activityId : null);
    if (currentActivityId) {
      blockToActivityId.set(block.id, currentActivityId);
    }
    // step 内はモード帯が phase を決める（見出し由来の phase より優先）
    const currentPhase =
      stepPhase.get(block.id) ??
      (phaseStack.length > 0 ? phaseStack[phaseStack.length - 1].phase : undefined);
    if (currentPhase) {
      blockToPhase.set(block.id, currentPhase);
    }
  }

  function getActivityIdsForScope(blockId: string): string[] {
    const scopeActId = blockToActivityId.get(blockId);
    if (!scopeActId) return [];
    return [scopeActId];
  }

  function getPhaseForBlock(blockId: string): Phase {
    return blockToPhase.get(blockId);
  }

  /** メディアブロックの場合にラベル・mediaType・mediaUrl を返すヘルパー */
  const MEDIA_BLOCK_TYPES_SET = new Set(["image", "video", "audio", "file", "pdf"]);
  function getEntityLabelAndMedia(block: any): { label: string; mediaType?: string; mediaUrl?: string } {
    if (MEDIA_BLOCK_TYPES_SET.has(block.type) && block.props?.url) {
      const url: string = block.props.url;
      const name = block.props.name
        || decodeURIComponent(url.split("/").pop()?.split("?")[0] ?? "")
        || block.id.slice(0, 8);
      return { label: name, mediaType: block.type, mediaUrl: url };
    }
    return { label: getBlockText(block) };
  }

  // ── material / tool → Entity + used 関係 ──
  // Phase 3: テーブルの場合は行ごとに個別 Entity に展開
  const INPUT_LABELS: CoreLabel[] = ["material", "tool"];
  for (const lb of labeledBlocks) {
    if (lb.coreLabel && INPUT_LABELS.includes(lb.coreLabel)) {
      const subtype = lb.coreLabel ? LABEL_TO_ENTITY_SUBTYPE[lb.coreLabel] : undefined;
      if (lb.block.type === "table") {
        // テーブル: 行ごとに個別 Entity を生成
        const parsed = parseStructuredTable(lb.block);
        if (parsed && parsed.rows.length > 0) {
          // 同名行による @id 衝突を防ぐ。初出は従来形式、重複時のみ連番を付与
          // （同名 2 行が同一 @id になると nodeMap で後勝ち上書きされ params/エッジが消える）。
          const seenName = new Map<string, number>();
          for (const row of parsed.rows) {
            const seq = (seenName.get(row.name) ?? 0) + 1;
            seenName.set(row.name, seq);
            const entityId = seq === 1
              ? `entity_${lb.block.id}_${row.name}`
              : `entity_${lb.block.id}_${row.name}_${seq}`;
            nodes.push({
              "@id": entityId,
              "@type": "prov:Entity",
              label: row.name,
              blockId: lb.block.id,
              params: Object.keys(row.attrs).length > 0 ? row.attrs : undefined,
              entitySubtype: subtype,
            });
            for (const actId of getActivityIdsForScope(lb.block.id)) {
              relations.push({ "@type": "prov:used", from: actId, to: entityId });
            }
          }
        } else {
          // パース失敗時はフォールバック（テーブル全体を1 Entity）
          const entityId = `entity_${lb.block.id}`;
          nodes.push({
            "@id": entityId,
            "@type": "prov:Entity",
            label: getBlockText(lb.block),
            blockId: lb.block.id,
            entitySubtype: subtype,
          });
          for (const actId of getActivityIdsForScope(lb.block.id)) {
            relations.push({ "@type": "prov:used", from: actId, to: entityId });
          }
        }
      } else {
        // 段落・メディア: ヘルパーでラベルとメディア属性を取得
        const entityId = `entity_${lb.block.id}`;
        const { label: entityLabel, mediaType, mediaUrl } = getEntityLabelAndMedia(lb.block);
        nodes.push({
          "@id": entityId,
          "@type": "prov:Entity",
          label: entityLabel,
          blockId: lb.block.id,
          entitySubtype: subtype,
          mediaType,
          mediaUrl,
        });
        for (const actId of getActivityIdsForScope(lb.block.id)) {
          relations.push({ "@type": "prov:used", from: actId, to: entityId });
        }
      }
    }
  }

  // ── output → Entity + wasGeneratedBy 関係 ──
  // Phase 3: テーブルの場合は行ごとに個別 Entity に展開
  // NOTE: PROV ノード ID 接頭辞は歴史的経緯で `result_` のまま維持（後方互換）。
  for (const lb of labeledBlocks) {
    if (lb.coreLabel === "output") {
      if (lb.block.type === "table") {
        const parsed = parseStructuredTable(lb.block);
        if (parsed && parsed.rows.length > 0) {
          // 同名行による @id 衝突を防ぐ（初出は従来形式、重複時のみ連番）。
          const seenName = new Map<string, number>();
          for (const row of parsed.rows) {
            const seq = (seenName.get(row.name) ?? 0) + 1;
            seenName.set(row.name, seq);
            const entityId = seq === 1
              ? `result_${lb.block.id}_${row.name}`
              : `result_${lb.block.id}_${row.name}_${seq}`;
            nodes.push({
              "@id": entityId,
              "@type": "prov:Entity",
              label: row.name,
              blockId: lb.block.id,
              params: Object.keys(row.attrs).length > 0 ? row.attrs : undefined,
            });
            for (const actId of getActivityIdsForScope(lb.block.id)) {
              relations.push({ "@type": "prov:wasGeneratedBy", from: entityId, to: actId });
            }
          }
        } else {
          const entityId = `result_${lb.block.id}`;
          const { label: entityLabel, mediaType, mediaUrl } = getEntityLabelAndMedia(lb.block);
          nodes.push({
            "@id": entityId,
            "@type": "prov:Entity",
            label: entityLabel,
            blockId: lb.block.id,
            mediaType,
            mediaUrl,
          });
          for (const actId of getActivityIdsForScope(lb.block.id)) {
            relations.push({ "@type": "prov:wasGeneratedBy", from: entityId, to: actId });
          }
        }
      } else {
        // 段落・メディア
        const entityId = `result_${lb.block.id}`;
        const { label: entityLabel, mediaType, mediaUrl } = getEntityLabelAndMedia(lb.block);
        nodes.push({
          "@id": entityId,
          "@type": "prov:Entity",
          label: entityLabel,
          blockId: lb.block.id,
          mediaType,
          mediaUrl,
        });
        for (const actId of getActivityIdsForScope(lb.block.id)) {
          relations.push({ "@type": "prov:wasGeneratedBy", from: entityId, to: actId });
        }
      }
    }
  }

  // ── attribute → 親ノードの graphium:attributes に埋め込み ──
  // 独立ノードは作らず、親の Entity/Activity のプロパティとして格納
  // ※ output ノード生成後に実行する（result_ ノードを参照するため）
  for (const lb of labeledBlocks) {
    if (lb.coreLabel === "attribute") {
      // テーブルの [パラメータ] は key=value の構造化パラメータとして展開し、
      // 親 Entity または手順（Activity）の params にマージする（案B: 列名=key）。
      if (lb.block.type === "table") {
        const params = parseParameterTable(lb.block);
        if (params) {
          const mergeParams = (node: InternalNode | undefined) => {
            if (!node) return;
            node.params = { ...(node.params ?? {}), ...params };
          };
          const parentNodeId = findParentLabeledNodeId(lb.block.id, blocks, labels, labeledBlocks);
          if (parentNodeId) {
            mergeParams(nodes.find((n) => n["@id"] === parentNodeId));
          } else {
            for (const actId of getActivityIdsForScope(lb.block.id)) {
              mergeParams(nodes.find((n) => n["@id"] === actId));
            }
          }
        }
        continue;
      }

      // メディアブロックの場合はファイル名・URL・タイプを取得
      const { label: attrLabel, mediaUrl, mediaType } = getEntityLabelAndMedia(lb.block);
      const attrEntry = { label: attrLabel, blockId: lb.block.id, mediaUrl, mediaType };

      // 親ブロックの PROV ノードを探す
      const parentNodeId = findParentLabeledNodeId(lb.block.id, blocks, labels, labeledBlocks);
      if (parentNodeId) {
        const parentNode = nodes.find((n) => n["@id"] === parentNodeId);
        if (parentNode) {
          if (!parentNode.attributes) parentNode.attributes = [];
          parentNode.attributes.push(attrEntry);
        }
      } else {
        // 親がない場合はスコープの Activity に埋め込む
        for (const actId of getActivityIdsForScope(lb.block.id)) {
          const actNode = nodes.find((n) => n["@id"] === actId);
          if (actNode) {
            if (!actNode.attributes) actNode.attributes = [];
            actNode.attributes.push(attrEntry);
          }
        }
      }
    }
  }

  // ── ラベルなしメディアブロック → 祖先 Entity の属性として埋め込み ──
  // ブロックツリーの親子関係を辿り、[材料]/[ツール]/[結果] の祖先があれば
  // その Entity の属性として埋め込む。

  const MEDIA_BLOCK_TYPES = ["image", "video", "audio", "file", "pdf"];
  const ENTITY_LABEL_SET: CoreLabel[] = ["material", "tool", "output"];

  // ラベルなしメディアブロックの祖先を探して属性として埋め込む
  const embeddedMediaIds = new Set<string>();

  // Phase D-3-β: メディアインラインラベル付きブロックは後続の集約パスで
  // 直接 Entity 化されるため、祖先 attribute 化からは除外する。
  const mediaInlineLabeledIds = new Set<string>();
  if (input.mediaInlineLabels) {
    for (const id of input.mediaInlineLabels.keys()) mediaInlineLabeledIds.add(id);
  }

  for (const block of flatBlocks) {
    // ラベル付き or 非メディア → スキップ
    if (labels.has(block.id)) continue;
    if (mediaInlineLabeledIds.has(block.id)) continue;
    if (!MEDIA_BLOCK_TYPES.includes(block.type)) continue;
    if (!block.props?.url) continue;

    // ブロックツリーを遡って [材料]/[ツール]/[結果] の祖先を探す
    const parentNodeId = findParentLabeledNodeId(block.id, blocks, labels, labeledBlocks);
    if (!parentNodeId) continue;

    const url: string = block.props.url;
    const mediaName = block.props.name
      || decodeURIComponent(url.split("/").pop()?.split("?")[0] ?? "")
      || block.id.slice(0, 8);

    // 親ノードを探す（テーブル展開時は複数行 Entity がある → 全行に付与）
    const parentNodes = nodes.filter((n) =>
      n["@id"] === parentNodeId || n["@id"].startsWith(`${parentNodeId}_`)
    );

    for (const parentNode of parentNodes) {
      if (!parentNode.attributes) parentNode.attributes = [];
      parentNode.attributes.push({
        label: mediaName,
        blockId: block.id,
        mediaUrl: url,
        mediaType: block.type,
      });
    }

    embeddedMediaIds.add(block.id);
  }

  // ── メディアブロック → Entity（ラベル付きセクション内、かつ子ブロックでないもの） ──
  // フラットブロックを走査し、直前のラベルコンテキスト（[材料]/[ツール]/[結果]）を追跡。
  // メディアブロックがラベル付きセクション内にあれば PROV Entity として生成する。
  // 同一 URL のメディアは 1 Entity にまとめ、複数の prov:used/wasGeneratedBy を付与。
  // ※ 子ブロックとして既に親の属性に埋め込まれたメディアは除外。

  type EntityLabelContext = { coreLabel: CoreLabel };

  let currentEntityLabel: EntityLabelContext | null = null;
  // URL → デデュプ情報（同一メディアを 1 Entity にまとめる）
  const mediaEntityMap = new Map<string, {
    entityId: string;
    activityIds: Set<string>;
    coreLabel: CoreLabel;
  }>();

  for (const block of flatBlocks) {
    // ラベルコンテキストの更新
    const rawLabel = labels.get(block.id);
    if (rawLabel) {
      const normalized = normalizeLabel(rawLabel);
      // テーブルの entity 系ラベル（構造テーブル）は自己完結（各行が Entity）であり、
      // 後続のメディアブロックへ文脈を流さない。流すと、テーブルの直後に置いた
      // 無関係な画像まで material/output として取り込まれてしまう（誤検出）。
      if (ENTITY_LABEL_SET.includes(normalized as CoreLabel) && block.type !== "table") {
        currentEntityLabel = { coreLabel: normalized as CoreLabel };
      } else {
        // procedure / attribute / 構造テーブル などはメディアのコンテキストをリセット
        currentEntityLabel = null;
      }
    }

    // 見出し / step コンテナでコンテキストをリセット（新しいセクションの開始）
    // step も工程の境界なので、直前の [材料] 文脈が step の中の画像に漏れないようにする。
    if ((block.type === "heading" || block.type === "step") && !rawLabel) {
      currentEntityLabel = null;
    }

    // メディアブロックの検出（子ブロックとして既に処理済みのものは除外）
    if (
      MEDIA_BLOCK_TYPES.includes(block.type) &&
      block.props?.url &&
      currentEntityLabel &&
      !embeddedMediaIds.has(block.id) &&
      !mediaInlineLabeledIds.has(block.id) // Phase D-3-β: インラインラベル付きは別経路
    ) {
      const url: string = block.props.url;
      const actIds = getActivityIdsForScope(block.id);
      const { coreLabel } = currentEntityLabel;

      if (mediaEntityMap.has(url)) {
        // 同一メディア → Activity 関係のみ追加
        const existing = mediaEntityMap.get(url)!;
        for (const actId of actIds) {
          existing.activityIds.add(actId);
        }
      } else {
        // 新規メディア Entity を生成
        const prefix = coreLabel === "output" ? "result_media" : "entity_media";
        const entityId = `${prefix}_${block.id}`;
        const mediaName = block.props.name
          || decodeURIComponent(url.split("/").pop()?.split("?")[0] ?? "")
          || block.id.slice(0, 8);

        const subtype = LABEL_TO_ENTITY_SUBTYPE[coreLabel];
        nodes.push({
          "@id": entityId,
          "@type": "prov:Entity",
          label: mediaName,
          blockId: block.id,
          entitySubtype: subtype,
          mediaType: block.type,
          mediaUrl: url,
        });

        mediaEntityMap.set(url, {
          entityId,
          activityIds: new Set(actIds),
          coreLabel,
        });
      }
    }
  }

  // メディア Entity の PROV 関係を生成
  for (const [, info] of mediaEntityMap) {
    for (const actId of info.activityIds) {
      if (info.coreLabel === "output") {
        relations.push({ "@type": "prov:wasGeneratedBy", from: info.entityId, to: actId });
      } else {
        relations.push({ "@type": "prov:used", from: actId, to: info.entityId });
      }
    }
  }

  // ── インラインハイライト → Entity / Attribute（Phase D-1, 2026-04-30） ──
  //
  // BlockNote のインライン style (`inlineMaterial / inlineTool / inlineAttribute /
  // inlineOutput`) を読み取り、PROV Entity / Attribute を生成する。
  //
  // - 同 entityId を持つ複数の text inline は 1 つの Entity に集約（テキスト連結）
  // - material / tool → prov:used
  // - output → prov:wasGeneratedBy
  // - attribute (Parameter) → 同ブロック内で最寄りの Entity ハイライトに従属、なければ親 Activity
  //
  // 実装メモ:
  //   - block-level [material]/[tool]/[output]/[attribute] は legacy として共存可能だが、
  //     Phase C-2 のマイグレーションでインライン style に変換されているはず
  //   - ID は `inline_<label>_<entityId>` で安定させ、衝突を防ぐ
  type InlineHighlightSegment = {
    blockId: string;
    label: CoreLabel;
    entityId: string;
    text: string;
    /** ブロック内の char offset 開始（最寄り Entity 検索用） */
    charStart: number;
    /** ブロック内の char offset 終了 */
    charEnd: number;
    /**
     * Phase F: attribute のみ。明示指定された親 entity / "activity" / null。
     * null は最寄り Entity 推論（旧挙動）。
     */
    parentOverride?: string | null;
  };

  const inlineSegments: InlineHighlightSegment[] = [];
  const STYLE_TO_LABEL: Record<string, CoreLabel> = {
    inlineMaterial: "material",
    inlineTool: "tool",
    inlineAttribute: "attribute",
    inlineOutput: "output",
  };

  for (const block of flatBlocks) {
    const content = block?.content;
    if (!Array.isArray(content)) continue;
    let charOffset = 0;
    const collectFromText = (textInline: any) => {
      const text: string = typeof textInline?.text === "string" ? textInline.text : "";
      const styles = textInline?.styles ?? {};
      const len = text.length;
      for (const styleKey of Object.keys(STYLE_TO_LABEL)) {
        const raw = styles[styleKey];
        if (typeof raw === "string" && raw) {
          const labelKind = STYLE_TO_LABEL[styleKey];
          let entityId: string = raw;
          let parentOverride: string | null = null;
          if (labelKind === "attribute") {
            const b = parseAttributeBinding(raw);
            entityId = b.entityId;
            parentOverride = b.parentEntityId;
            if (!entityId) continue;
          }
          inlineSegments.push({
            blockId: block.id,
            label: labelKind,
            entityId,
            text,
            charStart: charOffset,
            charEnd: charOffset + len,
            parentOverride,
          });
        }
      }
      charOffset += len;
    };
    for (const c of content) {
      if (c?.type === "text") {
        collectFromText(c);
      } else if (c?.type === "link" && Array.isArray(c.content)) {
        for (const lc of c.content) {
          if (lc?.type === "text") collectFromText(lc);
        }
      } else if (typeof c === "string") {
        charOffset += c.length;
      }
    }
  }

  // entityId × ブロック の単位で Entity / Attribute をまとめる
  type AggregatedEntity = {
    label: CoreLabel;
    entityId: string;
    blockId: string;
    text: string;
    /** このブロック内での文字範囲（最寄り Entity 検索用） */
    charStart: number;
    charEnd: number;
    /** メディアブロック由来の場合のメディア URL */
    mediaUrl?: string;
    /** メディアブロック由来の場合のメディア種別 (image/video/audio/file/pdf) */
    mediaType?: string;
    /** Phase F: attribute のみ。明示指定 parent。null/undefined は最寄り推論。 */
    parentOverride?: string | null;
  };
  const aggregatedByKey = new Map<string, AggregatedEntity>();
  for (const seg of inlineSegments) {
    const key = `${seg.blockId}::${seg.label}::${seg.entityId}`;
    const existing = aggregatedByKey.get(key);
    if (existing) {
      existing.text += seg.text;
      existing.charStart = Math.min(existing.charStart, seg.charStart);
      existing.charEnd = Math.max(existing.charEnd, seg.charEnd);
      // 後勝ちで parentOverride を上書き（同 entity に複数 segment がある場合）
      if (seg.parentOverride !== undefined && seg.parentOverride !== null) {
        existing.parentOverride = seg.parentOverride;
      }
    } else {
      aggregatedByKey.set(key, {
        label: seg.label,
        entityId: seg.entityId,
        blockId: seg.blockId,
        text: seg.text,
        charStart: seg.charStart,
        charEnd: seg.charEnd,
        parentOverride: seg.parentOverride ?? null,
      });
    }
  }

  // ── Phase D-3-β (2026-04-30): メディアブロックのインラインラベル ──
  //
  // image / video / audio / file / pdf ブロックは BlockNote の inline style を
  // 持てないため、サイドストア (mediaInlineLabels) で blockId → {label, entityId}
  // を保存している。テキストハイライトと同じ集約マップ (aggregatedByKey) に
  // 合流させ、後続の Entity / Attribute 生成ロジックを共有する。
  const mediaInlineLabels = input.mediaInlineLabels;
  if (mediaInlineLabels && mediaInlineLabels.size > 0) {
    const blockById = new Map<string, any>();
    for (const b of flatBlocks) blockById.set(b.id, b);
    for (const [blockId, entry] of mediaInlineLabels) {
      const block = blockById.get(blockId);
      if (!block) continue;
      if (!MEDIA_BLOCK_TYPES.includes(block.type)) continue;
      const url: string | undefined = block.props?.url || undefined;
      const mediaName: string =
        block.props?.name ||
        (url
          ? decodeURIComponent(url.split("/").pop()?.split("?")[0] ?? "")
          : "") ||
        block.id.slice(0, 8);
      const key = `${blockId}::${entry.label}::${entry.entityId}`;
      aggregatedByKey.set(key, {
        label: entry.label,
        entityId: entry.entityId,
        blockId,
        text: mediaName,
        charStart: 0,
        charEnd: 0,
        mediaUrl: url,
        mediaType: block.type,
      });
    }
  }

  const aggregatedList = Array.from(aggregatedByKey.values());

  // ── Phase D-2 (2026-04-30): Plan / Result phase スコーピング ──
  //   - `#plan` 見出し配下のインライン Entity → 型は `prov:Entity` のまま
  //     （個別の予定物質に `prov:Plan` を付けるのは誤用。phase は `graphium:phase`
  //     メタ属性で表現。下記 §1 のコメント参照）。
  //     ノード ID は `inline_<label>_<entityId>_plan` で execution Entity と分離
  //   - `#result` 見出し or 未指定 → 既存の Activity 実行 Entity (`prov:Entity`)
  //   - 同 entityId が plan / execution 両方に出現 → execution → plan に
  //     `prov:wasDerivedFrom` エッジを張る（実体は計画から派生）
  function nodeIdFor(agg: AggregatedEntity): string {
    const phase = getPhaseForBlock(agg.blockId);
    const suffix = phase === "plan" ? "_plan" : "";
    return `inline_${agg.label}_${agg.entityId}${suffix}`;
  }

  // 1) Input / Tool / Output → Entity ノード + edge
  //    Plan phase の Entity も型は `prov:Entity` のまま（PROV-DM の Plan は
  //    "agent が activity 実行に使う計画書全体" を指す概念で、個別の予定物質に
  //    `prov:Plan` を付けるのは誤用）。phase はメタ属性 `graphium:phase` で表現。
  for (const agg of aggregatedList) {
    if (agg.label === "attribute") continue; // Parameter は後段で処理
    const phase = getPhaseForBlock(agg.blockId);
    const nodeId = nodeIdFor(agg);
    if (!nodes.find((n) => n["@id"] === nodeId)) {
      const node: InternalNode = {
        "@id": nodeId,
        "@type": "prov:Entity",
        label: agg.text || agg.entityId,
        blockId: agg.blockId,
        entitySubtype: LABEL_TO_ENTITY_SUBTYPE[agg.label],
      };
      if (agg.mediaUrl) node.mediaUrl = agg.mediaUrl;
      if (agg.mediaType) node.mediaType = agg.mediaType;
      // graphium:phase をメタとして残す（クエリやフィルタ用）
      (node as any)["graphium:phase"] = phase ?? "execution";
      nodes.push(node);
    }
    // 同 entityId の複数ブロック分は edge を重ねる
    for (const actId of getActivityIdsForScope(agg.blockId)) {
      if (agg.label === "output") {
        relations.push({ "@type": "prov:wasGeneratedBy", from: nodeId, to: actId });
      } else {
        relations.push({ "@type": "prov:used", from: actId, to: nodeId });
      }
    }
  }

  // 1b) wasDerivedFrom: execution Entity が plan Entity と同 entityId / 同 label の場合、
  //    execution → plan の wasDerivedFrom エッジを張る（実体は計画から派生）。
  //    PROV-DM 上 specializationOf は「同じ実体のより固定された見方」を表す関係で、
  //    Plan（意図）と Execution（実体）は別個の事象なので、derivation の方が整合的。
  //    Step Activity は両 Entity の used 関係から PROV-DM 完全形を復元可能。
  const planEntityKeys = new Set<string>();
  for (const agg of aggregatedList) {
    if (agg.label === "attribute") continue;
    if (getPhaseForBlock(agg.blockId) === "plan") {
      planEntityKeys.add(`${agg.label}::${agg.entityId}`);
    }
  }
  if (planEntityKeys.size > 0) {
    for (const agg of aggregatedList) {
      if (agg.label === "attribute") continue;
      if (getPhaseForBlock(agg.blockId) === "plan") continue;
      const key = `${agg.label}::${agg.entityId}`;
      if (planEntityKeys.has(key)) {
        const fromId = `inline_${agg.label}_${agg.entityId}`;
        const toId = `inline_${agg.label}_${agg.entityId}_plan`;
        // 重複防止
        const exists = relations.some(
          (r) => r["@type"] === "prov:wasDerivedFrom" && r.from === fromId && r.to === toId,
        );
        if (!exists) {
          relations.push({ "@type": "prov:wasDerivedFrom", from: fromId, to: toId });
        }
      }
    }
  }

  // 2) Parameter (attribute) → 隣接 Entity の attribute、無ければ Activity の attribute
  //    Phase F: parentOverride（明示指定）があればそれを最優先。
  //    隣接判定（fallback）: 同ブロック内の Entity ハイライトのうち、Parameter の char 範囲との
  //    最短距離（重なり=0、隣接=1、離れる=距離）を優先
  for (const agg of aggregatedList) {
    if (agg.label !== "attribute") continue;

    const sameBlockEntities = aggregatedList.filter(
      (other) => other.blockId === agg.blockId && other.label !== "attribute",
    );

    let chosenNodeId: string | null = null;
    let bindToActivity = false;

    // Phase F: 明示指定 parent
    if (agg.parentOverride === PARENT_ACTIVITY_MARKER) {
      bindToActivity = true;
    } else if (agg.parentOverride) {
      // 同ブロック内 → 他ブロック の順で該当 Entity を探す（cross-block 紐付け対応）
      const explicit =
        sameBlockEntities.find((o) => o.entityId === agg.parentOverride) ??
        aggregatedList.find(
          (o) =>
            o.label !== "attribute" && o.entityId === agg.parentOverride,
        );
      if (explicit) {
        chosenNodeId = nodeIdFor(explicit);
      }
      // 見つからない場合は fallback として最寄り推論に落ちる
    }

    // fallback: 最寄り推論
    if (!chosenNodeId && !bindToActivity && sameBlockEntities.length > 0) {
      let bestDist = Number.POSITIVE_INFINITY;
      for (const other of sameBlockEntities) {
        const otherNodeId = nodeIdFor(other);
        // 範囲距離: 重なりは 0、それ以外は最短ギャップ
        const overlap = !(agg.charEnd <= other.charStart || other.charEnd <= agg.charStart);
        const dist = overlap
          ? 0
          : Math.min(
              Math.abs(agg.charStart - other.charEnd),
              Math.abs(other.charStart - agg.charEnd),
            );
        if (dist < bestDist) {
          bestDist = dist;
          chosenNodeId = otherNodeId;
        }
      }
    }

    // fallback (階層): 同ブロックに Entity が無ければ、親ブロックを遡って
    // 最も近い Entity (block-level label / inline style どちらでも) を探す。
    //   - Bread flour (inline material)
    //     - Amount: 300g (inline attribute)  ← parent block の Bread flour に紐づく
    if (!chosenNodeId && !bindToActivity && sameBlockEntities.length === 0) {
      // ブロックレベルラベル経由 (block-level material/tool/output 用)
      const parentLabeledId = findParentLabeledNodeId(agg.blockId, blocks, labels, labeledBlocks);
      if (parentLabeledId && nodes.some((n) => n["@id"] === parentLabeledId)) {
        chosenNodeId = parentLabeledId;
      } else {
        // インライン Entity 経由: 親ブロックを遡り、aggregatedList に
        // 非 attribute の entry を持つ最も近い祖先ブロックを採用する。
        let cursorId = findParentBlockId(blocks, agg.blockId);
        while (cursorId) {
          const parentEntities = aggregatedList.filter(
            (other) => other.blockId === cursorId && other.label !== "attribute",
          );
          if (parentEntities.length > 0) {
            // 親ブロックに複数 entity がある場合は先頭（=最初に出現したもの）。
            // 通常 1 つを想定（Bread flour のような single-entity ブロック）。
            chosenNodeId = nodeIdFor(parentEntities[0]);
            break;
          }
          cursorId = findParentBlockId(blocks, cursorId);
        }
      }
    }

    // メディアブロックを [パラメータ] 化した場合も、Entity 経路（mediaUrl/mediaType を
    // ノードへ付与）と同様にメディア情報を attribute へ引き継ぐ。これがないと graph view が
    // サムネイルを描けず、ファイル名テキストにフォールバックしてしまう。
    const attrEntry: { label: string; blockId: string; mediaUrl?: string; mediaType?: string } = {
      label: agg.text || agg.entityId,
      blockId: agg.blockId,
    };
    if (agg.mediaUrl) attrEntry.mediaUrl = agg.mediaUrl;
    if (agg.mediaType) attrEntry.mediaType = agg.mediaType;

    if (chosenNodeId) {
      const target = nodes.find((n) => n["@id"] === chosenNodeId);
      if (target) {
        if (!target.attributes) target.attributes = [];
        target.attributes.push(attrEntry);
      }
    } else {
      // bindToActivity または 同ブロック内に Entity が無い → 親 Activity に attach
      for (const actId of getActivityIdsForScope(agg.blockId)) {
        const actNode = nodes.find((n) => n["@id"] === actId);
        if (actNode) {
          if (!actNode.attributes) actNode.attributes = [];
          actNode.attributes.push(attrEntry);
        }
      }
    }
  }

  // ── informed_by → 前手順の結果を経由してリンク + Entity unification ──
  //
  // PROV-DM の wasInformedBy(B, A) は ∃E. wasGeneratedBy(E, A) ∧ used(B, E) を意味する。
  // すなわち「B が A の出力 Entity E を使った」というチェーン。
  //
  // 二つの正規化を行う:
  //
  //   (1) **Entity の unification（同一実体の 2 ノード化を回避）**:
  //       B の material/tool span のテキスト label が A の output span の label と一致したら、
  //       B 側の inline_material/_tool ノードを A 側の inline_output ノードに **merge** する。
  //       これにより「Step A が生成した X」と「Step B が使う X」が同じ PROV Entity になり、
  //       グラフから重複ノードが消える。derivedFrom を持つ material/tool span が
  //       LLM の意図する「前手順の生成物」であるとき、この unification が自然に成立する。
  //
  //   (2) **synthetic placeholder の抑制**:
  //       A に explicit な inline_output Entity が既にある場合、`result_synthetic_*` の
  //       「〜の結果」 placeholder は作らない。代わりに inline_output を proxy として
  //       used edge を張る。explicit output も B 側 material も無いときだけ
  //       fallback として synthetic を作る（grafh connectivity 維持のため）。
  const findOutputEntitiesForActivity = (actId: string) =>
    nodes.filter(
      (n) => n["@id"].startsWith("inline_output_") && blockToActivityId.get(n.blockId) === actId,
    );
  const findMatToolEntitiesForActivity = (actId: string) =>
    nodes.filter(
      (n) =>
        (n["@id"].startsWith("inline_material_") || n["@id"].startsWith("inline_tool_")) &&
        blockToActivityId.get(n.blockId) === actId,
    );
  const labelForMatch = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");

  for (const link of validLinks) {
    if (link.type !== "informed_by") continue;

    const prevActId = `activity_${link.targetBlockId}`;
    const currentActId = `activity_${link.sourceBlockId}`;

    // (a) explicit output Entity of prev activity（v5+ では inline_output_*）
    const prevOutputs = findOutputEntitiesForActivity(prevActId);

    // (b) current activity の material/tool で、prev output と label が一致するものを merge
    const currMatTools = findMatToolEntitiesForActivity(currentActId);
    const unifiedFromIds = new Set<string>();
    for (const curr of currMatTools) {
      const match = prevOutputs.find((o) => labelForMatch(o.label) === labelForMatch(curr.label));
      if (!match) continue;
      // reroute all relations referencing curr to match
      for (const rel of relations as InternalRelation[]) {
        if (rel.from === curr["@id"]) rel.from = match["@id"];
        if (rel.to === curr["@id"]) rel.to = match["@id"];
      }
      unifiedFromIds.add(curr["@id"]);
    }
    if (unifiedFromIds.size > 0) {
      // unified node を nodes 配列から除去
      for (let i = nodes.length - 1; i >= 0; i--) {
        if (unifiedFromIds.has(nodes[i]["@id"])) nodes.splice(i, 1);
      }
      // wasInformedBy は (b) の merged Entity を介してすでに表現済み。追加 edge は不要。
      continue;
    }

    // (c) merge 不成立。informed_by → used を張るための proxy を決める
    let proxyId: string;
    if (prevOutputs.length > 0) {
      // explicit output があれば、その先頭を proxy として使う（synthetic を作らない）
      proxyId = prevOutputs[0]["@id"];
    } else {
      // 旧形式の result_* ノード（後方互換）も拾う
      const legacyResult = nodes.find(
        (n) => n["@id"].startsWith("result_") && blockToActivityId.get(n.blockId) === prevActId,
      );
      if (legacyResult) {
        proxyId = legacyResult["@id"];
      } else {
        // 何も無いので synthetic placeholder を作る（graph connectivity の最終 fallback）
        const syntheticId = `result_synthetic_${link.targetBlockId}`;
        if (!nodes.find((n) => n["@id"] === syntheticId)) {
          const prevActLabel = nodes.find((n) => n["@id"] === prevActId)?.label ?? t("prov.prevStepFallback");
          nodes.push({
            "@id": syntheticId,
            "@type": "prov:Entity",
            label: t("prov.resultOf", { label: prevActLabel }),
            blockId: link.targetBlockId,
          });
          relations.push({
            "@type": "prov:wasGeneratedBy",
            from: syntheticId,
            to: prevActId,
          });
        }
        proxyId = syntheticId;
      }
    }

    relations.push({ "@type": "prov:used", from: currentActId, to: proxyId, linkId: link.id });
  }

  if (import.meta.env.DEV) {
    console.log("生成ノード:", nodes.map((n) => `${n["@type"]} "${n.label}" (${n["@id"]})`));
    console.log("生成リレーション:", relations.map((r) => `${r["@type"]} ${r.from} → ${r.to}`));
    console.log("警告:", warnings);
    console.groupEnd();
  }

  // ── 中間表現 → PROV-JSON-LD 埋め込み形式に変換 ──
  return buildProvJsonLd(nodes, relations, warnings, input.documentProvenance);
}

// ── 中間表現 → PROV-JSON-LD 変換 ──

function buildProvJsonLd(
  nodes: InternalNode[],
  relations: InternalRelation[],
  warnings: ProvWarning[],
  documentProvenance?: import("../document-provenance/types").DocumentProvenance,
): ProvJsonLd {
  // ノード ID → ProvJsonLdNode マップを構築
  const nodeMap = new Map<string, ProvJsonLdNode>();

  for (const n of nodes) {
    const jsonLdNode: ProvJsonLdNode = {
      "@id": n["@id"],
      "@type": n["@type"],
      "rdfs:label": n.label,
      "graphium:blockId": n.blockId,
    };
    // Phase D-2: graphium:phase ("plan" | "execution") を追跡用に転写
    const internalPhase = (n as any)["graphium:phase"];
    if (typeof internalPhase === "string") {
      jsonLdNode["graphium:phase"] = internalPhase;
    }
    // Entity サブタイプ（material / tool）
    if (n.entitySubtype) {
      jsonLdNode["graphium:entityType"] = n.entitySubtype;
    }
    // メディア Entity のプロパティ
    if (n.mediaType) {
      jsonLdNode["graphium:mediaType"] = n.mediaType;
    }
    if (n.mediaUrl) {
      jsonLdNode["graphium:mediaUrl"] = n.mediaUrl;
    }
    // 構造化属性（テーブルから展開された params）
    if (n.params) {
      for (const [k, v] of Object.entries(n.params)) {
        jsonLdNode[`graphium:${k}` as `graphium:${string}`] = v;
      }
    }
    // 埋め込み属性（[属性] ラベルの段落テキスト、メディア子ブロック）
    if (n.attributes && n.attributes.length > 0) {
      jsonLdNode["graphium:attributes"] = n.attributes.map((a) => {
        const attr: ProvAttribute = {
          "rdfs:label": a.label,
          "graphium:blockId": a.blockId,
        };
        if (a.mediaUrl) {
          attr["graphium:mediaUrl"] = a.mediaUrl;
        }
        if (a.mediaType) {
          attr["graphium:mediaType"] = a.mediaType;
        }
        return attr;
      });
    }
    nodeMap.set(n["@id"], jsonLdNode);
  }

  // 関係をノードに埋め込む
  for (const rel of relations) {
    const sourceNode = nodeMap.get(rel.from);
    if (!sourceNode) continue;

    switch (rel["@type"]) {
      case "prov:used": {
        if (!sourceNode["prov:used"]) {
          sourceNode["prov:used"] = [];
        }
        sourceNode["prov:used"]!.push({ "@id": rel.to });
        break;
      }
      case "prov:wasGeneratedBy": {
        // wasGeneratedBy: Entity → Activity（from=Entity, to=Activity）
        // 配列に push（同一 Entity が複数 Activity に生成され得る。単一値で上書きすると
        // 生成エッジが欠落し、wasInformedBy の構造導出にも波及する）。重複は抑制。
        if (!sourceNode["prov:wasGeneratedBy"]) {
          sourceNode["prov:wasGeneratedBy"] = [];
        }
        if (!sourceNode["prov:wasGeneratedBy"]!.some((g) => g["@id"] === rel.to)) {
          sourceNode["prov:wasGeneratedBy"]!.push({ "@id": rel.to });
        }
        break;
      }
      case "prov:wasDerivedFrom": {
        // Phase D-2: execution Entity (from) は plan Entity (to) から派生
        // PROV-DM の wasDerivedFrom 短縮形。Activity (Step) は両 Entity の
        // used 関係から復元可能なので、ここでは Entity 間の関係のみ記録する。
        if (!sourceNode["prov:wasDerivedFrom"]) {
          sourceNode["prov:wasDerivedFrom"] = [];
        }
        sourceNode["prov:wasDerivedFrom"]!.push({ "@id": rel.to });
        break;
      }
      // graphium:hasAttribute は廃止 — 属性は graphium:attributes に直接埋め込み
    }
  }

  // DocumentProvenance Bundle（オプション）
  const docProvBundle = documentProvenance
    ? buildDocumentProvenanceBundle(documentProvenance)
    : undefined;

  return {
    "@context": {
      prov: "http://www.w3.org/ns/prov#",
      graphium: "https://graphium.app/ns#",
      rdfs: "http://www.w3.org/2000/01/rdf-schema#",
      xsd: "http://www.w3.org/2001/XMLSchema#",
    },
    "@graph": [...nodeMap.values()],
    "graphium:warnings": warnings.length > 0 ? warnings : undefined,
    "graphium:documentProvenance": docProvBundle,
  };
}

// ── ヘルパー関数 ──

/** コアラベル → PROVロール */
function coreToProvRole(label: CoreLabel, block: any): string | null {
  switch (label) {
    case "procedure": {
      if (block.type === "heading") {
        const role = getHeadingLabelRole(block.props?.level ?? 2, label);
        return role === "activity" ? "prov:Activity" : null;
      }
      return "prov:Activity";
    }
    case "material": return "prov:Entity";
    case "tool": return "prov:Entity";
    case "attribute": return null; // 親ノードのプロパティとして埋め込む
    case "output": return "prov:Entity";
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

/** テーブルセルからテキストを抽出 */
function extractCellText(cell: any): string {
  // BlockNote エディタ出力形式: { type: "tableCell", content: [...] }
  if (cell && !Array.isArray(cell) && cell.type === "tableCell") {
    return extractInlineText(cell.content ?? []);
  }
  // テスト用・旧形式: [{ type: "text", text: "..." }]
  if (Array.isArray(cell)) {
    return extractInlineText(cell);
  }
  return "";
}

/** InlineContent 配列からテキストを結合（リンク・画像の URL も抽出） */
function extractInlineText(inlines: any[]): string {
  if (!Array.isArray(inlines)) return "";
  return inlines
    .map((inline: any) => {
      if (typeof inline === "string") return inline;
      if (inline.type === "text") return inline.text ?? "";
      // リンク: テキストがあればテキスト、なければ href
      if (inline.type === "link") {
        const linkText = extractInlineText(inline.content ?? []);
        return linkText || (inline.href ?? "");
      }
      // 画像インライン: URL を返す
      if (inline.type === "image" && inline.props?.url) {
        return inline.props.url;
      }
      return "";
    })
    .join("")
    .trim();
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

/**
 * [属性] ブロックの親ラベル付きブロックの PROV ノード ID を探す。
 */
function findParentLabeledNodeId(
  blockId: string,
  blocks: any[],
  labels: Map<string, string>,
  labeledBlocks: { block: any; coreLabel: string | null }[]
): string | null {
  const parentId = findParentBlockId(blocks, blockId);
  if (!parentId) return null;

  // step コンテナは工程の境界なので、そこで探索を打ち切る（procedure と同じ扱い）。
  // 素通りさせると step 直下の [属性] が step の外側にある material Entity に
  // 紐づいてしまう。
  const parentBlock = blocks
    .map((b: any) => findBlockById(b, parentId))
    .find((b: any) => b);
  if (parentBlock?.type === "step") return null;

  const parentLabel = labels.get(parentId);
  if (!parentLabel) {
    return findParentLabeledNodeId(parentId, blocks, labels, labeledBlocks);
  }

  const normalized = normalizeLabel(parentLabel);

  switch (normalized) {
    case "material":
    case "tool":
      return `entity_${parentId}`;
    case "output":
      return `result_${parentId}`;
    case "procedure":
      return null;
    default:
      return null;
  }
}

/** ブロックツリー内で指定ブロックの親ブロック ID を探す */
function findParentBlockId(blocks: any[], targetId: string): string | null {
  for (const block of blocks) {
    if (block.children && Array.isArray(block.children)) {
      for (const child of block.children) {
        if (child.id === targetId) return block.id;
        const found = findParentBlockId([child], targetId);
        if (found) return found;
      }
    }
  }
  return null;
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

// ── ProvJsonLd からフラットな関係リストを抽出（ビュー層・テスト用） ──

export type FlatRelation = {
  "@type": string;
  from: string;
  to: string;
};

/** ProvJsonLd の埋め込み関係をフラットなリストに展開する */
export function extractRelations(doc: ProvJsonLd): FlatRelation[] {
  const relations: FlatRelation[] = [];

  for (const node of doc["@graph"]) {
    if (node["prov:used"]) {
      for (const ref of node["prov:used"]) {
        relations.push({ "@type": "prov:used", from: node["@id"], to: ref["@id"] });
      }
    }
    if (node["prov:wasGeneratedBy"]) {
      for (const ref of node["prov:wasGeneratedBy"]) {
        relations.push({
          "@type": "prov:wasGeneratedBy",
          from: node["@id"],
          to: ref["@id"],
        });
      }
    }
    // graphium:attributes はプロパティ埋め込み — extractRelations には含めない
    // ビュー層が graphium:attributes を直接読んでダイヤモンドノードを生成する
  }

  return relations;
}
