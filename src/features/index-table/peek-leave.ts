// サイドピークの中のクリックで別の面へ移る（別ノート・素材・メモを開く）ときの順序。
//
// 移った先でピークが閉じたり作り直されたり（素材ギャラリーでの素材の差し替え）すると、
// 3 秒待ちの自動保存は後片付けで捨てられ、作り直したピークは古い doc キャッシュから
// 開いて古い本文を書き戻す。未保存の編集があるときは保存し終えてから移る
// （保存の完了で onSaved が親のキャッシュを更新するので、作り直したピークも新しい本文で開く）。

export type PeekSaveState = {
  /** SidePeek の保存状態 */
  status: "saving" | "saved" | "dirty";
  /** 自動保存のタイマーが発火待ちか。保存中に打った分は状態が saved に戻っても残る */
  timerPending: boolean;
};

/**
 * 未保存・保存中・タイマー待ちのどれかがあれば保存を済ませてから go を呼ぶ。
 * どれも無ければその場で go する — 外部ブラウザを開く経路をクリックの同期処理のまま残す
 * （非同期の後の window.open はポップアップとして止められることがある）。
 * 保存に失敗しても go は呼ぶ（閉じる・全画面で開くときと同じ扱い）。
 */
export function leaveAfterSave(
  state: PeekSaveState,
  steps: { cancelTimer: () => void; save: () => Promise<void>; go: () => void },
): void {
  if (state.status === "saved" && !state.timerPending) {
    steps.go();
    return;
  }
  steps.cancelTimer();
  steps
    .save()
    .catch((err) => console.error("[SidePeek] 移る前の保存に失敗:", err))
    .then(steps.go);
}
