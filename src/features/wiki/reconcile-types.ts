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
export type ReconcileConflict = {
  otherWikiId: string;
  otherTitle: string;
  summary: string;
  /**
   * 相手との関係。省略は "conflict"（見方が対立している）。
   * "newer" は「相手のページが後から書かれ、このページの見方を追い越している」。
   * このときは相手の見方を新しい見方として本文に書き、元の記述は以前の見方として残す
   */
  relation?: "conflict" | "newer";
};

/**
 * 出典照合で、どの出典にも裏づけられなかった 1 つの文（2026-11-05）。
 * 資料から全部作り直す代わりに、この文だけを 1 回の呼び出しで直す:
 * "contradicted" は出典の引用に合わせて書き換え、"not-in-source" は文を外す。
 */
export type ReconcileUnbacked = {
  /** 裏づけの無い文（トピック・問答は文単位。無いときは本文全体が対象） */
  statement?: string;
  /** 食い違う出典が 1 つでもあれば "contradicted"、どの出典にも無いだけなら "not-in-source" */
  verdict: "contradicted" | "not-in-source";
  /** 照合した出典（contradicted の側は quote に出典の言い分が入る） */
  sources: ReconcileSide[];
};

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
  /** どの出典にも裏づけられなかった文（書き換え・削除の対象） */
  unbacked?: ReconcileUnbacked[];
};

export type ReconcileOutput = { sections?: { heading: string; content: string }[]; body?: string; model?: string };
