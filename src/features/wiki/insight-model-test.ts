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
//   - 【構造を仕込む】テスト知見には畳める構造を意図的に入れてある:
//       (1)(2) 時間×温度のトレードオフ / (3)(4) 構造の成熟には適正範囲がある /
//       (5) 単独でも可搬な工程→構造→性質 / (6) 畳めない一回性の事実（ノイズ耐性の確認）。
//     能力のあるモデルはこれらを折り畳んだ抽象を返し、力不足のモデルは知見の言い換えを
//     知見と同数返すか、空リストを返す。

import type { ClaimSnapshot } from "../../server/services/wiki-types";
import { atomizeConcepts, type AtomCandidate } from "./wiki-service";
import { tokenize, jaccard } from "./sampling";

export type InsightTestClaim = { id: string; title: string; body: string };

/** ユーザーデータと衝突しない・見れば由来が分かる ID プレフィックス */
export const INSIGHT_TEST_ID_PREFIX = "insight-model-test-";

const CLAIMS_JA: InsightTestClaim[] = [
  {
    id: `${INSIGHT_TEST_ID_PREFIX}1`,
    title: "低温で長時間発酵させた生地は香りが深くなる",
    body: "冷蔵庫で一晩（8〜12 時間）発酵させたパン生地は、常温 1 時間で発酵させた生地より香りの成分が増え、味に複雑さが出た。",
  },
  {
    id: `${INSIGHT_TEST_ID_PREFIX}2`,
    title: "高温で急がせた発酵は気泡を粗くする",
    body: "30 度を超える場所で 40 分の急速発酵をした生地は、気泡が不揃いに大きくなり、焼き上がりのきめが粗くなった。",
  },
  {
    id: `${INSIGHT_TEST_ID_PREFIX}3`,
    title: "こねが足りない生地は気泡を保持できない",
    body: "グルテンの膜が十分に育っていない生地は、発酵で生まれたガスを抱えきれず、焼き上がりが平たく詰まった。",
  },
  {
    id: `${INSIGHT_TEST_ID_PREFIX}4`,
    title: "発酵を進めすぎた生地は焼成中に潰れる",
    body: "過発酵の生地は骨格が弱り、オーブンの熱でいったん持ち上がったあとに沈んで、目の詰まった層ができた。",
  },
  {
    id: `${INSIGHT_TEST_ID_PREFIX}5`,
    title: "同じ配合でも捏ね方で食感が変わる",
    body: "材料と分量がまったく同じでも、捏ねる強さと時間を変えると、しっとりからふわふわまで食感が別物になった。",
  },
  {
    id: `${INSIGHT_TEST_ID_PREFIX}6`,
    title: "今日開けた粉は吸水が多かった",
    body: "新しく開けた袋の粉は、いつもの加水率だと生地がかたく、水を 15 グラム足してちょうどよくなった。",
  },
];

const CLAIMS_EN: InsightTestClaim[] = [
  {
    id: `${INSIGHT_TEST_ID_PREFIX}1`,
    title: "Slow, cold fermentation deepens the aroma of dough",
    body: "Bread dough fermented overnight in the fridge (8–12 hours) developed more aroma compounds and a more complex taste than dough proofed for one hour at room temperature.",
  },
  {
    id: `${INSIGHT_TEST_ID_PREFIX}2`,
    title: "Rushed, warm fermentation makes the crumb coarse",
    body: "Dough proofed fast for 40 minutes above 30°C developed unevenly large bubbles and a coarse crumb after baking.",
  },
  {
    id: `${INSIGHT_TEST_ID_PREFIX}3`,
    title: "Under-kneaded dough cannot hold its gas",
    body: "Dough whose gluten film had not developed enough could not retain the gas produced during fermentation, and the loaf came out flat and dense.",
  },
  {
    id: `${INSIGHT_TEST_ID_PREFIX}4`,
    title: "Over-proofed dough collapses during baking",
    body: "Dough left to ferment too long lost its structural strength; it rose briefly in the oven's heat and then sank, leaving a dense layer.",
  },
  {
    id: `${INSIGHT_TEST_ID_PREFIX}5`,
    title: "The same recipe gives a different texture depending on kneading",
    body: "With identical ingredients and amounts, changing only the strength and duration of kneading turned the texture from moist to fluffy — practically a different bread.",
  },
  {
    id: `${INSIGHT_TEST_ID_PREFIX}6`,
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
    title: "時間をかけた変化は質を深め、急がせた変化は構造を粗くする",
    body: "同じ工程でも、ゆっくり進めると狙った性質が育ち、急がせると内部の構造が乱れる。速度は結果の量ではなく質を変える。",
    foldsClaimNumbers: [1, 2],
  },
  {
    title: "内部の骨組みには、育ち不足でも育ちすぎでも崩れる適正な範囲がある",
    body: "構造を支える骨組みは、足りなければ持ちこたえられず、進みすぎれば自壊する。良い状態は両端の間の帯にある。",
    foldsClaimNumbers: [3, 4],
  },
  {
    title: "同じ材料でも、工程が生んだ内部構造が仕上がりを決める",
    body: "何でできているかが同じでも、どう作られたかで内部の構造が変わり、最終的な性質はその構造が決める。",
    foldsClaimNumbers: [5],
  },
];

const REFERENCE_EN: InsightTestReference[] = [
  {
    title: "Slow change deepens quality; rushed change coarsens structure",
    body: "The same process grows the desired property when given time, and disorders the internal structure when rushed. Speed changes the quality of the outcome, not just its amount.",
    foldsClaimNumbers: [1, 2],
  },
  {
    title: "An internal framework has a viable range — too little or too much development both collapse it",
    body: "A supporting structure fails when underdeveloped and destroys itself when overdeveloped. The good state lives in the band between the extremes.",
    foldsClaimNumbers: [3, 4],
  },
  {
    title: "With identical ingredients, the structure created by the process decides the outcome",
    body: "Even when the components are the same, how the thing was made changes its internal structure — and that structure determines the final properties.",
    foldsClaimNumbers: [5],
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
  /** 元知見との最大トークン重なり（0..1）。しきい値超えで「言い換えの可能性」バッジ */
  restatement: number;
  atomType?: AtomCandidate["atomType"];
};

export type InsightTestResult = {
  candidates: InsightTestCandidate[];
  /** 実際に使われたモデル（サーバー解決後） */
  model?: string;
};

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
  const candidates: InsightTestCandidate[] = res.atoms.map((a) => ({
    title: a.title,
    body: a.body,
    sourceTitles: a.derivedFromConceptTitles,
    restatement: restatementScore(a.title, claims),
    atomType: a.atomType,
  }));
  return { candidates, model: res.model };
}
