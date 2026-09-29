// モデル設定（登録済みモデル一覧）の表示名の一意性ルール。
// サーバー（src/server/config/models.ts・src/server/routes/models.ts）と
// クライアント（src/features/settings/store.ts・modal.tsx）の両方から使う共通の純関数。
// どちらか片方だけに実装すると、もう片方の経路で同名モデルを作れてしまう。

/** 重複判定に使う最小限のモデル情報 */
export type ModelNameCandidate = {
  id: string;
  name: string;
};

/**
 * 表示名 name（selfId 以外のモデル）が existing の中に既にあるかを判定する。
 * - 判定は「id が違い、trim() した名前が一致する」。大文字・小文字は区別する。
 * - 新規追加のときは selfId に空文字を渡す（既存モデルの id は必ず空文字以外なので、
 *   全件と比較したことになる）。
 * - 編集で名前を変えないとき（newName が今の名前と同じ）は、この関数を呼ぶ前に
 *   呼び出し側でスキップすること — 既に重なった名前を持つ利用者が、名前を変えずに
 *   他のフィールドだけ更新する操作まで誤って拒否してしまう。
 */
export function isDuplicateModelName(
  name: string,
  selfId: string,
  existing: readonly ModelNameCandidate[],
): boolean {
  const trimmed = name.trim();
  if (!trimmed) return false;
  return existing.some((m) => m.id !== selfId && m.name.trim() === trimmed);
}
