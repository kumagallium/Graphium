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
import { readFirstColumnName } from "../table-meta/table-cells";
import type { TemplateBuildResult } from "./templates";
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

  return { blocks, idMap, pathMap };
}

/**
 * 共有テンプレートを「現在のページへの挿入」に使える形へ変換する。
 *
 * - blocks: id を振り直した複製
 * - labels: blockId → path に変換（挿入後は path でブロックを引き当てる）
 * - attributes: 同上（ラベル連動属性。ページには保存されないので挿入後に適用する）
 * - columnTypes: tableMeta の「先頭列に付いたふるまい」だけ復元できる。
 *   なぜ先頭列だけか: 既存の適用経路（note-app の addFirstColumnType）が
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
