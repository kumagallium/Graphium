// 素材画面（一覧・全画面）から「戻る」ときの行き先を決める純関数。
// 履歴（ブラウザの戻る）と表示の状態がずれないよう、判定を note-app から切り出してテストする。

/** 素材一覧の「← 戻る」の行き先 */
export type AssetBackAction =
  /** 履歴を 1 段戻す（ブラウザの戻ると同じ。着地先の画面は popstate の処理が復元する） */
  | { kind: "history" }
  /** 戻れないので表示だけ畳み、URL を実際の画面に合わせて差し替える（履歴は積まない） */
  | { kind: "replace"; route: { view: "editor"; fileId: string } | { view: "home" } };

/** 素材一覧の「← 戻る」。戻れるなら履歴を戻し、戻れないなら表示の実態に URL を揃える。
 *  skill: は本文ルートで復元できない ID なので home に落とす（開けない URL を残さない） */
export function resolveAssetBackAction(input: {
  canGoBack: boolean;
  activeFileId: string | null;
}): AssetBackAction {
  if (input.canGoBack) return { kind: "history" };
  const id = input.activeFileId;
  if (id && !id.startsWith("skill:")) return { kind: "replace", route: { view: "editor", fileId: id } };
  return { kind: "replace", route: { view: "home" } };
}

/** 全画面を閉じる操作（「全画面表示を解除」・× ・Esc）で、ノートへ戻る（履歴を戻す）か。
 *  ノートから開いた全画面（本文の画像のダブルクリック・サイドピークの ⤢）だけが対象。
 *  素材の一覧の中から全画面にした場合は今までどおり一覧に戻る。戻れないときも従来どおり */
export function shouldReturnToNoteOnFullExit(input: {
  openedFromNote: boolean;
  canGoBack: boolean;
}): boolean {
  return input.openedFromNote && input.canGoBack;
}
