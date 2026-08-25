// 洞察モデルの能力テスト
//
// 「どのモデルなら洞察（Atom）の抽象化に足りるか」をユーザー自身が実測で確かめるための
// 固定ベンチ。同梱のテスト用知見（パン作り — マニュアルのデモ世界観と同じ、誰でも情景が
// 描ける題材）を選択中の洞察モデルで 1 回 atomize し、結果をその場に表示する。
//
// 設計原則:
//   - 【汚染ゼロ】テスト用知見はこのファイルの定数としてだけ存在する。ノート・ナレッジ・
//     インデックス・embedding・wikiLog のどこにも書き込まない（保存経路を最初から持たない）。
//     結果もその場に表示するだけで揮発する。
//   - 【採点しない】機械採点器は恣意性の持ち込みになるので置かない。表示するのは
//     客観シグナル 2 つ（折り畳み = 2 知見以上の引用 / 言い換えの可能性 = 元知見との
//     トークン重なり）と、期待される抽象水準の参考例だけ。判断はユーザーがする。
//   - 【核となる期待解は 1 件】テストは最小構成にする: 畳める知見 2 件 + 一回性の知見 1 件。
//     合格の中心は「知見 1・2 を 1 つの規則に畳んだ洞察」が出ること。
//     (1)(2) は「構造の成熟には適正範囲がある」（不足でも過剰でも破綻する逆 U 字）—
//     単純な因果 2 本を 1 つの境界構造に畳む、言い換えでは到達できない抽象を要求する。
//     ただし「ちょうど 1 件」は要求しない: 能力のあるモデルは同じペアから別の切り口の
//     妥当な抽象（発生と保持の分離など）や、知見 3 を持ち上げた単独洞察を追加で出すことが
//     ある — 単独でも可搬なら Atom は仕様上有効（#459）なので、これらは減点ではない。
//     力不足のシグナルは「言い換えが知見と同数並ぶ」「空リスト」「3 を言い換えのまま拾う」。

import type { ClaimSnapshot } from "../../server/services/wiki-types";
import { atomizeConcepts, type AtomCandidate } from "./wiki-service";
import { tokenize, jaccard } from "./sampling";

export type InsightTestClaim = { id: string; title: string; body: string };

/** ユーザーデータと衝突しない・見れば由来が分かる ID プレフィックス */
export const INSIGHT_TEST_ID_PREFIX = "insight-model-test-";

const CLAIMS_JA: InsightTestClaim[] = [
  {
    id: `${INSIGHT_TEST_ID_PREFIX}1`,
    title: "こねが足りない生地は気泡を保持できない",
    body: "グルテンの膜が十分に育っていない生地は、発酵で生まれたガスを抱えきれず、焼き上がりが平たく詰まった。",
  },
  {
    id: `${INSIGHT_TEST_ID_PREFIX}2`,
    title: "発酵を進めすぎた生地は焼成中に潰れる",
    body: "過発酵の生地は骨格が弱り、オーブンの熱でいったん持ち上がったあとに沈んで、目の詰まった層ができた。",
  },
  {
    id: `${INSIGHT_TEST_ID_PREFIX}3`,
    title: "今日開けた粉は吸水が多かった",
    body: "新しく開けた袋の粉は、いつもの加水率だと生地がかたく、水を 15 グラム足してちょうどよくなった。",
  },
];

const CLAIMS_EN: InsightTestClaim[] = [
  {
    id: `${INSIGHT_TEST_ID_PREFIX}1`,
    title: "Under-kneaded dough cannot hold its gas",
    body: "Dough whose gluten film had not developed enough could not retain the gas produced during fermentation, and the loaf came out flat and dense.",
  },
  {
    id: `${INSIGHT_TEST_ID_PREFIX}2`,
    title: "Over-proofed dough collapses during baking",
    body: "Dough left to ferment too long lost its structural strength; it rose briefly in the oven's heat and then sank, leaving a dense layer.",
  },
  {
    id: `${INSIGHT_TEST_ID_PREFIX}3`,
    title: "Today's new bag of flour absorbed more water",
    body: "A freshly opened bag of flour made the dough stiff at the usual hydration; adding 15 g of water brought it back to normal.",
  },
];

export function getInsightTestClaims(locale: string): InsightTestClaim[] {
  return locale === "ja" ? CLAIMS_JA : CLAIMS_EN;
}

/**
 * 参考: この知見群から期待される抽象の水準。
 * 特定モデルの逐語出力ではなく「このくらい持ち上がっていれば合格」という基準線。
 * ユーザーが自分のモデルの出力と見比べるために表示する。
 * foldsClaimNumbers は「どの知見（1 始まりの表示番号）を折り畳むのが期待か」の対応表 —
 * 何が正解かをユーザーが照合できるようにする。番号は getInsightTestClaims の並び順。
 */
export type InsightTestReference = { title: string; body: string; foldsClaimNumbers: number[] };

const REFERENCE_JA: InsightTestReference[] = [
  {
    title: "内部の骨組みには、育ち不足でも育ちすぎでも崩れる適正な範囲がある",
    body: "構造を支える骨組みは、足りなければ持ちこたえられず、進みすぎれば自壊する。良い状態は両端の間の帯にある。",
    foldsClaimNumbers: [1, 2],
  },
];

const REFERENCE_EN: InsightTestReference[] = [
  {
    title: "An internal framework has a viable range — too little or too much development both collapse it",
    body: "A supporting structure fails when underdeveloped and destroys itself when overdeveloped. The good state lives in the band between the extremes.",
    foldsClaimNumbers: [1, 2],
  },
];

export function getInsightTestReference(locale: string): InsightTestReference[] {
  return locale === "ja" ? REFERENCE_JA : REFERENCE_EN;
}

/**
 * 言い換え度: 候補タイトルと元知見タイトルの最大トークン重なり（Jaccard, 0..1）。
 * 高い = 元知見をほぼそのまま言い換えている可能性。表示バッジにだけ使い、破棄はしない。
 */
export function restatementScore(candidateTitle: string, claims: InsightTestClaim[]): number {
  const cand = tokenize(candidateTitle);
  let max = 0;
  for (const c of claims) {
    const s = jaccard(cand, tokenize(c.title));
    if (s > max) max = s;
  }
  return max;
}

/** 「言い換えの可能性」バッジを出す表示しきい値（表示のみ・破棄には使わない） */
export const RESTATEMENT_BADGE_THRESHOLD = 0.5;

export type InsightTestCandidate = {
  title: string;
  body: string;
  /** 引用した知見のタイトル（折り畳みシグナル: 2 件以上なら知見をまたげている） */
  sourceTitles: string[];
  /** 引用した知見の表示番号（1 始まり・knowledge リストと参考例の番号に対応）。
   *  参考例の「折り畳む知見: 1 · 2」と突き合わせる答え合わせ用。 */
  sourceNumbers: number[];
  /** 元知見との最大トークン重なり（0..1）。しきい値超えで「言い換えの可能性」バッジ */
  restatement: number;
  atomType?: AtomCandidate["atomType"];
};

/** 一回性の事実（どの洞察にも畳まれないのが期待）の表示番号 */
export const INSIGHT_TEST_ONE_OFF_NUMBER = 3;

/**
 * 結果の要約。候補が多いときに 1 行で全体像を掴めるようにする — 目視検証の負担を下げる。
 * 客観的に数えられる量だけを集計し、合否判定はしない。
 */
export type InsightTestSummary = {
  /** 2 件以上の知見を引用した候補数（折り畳みの成立数） */
  foldCount: number;
  /** 「言い換えの可能性」バッジが付く候補数 */
  restatementCount: number;
  /** 引用された知見番号の和集合（視野） */
  coveredNumbers: number[];
  /** 一回性の知見を引用した候補があるか（中立情報 — 持ち上げて拾うのは仕様上許容） */
  citesOneOffFact: boolean;
  /** 一回性の知見を「言い換えのまま」拾った候補があるか。これは力不足のシグナル */
  oneOffRestated: boolean;
};

export function summarizeInsightTest(candidates: InsightTestCandidate[]): InsightTestSummary {
  const covered = new Set<number>();
  let foldCount = 0;
  let restatementCount = 0;
  let oneOffRestated = false;
  for (const c of candidates) {
    if (c.sourceNumbers.length >= 2) foldCount += 1;
    const restated = c.restatement >= RESTATEMENT_BADGE_THRESHOLD;
    if (restated) restatementCount += 1;
    // 一回性の知見を引用すること自体は仕様上許容（単独でも可搬なら Atom — #459）。
    // 警告に値するのは「言い換えのまま拾った」場合だけなので、両条件の合致を見る。
    if (restated && c.sourceNumbers.includes(INSIGHT_TEST_ONE_OFF_NUMBER)) oneOffRestated = true;
    for (const n of c.sourceNumbers) covered.add(n);
  }
  return {
    foldCount,
    restatementCount,
    coveredNumbers: [...covered].sort((a, b) => a - b),
    citesOneOffFact: covered.has(INSIGHT_TEST_ONE_OFF_NUMBER),
    oneOffRestated,
  };
}

export type InsightTestResult = {
  candidates: InsightTestCandidate[];
  /** 実際に使われたモデル（サーバー解決後） */
  model?: string;
};

// 直近のテスト結果のメモリキャッシュ。設定モーダルは閉じると unmount されるため、
// React state だけだと開き直しで結果が消える（LLM 1 回ぶんが無駄になる）。
// localStorage には置かない — 「テストは何も保存しない」の約束どおり、
// ページを離れれば揮発するインメモリ保持に留める。
let lastInsightTestResult: InsightTestResult | null = null;

export function getLastInsightTestResult(): InsightTestResult | null {
  return lastInsightTestResult;
}

export function setLastInsightTestResult(result: InsightTestResult | null): void {
  lastInsightTestResult = result;
}

/**
 * テストを 1 回実行する。LLM 呼び出しは atomize の 1 回だけ。
 * どこにも保存しない: snapshot は同梱定数から組み立て、結果は返すだけ。
 */
export async function runInsightModelTest(
  locale: string,
  model?: string,
  signal?: AbortSignal,
): Promise<InsightTestResult> {
  const claims = getInsightTestClaims(locale);
  const snapshots: ClaimSnapshot[] = claims.map((c) => ({
    id: c.id,
    title: c.title,
    bodyPreview: c.body,
    level: undefined,
    relatedClaims: [],
    sourceSummaryPreviews: [],
    atomType: undefined,
  }));
  const res = await atomizeConcepts(snapshots, locale, {
    ...(model ? { model } : {}),
    ...(signal ? { signal } : {}),
  });
  const idToNumber = new Map(claims.map((c, i) => [c.id, i + 1]));
  const candidates: InsightTestCandidate[] = res.atoms.map((a) => ({
    title: a.title,
    body: a.body,
    sourceTitles: a.derivedFromConceptTitles,
    sourceNumbers: a.derivedFromClaims
      .map((id) => idToNumber.get(id))
      .filter((n): n is number => n !== undefined),
    restatement: restatementScore(a.title, claims),
    atomType: a.atomType,
  }));
  const result: InsightTestResult = { candidates, model: res.model };
  setLastInsightTestResult(result);
  return result;
}
