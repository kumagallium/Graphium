// サイドピークの保存を、ノートごとに 1 本の列に並べる。
//
// ピークはアンマウントの瞬間に未保存の編集を書き出す（閉じるボタンと同じ扱い）。書き出しは
// 非同期なので、同じノートをすぐ開き直したピーク（素材ギャラリーで素材を切り替えると全画面ごと
// 作り直す）は、保存が終わる前の doc キャッシュから開き、初期化で走る自動保存で古い本文を
// 書き戻してしまう。そこで:
//   - 同じノートの保存は、先の保存（成否を問わず）が終わってから書く（追い越さない）
//   - 列に保存が残っている間は、最後の保存の結果（書いた doc と成否）を取り出せる。
//     開く側（ピーク・チャットの書き戻し）はそれを待ってから最新の doc を読む
//
// キーはピークの noteId そのまま（wiki:/skill: 付き。doc キャッシュのキーと同じ形）。
// メインエディタの保存はこの列に並ばないが、アンマウント時の書き出し（ノートを切り替えた・
// 一覧や素材ギャラリーへ移った瞬間に残っていた直前 3 秒の編集）は同じキーで並ぶ。移った先の
// ピークが同じノートを開くとき、書き出しの完了を待てるように（note-app.tsx NoteEditorInner）

import type { GraphiumDocument } from "./document-types";

export type PeekSaveOutcome = {
  /** 書いた（失敗なら書こうとした）doc */
  doc: GraphiumDocument;
  /** 保存に成功したか。失敗なら doc はどこにも書かれていない */
  saved: boolean;
};

const tails = new Map<string, Promise<PeekSaveOutcome>>();

/**
 * 同じノートの先の保存が終わってから write を実行する。
 * 戻り値は write の結果（失敗なら reject する。呼び出し側が「未保存」に戻す）。
 * write が doc を返したら、それを「書いた doc」として結果に載せる（doc が書き込みの直前まで
 * 決まらない保存用。メインエディタは来歴を刻んでから書く）。返さなければ引数の doc
 */
export function queuePeekSave(
  noteId: string,
  doc: GraphiumDocument,
  write: () => Promise<GraphiumDocument | void>,
): Promise<GraphiumDocument | void> {
  const prev = tails.get(noteId);
  // prev（列の末尾）は reject しない
  const run = prev ? prev.then(() => write()) : write();
  const tail = run.then(
    (written): PeekSaveOutcome => ({ doc: written ?? doc, saved: true }),
    (): PeekSaveOutcome => ({ doc, saved: false }),
  );
  tails.set(noteId, tail);
  void tail.then(() => {
    // 後から並んだ保存があれば、列はそちらが持つ
    if (tails.get(noteId) === tail) tails.delete(noteId);
  });
  return run;
}

/**
 * このノートの保存が列に残っていれば、最後の保存が終わったときにその結果で解決する Promise。
 * 残っていなければ null（待たずに開いてよい）。
 */
export function pendingPeekSave(noteId: string): Promise<PeekSaveOutcome> | null {
  return tails.get(noteId) ?? null;
}
