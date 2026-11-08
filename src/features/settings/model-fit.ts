// モデルの割り当て枠ごとに「どの大きさのモデルが向くか」の目安。
//
// 2026-11-07 の測定（manual/evaluations/model-tiers-by-feature.md）から作った。
// 5 つのモデル（上位のクラウド: Claude Opus 5・Copilot の gpt-5.6-luna／オープンな大型: gpt-oss-120b／
// このパソコン: qwen3.6-35b-a3b（30B 級）・qwen3.5-9b（10B 級））で、
// 各枠が受け持つ機能を同じ入力で動かし、出典と照らして採点した結果を、大きさの区分に畳んである。
//
// 個別のモデル名や提供者は出さない（おすすめで特定の会社を推さない。providers の方針と同じ）。
// 区分の中でも差はある（世界照合では luna が 16 件中 7 件を判定できず、Opus 5 は 15/16）ので、断定でなく「目安」として出す。
// 世界照合は v0.125 から専用の選択欄を外し、デフォルト（軽い処理）の段で動く。
// 測り直したら、ここと検証の記録のページを同じ PR で直す。

/** 割り当て枠。default・standard・precise が難しさ別の 3 段、chat・meeting は機能ごとの上書き */
export type ModelSlot = "default" | "standard" | "precise" | "chat" | "meeting";

/** モデルの大きさの区分 */
export type ModelClass = "frontier" | "openLarge" | "local30b" | "local10b";

/** 向き不向き */
export type FitLevel = "good" | "partial" | "poor";

export const MODEL_CLASSES: readonly ModelClass[] = ["frontier", "openLarge", "local30b", "local10b"];

export const MODEL_FIT: Record<ModelSlot, Record<ModelClass, FitLevel>> = {
  // 軽い処理（チャットの回答・点検・出典照合・題付け・トピックの統合・世界照合）。世界照合は 30B 級が Opus 5 と同じ 15/16。品質ならどの大きさでもほぼ足りた
  // （10B 級も回答 10/10）。10B 級は題付け約 3 分・出典照合約 4 分と遅いので条件つき
  default: { frontier: "good", openLarge: "good", local30b: "good", local10b: "partial" },
  // 標準の処理（ナレッジ化・翻訳・トピックの振り分けと改訂）。オープンな大型はナレッジ化 4/5・翻訳 3/4・
  // トピック 5/8。30B 級はナレッジ化 3/5・トピック 4/8 で 1 件 1〜3 分。10B 級はナレッジ化 2/5・翻訳 1/4
  standard: { frontier: "good", openLarge: "good", local30b: "partial", local10b: "poor" },
  // 精密な処理（論文からの手順・名寄せ・計画づくりと根拠照合・洞察の抽出・清書）。オープンな大型は
  // 手順のつながり F1 0.31・計画 0/2・洞察 0/4・清書 0/3。30B 級も計画 0/2・清書 0/3。10B 級は時間切れが多い
  precise: { frontier: "good", openLarge: "poor", local30b: "poor", local10b: "poor" },
  // チャットの上書き。チャットの回答は軽い処理と同じ結果
  chat: { frontier: "good", openLarge: "good", local30b: "good", local10b: "partial" },
  // 清書は発言を書き換えない忠実さが要る。オープンな大型と 30B 級は清書 0/3（語の置き換え・付け足し）、
  // 10B 級はほとんど直せないか時間切れ
  meeting: { frontier: "good", openLarge: "poor", local30b: "poor", local10b: "poor" },
};

/** 検証の記録のページ（設定画面から開く） */
export function modelFitEvaluationUrl(locale: string): string {
  return `https://kumagallium.github.io/Graphium/manual/${locale === "ja" ? "ja/" : ""}evaluations/model-tiers-by-feature`;
}
