// ノート保存の共有モジュール
//
// メインエディタ（note-app.tsx buildDocument / handleSave）と SidePeek
// （side-peek.tsx doSave）に並行実装されていた保存経路のうち、両者が
// 「同じ方式」で行っている部分だけをここに集約する。挙動保存（behavior-
// preserving）が最優先で、呼び出し側ごとに異なる副作用（syncUsedIn /
// recordRevision の有無、doc の組み立て範囲）は**このモジュールでは扱わない**。
// それらは各呼び出し側に残す（暗黙の挙動差を作らないため）。
//
// このモジュールが引き受けるのは次の 2 つだけ:
//
//   1. buildSavedPageFields — linkStore / labelStore / blockAlignmentStore の
//      スナップショットから、保存時のページ差分フィールド（labels /
//      provLinks / knowledgeLinks / blockAlignments）を組み立てる。
//      note-app.tsx buildDocument と side-peek.tsx doSave が字面レベルで
//      同一だった箇所。
//
//   2. saveNoteDoc — 保存の**順序**（provider へ保存 → onSaved）を 1 か所に
//      固定する。過去のデータ破壊（#514: 保存後 reindex 漏れ）は「保存に
//      成功したら必ず保存済み doc で reindex する」不変条件を守れなかった
//      ことが原因なので、順序をコードで強制する。wiki:/skill: 等の ID
//      プレフィックスに応じた saveFile / saveWikiFile / saveSkillFile の
//      振り分けもここに集約する。
//
// 注意（歴史的経緯）: SidePeek の保存は syncUsedIn（メディアの usedIn 同期）
// と recordRevision（ドキュメント来歴）を意図的に迂回している。これはバグでは
// なく現行仕様であり、saveNoteDoc はその迂回をそのまま保持する（syncUsedIn /
// recordRevision を内部で呼ばない）。統合するとしても別 PR で行う。

import type { GraphiumDocument } from "../../lib/document-types";
import { getActiveProvider } from "../../lib/storage/registry";

/**
 * linkStore などから保存時のリンクを取り出すための最小インターフェース。
 * note-app / side-peek 双方の linkStore がこの形を満たす。
 */
export interface LinkSource {
  /** layer フィールド（"prov" | "knowledge"）を持つリンクの全件 */
  getAllLinks(): Array<{ layer?: string; [k: string]: unknown }>;
}

/**
 * labelStore.getSnapshot() の返り値のうち、保存で使う部分だけ。
 * labels は Map / エントリ配列いずれでもよい（どちらも `for...of` で反復可能）。
 * 実装（context-label store）は `[string, string][]` を返す。
 */
export interface LabelSnapshotSource {
  getSnapshot(): { labels: Iterable<[string, string]> };
}

/** blockAlignmentStore.getSnapshot() の返り値（blockId → 揃え） */
export interface AlignmentSource {
  getSnapshot(): Record<string, "left" | "center" | "right">;
}

/** buildSavedPageFields の入力 */
export interface BuildSavedPageFieldsInput {
  labelStore: LabelSnapshotSource;
  linkStore: LinkSource;
  blockAlignmentStore: AlignmentSource;
}

/**
 * 保存時に GraphiumPage へマージするフィールド群。
 *
 * - labels: labelStore のスナップショットを plain object 化したもの
 * - provLinks / knowledgeLinks: linkStore を layer で振り分けたもの
 * - blockAlignments: 空なら undefined（フィールド自体を省略する）
 *
 * note-app.tsx buildDocument / side-peek.tsx doSave で完全に同一だった処理。
 */
export interface SavedPageFields {
  labels: Record<string, string>;
  provLinks: unknown[];
  knowledgeLinks: unknown[];
  blockAlignments: Record<string, "left" | "center" | "right"> | undefined;
}

/**
 * 保存時のページ差分フィールドを組み立てる。
 *
 * メイン / SidePeek いずれも、保存直前に labelStore / linkStore /
 * blockAlignmentStore のスナップショットを取り、labels を plain object 化し、
 * リンクを prov / knowledge レイヤに振り分け、空の blockAlignments は
 * undefined へ落としていた。その 3 ステップをここに集約する。
 */
export function buildSavedPageFields({
  labelStore,
  linkStore,
  blockAlignmentStore,
}: BuildSavedPageFieldsInput): SavedPageFields {
  const labelSnapshot = labelStore.getSnapshot();
  const labels: Record<string, string> = {};
  for (const [k, v] of labelSnapshot.labels) {
    labels[k] = v;
  }

  const allLinks = linkStore.getAllLinks();
  const provLinks = allLinks.filter((l) => l.layer === "prov");
  const knowledgeLinks = allLinks.filter((l) => l.layer === "knowledge");

  const alignmentsSnapshot = blockAlignmentStore.getSnapshot();
  const blockAlignments =
    Object.keys(alignmentsSnapshot).length > 0 ? alignmentsSnapshot : undefined;

  return { labels, provLinks, knowledgeLinks, blockAlignments };
}

/** saveNoteDoc の入力 */
export interface SaveNoteDocInput {
  /**
   * 保存先の ID。`wiki:` / `skill:` プレフィックス付きのフルキー
   * （doc キャッシュのキーと同じ形）で渡す。振り分けはこの関数が行う。
   */
  noteId: string;
  /** 保存する完成済みドキュメント。組み立ては呼び出し側の責務。 */
  doc: GraphiumDocument;
  /**
   * provider への保存が成功した後に、保存済み doc を渡して呼ばれる。
   * 呼び出し側はここで doc キャッシュとインデックスを最新化する
   * （reindexNoteFromDoc）。保存が失敗した場合は呼ばれない（#514 の不変条件）。
   * noteId は渡したときのフルキー（プレフィックス付き）のまま渡す。
   */
  onSaved?: (noteId: string, savedDoc: GraphiumDocument) => void;
}

/**
 * ノートドキュメントを保存し、成功時に onSaved を呼ぶ。
 *
 * 守る不変条件:
 *   (a) 保存に成功したときだけ onSaved が呼ばれる（失敗時は呼ばない）
 *   (b) onSaved には「provider へ書き込んだ doc そのもの」が渡る
 *   (c) noteId の `wiki:` / `skill:` プレフィックスに応じて
 *       saveWikiFile / saveSkillFile / saveFile を振り分ける
 *
 * provider の save が throw した場合はここでは握りつぶさず、そのまま
 * 呼び出し側へ伝播する（呼び出し側が saveStatus を "dirty" に戻す等の
 * リカバリを行う。従来の doSave の try/catch と同じ責務分担）。
 */
export async function saveNoteDoc({
  noteId,
  doc,
  onSaved,
}: SaveNoteDocInput): Promise<void> {
  const provider = getActiveProvider();
  if (noteId.startsWith("wiki:")) {
    const rawId = noteId.replace(/^wiki:/, "");
    if (!provider.saveWikiFile) throw new Error("Wiki 非対応のストレージプロバイダーです");
    await provider.saveWikiFile(rawId, doc);
  } else if (noteId.startsWith("skill:")) {
    const rawId = noteId.replace(/^skill:/, "");
    if (!provider.saveSkillFile) throw new Error("Skill 非対応のストレージプロバイダーです");
    await provider.saveSkillFile(rawId, doc);
  } else {
    await provider.saveFile(noteId, doc);
  }
  // 保存成功後のみ onSaved を呼ぶ（#514: 保存後 reindex 漏れの再発防止）。
  onSaved?.(noteId, doc);
}
