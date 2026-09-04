// ページを「テンプレート」として team-shared storage に書き出す（PR 3）。
//
// 設計判断（docs/internal/team-shared-storage-design.md §20）:
// - body は GraphiumDocument ではなく PageTemplate の JSON（休眠していた型を本文に使う）。
//   なぜ: テンプレートは記録ではなく雛形で、来歴・チャット・共有参照を引き継がせたくない。
//   ページのブロックとラベル・表のふるまいだけを持たせる。
// - 本文は「ページをそのまま」。結果や数値を自動で消さない（消してから共有すればよい）。
// - **再共有の対応付けは持たない**。テンプレートは共有するたびに新しい id になり、
//   元ノートの sharedRef も触らない。なぜ: 雛形は「あの日のノートの写し」ではなく
//   独立した配布物で、ノート側の共有状態（記録のコピー）と一対一に紐づけると
//   どちらを更新したのか分からなくなる。
// - メディアはノート共有と同じ auto-blob（`shared-blob:<hash>` 置換 + extra.blobs）。
// - 連動属性（StepAttributes）は page ではなくラベルストアにしか無いので、
//   呼び出し側（共有ダイアログ）がスナップショットを options.attributes で渡す。
//   これを渡さないと `/template` 挿入経路で手順のチェック・実行者・状態が復元されない。

import type { GraphiumDocument, GraphiumPage } from "../../lib/document-types";
import type { AuthorIdentity } from "../document-provenance/types";
import {
  LocalFolderSharedProvider,
  LocalFolderBlobProvider,
  newSharedId,
  computeSharedEntryHash,
  type SharedEntry,
  type BlobRef,
} from "../../lib/storage/shared";
import { createTemplate, serializeTemplate } from "../template/save";
import type { PageTemplate } from "../template/types";
import type { StepAttributes } from "../context-label/label-attributes";
import {
  autoUploadMediaBlobs,
  collectMediaRefs,
  type FetchMediaBytes,
} from "./auto-blob";
import { getActiveProvider } from "../../lib/storage/registry";
import { invoke } from "@tauri-apps/api/core";

export type ShareTemplateOptions = {
  /** Settings の shared root（テンプレートを置く先） */
  sharedRoot: string;
  /**
   * Settings の blob root。ページに埋め込まれたメディアを共有するために使う。
   * メディアを含むページでは必須（未設定ならエラーを返す）。
   */
  blobRoot?: string | null;
  /** Settings 登録済みの AuthorIdentity（必須） */
  author: AuthorIdentity;
  /** ユーザーが入力したテンプレート名（一覧の表示名） */
  title: string;
  /** ユーザーが入力した説明（任意） */
  description?: string;
  /**
   * 連動属性（blockId → StepAttributes）。呼び出し側がラベルストアの
   * スナップショットから渡す。
   * なぜ options 経由か: StepAttributes は GraphiumPage に保存されず
   * ラベルストアの実行時状態にしかないため、doc / page からは復元できない。
   * 未指定なら空のまま共有する（テストや page 由来の呼び出しでも壊れない）。
   */
  attributes?: [string, StepAttributes][];
  /**
   * テスト用フック（本番では未指定）。share-note.ts と同じ差し込み口。
   */
  __test?: {
    extractFileId?: (url: string) => string | null;
    fetchBytes?: FetchMediaBytes;
  };
};

export type ShareTemplateResult =
  | {
      ok: true;
      /** 書き込んだ SharedEntry（hash 計算済み） */
      entry: SharedEntry;
      /** body に書いた PageTemplate（呼び出し側のプレビュー用） */
      template: PageTemplate;
    }
  | { ok: false; error: string };

const defaultFetchBytes: FetchMediaBytes = async (fileId: string) => {
  const b64 = await invoke<string>("read_media_file", { fileId });
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
};

/** step ブロックの数を再帰的に数える（一覧の「手順数」表示用） */
function countSteps(blocks: any[] | undefined): number {
  let n = 0;
  for (const b of blocks ?? []) {
    if (b?.type === "step") n++;
    if (Array.isArray(b?.children)) n += countSteps(b.children);
  }
  return n;
}

/**
 * ページをテンプレートとして共有する。
 *
 * doc は auto-blob の入口（collectMediaRefs / autoUploadMediaBlobs）が
 * GraphiumDocument を受け取るために渡す。書き出すのは page 1 枚分だけで、
 * doc の他のページ・チャット・来歴は body に入らない。
 */
export async function shareTemplate(
  doc: GraphiumDocument,
  page: GraphiumPage,
  options: ShareTemplateOptions,
): Promise<ShareTemplateResult> {
  try {
    // ── メディアの自動 blob 化（ノート共有と同じ経路）──
    // 対象ページだけを持つ擬似 doc を作って auto-blob に通す。
    // なぜ: auto-blob は doc 単位の API なので、ページ単位の共有では
    //       「共有するページだけ」を包んで渡すのが最小の合わせ方。
    const pseudoDoc: GraphiumDocument = { ...doc, pages: [page] };
    const extractFileId =
      options.__test?.extractFileId ??
      ((url: string) => getActiveProvider().extractFileId(url));
    const refs = collectMediaRefs(pseudoDoc, extractFileId);
    if (refs.length > 0 && !options.blobRoot) {
      return {
        ok: false,
        error:
          "Blob root is not configured. Set it in Settings → Shared storage to share pages that contain media.",
      };
    }

    let blocks = page.blocks;
    let blobs: BlobRef[] = [];
    if (refs.length > 0 && options.blobRoot) {
      const blobProvider = new LocalFolderBlobProvider(options.blobRoot);
      const fetchBytes = options.__test?.fetchBytes ?? defaultFetchBytes;
      const result = await autoUploadMediaBlobs(pseudoDoc, {
        extractFileId,
        fetchBytes,
        blobProvider,
      });
      blocks = result.doc.pages[0].blocks;
      blobs = result.blobs;
    }

    const title = options.title.trim() || doc.title || "Untitled";
    const labels = Object.entries(page.labels ?? {});
    // 連動属性はラベルが付いたブロックにしか意味がない（復元側の setAttributes は
    // ラベル未設定のブロックでは何もしない）。他ページや削除済みブロックの属性が
    // ラベルストアに残っていても本文には混ぜない
    const labeledIds = new Set(labels.map(([blockId]) => blockId));
    const attributes = (options.attributes ?? []).filter(([blockId]) =>
      labeledIds.has(blockId),
    );
    const template = createTemplate({
      name: title,
      pageTitle: page.title || doc.title,
      blocks,
      labels,
      attributes,
      tableMeta: page.tableMeta,
      mediaInlineLabels: page.mediaInlineLabels,
    });

    const body = new TextEncoder().encode(serializeTemplate(template));

    // テンプレートは毎回新しい id（再共有の対応付けを持たない）
    const id = newSharedId();
    const now = new Date().toISOString();
    const baseEntry: SharedEntry = {
      id,
      type: "template",
      author: options.author,
      created_at: now,
      updated_at: now,
      hash: "", // provider.write が再計算する
      prov: { derived_from: [] },
      extra: {
        title,
        description: options.description?.trim() || null,
        // 一覧は本文を読まずに描くので、規模が分かる数だけメタデータ側に置く
        stepCount: countSteps(blocks),
        labelCount: template.labels.length,
        pageTitle: template.pageTitle,
        ...(blobs.length > 0 ? { blobs } : {}),
      },
    };

    const hash = await computeSharedEntryHash(baseEntry, body);
    const provider = new LocalFolderSharedProvider(options.sharedRoot, {
      email: options.author.email,
    });
    await provider.write(baseEntry, body);

    return { ok: true, entry: { ...baseEntry, hash }, template };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
