// これまでのノートをまとめて A4 の幅にする（まとめて標準に戻す）。
//
// 設定画面の 2 つのボタンから呼ぶ。エディタの保存経路（buildDocument・recordRevision）は通さず、
// provider から読んだ doc の本文の幅の 2 項目（fullWidth / paperSize）だけを差し替えて書き戻す。
// - doc.modifiedAt・版の履歴（documentProvenance）・ほかの項目は 1 つも変えない
// - 1 件ずつ順に（Google ドライブ・NAS で往復が重いので並列にしない）
// - 止められる（AbortSignal）。1 件の失敗では止めず、数えて最後に返す

import type { GraphiumDocument } from "../../lib/document-types";
import type { NoteIndexEntry } from "../navigation/index-file";
import { resolveBodyWidth, type BodyWidth } from "./body-width";

/** a4: 標準のノートを A4 にする / standard: A4 のノートを標準に戻す */
export type BulkWidthMode = "a4" | "standard";

/**
 * まとめて変える対象の候補（ノート索引から）。
 * 自分のノートだけ（Wiki・スキルは対象外）。アーカイブは含み、ゴミ箱は除く。
 * 共有ライブラリの写しはノート索引に載らないので、ここに来ない。
 */
export function bulkWidthCandidates(notes: readonly NoteIndexEntry[]): NoteIndexEntry[] {
  return notes.filter((n) => !n.deletedAt && (n.source ?? "human") === "human" && !n.wikiKind);
}

export type BulkWidthPlan =
  | { kind: "change"; doc: GraphiumDocument }
  | { kind: "skip"; reason: "fullWidth" | "alreadyA4" | "notA4" | "unknownPaper" };

/**
 * doc 1 件をどうするか決める。変えるときは、幅の 2 項目だけを差し替えた新しい doc を返す
 * （読んだ JSON をそのまま使い、ほかの項目は落とさない・足さない。undefined のキーも残さない）。
 *
 * - a4: fullWidth: true（幅いっぱい）は変えない・すでに A4 は飛ばす。それ以外は paperSize を "a4" にし、
 *   fullWidth は外す。知らない paperSize（将来の版が書いた値）は上書きしない
 * - standard: paperSize が "a4" のものから paperSize を外す。A4 と幅いっぱいが両方立った doc は
 *   見えていた幅が A4（resolveBodyWidth）なので、fullWidth も外して標準にする。それ以外は触らない
 */
export function planBulkWidth(doc: GraphiumDocument, mode: BulkWidthMode): BulkWidthPlan {
  const raw = doc as { fullWidth?: boolean; paperSize?: unknown };
  const knownPaper = raw.paperSize == null || raw.paperSize === "a4";
  if (mode === "a4") {
    if (raw.paperSize === "a4") return { kind: "skip", reason: "alreadyA4" };
    if (raw.fullWidth === true) return { kind: "skip", reason: "fullWidth" };
    if (!knownPaper) return { kind: "skip", reason: "unknownPaper" };
    const { fullWidth: _fullWidth, ...rest } = doc as GraphiumDocument & { fullWidth?: boolean };
    return { kind: "change", doc: { ...rest, paperSize: "a4" } as GraphiumDocument };
  }
  if (raw.paperSize !== "a4") return { kind: "skip", reason: "notA4" };
  const { fullWidth: _fullWidth, paperSize: _paperSize, ...rest } = doc as GraphiumDocument & {
    fullWidth?: boolean;
  };
  return { kind: "change", doc: rest as GraphiumDocument };
}

/** 書いた doc から、開いているエディタに知らせる本文の幅を取り出す */
export function bodyWidthOfDoc(doc: GraphiumDocument): BodyWidth {
  return resolveBodyWidth(doc);
}

export type BulkWidthProgress = { done: number; total: number };

export type BulkWidthResult = {
  /** 対象にした件数 */
  total: number;
  /** 幅を書き換えた件数 */
  changed: number;
  /** 幅いっぱいのため変えなかった件数（A4 にする方） */
  skippedFullWidth: number;
  /** すでに A4 だった件数（A4 にする方） */
  skippedAlready: number;
  /** A4 ではなかった件数（標準に戻す方）・知らない paperSize の件数 */
  skippedOther: number;
  /** 読み書きに失敗した件数と id（もう一度押せば、書けていないものだけ続きから直せる） */
  failed: number;
  failedIds: string[];
  /** 途中で止めたか（止めた時点までの結果） */
  aborted: boolean;
};

export type BulkWidthDeps = {
  /** 書き込む直前に読む（ほかの画面の編集を古い値で潰さないよう、キャッシュは使わない） */
  loadFile: (noteId: string) => Promise<GraphiumDocument>;
  saveFile: (noteId: string, doc: GraphiumDocument) => Promise<void>;
  /** 書き換えに成功した 1 件ごとに呼ぶ（開いているノートへの反映・doc キャッシュの更新用） */
  onChanged?: (noteId: string, doc: GraphiumDocument) => void;
  /** 1 件ごとの前処理（開いているエディタの未保存を書き出させてから読む、など）。失敗は 1 件の失敗に数える */
  beforeEach?: (noteId: string) => Promise<void> | void;
  onProgress?: (progress: BulkWidthProgress) => void;
  signal?: AbortSignal;
};

/**
 * noteIds を 1 件ずつ順に処理する。止められる（次の 1 件に進む前に signal を見る）。
 * 1 件の失敗は数えて続ける。
 */
export async function runBulkBodyWidth(
  noteIds: readonly string[],
  mode: BulkWidthMode,
  deps: BulkWidthDeps,
): Promise<BulkWidthResult> {
  const result: BulkWidthResult = {
    total: noteIds.length,
    changed: 0,
    skippedFullWidth: 0,
    skippedAlready: 0,
    skippedOther: 0,
    failed: 0,
    failedIds: [],
    aborted: false,
  };
  deps.onProgress?.({ done: 0, total: noteIds.length });
  for (let i = 0; i < noteIds.length; i++) {
    if (deps.signal?.aborted) {
      result.aborted = true;
      break;
    }
    const noteId = noteIds[i];
    try {
      await deps.beforeEach?.(noteId);
      const doc = await deps.loadFile(noteId);
      const plan = planBulkWidth(doc, mode);
      if (plan.kind === "change") {
        await deps.saveFile(noteId, plan.doc);
        result.changed++;
        deps.onChanged?.(noteId, plan.doc);
      } else if (plan.reason === "fullWidth") {
        result.skippedFullWidth++;
      } else if (plan.reason === "alreadyA4") {
        result.skippedAlready++;
      } else {
        result.skippedOther++;
      }
    } catch (err) {
      console.warn("[bulk-body-width] 失敗:", noteId, err);
      result.failed++;
      result.failedIds.push(noteId);
    }
    deps.onProgress?.({ done: i + 1, total: noteIds.length });
  }
  return result;
}

/**
 * target の本文の幅の 2 項目を、source（いまファイルにある doc）の値に揃えた複製を返す。
 * doc キャッシュ・開いているノートの復元元（activeDoc）を、ファイルに書いた幅へ追従させる用。
 * ほかの項目は target のまま（キャッシュの方が新しい本文を持っていても潰さない）。
 */
export function copyBodyWidthFields<T extends object>(target: T, source: object): T {
  const { fullWidth: _fullWidth, paperSize: _paperSize, ...rest } = target as T & {
    fullWidth?: boolean;
    paperSize?: unknown;
  };
  const { fullWidth, paperSize } = source as { fullWidth?: boolean; paperSize?: unknown };
  return {
    ...rest,
    ...(fullWidth !== undefined ? { fullWidth } : {}),
    ...(paperSize !== undefined ? { paperSize } : {}),
  } as unknown as T;
}
