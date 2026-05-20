// .graphium-index.json の型定義と Drive 読み書き
// 全ノートのメタデータを1ファイルに集約し、一覧・検索・被参照計算を高速化する

import type {
  AtomType,
  BackingEntry,
  ClaimRole,
  EpistemicStatus,
  GraphiumDocument,
  GraphiumFile,
  HypothesisStatus,
  ModalQualifier,
  SynthesisMode,
  WikiKind,
} from "../../lib/document-types";
import { getActiveProvider } from "../../lib/storage/registry";
import { normalizeLabel } from "../context-label/labels";

// ── 型定義 ──

// インデックスのスキーマバージョン
// extractBlockText の改善等、インデックス構築ロジックが変わった場合にインクリメントする
// v4: source, wikiKind フィールドを追加（Wiki ドキュメント対応）
// v5: author, model フィールドを追加（誰が / どのモデルが書いたかを一覧で表示）
// v6: ラベルを内部キー（procedure/material/tool/attribute/result）に正規化
// v8: inlineLabelTypes フィールド追加（Phase D-3-α 初版）
//     インラインハイライト + メディアインラインラベルを集計し、左ナビ ラベルフィルタで
//     material/tool/attribute/output を絞り込めるようにする
// v9: inlineLabels フィールド追加（Phase D-3-α）
//     ハイライトされたテキスト本体（"NaCl" 等）と blockId / entityId を保持し、
//     LabelGalleryView で「インプット → たまねぎ 12件 …」のような referent 単位の
//     集計を可能にする。inlineLabelTypes は派生情報なので廃止し、
//     必要時に inlineLabels から導出する。
// v10: deletedAt / trashedAt フィールド追加（ゴミ箱機能）
//      ノートを「ゴミ箱に送る」と deletedAt が ISO 文字列で入る。
//      ファイル本体は削除せず、メイン一覧・検索・picker・グラフからは除外し、
//      ゴミ箱ビューでのみ表示・復元・完全削除できる。
// v11: WikiKind に "atom" を追加（実験的レイヤ）
//      Concept をさらに抽象化した "1 アイデア" 単位の Wiki。
//      experimental.atomLayer 設定で生成可否を制御する。
//      既存インデックスは自動再構築される。
// v12: archivedAt フィールド追加（アーカイブ機能）
//      Concept merge で吸収された Wiki 等を「参照保護目的の退避」として archive する。
//      ノート一覧・検索・最近からは除外し、引用・regenerate・グラフは透過解決する。
//      ユーザーの削除意思 (deletedAt) と区別するため別フィールド。
//      アーカイブからは「復元」のみ。完全削除はゴミ箱経由のみ。
// v13: claimRole / atomType / synthesisMode / hypothesisStatus フィールド追加
//      （提案 v4 Phase 1 の意味的な型）
//      AI Wiki ノートに対する直交した型情報を一覧 UI でフィルタするため
//      wikiMeta から mirror する。すべて optional。
// v14: WikiKind "concept" → "claim" リネーム（提案 v4 で命名を見直したため）。
//      旧 kind / 旧フィールド名 (derivedFromConcepts / conceptRole) は
//      document-migration.ts の migrateConceptKindToClaim で読み込み時に
//      自動移行されるが、index 側のキャッシュは bump で再構築する。
// v15: epistemicStatus フィールド（Phase η, 提案 v4 Phase 5）。
//      wikiMeta.epistemicStatus を mirror して一覧 UI のフィルタに使う。
//      既存エントリは undefined のままで動く（読み込み側で interpretation 扱い）が、
//      bump によりインデックスを再構築させ、Ingester / Atomizer 由来の epistemic が
//      mirror に反映されるようにする。
// v16: Toulmin extension（Phase γ）。
//      rebuttalConditions（Claim/Atom）/ backing（Claim のみ）/ modalQualifier（Claim のみ）
//      の 3 フィールドを wikiMeta から mirror する。バッジ表示・フィルタ・将来の
//      dialectic 候補抽出（rebuttal 持ち Atom が 2+）で参照する。
//      既存 Phase γ 以前のエントリは undefined / 空配列で動く（後方互換）。
const INDEX_SCHEMA_VERSION = 16;

export type GraphiumIndex = {
  version: number;
  updatedAt: string;
  notes: NoteIndexEntry[];
};

export type NoteIndexEntry = {
  noteId: string;
  title: string;
  modifiedAt: string;
  createdAt: string;
  headings: {
    blockId: string;
    text: string;
    level: 2 | 3;
  }[];
  labels: {
    blockId: string;
    label: string;
    preview: string;
  }[];
  outgoingLinks: {
    targetNoteId: string;
    targetBlockId?: string;
    layer: "prov" | "knowledge";
  }[];
  /** ドキュメントソース: "human" or "ai"（Wiki）or "skill" */
  source?: "human" | "ai" | "skill";
  /** Wiki ドキュメントの種類（source === "ai" の場合のみ） */
  wikiKind?: WikiKind;
  /** 作者 (username)。Claude Code Skill 等で書かれたノートは指示者の OS ユーザー名が入る */
  author?: string;
  /** 書記役の LLM モデル ID (例: claude-opus-4-7)。人間が直接書いたノートでは未設定 */
  model?: string;
  /**
   * source === "ai" の wiki エントリのみ設定される。
   * このエントリが派生元として参照する通常ノートの ID 配列（wikiMeta.derivedFromNotes）。
   * 通常ノート → 派生 wiki エントリの逆引き lookup を実装するために保存する。
   */
  derivedFromNotes?: string[];
  /**
   * インラインラベル（Phase D-3-α）。
   * ノート本文の inline style ハイライト（material / tool / attribute / output）と
   * メディアブロックのサイドストア (`page.mediaInlineLabels`) を集約したエントリ群。
   *
   * - blockId: ハイライトが属するブロック ID（メディアブロックの場合はそのメディアの ID）
   * - label: コアラベル種別
   * - text: ハイライトされたテキスト（メディアの場合は `block.props.name` など）。
   *   referent 単位 (entityId) で同一ブロック内の text を結合する
   * - entityId: PROV Entity の同一性キー（同じ referent の重複ハイライトをまとめるため）
   *
   * LabelGalleryView では `text` をキーにグルーピングして「インプット → NaCl 5件」
   * のような referent ベースの一覧表示を行う。
   */
  inlineLabels?: {
    blockId: string;
    label: "material" | "tool" | "attribute" | "output";
    text: string;
    entityId: string;
  }[];
  /**
   * ゴミ箱に入れた日時（ISO 文字列）。
   * セットされていればこのノートはゴミ箱内とみなし、メイン一覧・検索・picker・グラフから除外する。
   * 復元すると undefined に戻る。完全削除でエントリ自体が除去される。
   */
  deletedAt?: string;
  /**
   * アーカイブした日時（ISO 文字列）。
   * セットされていればこのノートはアーカイブ済みとみなし、ノート一覧・検索・最近から除外する。
   * ただし引用・regenerate・グラフ探索など参照解決系では透過的に取得できる
   * （loadDoc が archived/ プレフィックスにフォールバックする）。
   *
   * deletedAt とは別フィールド: deletedAt はユーザーの削除意思、archivedAt はシステム都合の退避
   * （主に Concept merge 吸収時の参照保護）。アーカイブからは「復元」のみで、
   * 完全削除はゴミ箱に戻してから行う。
   */
  archivedAt?: string;
  /**
   * Concept の研究プロセス役割（提案 v4 Phase 1.1）。
   * wikiMeta.claimRole を mirror する。複数値可。
   * 一覧 UI でロール単位のフィルタや色分け表示に使う。
   */
  claimRole?: ClaimRole[];
  /** Atom の推論的役割（提案 v4 Phase 1.2）。wikiMeta.atomType を mirror。 */
  atomType?: AtomType;
  /** Synthesis の推論モード（提案 v4 Phase 1.3）。wikiMeta.synthesisMode を mirror。 */
  synthesisMode?: SynthesisMode;
  /** Synthesis の検証状態。wikiMeta.hypothesisStatus を mirror。 */
  hypothesisStatus?: HypothesisStatus;
  /**
   * Claim / Atom の認識論的ステータス（Phase η, v15）。
   * wikiMeta.epistemicStatus を mirror する。一覧 UI で status filter に使う。
   * Phase η 以前に書かれた既存エントリでは undefined（読み込み側で interpretation 扱い）。
   */
  epistemicStatus?: EpistemicStatus;
  /**
   * Toulmin Rebuttal（Phase γ, v16）。Claim / Atom の wikiMeta.rebuttalConditions を mirror。
   * 一覧 UI で「rebuttal 付き Claim/Atom」のフィルタ・バッジ表示に使う。
   * Atom 側は「共通 rebuttal が伝播した」ことを意味する（spec §9, γ-6）。
   */
  rebuttalConditions?: string[];
  /**
   * Toulmin Backing（Phase γ, v16）。Claim のみ。wikiMeta.backing を mirror。
   * 教科書裏付け / 外部論文裏付け / 内部 Claim 裏付け の有無を一覧から把握するため
   * 配列をそのまま mirror する。
   */
  backing?: BackingEntry[];
  /**
   * Toulmin Modal qualifier（Phase γ, v16）。Claim のみ。
   * wikiMeta.modalQualifier を mirror。一覧 UI で「necessarily / probably / possibly / rarely」
   * のバッジ表示に使う。
   */
  modalQualifier?: ModalQualifier;
};

// ── Drive API ──

const DRIVE_API = "https://www.googleapis.com/drive/v3";
const UPLOAD_API = "https://www.googleapis.com/upload/drive/v3";
const INDEX_FILE_NAME = ".graphium-index.json";

// ストレージプロバイダー経由の認証付き fetch
function authedFetch(url: string, options: RequestInit = {}): Promise<Response> {
  return getActiveProvider().authedFetch(url, options);
}

// Graphium フォルダ ID を取得（google-drive.ts の getOrCreateFolder を再利用したいが、
// 循環 import を避けるため、ファイル検索で取得する）
let cachedFolderId: string | null = null;
async function getFolderId(): Promise<string> {
  if (cachedFolderId) return cachedFolderId;
  const query = `name='Graphium' and mimeType='application/vnd.google-apps.folder' and trashed=false`;
  const res = await authedFetch(
    `${DRIVE_API}/files?q=${encodeURIComponent(query)}&fields=files(id)&spaces=drive`
  );
  const data = await res.json();
  if (data.files?.[0]?.id) {
    cachedFolderId = data.files[0].id;
    return cachedFolderId!;
  }
  throw new Error("Graphium フォルダが見つかりません");
}

// インデックスファイル ID のキャッシュ
let cachedIndexFileId: string | null = null;

/** モジュールキャッシュをクリア（サインアウト時に呼ぶ） */
export function clearIndexCache(): void {
  cachedFolderId = null;
  cachedIndexFileId = null;
}

async function findIndexFileId(): Promise<string | null> {
  if (cachedIndexFileId) return cachedIndexFileId;
  const folderId = await getFolderId();
  const query = `name='${INDEX_FILE_NAME}' and '${folderId}' in parents and trashed=false`;
  const res = await authedFetch(
    `${DRIVE_API}/files?q=${encodeURIComponent(query)}&fields=files(id)&spaces=drive`
  );
  const data = await res.json();
  if (data.files?.[0]?.id) {
    cachedIndexFileId = data.files[0].id;
    return cachedIndexFileId;
  }
  return null;
}

// インデックスファイルを読み込み
export async function readIndexFile(): Promise<GraphiumIndex | null> {
  // プロバイダーが readAppData をサポートしていればそちらを使う
  const provider = getActiveProvider();
  if (provider.readAppData) {
    return (await provider.readAppData("note-index")) as GraphiumIndex | null;
  }
  // Drive API 経由（Google Drive プロバイダー）
  const fileId = await findIndexFileId();
  if (!fileId) return null;
  const res = await authedFetch(`${DRIVE_API}/files/${fileId}?alt=media`);
  return res.json();
}

// インデックスファイルを保存（新規作成 or 上書き）
export async function saveIndexFile(index: GraphiumIndex): Promise<void> {
  // プロバイダーが writeAppData をサポートしていればそちらを使う
  const provider = getActiveProvider();
  if (provider.writeAppData) {
    await provider.writeAppData("note-index", index);
    return;
  }
  // Drive API 経由（Google Drive プロバイダー）
  const fileId = await findIndexFileId();
  const body = JSON.stringify(index);

  if (fileId) {
    // 上書き
    await authedFetch(`${UPLOAD_API}/files/${fileId}?uploadType=media`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body,
    });
  } else {
    // 新規作成
    const folderId = await getFolderId();
    const boundary = "graphium_index_boundary";
    const metadata = JSON.stringify({ name: INDEX_FILE_NAME, parents: [folderId] });
    const multipart =
      `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadata}\r\n` +
      `--${boundary}\r\nContent-Type: application/json\r\n\r\n${body}\r\n` +
      `--${boundary}--`;

    const res = await authedFetch(`${UPLOAD_API}/files?uploadType=multipart&fields=id`, {
      method: "POST",
      headers: { "Content-Type": `multipart/related; boundary=${boundary}` },
      body: multipart,
    });
    const data = await res.json();
    cachedIndexFileId = data.id;
  }
}

// ── インデックスエントリ構築 ──

// GraphiumDocument からインデックスエントリを構築
export function buildIndexEntry(
  noteId: string,
  doc: GraphiumDocument,
  file?: GraphiumFile,
): NoteIndexEntry {
  const page = doc.pages[0];
  const headings: NoteIndexEntry["headings"] = [];
  const labels: NoteIndexEntry["labels"] = [];
  const outgoingLinks: NoteIndexEntry["outgoingLinks"] = [];
  const inlineLabels: NonNullable<NoteIndexEntry["inlineLabels"]> = [];

  if (page) {
    // 見出しを収集
    for (const block of page.blocks || []) {
      if (block.type === "heading" && (block.props?.level === 2 || block.props?.level === 3)) {
        const text = extractInlineText(block.content);
        if (text) {
          headings.push({ blockId: block.id, text, level: block.props.level });
        }
      }
    }

    // インラインハイライトを集計（Phase D-3-α）
    // BlockNote の inline style として保存されている material/tool/attribute/output を
    // ブロックツリー全体から拾い、(blockId, label, entityId) 単位で text を連結する。
    collectInlineLabels(page.blocks || [], inlineLabels);

    // メディアブロックのインラインラベル（Phase D-3-β サイドストア）
    if (page.mediaInlineLabels) {
      const blockById = new Map<string, any>();
      const collectBlocks = (bs: any[]) => {
        for (const b of bs) {
          if (b?.id) blockById.set(b.id, b);
          if (b?.children?.length) collectBlocks(b.children);
        }
      };
      collectBlocks(page.blocks || []);
      for (const [blockId, entry] of Object.entries(page.mediaInlineLabels)) {
        if (!entry?.label) continue;
        const block = blockById.get(blockId);
        const url: string | undefined = block?.props?.url;
        const text =
          block?.props?.name ||
          (url
            ? decodeURIComponent(url.split("/").pop()?.split("?")[0] ?? "")
            : "") ||
          blockId.slice(0, 8);
        inlineLabels.push({
          blockId,
          label: entry.label,
          text,
          entityId: entry.entityId,
        });
      }
    }

    // ラベルを収集（子ブロックも再帰的に検索、テーブル・子要素のテキストも取得）
    // ブロックが削除済みでラベルだけ残っている場合はスキップ（ゴーストラベル除去）
    // v2 以前の旧データが混入してもインデックスは内部キーで統一するため normalize する。
    for (const [blockId, label] of Object.entries(page.labels || {})) {
      const block = findBlockById(page.blocks || [], blockId);
      if (!block) continue;
      const preview = extractBlockText(block).slice(0, 80);
      labels.push({ blockId, label: normalizeLabel(label as string), preview });
    }

    // provLinks からの出力リンク
    for (const link of page.provLinks || []) {
      if (link.targetNoteId) {
        outgoingLinks.push({
          targetNoteId: link.targetNoteId,
          targetBlockId: link.targetBlockId || undefined,
          layer: "prov",
        });
      }
    }

    // knowledgeLinks からの出力リンク
    for (const link of page.knowledgeLinks || []) {
      if (link.targetNoteId) {
        outgoingLinks.push({
          targetNoteId: link.targetNoteId,
          targetBlockId: link.targetBlockId || undefined,
          layer: "knowledge",
        });
      }
    }

    // indexTables からの出力リンク
    for (const linkedNotes of Object.values(page.indexTables || {})) {
      for (const targetNoteId of Object.values(linkedNotes as Record<string, string>)) {
        outgoingLinks.push({ targetNoteId, layer: "knowledge" });
      }
    }
  }

  // derivedFromNoteId
  if (doc.derivedFromNoteId) {
    outgoingLinks.push({ targetNoteId: doc.derivedFromNoteId, layer: "prov" });
  }
  // noteLinks
  if (doc.noteLinks) {
    for (const link of doc.noteLinks) {
      outgoingLinks.push({
        targetNoteId: link.targetNoteId,
        targetBlockId: link.sourceBlockId || undefined,
        layer: "prov",
      });
    }
  }

  // 作者 / モデルの抽出
  // - 通常ノート (source !== "ai"): generatedBy.user.username と generatedBy.model を使う
  // - Wiki (source === "ai"): wikiMeta.generatedBy.model を使う。作者は LLM 自身なので username は無し
  const author = doc.generatedBy?.user?.username;
  const model = doc.generatedBy?.model ?? doc.wikiMeta?.generatedBy?.model;

  return {
    noteId,
    title: doc.title,
    modifiedAt: file?.modifiedTime ?? doc.modifiedAt,
    createdAt: file?.createdTime ?? doc.createdAt,
    headings,
    labels,
    outgoingLinks,
    source: doc.source,
    wikiKind: doc.wikiMeta?.kind,
    author,
    model,
    derivedFromNotes: doc.wikiMeta?.derivedFromNotes,
    inlineLabels: inlineLabels.length > 0 ? inlineLabels : undefined,
    claimRole: doc.wikiMeta?.claimRole,
    atomType: doc.wikiMeta?.atomType,
    synthesisMode: doc.wikiMeta?.synthesisMode,
    hypothesisStatus: doc.wikiMeta?.hypothesisStatus,
    epistemicStatus: doc.wikiMeta?.epistemicStatus,
    rebuttalConditions:
      doc.wikiMeta?.rebuttalConditions && doc.wikiMeta.rebuttalConditions.length > 0
        ? doc.wikiMeta.rebuttalConditions
        : undefined,
    backing:
      doc.wikiMeta?.backing && doc.wikiMeta.backing.length > 0
        ? doc.wikiMeta.backing
        : undefined,
    modalQualifier: doc.wikiMeta?.modalQualifier,
  };
}

/**
 * ブロックツリーを再帰的にたどり、inline style 経由のラベルエントリを集める。
 * Phase D-3-α 用ヘルパー。BlockNote の content[].styles を走査し、
 * (blockId, label, entityId) が同じ連続 text 片を 1 つの referent として連結する。
 *
 * 例: "[NaCl][水溶液] を作る" のように 2 連続のハイライトが同 entityId で付いていれば
 *     "NaCl水溶液" のテキストを持つ 1 エントリにまとめる。entityId が違えば別エントリ。
 */
function collectInlineLabels(
  blocks: any[],
  out: NonNullable<NoteIndexEntry["inlineLabels"]>,
): void {
  const STYLE_TO_LABEL: Record<string, "material" | "tool" | "attribute" | "output"> = {
    inlineMaterial: "material",
    inlineTool: "tool",
    inlineAttribute: "attribute",
    inlineOutput: "output",
  };
  const visit = (b: any): void => {
    if (!b || typeof b !== "object") return;
    const content = b.content;
    if (Array.isArray(content)) {
      // 同 (label, entityId) ハイライトをブロック内で連結する
      const aggregated = new Map<string, { label: "material" | "tool" | "attribute" | "output"; text: string; entityId: string }>();
      const collect = (text: string, styles: Record<string, any> | undefined) => {
        if (!styles) return;
        for (const styleKey of Object.keys(STYLE_TO_LABEL)) {
          const entityId = styles[styleKey];
          if (typeof entityId !== "string" || !entityId) continue;
          const label = STYLE_TO_LABEL[styleKey];
          const key = `${label}::${entityId}`;
          const existing = aggregated.get(key);
          if (existing) existing.text += text;
          else aggregated.set(key, { label, text, entityId });
        }
      };
      for (const c of content) {
        if (c?.type === "text") {
          collect(typeof c.text === "string" ? c.text : "", c.styles);
        } else if (c?.type === "link" && Array.isArray(c.content)) {
          for (const lc of c.content) {
            if (lc?.type === "text") {
              collect(typeof lc.text === "string" ? lc.text : "", lc.styles);
            }
          }
        }
      }
      for (const agg of aggregated.values()) {
        out.push({
          blockId: b.id,
          label: agg.label,
          text: agg.text,
          entityId: agg.entityId,
        });
      }
    }
    if (Array.isArray(b.children)) {
      for (const child of b.children) visit(child);
    }
  };
  for (const b of blocks) visit(b);
}

/**
 * 通常ノート ID → そのノートを派生元として参照する wiki エントリ配列の Map を構築する。
 * Knowledge 化済みかの判定や、ソースノートから対応 wiki への逆引き表示に使う。
 */
export function buildKnowledgeMap(index: GraphiumIndex | null): Map<string, NoteIndexEntry[]> {
  const map = new Map<string, NoteIndexEntry[]>();
  if (!index) return map;
  for (const entry of index.notes) {
    if (entry.source !== "ai") continue;
    if (!entry.derivedFromNotes || entry.derivedFromNotes.length === 0) continue;
    for (const sourceNoteId of entry.derivedFromNotes) {
      const list = map.get(sourceNoteId);
      if (list) list.push(entry);
      else map.set(sourceNoteId, [entry]);
    }
  }
  return map;
}

// ブロック配列から ID で再帰的に検索
function findBlockById(blocks: any[], id: string): any | undefined {
  for (const block of blocks) {
    if (block.id === id) return block;
    if (block.children?.length) {
      const found = findBlockById(block.children, id);
      if (found) return found;
    }
  }
  return undefined;
}

// BlockNote のインラインコンテンツからテキストを抽出
function extractInlineText(content: any): string {
  if (!content) return "";
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content.map((c: any) => c.text ?? c.content ?? "").join("");
  }
  // テーブルコンテンツ: { type: "tableContent", rows: [{ cells: [[...]] }] }
  if (content.type === "tableContent" && Array.isArray(content.rows)) {
    return content.rows
      .map((row: any) =>
        (row.cells ?? [])
          .map((cell: any) => extractInlineText(cell))
          .join(" ")
      )
      .join(" ")
      .trim();
  }
  return "";
}

// ブロックとその子ブロックからテキストを抽出
function extractBlockText(block: any): string {
  // 1. インラインコンテンツから直接取得
  let text = extractInlineText(block.content);
  if (text) return text;

  // 2. props.text (一部のブロック型)
  if (block.props?.text) return block.props.text;

  // 3. 子ブロックからテキストを再帰的に収集
  if (block.children?.length) {
    text = block.children
      .map((child: any) => extractBlockText(child))
      .filter(Boolean)
      .join(", ");
    if (text) return text;
  }

  // 4. content が文字列でない構造（フォールバック: JSON を文字列化して中身を探す）
  if (block.content) {
    try {
      const json = JSON.stringify(block.content);
      const texts = [...json.matchAll(/"text"\s*:\s*"([^"]+)"/g)].map(m => m[1]);
      if (texts.length > 0) return texts.join(" ");
    } catch {}
  }

  return "";
}

// ── インデックスの初期構築・差分更新 ──

// 起動時: インデックスを読み込み、古ければ差分更新
// prefetchedIndex が渡された場合は readIndexFile をスキップ（並列読み込み用）
export async function ensureIndex(
  files: GraphiumFile[],
  docCache: Map<string, GraphiumDocument>,
  prefetchedIndex?: GraphiumIndex | null,
): Promise<GraphiumIndex> {
  const existing = prefetchedIndex !== undefined ? prefetchedIndex : await readIndexFile();

  // 既存インデックスが最新かチェック（バージョン一致 + ファイル数一致 + 更新日が全て含まれている）
  if (existing && existing.version === INDEX_SCHEMA_VERSION && isIndexFresh(existing, files)) {
    return existing;
  }

  // スキーマバージョンが異なる → 全件再構築が必要
  if (!existing || existing.version !== INDEX_SCHEMA_VERSION) {
    const rebuilt = await fullRebuild(files, docCache);
    // 既存の Wiki エントリを保持（Wiki は別管理のため再構築対象外）
    if (existing) {
      const wikiEntries = existing.notes.filter((n) => n.source === "ai");
      rebuilt.notes.push(...wikiEntries);
    }
    return rebuilt;
  }

  // 差分更新: 変更があったノートだけ再読み込み
  const indexMap = new Map(existing.notes.map((n) => [n.noteId, n]));
  const fileIds = new Set(files.map((f) => f.id));
  const staleFiles: GraphiumFile[] = [];

  for (const file of files) {
    const entry = indexMap.get(file.id);
    if (!entry || new Date(file.modifiedTime).getTime() > new Date(entry.modifiedAt).getTime() + 1000) {
      staleFiles.push(file);
    }
  }

  // 削除されたノートを除去（Wiki エントリは別管理なので除外）
  const deletedIds = existing.notes
    .filter((n) => n.source !== "ai" && !fileIds.has(n.noteId))
    .map((n) => n.noteId);

  // 変更も削除もなければ既存インデックスを返す
  if (staleFiles.length === 0 && deletedIds.length === 0) {
    return existing;
  }

  // 変更があったノートだけ並列読み込み
  const toLoad = staleFiles.filter((f) => !docCache.has(f.id));
  if (toLoad.length > 0) {
    const results = await Promise.allSettled(
      toLoad.map(async (file) => {
        const doc = await getActiveProvider().loadFile(file.id);
        docCache.set(file.id, doc);
      })
    );
    // エラーは無視（削除済みファイルなど）
    results.forEach((r, i) => {
      if (r.status === "rejected") {
        console.warn(`[index] スキップ: ${toLoad[i].name}`);
      }
    });
  }

  // 既存エントリをベースに差分適用（Wiki エントリは保持）
  let notes = existing.notes.filter((n) => n.source === "ai" || fileIds.has(n.noteId));
  for (const file of staleFiles) {
    const doc = docCache.get(file.id);
    if (doc) {
      notes = notes.filter((n) => n.noteId !== file.id);
      notes.push(buildIndexEntry(file.id, doc, file));
    }
  }

  const index: GraphiumIndex = {
    version: INDEX_SCHEMA_VERSION,
    updatedAt: new Date().toISOString(),
    notes,
  };

  // バックグラウンドで保存（UI をブロックしない）
  saveIndexFile(index).catch((err) => console.warn("インデックス保存失敗:", err));

  return index;
}

// 全件再構築（スキーマバージョン変更時やインデックスが存在しない場合）
async function fullRebuild(
  files: GraphiumFile[],
  docCache: Map<string, GraphiumDocument>,
): Promise<GraphiumIndex> {
  const toLoad = files.filter((f) => !docCache.has(f.id));
  if (toLoad.length > 0) {
    await Promise.allSettled(
      toLoad.map(async (file) => {
        const doc = await getActiveProvider().loadFile(file.id);
        docCache.set(file.id, doc);
      })
    );
  }

  const entries: NoteIndexEntry[] = [];
  for (const file of files) {
    const doc = docCache.get(file.id);
    if (doc) {
      entries.push(buildIndexEntry(file.id, doc, file));
    }
  }

  const index: GraphiumIndex = {
    version: INDEX_SCHEMA_VERSION,
    updatedAt: new Date().toISOString(),
    notes: entries,
  };

  saveIndexFile(index).catch((err) => console.warn("インデックス保存失敗:", err));

  return index;
}

// インデックスがファイル一覧に対して最新かチェック
// Wiki エントリ（source === "ai"）はノートとは別管理なので除外して比較する
function isIndexFresh(index: GraphiumIndex, files: GraphiumFile[]): boolean {
  // ノートエントリのみ抽出（Wiki を除外）
  const noteEntries = index.notes.filter((n) => n.source !== "ai");
  // ファイル数が一致しない → 古い
  if (noteEntries.length !== files.length) return false;

  const indexMap = new Map(noteEntries.map((n) => [n.noteId, n.modifiedAt]));
  for (const file of files) {
    const indexModified = indexMap.get(file.id);
    // インデックスに含まれていない or 更新日が古い → 再構築
    if (!indexModified) return false;
    if (new Date(file.modifiedTime).getTime() > new Date(indexModified).getTime() + 1000) {
      return false;
    }
  }
  return true;
}

// ノート保存時: 該当エントリだけ差分更新
// archivedAt / deletedAt は doc には乗らないため、既存エントリから引き継ぐ
// （これが無いと archive 済みノートを保存した瞬間にフラグが剥がれる）。
export function updateIndexEntry(
  index: GraphiumIndex,
  noteId: string,
  doc: GraphiumDocument,
  file?: GraphiumFile,
): GraphiumIndex {
  const existing = index.notes.find((n) => n.noteId === noteId);
  const entry = buildIndexEntry(noteId, doc, file);
  if (existing?.archivedAt) entry.archivedAt = existing.archivedAt;
  if (existing?.deletedAt) entry.deletedAt = existing.deletedAt;
  const notes = index.notes.filter((n) => n.noteId !== noteId);
  notes.push(entry);
  return { ...index, updatedAt: new Date().toISOString(), notes };
}

// ノート削除時: エントリを除去（完全削除）
export function removeIndexEntry(
  index: GraphiumIndex,
  noteId: string,
): GraphiumIndex {
  return {
    ...index,
    updatedAt: new Date().toISOString(),
    notes: index.notes.filter((n) => n.noteId !== noteId),
  };
}

// ゴミ箱に送る: deletedAt をセットする（エントリは残す）
export function softDeleteIndexEntry(
  index: GraphiumIndex,
  noteId: string,
): GraphiumIndex {
  const now = new Date().toISOString();
  return {
    ...index,
    updatedAt: now,
    notes: index.notes.map((n) =>
      n.noteId === noteId ? { ...n, deletedAt: now } : n
    ),
  };
}

// ゴミ箱から復元: deletedAt を消す
export function restoreIndexEntry(
  index: GraphiumIndex,
  noteId: string,
): GraphiumIndex {
  return {
    ...index,
    updatedAt: new Date().toISOString(),
    notes: index.notes.map((n) => {
      if (n.noteId !== noteId) return n;
      const { deletedAt: _omit, ...rest } = n;
      return rest;
    }),
  };
}

// 通常表示用: ゴミ箱・アーカイブ内エントリを除外
export function getActiveNotes(index: GraphiumIndex | null): NoteIndexEntry[] {
  if (!index) return [];
  return index.notes.filter((n) => !n.deletedAt && !n.archivedAt);
}

// ゴミ箱表示用: ゴミ箱内エントリのみ（アーカイブは含めない）
export function getTrashedNotes(index: GraphiumIndex | null): NoteIndexEntry[] {
  if (!index) return [];
  return index.notes.filter((n) => n.deletedAt && !n.archivedAt);
}

// アーカイブ表示用: アーカイブ内エントリのみ（ゴミ箱は含めない）
export function getArchivedNotes(index: GraphiumIndex | null): NoteIndexEntry[] {
  if (!index) return [];
  return index.notes.filter((n) => n.archivedAt && !n.deletedAt);
}

// アーカイブする: archivedAt をセットする（エントリは残す）
export function archiveIndexEntry(
  index: GraphiumIndex,
  noteId: string,
): GraphiumIndex {
  const now = new Date().toISOString();
  return {
    ...index,
    updatedAt: now,
    notes: index.notes.map((n) =>
      n.noteId === noteId ? { ...n, archivedAt: now } : n
    ),
  };
}

// アーカイブから復元: archivedAt を消す
export function restoreFromArchive(
  index: GraphiumIndex,
  noteId: string,
): GraphiumIndex {
  return {
    ...index,
    updatedAt: new Date().toISOString(),
    notes: index.notes.map((n) => {
      if (n.noteId !== noteId) return n;
      const { archivedAt: _omit, ...rest } = n;
      return rest;
    }),
  };
}

/**
 * 指定ノートを参照しているノートを列挙する（参照警告・参照数カラム用）。
 * outgoingLinks が `targetNoteId === noteId` を含むエントリを返す。
 * ゴミ箱内ノートからの参照は除外する（ゴミ箱内同士の循環は考慮しない）。
 */
export function findIncomingReferences(
  index: GraphiumIndex | null,
  noteId: string,
): NoteIndexEntry[] {
  if (!index) return [];
  return index.notes.filter((n) => {
    if (n.noteId === noteId) return false;
    if (n.deletedAt) return false;
    return n.outgoingLinks.some((link) => link.targetNoteId === noteId);
  });
}
