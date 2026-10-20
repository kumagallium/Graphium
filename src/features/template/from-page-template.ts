// PageTemplate（共有テンプレートの本文）を「挿入用」「新規ノート用」に変換する純関数。
//
// 共有テンプレートは 2 通りの使われ方をする:
//   1. /template ピッカーから **現在のページに挿入** → pageTemplateToBuildResult
//   2. 共有ライブラリから **テンプレートから新規ノート** → buildDocumentFromTemplate
//
// どちらもブロック id を振り直す。なぜ: テンプレートの id は共有した人のページの
// blockId で、そのまま挿すと同じ文書内・別ノート間で id が衝突し、ラベルや表の
// ふるまい（blockId をキーに持つ注釈層）が他のブロックに混線する。
//
// 副作用を持たないので、UI から切り離してテストできる（この経路はデータの取り違えが
// そのままユーザーのノート破損になるため、ここで単体テストを持つ意味が大きい）。

import type { CoreLabel } from "../context-label/labels";
import type {
  GraphiumDocument,
  MediaInlineLabel,
  TableMeta,
} from "../../lib/document-types";
import { LATEST_DOCUMENT_VERSION } from "../../lib/document-migration";
import { remapCalcTargetsInBlocks } from "../../blocks/calc/remap-targets";
import { readFirstColumnName } from "../table-meta/table-cells";
import { t as tStatic } from "../../i18n";
import { convertExtractedProcedureBlocksToSteps } from "../ai-assistant/label-markers";
import type { BlockLink } from "../../lib/block-link-types";
import type { TemplateBuildResult, TemplateDef } from "./templates";
import type { PageTemplate } from "./types";

/** 新規ノートに付ける起源情報（GraphiumDocument.templateFrom と同型） */
export type TemplateFromRef = NonNullable<GraphiumDocument["templateFrom"]>;

export type RemappedTemplateBlocks = {
  /** id を振り直したブロック（元の template.blocks は変更しない） */
  blocks: any[];
  /** 元 blockId → 新 blockId */
  idMap: Map<string, string>;
  /** 元 blockId → ルートからのインデックス配列（挿入後に引き当てるため） */
  pathMap: Map<string, number[]>;
};

/**
 * テンプレートのブロックを複製し、すべてのブロックへ新しい id を振る。
 * 同時に「元 id → 新 id」「元 id → path」の対応表を作る。
 */
export function remapTemplateBlocks(template: PageTemplate): RemappedTemplateBlocks {
  const blocks = structuredClone(template.blocks ?? []);
  const idMap = new Map<string, string>();
  const pathMap = new Map<string, number[]>();

  const walk = (list: any[], prefix: number[]): void => {
    list.forEach((b, i) => {
      if (!b || typeof b !== "object") return;
      const path = [...prefix, i];
      const oldId = typeof b.id === "string" ? b.id : null;
      const newId = crypto.randomUUID();
      b.id = newId;
      if (oldId) {
        idMap.set(oldId, newId);
        pathMap.set(oldId, path);
      }
      if (Array.isArray(b.children)) walk(b.children, path);
    });
  };
  walk(blocks, []);
  // 計算ブロックの書き戻し先（表の blockId）も新しい id に揃える。揃えないと
  // 計算が元の表を指したまま残り、差し込んだ表へ値が入らない
  remapCalcTargetsInBlocks(blocks, idMap);

  return { blocks, idMap, pathMap };
}

/**
 * 共有テンプレートを「現在のページへの挿入」に使える形へ変換する。
 *
 * - blocks: id を振り直した複製
 * - labels: blockId → path に変換（挿入後は path でブロックを引き当てる）
 * - attributes: 同上（ラベル連動属性。ページには保存されないので挿入後に適用する）
 * - columnTypes: tableMeta の「先頭列に付いたふるまい」だけ復元できる。
 *   なぜ先頭列だけか: 既存の適用経路（insert.ts の insertPageTemplate）が
 *   先頭列名をキーに付けるふるまいしか持たないため。2 列目以降は落ちる。
 * - provLinks: 付けない（テンプレートは手順間リンクを持たない）
 */
export function pageTemplateToBuildResult(template: PageTemplate): TemplateBuildResult {
  const { blocks, pathMap } = remapTemplateBlocks(template);

  const labels: { path: number[]; label: CoreLabel }[] = [];
  for (const [blockId, label] of template.labels ?? []) {
    const path = pathMap.get(blockId);
    // 本文に存在しない blockId のラベルは捨てる（壊れたテンプレートでも落ちない）
    if (path) labels.push({ path, label: label as CoreLabel });
  }

  const attributes: { path: number[]; attributes: any }[] = [];
  for (const [blockId, attrs] of template.attributes ?? []) {
    const path = pathMap.get(blockId);
    if (path) attributes.push({ path, attributes: attrs });
  }

  // tableMeta の列のふるまいを、挿入後に付け直せる形（path + type）へ落とす。
  // 先頭列名はブロック本体（ヘッダ行の先頭セル）から読む。
  const columnTypes: TemplateBuildResult["columnTypes"] = [];
  const blockByPath = (path: number[]): any | null => {
    let nodes: any[] = blocks;
    let node: any = null;
    for (const idx of path) {
      node = nodes?.[idx];
      if (!node) return null;
      nodes = node.children ?? [];
    }
    return node;
  };
  for (const [blockId, meta] of Object.entries(template.tableMeta ?? {})) {
    const path = pathMap.get(blockId);
    if (!path) continue;
    const block = blockByPath(path);
    const firstColumn = readFirstColumnName(block);
    if (!firstColumn) continue;
    for (const type of meta.columns?.[firstColumn] ?? []) {
      columnTypes.push({ path, type });
    }
  }

  return {
    blocks,
    labels,
    ...(attributes.length > 0 ? { attributes } : {}),
    ...(columnTypes.length > 0 ? { columnTypes } : {}),
  };
}

/**
 * 共有テンプレートから新規ノート用の GraphiumDocument を組み立てる。
 *
 * ラベル・表のふるまい・メディアラベルは、いずれもノートを開いたときに
 * 各ストアへ復元される「ページ上の注釈層」（page.labels / page.tableMeta /
 * page.mediaInlineLabels）なので、新 blockId に貼り替えてそこへ書き戻す。
 *
 * 連動属性（PageTemplate.attributes）は本文には入っているが、GraphiumPage に
 * 保存先が無いためこの経路では復元しない（ラベルストアは開いているページの
 * 実行時状態で、まだ開いていない新規ノートには書き込めない）。挿入経路の
 * pageTemplateToBuildResult だけが、挿入直後にストアへ適用する形で扱える。
 *
 * `shared-blob:` の解決（materializeSharedBlobs）は呼び出し側の責務。
 * 素材の書き込みは副作用なので、この純関数の外に置く。
 */
export function buildDocumentFromTemplate(
  template: PageTemplate,
  meta: { title: string; templateFrom: TemplateFromRef },
): GraphiumDocument {
  const { blocks, idMap } = remapTemplateBlocks(template);

  const labels: Record<string, string> = {};
  for (const [blockId, label] of template.labels ?? []) {
    const newId = idMap.get(blockId);
    if (newId) labels[newId] = label;
  }

  const tableMeta: Record<string, TableMeta> = {};
  for (const [blockId, entry] of Object.entries(template.tableMeta ?? {})) {
    const newId = idMap.get(blockId);
    if (!newId) continue;
    // noteLinks は共有した人のローカルノート id を指すので引き継がない
    // （こちらの環境では解決できず、行から他人のノートを開こうとして壊れる）。
    const { noteLinks: _dropped, ...rest } = entry;
    tableMeta[newId] = rest;
  }

  const mediaInlineLabels: Record<string, MediaInlineLabel> = {};
  for (const [blockId, entry] of Object.entries(template.mediaInlineLabels ?? {})) {
    const newId = idMap.get(blockId);
    if (newId) mediaInlineLabels[newId] = entry;
  }

  const now = new Date().toISOString();
  return {
    version: LATEST_DOCUMENT_VERSION,
    title: meta.title,
    pages: [
      {
        id: "main",
        title: meta.title,
        blocks,
        labels,
        provLinks: [],
        knowledgeLinks: [],
        ...(Object.keys(tableMeta).length > 0 ? { tableMeta } : {}),
        ...(Object.keys(mediaInlineLabels).length > 0 ? { mediaInlineLabels } : {}),
      },
    ],
    templateFrom: meta.templateFrom,
    createdAt: now,
    modifiedAt: now,
  };
}

/** path（ルートからのインデックス配列）でブロックを引く */
function blockAtPath(blocks: any[], path: number[]): any | null {
  let nodes: any[] = blocks;
  let node: any = null;
  for (const idx of path) {
    node = nodes?.[idx];
    if (!node) return null;
    nodes = node.children ?? [];
  }
  return node;
}

/** 全ブロックへ新しい id を振る（組み込みテンプレートは build のたびに id 無しで返る） */
function assignFreshIds(list: any[]): void {
  for (const b of list ?? []) {
    if (b && typeof b === "object") {
      b.id = crypto.randomUUID();
      if (Array.isArray(b.children)) assignFreshIds(b.children);
    }
  }
}

/**
 * 組み込みテンプレート（TemplateDef）から新規ノート用の GraphiumDocument を組み立てる。
 *
 * 差し込み（insert.ts の insertTemplateDef）と同じ手順でブロックを作る:
 * build → id を振る → 旧語彙（procedure/plan/result）を step ブロックへ変換。
 * 差し込みはその後エディタの注釈層（ストア）へ書くが、こちらは開く前のノートなので
 * page.labels / page.provLinks / page.tableMeta へ直接書く。id は build のたびに
 * 新しく振るので、同じテンプレートから何度作っても別ノートと id が衝突しない。
 */
export function buildDocumentFromTemplateDef(
  def: TemplateDef,
  meta: { title: string; templateFrom: TemplateFromRef },
  t: (key: string) => string = tStatic,
): GraphiumDocument {
  const { blocks: rawBlocks, labels: rawLabels, provLinks, columnTypes } = def.build(t);
  assignFreshIds(rawBlocks);
  const idAtPath = (path: number[]): string | null => blockAtPath(rawBlocks, path)?.id ?? null;

  // 変換は id を保つので、リンク・列のふるまいは変換前に id へ解決しておく
  const links: BlockLink[] = (provLinks ?? []).flatMap((l, i) => {
    const sourceId = idAtPath(l.sourcePath);
    const targetId = idAtPath(l.targetPath);
    return sourceId && targetId
      ? [
          {
            id: `link-${Date.now()}-${i}`,
            sourceBlockId: sourceId,
            targetBlockId: targetId,
            type: l.type,
            layer: "prov" as const,
            createdBy: "human" as const,
          },
        ]
      : [];
  });
  const tableMeta: Record<string, TableMeta> = {};
  for (const c of columnTypes ?? []) {
    const block = blockAtPath(rawBlocks, c.path);
    if (!block?.id) continue;
    const firstColumn = readFirstColumnName(block);
    if (!firstColumn) continue;
    const entry = (tableMeta[block.id] ??= {});
    const columns = (entry.columns ??= {});
    columns[firstColumn] = [...(columns[firstColumn] ?? []), c.type];
  }

  const { blocks, labels: convertedLabels } = convertExtractedProcedureBlocksToSteps(rawBlocks, rawLabels);
  const labels: Record<string, string> = {};
  for (const { path, label } of convertedLabels) {
    const id = blockAtPath(blocks, path)?.id;
    if (id) labels[id] = label;
  }

  const now = new Date().toISOString();
  return {
    version: LATEST_DOCUMENT_VERSION,
    title: meta.title,
    pages: [
      {
        id: "main",
        title: meta.title,
        blocks,
        labels,
        provLinks: links,
        knowledgeLinks: [],
        ...(Object.keys(tableMeta).length > 0 ? { tableMeta } : {}),
      },
    ],
    templateFrom: meta.templateFrom,
    createdAt: now,
    modifiedAt: now,
  };
}
