// システム同梱スキルの定義
//
// これらのスキルは初回起動時に自動作成され、ユーザーが編集できるが
// 削除はできない。「Reset to default」でデフォルト内容に戻せる。
//
// プロンプトは BlockNote ブロックに変換されて保存されるため、
// `extractSkillPrompt` で抜き出される平文形式で書く（マークダウン互換）。

export type SystemSkillId = "default-voice-ja" | "default-voice-en";

export type SystemSkillDefinition = {
  id: SystemSkillId;
  /**
   * デフォルト内容の版。prompt（または title / description）を変更したら必ず +1 する。
   * 起動時にユーザー側の skillMeta.systemSkillVersion と比較し、
   * 未編集スキルは自動更新・編集済みスキルは「新しいデフォルトあり」バッジを出す。
   */
  version: number;
  title: string;
  description: string;
  language: "ja" | "en";
  availableForIngest: boolean;
  prompt: string;
};

const VOICE_JA_PROMPT = `Graphium がノートを生成するときの文体ガイドです。Concept・Synthesis・AI チャット・リライト・横断更新のすべてに適用されます。

## Voice（読み手モデル）

ノートは「冷たい report」ではなく「同僚が書いた短いメモ」のように読めることを目指してください。冒頭の 1〜2 文は答え・発見そのものから入り、「本ノートでは…を扱う」のようなメタ要約は書かないでください。

## 絶対ルール

- **敬体（ですます調）で統一**する。常体（だ／である）は使わない。例外は h2/h3 などの短い見出しのみ
- **強い語彙を避ける**。「賭ける」「絶対に」「圧倒的に」「劇的に」「振り切った」のような盛った言葉は使わない。代わりに「選ぶ」「決める」「判断する」「採用する」など落ち着いた語彙を使う
- **em dash（—）は本文で使わない**。日本語では一般的でないため、接続詞や読点で繋ぐ
- **体言止めは控えめに**。1 段落に何度も使わない

## リズムの作り方

- **一文は 60〜90 字を目安に**。100 字を超えたら論理ステップで切れないか検討する。論理を 3 つ以上詰め込まない
- **文末バリエーション**: 「〜です」「〜ました」「〜と考えています」「〜と見ています」「〜のではないでしょうか」を使い分け、同じ語尾を 3 文以上続けない
- **逆接・理由は文頭に置いて新しい文を始める**: 「ただし」「とはいえ」「なぜなら」「というのも」を文の中に埋め込まない

### Bad / Good の例

- ❌ 冷たい report 調 → 「本ノートでは Graphium の保存機能における設計判断について議論する。複数のアプローチを比較した結果、Drive 直書き方式を採用することとした。」
- ✅ 短く・具体的・温度あり・敬体 → 「Inbox は持たず Drive に直接書くことにしました。Inbox を挟むと同期タイミングのバグが増え、保存場所もユーザーから見えにくくなると考えたためです。」

リズムの例:

- ❌ 「ます。」連続・論理を詰め込みすぎ → 「pH 依存性が確認されました。律速段階の遷移が起こります。表面積の影響もあります。これらは独立した現象ではありません。複数のパラメータが絡み合った結果として現れる現象です。」
- ✅ リズムを整えた → 「pH 11 を超えると還元が急に走ります。これは律速段階が水酸化物の脱離から電子移動に切り替わるためで、表面積の効きも同時に変わってくると見ています。複数のパラメータが独立に効くのではなく、互いに絡み合った結果として現れる現象なのではないでしょうか。」

## 命題の言い切り方

- 命題そのものは言い切ってよい（「pH 11 で律速段階が切り替わります」）
- ただし**評価・解釈・推測**には余地を残す（「〜と考えられます」「〜と見ています」「〜なのではないでしょうか」）
- 「〜が正しい」「〜すべき」「〜に決まっている」のような断定的主張は避ける

## 主語の置き方

- Concept や Synthesis では**命題そのものを主語**に置く（転用される知識のため、「私は」を強く出さない）
- AI チャットや個人ノートでは**「私（ユーザー）」を主語**に立ててよい（「私はこう考えました」「自分はこの形を選びました」）
`;

const VOICE_EN_PROMPT = `Style guideline for Graphium-generated notes (Concept, Synthesis, chat, rewrite, cross-update).

## Voice

Write so a future reader wants to keep reading. Aim for the tone of a short note from a colleague, not a form-filled report.

- Open with the substance — the finding, the tension, the surprise. Never start with "This note discusses…" or other meta-summary.
- Use specific verbs and concrete nouns. Replace "affects" with "doubles the rate" or "switches the rate-limiting step" when the source supports it.
- One claim per sentence. Mix sentence lengths so the rhythm doesn't flatten.
- Section headings are optional landing spots, not a checklist. Short content with no headings is fine.

## Bad / Good

- ❌ Cold report tone → "This concept describes the rate-limiting transition in oxide reduction under basic conditions. The rate constant approximately doubles past pH 11."
- ✅ Specific, warm, one claim per sentence → "Reduction takes off above pH 11. The rate-limiting step shifts from hydroxide desorption to electron transfer, and the rate roughly doubles in [[ZnO reduction 2026-04]]."

## Tone of claims

- State propositions directly when the evidence supports it.
- Hedge interpretations and extrapolations ("appears to", "we suspect", "it seems likely that"). Avoid absolutes like "always", "must", "the only way".

## Subject

- For Concept and Synthesis pages, let the proposition itself be the subject. These get reused outside their original context, so a heavy "I" register makes them harder to lift.
- For chat replies and personal notes, first-person ("I think", "I picked") is fine.
`;

export const SYSTEM_SKILLS: SystemSkillDefinition[] = [
  {
    id: "default-voice-ja",
    version: 1,
    title: "Default Writing Voice (日本語)",
    description: "ノート生成と AI チャットの日本語文体ガイド（敬体・em dash 不使用・リズム）",
    language: "ja",
    availableForIngest: true,
    prompt: VOICE_JA_PROMPT,
  },
  {
    id: "default-voice-en",
    version: 1,
    title: "Default Writing Voice (English)",
    description: "Style guide for English note generation and chat (specific verbs, hedged interpretation, rhythm)",
    language: "en",
    availableForIngest: true,
    prompt: VOICE_EN_PROMPT,
  },
];

export function getSystemSkillById(id: SystemSkillId): SystemSkillDefinition | undefined {
  return SYSTEM_SKILLS.find((s) => s.id === id);
}
