// メモの「付け先」（何についてのメモか）。UI 用の型で、保存はしない。
//
// 保存されるのは今まで通り CaptureEntry の sourceAsset / sourceNote だけ。
// 付け先はメモを書く入口（クイックメモ・選択ツールバー・ブロックメニュー）が
// 「いま見ているもの」から決め、CaptureDialog の付け先チップに見せる。
// チップの ✕ で外すと none（どこにも付かないメモ＝今までのクイックメモ）になる。

import type { MediaType } from "../asset-browser/media-index";
import type { MemoSourceAsset, MemoSourceNote } from "./capture-store";

export type MemoTarget =
  | { kind: "none" }
  | { kind: "note"; fileId: string; title?: string }
  | {
      kind: "block";
      fileId: string;
      title?: string;
      blockId: string;
      blockText: string;
      /** そのブロックが素材（画像・動画・PDF）に引けるときの素材。あれば sourceAsset も一緒に持つ */
      asset?: BlockAssetRef;
    }
  | { kind: "asset"; fileId: string; type: MediaType; name: string; pageNumber?: number };

/** 素材ブロックの付け先が持つ素材の情報 */
export type BlockAssetRef = { fileId: string; type: MediaType; name: string };

export const MEMO_TARGET_NONE: MemoTarget = { kind: "none" };

/** 付け先 → 保存形。none は何も付けない。値の無い項目はキーごと省く（旧メモと同じ形に揃える） */
export function memoTargetToSources(target: MemoTarget): {
  sourceAsset?: MemoSourceAsset;
  sourceNote?: MemoSourceNote;
} {
  switch (target.kind) {
    case "none":
      return {};
    case "note":
      return {
        sourceNote: {
          fileId: target.fileId,
          ...(target.title ? { title: target.title } : {}),
        },
      };
    case "block":
      // 素材ブロックに付けるメモは、どの入口からでも素材とノートのブロックの両方を持つ
      return {
        ...(target.asset ? { sourceAsset: { fileId: target.asset.fileId, type: target.asset.type } } : {}),
        sourceNote: {
          fileId: target.fileId,
          ...(target.title ? { title: target.title } : {}),
          blockId: target.blockId,
          blockText: target.blockText,
        },
      };
    case "asset":
      return {
        sourceAsset: {
          fileId: target.fileId,
          type: target.type,
          ...(target.pageNumber !== undefined ? { pageNumber: target.pageNumber } : {}),
        },
      };
  }
}

/** 抜粋の最大文字数（ブロックの blockText = resolveMemoBlockLabel と同じ 80 字） */
export const MEMO_EXCERPT_MAX = 80;

/**
 * 選んだ文字などを blockText の抜粋にする。空白・改行は 1 つの空白にまとめ、80 字で切る
 * （サロゲートペアの途中では切らない）。空なら ""。
 */
export function toMemoExcerpt(text: string | null | undefined): string {
  if (!text) return "";
  const collapsed = text.replace(/\s+/g, " ").trim();
  const chars = Array.from(collapsed);
  return chars.length > MEMO_EXCERPT_MAX ? chars.slice(0, MEMO_EXCERPT_MAX).join("") : collapsed;
}

/** 付け先に使う素材の情報 */
export type MemoAssetRef = {
  fileId: string;
  type: MediaType;
  name: string;
  pageNumber?: number;
};

/**
 * ノートの編集面（NoteEditorInner）が返す、いまの見ているものの状況。
 * ノートの fileId / 題は編集面が知らない（NoteApp が持つ）ので、ここには入れない。
 */
export type NoteViewMemoContext =
  | { kind: "asset"; asset: MemoAssetRef }
  | { kind: "block"; blockId: string; blockText: string; asset?: BlockAssetRef }
  | { kind: "note" };

/**
 * ノートの編集面で、カーソルの状況から付け先を決める。
 *
 * - メインのエディタにカーソルがある（フォーカスがある／文字を選んでいる）:
 *   カーソルのあるブロックの block。空の段落（抜粋が空）なら note
 * - エディタにカーソルが無く、素材のサイドピークを開いている: その素材の asset
 * - それ以外（ノートを開いているだけ）: note
 *
 * サイドピークを開いていても、メインのエディタで書いている最中ならノートのブロックを優先する
 * （⌘⇧M を押した人が見ているのは本文のほう）。
 */
export function resolveNoteViewContext(input: {
  /** メインのエディタ（サイドピークでない）にフォーカスがある、または選択がある */
  editorActive: boolean;
  /** カーソルのあるブロック（取れなければ null） */
  cursorBlock: { id: string; label: string; asset?: BlockAssetRef } | null;
  /** エディタ内の素材のサイドピークで開いている素材 */
  peekAsset: MemoAssetRef | null;
}): NoteViewMemoContext {
  if (input.editorActive) {
    const block = input.cursorBlock;
    if (block && block.label) return {
        kind: "block",
        blockId: block.id,
        blockText: block.label,
        ...(block.asset ? { asset: block.asset } : {}),
      };
    return { kind: "note" };
  }
  if (input.peekAsset) return { kind: "asset", asset: input.peekAsset };
  return { kind: "note" };
}

/**
 * ⌘⇧M（クイックメモ）の付け先を決める。
 *
 * 1. 素材の全画面・素材のサイドピーク（一覧・グラフ側）を見ている → asset
 * 2. ノートの編集面が出ている → 編集面の状況（asset / block / note）。
 *    ノートに fileId が無い（未保存の新規ノート）ときは note / block に付けられないので none
 * 3. それ以外（一覧・ホームなど）・テンプレート編集中（編集面が状況を返さない） → none
 */
export function resolveQuickMemoTarget(input: {
  viewingAsset: MemoAssetRef | null;
  note: { fileId: string | null | undefined; title?: string } | null;
  noteView: NoteViewMemoContext | null;
}): MemoTarget {
  if (input.viewingAsset) return assetTarget(input.viewingAsset);
  const view = input.noteView;
  if (!view) return MEMO_TARGET_NONE;
  if (view.kind === "asset") return assetTarget(view.asset);
  const fileId = input.note?.fileId;
  if (!fileId) return MEMO_TARGET_NONE;
  const title = input.note?.title;
  if (view.kind === "block") {
    return {
      kind: "block",
      fileId,
      ...(title ? { title } : {}),
      blockId: view.blockId,
      blockText: view.blockText,
      ...(view.asset ? { asset: view.asset } : {}),
    };
  }
  return { kind: "note", fileId, ...(title ? { title } : {}) };
}

function assetTarget(asset: MemoAssetRef): MemoTarget {
  return {
    kind: "asset",
    fileId: asset.fileId,
    type: asset.type,
    name: asset.name,
    ...(asset.pageNumber !== undefined ? { pageNumber: asset.pageNumber } : {}),
  };
}
