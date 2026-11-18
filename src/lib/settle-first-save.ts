// 新しいノートの「最初の保存」が済むのを待つ
//
// まだ保存していない新しいノートは、最初の保存で ID が付いた時点でエディタだけが
// 作り直される（note-app.tsx の key={fileId || "new"}）。作り直されたエディタは
// 「保存した時点の本文」から始まるので、その保存が飛んでいる最中に本文へ挿した
// ブロックは、画面からも次の保存からも消える。
//
// ふつうの打鍵は保存が一瞬で終わるので当たらないが、非同期の結果を本文へ挿す処理
// （素材の登録を待ってからデータ表を置く、など）は、待っている間にちょうど最初の
// 自動保存が走りやすい。そういう処理は、挿す直前にこれを呼ぶ。
//
// - 既存のノート（ID がある）では何もしない
// - 未保存の編集があれば、最初の保存を前倒しで始める
// - 書き込み中の保存が無ければ何もしない（まっさらな新規ノート。挿入後の保存が
//   最初の保存になり、作り直しは挿入後の本文から始まる）
// - 保存が済んだら、エディタが作り直されるまで待つ。保存に失敗して ID が付かない
//   ときは timeoutMs で諦めて戻る（呼び出し側は今までどおり挿す）

export type SettleFirstSaveDeps = {
  /** いまのノートの ID。未保存の新しいノートは null */
  getFileId: () => string | null | undefined;
  hasUnsaved: () => boolean;
  saveNow: () => void;
  /** 書き込み中の保存があれば、すべて終わると解決する Promise。無ければ null */
  pendingSaves: () => Promise<unknown> | null;
  /** いま画面にあるエディタ（作り直されると別のインスタンスになる） */
  getLiveEditor: () => unknown;
  /** 作り直しを待つ上限。既定 2000ms */
  timeoutMs?: number;
};

export async function settleFirstSave(deps: SettleFirstSaveDeps): Promise<void> {
  if (deps.getFileId()) return;
  if (deps.hasUnsaved()) deps.saveNow();
  const pending = deps.pendingSaves();
  if (!pending) return;
  const before = deps.getLiveEditor();
  await pending.catch(() => {});
  const deadline = Date.now() + (deps.timeoutMs ?? 2000);
  for (;;) {
    const live = deps.getLiveEditor();
    if (deps.getFileId() && live && live !== before) return;
    if (Date.now() >= deadline) return;
    await new Promise<void>((resolve) => setTimeout(resolve, 20));
  }
}
