// 併記（reconcile）の入出力の型。クライアント・サーバー・出典照合で共有する

/** 食い違いの片側（出典 1 件） */
export type ReconcileSide = { sourceId: string; sourceTitle: string; quote?: string; rationale?: string };

/** 出典照合で見つかった、1 つの文をめぐる食い違い */
export type ReconcileDisagreement = {
  /** 食い違っている文（トピックは文単位。知見は本文全体が対象なので省く） */
  statement?: string;
  supporting: ReconcileSide[];
  contradicting: ReconcileSide[];
};

/** 点検で見つかった、別ページとの矛盾 */
export type ReconcileConflict = { otherWikiId: string; otherTitle: string; summary: string };

export type ReconcileInput = {
  title: string;
  kind: "claim" | "atom" | "topic" | "answer" | "summary";
  language: string;
  /** claim / atom は sections（[[タイトル]] 引用）、topic / answer / summary は body（[[source:<id>]] 引用） */
  format: "sections" | "body";
  currentSections?: { heading: string; content: string }[];
  currentBody?: string;
  disagreements: ReconcileDisagreement[];
  conflicts?: ReconcileConflict[];
};

export type ReconcileOutput = { sections?: { heading: string; content: string }[]; body?: string; model?: string };
