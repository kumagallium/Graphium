// 素材画面（一覧・全画面）から「戻る」ときの行き先を決める純関数。
// 履歴（ブラウザの戻る）と表示の状態がずれないよう、判定を note-app から切り出してテストする。
//
// 履歴は「戻る 1 回」で済むとは限らない。素材画面の上でノートのピークを開閉すると
// 履歴が 1 段ずつ積まれるので、「入る前」へ戻すには入った時点の連番（router.getSeq）を
// 覚えておき、いまとの差だけまとめて戻す（router.backBy）。

/** いまの連番 currentSeq から、連番 targetSeq のエントリまで戻る段数。
 *  targetSeq が不明（null）・現在より先・負なら 0（戻らない）。履歴の深さ（currentSeq）は超えない */
export function stepsBackTo(currentSeq: number, targetSeq: number | null): number {
  if (targetSeq === null || !Number.isFinite(targetSeq) || targetSeq < 0) return 0;
  return Math.max(0, Math.min(currentSeq, currentSeq - targetSeq));
}

/** 素材一覧の「← 戻る」の行き先 */
export type AssetBackAction =
  /** 履歴を steps 段戻す（ブラウザの戻ると同じ。着地先の画面は popstate の処理が復元する） */
  | { kind: "history"; steps: number }
  /** 戻れないので表示だけ畳み、URL を実際の画面に合わせて差し替える（履歴は積まない） */
  | { kind: "replace"; route: { view: "editor"; fileId: string } | { view: "home" } };

/** 素材一覧の「← 戻る」。戻れるなら一覧に入る前まで履歴を戻し、戻れないなら表示の実態に URL を揃える。
 *  entrySeq は一覧に入った時点の連番（その一つ前が「入る前」）。不明なら 1 段だけ戻す。
 *  skill: は本文ルートで復元できない ID なので home に落とす（開けない URL を残さない） */
export function resolveAssetBackAction(input: {
  currentSeq: number;
  entrySeq: number | null;
  activeFileId: string | null;
}): AssetBackAction {
  const target = input.entrySeq === null ? input.currentSeq - 1 : input.entrySeq - 1;
  const steps = stepsBackTo(input.currentSeq, target);
  if (steps > 0) return { kind: "history", steps };
  const id = input.activeFileId;
  if (id && !id.startsWith("skill:")) return { kind: "replace", route: { view: "editor", fileId: id } };
  return { kind: "replace", route: { view: "home" } };
}

/** ノートから開いた全画面を閉じるとき、ノートまで戻る段数（0 なら戻らず従来の畳み方）。
 *  noteSeq は全画面を開く直前（ノートを見ていた時点）の連番。開いても履歴が積まれなかった
 *  （同じ URL の差し替えだった＝ノートと URL が食い違っている）場合は null で、戻らない。
 *  全画面の最中にピークが積まれていても、noteSeq までまとめて戻る */
export function stepsBackToNote(currentSeq: number, noteSeq: number | null): number {
  return stepsBackTo(currentSeq, noteSeq);
}

/** 全画面を閉じる操作（「全画面表示を解除」・× ・Esc）の入口の手順。
 *  ノートから開いた全画面なら、先に印を下ろし（戻る操作は非同期の popstate で画面が替わるので、
 *  連打で 2 段戻らないように）、ノートへ戻れたらそこで終わる。戻れなければ従来の畳み方（fallback）。 */
export function runFullExit(input: {
  fromNote: boolean;
  clearFromNote: () => void;
  exitToNote?: () => boolean;
  fallback: () => void;
}): void {
  if (input.fromNote) {
    input.clearFromNote();
    if (input.exitToNote?.()) return;
  }
  input.fallback();
}
