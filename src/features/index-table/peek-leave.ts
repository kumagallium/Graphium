// サイドピークの操作で別の面へ移る（閉じる・全画面・ローカルビュー・ピーク内のリンクで
// 別ノート・素材・メモを開く）ときの順序。
//
// 移った先が同じノートを読むことがある（全画面のメインエディタ、作り直したピーク）。
// 未保存の編集や書き込み中の保存が残ったまま移ると、読む側は保存前の doc キャッシュから開く。
// そこで保存を済ませてから移る（保存の完了で onSaved が親のキャッシュを更新する）。
// ピークの外の操作で消えるときは、アンマウント時の書き出し（side-peek.tsx）が同じ役を担う。

export type PeekSaveState = {
  /** 保存にまだ渡していない編集がある（自動保存の待ち・前回の保存の失敗） */
  unsaved: boolean;
  /** このノートの保存が列に残っている（書き込み中・順番待ち。lib/peek-save-queue.ts） */
  saving: boolean;
};

/**
 * 未保存があれば保存し、保存が列に残っていれば書き終わるのを待ってから go を呼ぶ。
 * どちらも無ければその場で go する — 外部ブラウザを開く経路をクリックの同期処理のまま残す
 * （非同期の後の window.open はポップアップとして止められることがある）。
 * 保存に失敗しても go は呼ぶ（書けなかった分はピークが「未保存」として持ち、
 * アンマウント時にもう一度書き出す）。
 */
export function leaveAfterSave(
  state: PeekSaveState,
  steps: {
    cancelTimer: () => void;
    save: () => Promise<void>;
    waitSaved: () => Promise<void>;
    go: () => void;
  },
): void {
  if (!state.unsaved && !state.saving) {
    steps.go();
    return;
  }
  steps.cancelTimer();
  // 保存は列の後ろに並ぶので、書き込み中の保存があってもそれが済んでから終わる
  (state.unsaved ? steps.save() : steps.waitSaved())
    .catch((err) => console.error("[SidePeek] 移る前の保存に失敗:", err))
    .then(steps.go);
}
