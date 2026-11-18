// 「初期データの復元」effect が、届いた initialDoc をどう扱うかの判定。
//
// - skip: 何もしない（復元済み、または initialDoc がまだ無い）
// - notify-only: 復元はしない。「準備ができた」ことだけ伝える
//   （白紙の新規ノートとして開いたときに後から届く initialDoc は、このエディタ自身が
//   最初の保存で書いた本文。ストアは保存した時点より新しいことがあるので置き換えない）
// - restore: 通常どおりストアを initialDoc から復元する
export type InitialDocAction = "skip" | "notify-only" | "restore";

export function decideInitialDocAction(args: {
  initialized: boolean;
  hasInitialDoc: boolean;
  openedBlank: boolean;
}): InitialDocAction {
  if (args.initialized || !args.hasInitialDoc) return "skip";
  return args.openedBlank ? "notify-only" : "restore";
}
