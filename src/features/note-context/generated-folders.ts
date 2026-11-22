// Graphium がアプリ内で生成するノート（翻訳・論文からの手順抽出・音声ノートなど）の置き場所を決める。
//
// 規則: 「種類のフォルダ」を必ず付け、元の素材・ノートがフォルダに入っていればそれも引き継ぐ。
// - 素材をフォルダに入れないまま生成しても「未分類」に落ちない（種類のフォルダが受け皿になる）
// - 元がフォルダに入っていれば、話題のフォルダからも辿れる（フォルダは 1 ノートに複数持てる）
// - 作ったあとの付け外しはユーザーの自由（ここは生成時の初期値だけを決める）
//
// 「計画」フォルダも普通のフォルダとして引き継ぐ。計画かどうかはノートの種類（kind）で決まり、
// 生成したノートは普通のノート（kind: "note"）として作られるので、計画ノートには紛れ込まない。

import { normalizeNoteContexts } from "./context-tags";

/** 生成ノートの種類 → 種類のフォルダ名の i18n キー。名前は各ロケールの訳語を使う */
export const GENERATED_NOTE_FOLDER_KEYS = {
  translation: "generatedFolder.translation",
  procedure: "generatedFolder.procedure",
  voice: "generatedFolder.voice",
} as const;

export type GeneratedNoteKind = keyof typeof GENERATED_NOTE_FOLDER_KEYS;

/**
 * 生成ノートの noteContexts を組み立てる。
 * 先頭が種類のフォルダ、続いて元のフォルダ。重複は小文字で名寄せする。
 *
 * @param kindFolder 種類のフォルダ名（翻訳済みの表示名。空なら付けない）
 * @param inherited  元の素材・ノートのフォルダ
 */
export function buildGeneratedNoteFolders(
  kindFolder: string,
  inherited: readonly string[] = [],
): string[] | undefined {
  const carried = inherited.filter((f) => typeof f === "string");
  return normalizeNoteContexts([kindFolder, ...carried]);
}
