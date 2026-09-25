// テンプレートをエディタへ挿入する処理（メインエディタと SidePeek の共通の出どころ）
//
// 挿入はブロックを入れるだけでは終わらない。ラベル・前手順リンク・表の列のふるまい
// （計画テンプレートの表を note-link = インデックステーブルにする等）はノートの注釈層
// （labelStore / linkStore / tableMetaStore）にあり、「挿入したエディタで開いている
// ノート」のストアへ書く必要がある。以前は note-app がメインのエディタとストアに固定で
// 書いていたため、SidePeek では使えなかった（ピークで挿すと注釈がメイン側のノートに付く）。
// ここでは挿入先のエディタと書き込み先のストアを引数で受け取り、どちらも同じ手順で挿す。

import { t as tStatic } from "../../i18n";
import type { ColumnType, GraphiumDocument } from "../../lib/document-types";
import { LATEST_DOCUMENT_VERSION } from "../../lib/document-migration";
import {
  getBlobRoot,
  LocalFolderBlobProvider,
  type BlobRef,
  type SharedEntry,
} from "../../lib/storage/shared";
import { convertExtractedProcedureBlocksToSteps } from "../ai-assistant/label-markers";
import type { StepAttributes } from "../context-label/label-attributes";
// 共有ライブラリはバレル（features/sharing）を経由しない。バレルは ShareTemplateDialog →
// share-template → features/template を読むので循環参照になる（TemplatePickerModal と同じ）
import { readSharedEntryBody } from "../sharing/shared-library-store";
import { materializeSharedBlobs } from "../sharing/materialize-blobs";
import { readFirstColumnName } from "../table-meta/table-cells";
import { pageTemplateToBuildResult } from "./from-page-template";
import { deserializeTemplate } from "./save";
import type { TemplateDef } from "./templates";
import type { PageTemplate } from "./types";

/**
 * 挿入先のエディタで開いているノートの注釈層への書き込み口。
 * メインならメインのストア、SidePeek ならピーク自身のストアを渡す
 * （取り違えると、ピークで挿したテンプレートの注釈がメイン側のノートに付く）。
 */
export type TemplateTargetStores = {
  setLabel: (blockId: string, label: string) => void;
  setAttributes: (blockId: string, attrs: Partial<StepAttributes>) => void;
  addLink: (params: {
    sourceBlockId: string;
    targetBlockId: string;
    type: "informed_by";
    createdBy: "human";
  }) => unknown;
  addColumnType: (blockId: string, columnName: string, type: ColumnType) => void;
};

/** 挿す中身。公式テンプレートも共有テンプレートもこの形にそろえてから挿す */
type TemplateInsertion = {
  blocks: any[];
  /** 挿入後のブロックを path で引いて付けるラベル */
  labels: { path: number[]; label: string }[];
  /** 同じく path で引いて付ける連動属性（共有テンプレートだけが持つ） */
  attributes: { path: number[]; attributes: Partial<StepAttributes> }[];
  /** 挿入前に id へ解決した前手順リンク（id は挿入を跨いで保たれる） */
  links: { sourceId: string; targetId: string; type: "informed_by" }[];
  /** 挿入前に id へ解決した「表の先頭列に付けるふるまい」 */
  columnTypes: { blockId: string; type: ColumnType }[];
  /** 挿入後にカーソルを置くブロック。null なら挿入した先頭 */
  focusId: string | null;
};

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

/** 挿入前の全ブロックに id を振る（変換・挿入を跨いで同じブロックを引くため） */
function assignIds(list: any[]): void {
  for (const b of list ?? []) {
    if (b && typeof b === "object") {
      if (!b.id) b.id = crypto.randomUUID();
      if (Array.isArray(b.children)) assignIds(b.children);
    }
  }
}

/** スラッシュを打っただけの空ブロック（"/" もしくは空）か */
function isSlashOnlyBlock(block: any): boolean {
  const content = block?.content;
  return (
    Array.isArray(content) &&
    content.length <= 1 &&
    (!content[0] ||
      (content[0].type === "text" && content[0].text.replace("/", "").trim() === ""))
  );
}

/** 中身を triggerBlock の後ろに挿し、エディタの状態反映後（次フレーム）に注釈を付ける */
function applyInsertion(
  editor: any,
  triggerBlock: any,
  insertion: TemplateInsertion,
  stores: TemplateTargetStores,
): void {
  if (insertion.blocks.length === 0) return;

  const inserted: any[] = editor.insertBlocks(insertion.blocks, triggerBlock, "after");

  // スラッシュを打ったブロックが空なら削除
  if (isSlashOnlyBlock(triggerBlock)) editor.removeBlocks([triggerBlock]);

  const { labels, attributes, links, columnTypes } = insertion;
  if (labels.length > 0 || attributes.length > 0 || links.length > 0 || columnTypes.length > 0) {
    setTimeout(() => {
      for (const { path, label } of labels) {
        const block = blockAtPath(inserted, path);
        if (block?.id) stores.setLabel(block.id, label);
      }
      // 連動属性はラベルを付けた直後にだけ入る（setAttributes は既定値が無いブロックでは
      // 何もしない）。ラベルが復元できなかったブロックの属性は落ちるが、
      // 属性だけ復活しても意味が無いのでそれで正しい
      for (const { path, attributes: attrs } of attributes) {
        const block = blockAtPath(inserted, path);
        if (block?.id) stores.setAttributes(block.id, attrs);
      }
      for (const { sourceId, targetId, type } of links) {
        stores.addLink({ sourceBlockId: sourceId, targetBlockId: targetId, type, createdBy: "human" });
      }
      // 列のふるまいは先頭列の名前をキーに記録する（スラッシュメニューの
      // インデックス/時系列テーブル挿入と同じ記録の仕方）。名前は挿入した表から読む
      for (const { blockId, type } of columnTypes) {
        stores.addColumnType(blockId, readFirstColumnName(editor.getBlock?.(blockId)), type);
      }
    }, 0);
  }

  // カーソルを置く（id は挿入を跨いで保たれる）
  const focusId = insertion.focusId ?? inserted[0]?.id;
  if (focusId) {
    try {
      editor.setTextCursorPosition(focusId, "end");
    } catch {
      /* no-op */
    }
  }
}

/**
 * 公式テンプレート（getAllTemplates() の TemplateDef）を triggerBlock の後ろに挿す。
 *
 * テンプレートは旧語彙（procedure/plan/result ラベル付き見出し）で定義されている。
 * 挿入前に step ブロックへ変換する（工程は step が正。ラベルのまま挿すと
 * v6 済みドキュメントに旧形式が永久残留する）。変換は block id ベースなので一時 id を
 * 振り、前手順リンク・列のふるまい・カーソル位置は変換前に id へ解決しておく
 * （変換は id を保つため、挿入後も id で引ける。テンプレの step1→step2 informed_by は、
 * 見出し id を引き継いだ step 間に張られる）。
 */
export function insertTemplateDef(
  editor: any,
  triggerBlock: any,
  template: TemplateDef,
  stores: TemplateTargetStores,
  t: (key: string) => string = tStatic,
): void {
  const { blocks: rawBlocks, labels: rawLabels, provLinks, columnTypes } = template.build(t);
  assignIds(rawBlocks);
  const idAtPath = (path: number[]): string | null => blockAtPath(rawBlocks, path)?.id ?? null;

  const links = (provLinks ?? []).flatMap((l) => {
    const sourceId = idAtPath(l.sourcePath);
    const targetId = idAtPath(l.targetPath);
    return sourceId && targetId ? [{ sourceId, targetId, type: l.type }] : [];
  });
  const columnTypeIds = (columnTypes ?? []).flatMap((c) => {
    const blockId = idAtPath(c.path);
    return blockId ? [{ blockId, type: c.type }] : [];
  });
  const focusId = idAtPath(template.focusPath);

  // procedure/plan/result は変換で消費され、残るラベルは変換後の位置の path で返る
  const { blocks, labels } = convertExtractedProcedureBlocksToSteps(rawBlocks, rawLabels);

  applyInsertion(
    editor,
    triggerBlock,
    { blocks, labels, attributes: [], links, columnTypes: columnTypeIds, focusId },
    stores,
  );
}

/**
 * 共有テンプレート（共有ライブラリの type=template の本文 = PageTemplate）を
 * triggerBlock の後ろに挿す。ブロック id を振り直し（pageTemplateToBuildResult）、
 * ラベル・連動属性・列のふるまいを挿入後に付け直す。前手順リンクは持たない。
 * カーソルは挿入した先頭に置く（共有テンプレートは focusPath を持たない）。
 */
export function insertPageTemplate(
  editor: any,
  triggerBlock: any,
  template: PageTemplate,
  stores: TemplateTargetStores,
): void {
  const { blocks, labels, attributes, columnTypes } = pageTemplateToBuildResult(template);
  const columnTypeIds = (columnTypes ?? []).flatMap((c) => {
    const blockId: string | undefined = blockAtPath(blocks, c.path)?.id;
    return blockId ? [{ blockId, type: c.type }] : [];
  });

  applyInsertion(
    editor,
    triggerBlock,
    {
      blocks,
      labels,
      attributes: attributes ?? [],
      links: [],
      columnTypes: columnTypeIds,
      focusId: null,
    },
    stores,
  );
}

/**
 * 共有ライブラリのテンプレート（type=template）の本文を読み出す。
 * 公式テンプレートとの違いは「本文が共有ルートにある」ことだけなので、
 * 読み出し → hash 照合 → shared-blob: の解決 まで済ませて PageTemplate を返す。
 * 読めない・利用者が取りやめたときは null（読めない理由はここで知らせる）。
 *
 * uploadFile: 共有テンプレート内の画像・ファイルを自分の素材へ取り込む経路。
 * 未指定なら取り込まない（shared-blob: のまま返る）。
 */
export async function loadSharedTemplate(
  entry: SharedEntry,
  uploadFile?: (file: File) => Promise<string>,
): Promise<PageTemplate | null> {
  let template: PageTemplate;
  try {
    const { body, verified } = await readSharedEntryBody(entry);
    if (!verified) {
      // hash 不一致 = 共有元が壊れている / 想定外に書き換わっている。
      // 本文自体は読めるので、挿すかどうかは利用者に決めさせる
      if (!window.confirm(tStatic("template.picker.hashMismatchConfirm"))) return null;
    }
    // バイト列を生文字列として扱うと日本語が壊れる。必ず TextDecoder で読む
    template = deserializeTemplate(new TextDecoder().decode(body));
  } catch (e) {
    window.alert(tStatic("template.picker.loadFailed", { error: e instanceof Error ? e.message : String(e) }));
    return null;
  }

  // shared-blob: を自分のローカル素材へ置き換える（fork・テンプレートから新規ノートと
  // 同じ materializeSharedBlobs）。doc 単位の関数なので 1 ページの擬似 doc に包む。
  // ここでブロック id は変えない — 挿入時の pageTemplateToBuildResult が
  // labels / attributes / tableMeta を「元の blockId」で引くため、
  // 先に id が変わると注釈がまとめて落ちる
  const extraBlobs = (entry.extra as { blobs?: BlobRef[] } | undefined)?.blobs;
  const blobRoot = getBlobRoot();
  if (Array.isArray(extraBlobs) && extraBlobs.length > 0 && blobRoot && uploadFile) {
    const blobProvider = new LocalFolderBlobProvider(blobRoot);
    const now = new Date().toISOString();
    const pseudoDoc: GraphiumDocument = {
      version: LATEST_DOCUMENT_VERSION,
      title: template.name,
      pages: [
        {
          id: "main",
          title: template.pageTitle,
          blocks: template.blocks,
          labels: {},
          provLinks: [],
          knowledgeLinks: [],
        },
      ],
      createdAt: now,
      modifiedAt: now,
    };
    const materialized = await materializeSharedBlobs(pseudoDoc, {
      blobs: extraBlobs,
      fetchBytes: (ref) => blobProvider.get(ref),
      uploadMedia: async (file) => ({ url: await uploadFile(file) }),
    });
    template = { ...template, blocks: materialized.doc.pages[0]?.blocks ?? template.blocks };
    if (materialized.missing.length > 0) {
      window.alert(tStatic("template.picker.mediaMissing", { count: String(materialized.missing.length) }));
    }
  }

  return template;
}
