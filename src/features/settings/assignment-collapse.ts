// モデルの割り当てを「3 段とも ○○ を使います」の 1 行で出してよいかの判定。
//
// 1 行にするのは、段ごとに選ぶものが無いときだけ:
// - 登録しているモデルがちょうど 1 つ（読み込み中は判定しない）
// - 軽い処理の欄が空か、その 1 つと同じ
// - 標準の処理・高度な処理の欄が空（段ごとに選んであれば、今の 3 段で見せる）
// 欄に見つからない名前が残っているとき（モデルを消したあとなど）は、今の 3 段の「見つかりません」で知らせたいので 1 行にしない。
// #947 で割り当てを束に畳んだら、最小限で使いたい人がモデルを選べなくなった。選ぶものがあるときは畳まない。

export type AssignmentCollapseInput = {
  /** 一覧の読み込みが済んでいるか */
  modelsLoaded: boolean;
  /** 登録しているモデルの表示名 */
  modelNames: readonly string[];
  /** 軽い処理のモデル（空 = サーバーデフォルト） */
  model: string;
  standardModel: string;
  preciseModel: string;
};

/** 1 行で出せるなら、その 1 つのモデルの名前。出せなければ null */
export function singleModelForAssignment({ modelsLoaded, modelNames, model, standardModel, preciseModel }: AssignmentCollapseInput): string | null {
  if (!modelsLoaded || modelNames.length !== 1) return null;
  const only = modelNames[0];
  if (model !== "" && model !== only) return null;
  if (standardModel !== "" || preciseModel !== "") return null;
  return only;
}
