// テンプレート定義
//
// build() の戻り値:
//   blocks: BlockNote ブロックの配列
//   labels: 挿入後にコンテキストラベルを付与する [path, label] のリスト
//   provLinks: 挿入後に PROV リンクを張る [sourcePath → targetPath] のリスト
//
// path: ルートからのインデックス配列（例: [3, 0, 1] = blocks[3].children[0].children[1]）

import type { CoreLabel } from "../context-label/labels";

export type TemplateSource = "official" | "user";

export type TemplateBuildResult = {
  blocks: any[];
  /** 挿入後にコンテキストラベルを付与するブロック */
  labels: { path: number[]; label: CoreLabel }[];
  /** 挿入後に張る PROV リンク（前手順紐付けなど） */
  provLinks?: {
    sourcePath: number[];
    targetPath: number[];
    type: "informed_by";
  }[];
};

export type TemplateDef = {
  id: string;
  source: TemplateSource;
  titleKey: string;
  descKey: string;
  /** 検索・カテゴリ表示用のタグキー */
  tagKeys?: string[];
  /** テンプレート適用後にカーソルを置くブロックのパス */
  focusPath: number[];
  build: (t: (key: string) => string) => TemplateBuildResult;
};

// ── 計画テンプレート ─────────────────────────────────────────
//
// # （計画タイトル）
// ## 背景・目的         (paragraph)
// ## 試料と条件         (index table: サンプル名 / 組成 / 温度 / 時間 / 実験ノート)
// ## 予想される結果      (paragraph)
//
const planTemplate: TemplateDef = {
  id: "plan",
  source: "official",
  titleKey: "template.plan.title",
  descKey: "template.plan.desc",
  tagKeys: ["template.tag.plan", "template.tag.indexTable"],
  focusPath: [0],
  build: (t) => ({
    blocks: [
      // [0] H1 計画タイトル
      {
        type: "heading",
        props: { level: 1 },
        content: [{ type: "text", text: t("template.plan.h1Placeholder"), styles: {} }],
        children: [],
      },
      // [1] H2 背景・目的
      {
        type: "heading",
        props: { level: 2 },
        content: [{ type: "text", text: t("template.plan.backgroundHeading"), styles: {} }],
        children: [],
      },
      // [2] paragraph 動機
      {
        type: "paragraph",
        content: [{ type: "text", text: "", styles: {} }],
        children: [],
      },
      // [3] H2 試料と条件
      {
        type: "heading",
        props: { level: 2 },
        content: [{ type: "text", text: t("template.plan.samplesHeading"), styles: {} }],
        children: [],
      },
      // [4] インデックステーブル: 対象（=ノート名） / 種類 / 条件1 / 条件2
      // ※ 1列目のテキストがノート名になり、行頭ボタンで @ リンクに変換される
      {
        type: "table",
        content: {
          type: "tableContent",
          rows: [
            {
              cells: [
                [{ type: "text", text: t("template.plan.colSampleName"), styles: {} }],
                [{ type: "text", text: t("template.plan.colComposition"), styles: {} }],
                [{ type: "text", text: t("template.plan.colTemperature"), styles: {} }],
                [{ type: "text", text: t("template.plan.colDuration"), styles: {} }],
              ],
            },
            {
              cells: [
                [{ type: "text", text: "S-01", styles: {} }],
                [{ type: "text", text: "", styles: {} }],
                [{ type: "text", text: "", styles: {} }],
                [{ type: "text", text: "", styles: {} }],
              ],
            },
            {
              cells: [
                [{ type: "text", text: "S-02", styles: {} }],
                [{ type: "text", text: "", styles: {} }],
                [{ type: "text", text: "", styles: {} }],
                [{ type: "text", text: "", styles: {} }],
              ],
            },
          ],
        },
      },
      // [5] H2 予想される結果
      {
        type: "heading",
        props: { level: 2 },
        content: [{ type: "text", text: t("template.plan.hypothesisHeading"), styles: {} }],
        children: [],
      },
      // [6] paragraph 仮説
      {
        type: "paragraph",
        content: [{ type: "text", text: "", styles: {} }],
        children: [],
      },
    ],
    labels: [],
  }),
};

// ── 実験テンプレート ─────────────────────────────────────────
//
// # （試料名: S-01 など）
// ## Overview                   (paragraph)
// ## [[label:procedure]] 手順1   (Activity)
//   ### 計画                    (no role)
//     "<inlineMaterial>入力</> を <inlineTool>道具</> で <inlineAttribute>条件</> のもとに行う。" (paragraph)
//   ### 結果・考察               (no role)
//     "<inlineOutput>結果</> が得られた。" (paragraph)
// ## [[label:procedure]] 手順2   (Activity, informed_by 手順1)
//   ... 同様
//
// Phase E (2026-04-30): block-level material/tool/attribute/output ラベルは廃止し、
// インラインハイライト（BlockNote inline style）に移行。procedure ラベルだけ block-level
// として残る（H2 見出し = Activity）。
//
// 2026-05-07: 1 役割 = 1 placeholder bullet ではなく、1 step = 1 散文 paragraph に集約。
// 接続詞を i18n から差し込み、入力 / 道具・ツール / 条件・属性 / 結果が文中の
// インラインハイライトとして並ぶ形にする。
//
// 注: BlockNote のデフォルト heading は level 1-3 のみサポート。procedure scope は
//     level 2 を使う（prov-generator の仕様）。

// 各 placeholder paragraph テキスト全体に当てるインライン style 用の entityId 発番
function makeStepEntityId(role: "material" | "tool" | "attribute" | "output", step: number): string {
  // step ごとに異なる id を返すため step インデックスを seed に含める
  const rand = Math.random().toString(36).slice(2, 8);
  return `ent_${role}_step${step}_${rand}`;
}
const experimentTemplate: TemplateDef = {
  id: "experiment",
  source: "official",
  titleKey: "template.experiment.title",
  descKey: "template.experiment.desc",
  tagKeys: ["template.tag.run", "template.tag.prov"],
  focusPath: [0],
  build: (t) => {
    // 1 段落の中に複数の inline-highlighted span を並べる散文 placeholder を作る。
    // segments: ["前置きテキスト", { role, text }, "次の接続詞", { role, text }, ...]
    type Segment = string | { role: "material" | "tool" | "attribute" | "output"; text: string };
    const inlineSentence = (step: number, segments: Segment[]) => {
      const content = segments
        .filter((seg) => (typeof seg === "string" ? seg.length > 0 : seg.text.length > 0))
        .map((seg) => {
          if (typeof seg === "string") {
            return { type: "text", text: seg, styles: {} };
          }
          const styleKey = `inline${seg.role[0].toUpperCase()}${seg.role.slice(1)}`;
          return {
            type: "text",
            text: seg.text,
            styles: { [styleKey]: makeStepEntityId(seg.role, step) },
          };
        });
      return {
        type: "paragraph" as const,
        content,
        children: [],
      };
    };

    // Step n を生成するヘルパー（step は 1-indexed）
    // 5 ブロック構成: H2 / H3 計画 / 計画散文 / H3 結果 / 結果散文
    const buildStep = (stepLabel: string, step: number) => [
      // [0] H2 手順 (procedure)
      {
        type: "heading",
        props: { level: 2 },
        content: [{ type: "text", text: stepLabel, styles: {} }],
        children: [],
      },
      // [1] H3 計画
      {
        type: "heading",
        props: { level: 3 },
        content: [{ type: "text", text: t("template.experiment.planHeading"), styles: {} }],
        children: [],
      },
      // [2] 計画散文（input + tool + attribute の inline highlight）
      inlineSentence(step, [
        t("template.experiment.planSentence.beforeMaterial"),
        { role: "material", text: t("template.experiment.materialPlaceholder") },
        t("template.experiment.planSentence.beforeTool"),
        { role: "tool", text: t("template.experiment.toolPlaceholder") },
        t("template.experiment.planSentence.beforeAttribute"),
        { role: "attribute", text: t("template.experiment.attributePlaceholder") },
        t("template.experiment.planSentence.tail"),
      ]),
      // [3] H3 結果・考察
      {
        type: "heading",
        props: { level: 3 },
        content: [{ type: "text", text: t("template.experiment.resultHeading"), styles: {} }],
        children: [],
      },
      // [4] 結果散文（output の inline highlight）
      inlineSentence(step, [
        t("template.experiment.resultSentence.beforeOutput"),
        { role: "output", text: t("template.experiment.resultPlaceholder") },
        t("template.experiment.resultSentence.tail"),
      ]),
    ];

    // フラット展開: 各ステップは 5 ブロック
    // [0] H1 試料名
    // [1] H2 Overview
    // [2] paragraph (overview body)
    // [3..7]   step 1 (5 blocks)
    // [8..12]  step 2 (5 blocks)
    const step1 = buildStep(t("template.experiment.step1"), 1);
    const step2 = buildStep(t("template.experiment.step2"), 2);

    return {
      blocks: [
        // [0] H1 タイトル（試料名プレースホルダ）
        {
          type: "heading",
          props: { level: 1 },
          content: [{ type: "text", text: t("template.experiment.h1Placeholder"), styles: {} }],
          children: [],
        },
        // [1] H2 Overview
        {
          type: "heading",
          props: { level: 2 },
          content: [{ type: "text", text: t("template.experiment.overviewHeading"), styles: {} }],
          children: [],
        },
        // [2] paragraph overview 本文
        {
          type: "paragraph",
          content: [{ type: "text", text: t("template.experiment.overviewPlaceholder"), styles: {} }],
          children: [],
        },
        ...step1,
        ...step2,
      ],
      labels: [
        // step 1: procedure (H2) と plan/result phase (H3)
        // Phase D-2: H3 plan 配下の Entity は graphium:phase=plan メタ + ノード ID 末尾に _plan が付く。
        // 同 entityId が H3 result 配下に出ると execution Entity との specializationOf エッジが張られる
        // → 「計画値 vs 実測値」の対比が PROV グラフ上で可視化できる。
        { path: [3], label: "procedure" },
        { path: [4], label: "plan" },
        { path: [6], label: "result" },
        // step 2
        { path: [8], label: "procedure" },
        { path: [9], label: "plan" },
        { path: [11], label: "result" },
      ],
      provLinks: [
        // step 2 → step 1 (前手順リンク)
        { sourcePath: [8], targetPath: [3], type: "informed_by" },
      ],
    };
  },
};

// ── 公式テンプレート登録 ──
const OFFICIAL_TEMPLATES: TemplateDef[] = [planTemplate, experimentTemplate];

// ユーザー定義テンプレート（将来拡張ポイント）
let _userTemplates: TemplateDef[] = [];

export function registerUserTemplate(tmpl: TemplateDef) {
  _userTemplates = [..._userTemplates.filter((t) => t.id !== tmpl.id), tmpl];
}

export function getAllTemplates(): TemplateDef[] {
  return [...OFFICIAL_TEMPLATES, ..._userTemplates];
}
