// モデルの割り当て枠ごとに「どの大きさのモデルが向くか」の目安。
//
// 2026-11-07 の測定（manual/evaluations/model-tiers-by-feature.md）から作った。
// 5 つのモデル（上位のクラウド: Claude Opus 5・Copilot の gpt-5.6-luna／オープンな大型: gpt-oss-120b／
// このパソコン: qwen3.6-35b-a3b（30B 級）・qwen3.5-9b（10B 級））で、
// 各枠が受け持つ機能を同じ入力で動かし、出典と照らして採点した結果を、大きさの区分に畳んである。
//
// 個別のモデル名や提供者は出さない（おすすめで特定の会社を推さない。providers の方針と同じ）。
// 区分の中でも差はある（世界照合では luna が 16 件中 7 件を判定できず、Opus 5 は 15/16）ので、断定でなく「目安」として出す。
// 測り直したら、ここと検証の記録のページを同じ PR で直す。

/** 割り当て枠 */
export type ModelSlot = "default" | "chat" | "insight" | "grounding" | "meeting";

/** モデルの大きさの区分 */
export type ModelClass = "frontier" | "openLarge" | "local30b" | "local10b";

/** 向き不向き */
export type FitLevel = "good" | "partial" | "poor";

export const MODEL_CLASSES: readonly ModelClass[] = ["frontier", "openLarge", "local30b", "local10b"];

export const MODEL_FIT: Record<ModelSlot, Record<ModelClass, FitLevel>> = {
  // 手順の抽出・計画づくり・計画の根拠照合まで抱える。オープンな大型モデルは
  // ナレッジ化と翻訳は足りるが、手順のつながり（F1 0.31）と計画（0/2）で崩れた。
  // このパソコンの 30B 級は動くが 1 件 1〜3 分かかり、計画で崩れる。10B 級は遅く失敗も多い
  default: { frontier: "good", openLarge: "partial", local30b: "partial", local10b: "poor" },
  // 回答・点検・出典照合・題付けは、品質ならどの大きさでもほぼ足りた（10B 級も回答 10/10）。
  // 10B 級は題付け約 3 分・出典照合約 4 分と遅いので条件つき
  chat: { frontier: "good", openLarge: "good", local30b: "good", local10b: "partial" },
  // 知見の抽出は、上位のクラウド 4/4 に対し、オープンな大型 0/4・30B 級 2/4・10B 級は 4 件とも 15 分で終わらず
  insight: { frontier: "good", openLarge: "poor", local30b: "partial", local10b: "poor" },
  // 一般知識での照合。30B 級は Opus 5 と同じ 15/16。luna と gpt-oss-120b は 16 件中 7 件を「判定できない」にした
  grounding: { frontier: "good", openLarge: "partial", local30b: "good", local10b: "partial" },
  // 清書は発言を書き換えない忠実さが要る。オープンな大型と 30B 級は清書 0/3（語の置き換え・付け足し）、
  // 10B 級はほとんど直せないか時間切れ
  meeting: { frontier: "good", openLarge: "poor", local30b: "poor", local10b: "poor" },
};

/** 検証の記録のページ（設定画面から開く） */
export function modelFitEvaluationUrl(locale: string): string {
  return `https://kumagallium.github.io/Graphium/manual/${locale === "ja" ? "ja/" : ""}evaluations/model-tiers-by-feature`;
}
