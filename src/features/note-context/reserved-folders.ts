// 計画ノートの判定ユーティリティ。
//
// 計画かどうかはノート自身の kind（"plan" / "note"）で決める（v0.153〜）。以前は
// 予約フォルダ「計画」（noteContexts）に入っているかで決めていたが、置き場（フォルダ）に
// 種類が混ざり「計画フォルダに入れても、どのプロジェクトの計画か分からない」という混乱の元に
// なったので、印をノートへ移した。「計画」フォルダは今は普通のフォルダで、名前の変更も削除もできる。
// kind を持たない旧ノートだけ、旧予約フォルダに入っているかで読み替える（resolveNoteKind）。
// **判定はこのファイルだけに閉じ込める** — 他の処理は isPlanNote / resolveNoteKind だけを呼び、
// PLAN_FOLDER_KEYS をここ以外で直接比較しないこと。
//
// 比較規則は folder-store.ts の isSelfOrChild（L112-116）に揃える: trim → 小文字比較。
// 予約語判定だけは NFKC 正規化も加える（isSelfOrChild は正規化していない）。NFC では
// 全角英字（"ｐｌａｎ"）が "plan" に畳まれず取りこぼすため、互換等価まで畳む NFKC を使う。
//
// なお本機能の「計画ノート」（kind が plan のノート）は、論文抽出機能が使う
// GraphiumDocument.partOfPlanNoteId の「計画ノート」（実施ノートの親）とは**別概念**。
// 混同注意（docs/ARCHITECTURE.md §3.3 / document-types.ts 参照）。

import { normalizeNoteContexts } from "./context-tags";

/** 予約フォルダのキー（正規化前の表記）。この配列以外で予約語を直接書かない */
// 旧予約フォルダの名前（各ロケールの訳語）。kind を持たない旧ノートの読み替えにだけ使う
// （ja「計画」/ en「Plan」/ ko「계획」）
export const PLAN_FOLDER_KEYS: readonly string[] = ["計画", "plan", "계획"];

/**
 * フォルダパスを比較用に正規化する。
 * trim → NFKC 正規化 → 小文字化。folder-store.ts の isSelfOrChild に NFKC を足したもの。
 */
export function normalizeFolderKey(path: string): string {
  return path.trim().normalize("NFKC").toLowerCase();
}

/**
 * フォルダパスが予約フォルダ「計画」自身か、その子（"計画/xxx"）かどうか。
 * 「計画中」のような前方一致もどきは弾く（完全一致 or "計画/" で始まる、のみ）。
 */
export function isPlanFolderPath(path: string): boolean {
  const key = normalizeFolderKey(path);
  return PLAN_FOLDER_KEYS.some((reserved) => {
    const normalizedReserved = normalizeFolderKey(reserved);
    return key === normalizedReserved || key.startsWith(`${normalizedReserved}/`);
  });
}

/**
 * ノートの noteContexts に旧予約フォルダ「計画」（またはその子フォルダ）が含まれるか。
 * 要素の正規化（文字列以外の無視・trim・空の除外）は normalizeNoteContexts に任せ、
 * 規則を二重に持たない。
 *
 * v0.153 からは計画かどうかをノート自身の kind で決める。この関数は kind を持たない
 * 旧ノートの読み替え（resolveNoteKind）にだけ使う。
 */
export function isInLegacyPlanFolder(noteContexts: readonly unknown[] | undefined | null): boolean {
  const normalized = normalizeNoteContexts(noteContexts);
  if (!normalized) return false;
  return normalized.some((value) => isPlanFolderPath(value));
}

/** ノートの種類。計画ノート（表の行が工程になる）か、それ以外のノートか */
export type NoteKind = "plan" | "note";

/** 計画かどうかを決めるのに要る項目（GraphiumDocument / NoteIndexEntry のどちらも渡せる） */
export type PlanTarget = {
  kind?: unknown;
  noteContexts?: readonly unknown[] | null;
};

/**
 * ノートの種類を決める。kind があればそれに従い、無い（v0.153 より前に保存された・
 * MCP などアプリの外で作られた）ノートは、旧予約フォルダ「計画」に入っているかで読み替える。
 * 読み込み時（document-migration）と索引（index-file）がこの結果を kind として持つので、
 * 一度保存されたノートはフォルダを動かしても種類が変わらない。
 */
export function resolveNoteKind(target: PlanTarget | null | undefined): NoteKind {
  if (target?.kind === "plan") return "plan";
  if (target?.kind === "note") return "note";
  return isInLegacyPlanFolder(target?.noteContexts) ? "plan" : "note";
}

/**
 * これから作る（ファイルに初めて書く）ノートに種類を持たせる。kind を指定していないノートは
 * 普通のノート（"note"）として作る — 「計画」という名前のフォルダに入れて作っても計画にはならない。
 * ナレッジ・スキルのページは種類を持たないので触らない。渡した doc をそのまま返す（書き換える）。
 */
export function stampNewNoteKind<T extends { kind?: NoteKind; wikiMeta?: unknown; skillMeta?: unknown }>(doc: T): T {
  if (doc && doc.kind === undefined && !doc.wikiMeta && !doc.skillMeta) doc.kind = "note";
  return doc;
}

/**
 * フォルダ（noteContexts）を書き換える前に、いまの種類を確定させる。kind の無い旧ノートを
 * 「計画」フォルダから出す・「計画」フォルダを改名や削除すると、読み替えの元が消えて計画で
 * なくなってしまうので、書き換えの前の値で kind を持たせてから保存する。
 * ナレッジ・スキルのページは種類を持たないので元の値（undefined）のまま。
 */
export function kindBeforeFolderChange(doc: PlanTarget & { wikiMeta?: unknown; skillMeta?: unknown }): NoteKind | undefined {
  if (doc.wikiMeta || doc.skillMeta) return doc.kind === "plan" || doc.kind === "note" ? doc.kind : undefined;
  return resolveNoteKind(doc);
}

/**
 * 計画ノートか。工程グラフ・計画の PROV 書き出し・来歴の流れ・MCP の export_prov など、
 * 計画を見分ける処理はすべてここを通す（規則を 1 か所に閉じ込める）。
 */
export function isPlanNote(target: PlanTarget | null | undefined): boolean {
  return resolveNoteKind(target) === "plan";
}
