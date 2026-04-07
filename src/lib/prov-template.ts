// PROV-DM の全機能を示すテンプレート
// 手順・使用したもの・属性・結果・前手順リンクを含む

import type { ProvNoteDocument } from "./google-drive";

// ブロック ID（ラベル・リンクとの紐付け用）
const ids = {
  title: "tpl-title",
  step1: "tpl-step1",
  used1a: "tpl-used1a",
  used1b: "tpl-used1b",
  result1: "tpl-result1",
  step2: "tpl-step2",
  cond2a: "tpl-cond2a",
  cond2b: "tpl-cond2b",
  step3: "tpl-step3",
  result3: "tpl-result3",
};

// 初期ブロック
const blocks = [
  {
    id: ids.title,
    type: "heading",
    props: { level: 1 },
    content: [{ type: "text", text: "Cu粉末アニール実験", styles: {} }],
  },
  {
    id: ids.step1,
    type: "heading",
    props: { level: 2 },
    content: [{ type: "text", text: "1. 封入する", styles: {} }],
  },
  {
    id: ids.used1a,
    type: "paragraph",
    content: [{ type: "text", text: "Cu粉末 1g", styles: {} }],
  },
  {
    id: ids.used1b,
    type: "paragraph",
    content: [{ type: "text", text: "シリカ管", styles: {} }],
  },
  {
    id: ids.result1,
    type: "paragraph",
    content: [{ type: "text", text: "封入されたCu粉末", styles: {} }],
  },
  {
    id: ids.step2,
    type: "heading",
    props: { level: 2 },
    content: [{ type: "text", text: "2. アニールする", styles: {} }],
  },
  {
    id: ids.cond2a,
    type: "paragraph",
    content: [{ type: "text", text: "昇温速度: 5℃/min", styles: {} }],
  },
  {
    id: ids.cond2b,
    type: "paragraph",
    content: [{ type: "text", text: "冷却: 炉冷", styles: {} }],
  },
  {
    id: ids.step3,
    type: "heading",
    props: { level: 2 },
    content: [{ type: "text", text: "3. 評価する", styles: {} }],
  },
  {
    id: ids.result3,
    type: "paragraph",
    content: [{ type: "text", text: "XRD測定により相同定を行う。", styles: {} }],
  },
];

// 各ブロックに付けるラベル
const labels: Record<string, string> = {
  [ids.step1]: "[手順]",
  [ids.used1a]: "[使用したもの]",
  [ids.used1b]: "[使用したもの]",
  [ids.result1]: "[結果]",
  [ids.step2]: "[手順]",
  [ids.cond2a]: "[属性]",
  [ids.cond2b]: "[属性]",
  [ids.step3]: "[手順]",
  [ids.result3]: "[結果]",
};

// 前手順リンク（PROV 層）
const provLinks = [
  {
    id: "tpl-link-1",
    sourceBlockId: ids.step2,
    targetBlockId: ids.step1,
    type: "informed_by" as const,
    layer: "prov" as const,
    createdBy: "system" as const,
  },
  {
    id: "tpl-link-2",
    sourceBlockId: ids.step3,
    targetBlockId: ids.step2,
    type: "informed_by" as const,
    layer: "prov" as const,
    createdBy: "system" as const,
  },
];

// テンプレートドキュメント
export const PROV_TEMPLATE: ProvNoteDocument = {
  version: 2,
  title: "Cu粉末アニール実験",
  pages: [
    {
      id: "tpl-page-main",
      title: "Cu粉末アニール実験",
      blocks,
      labels,
      provLinks,
      knowledgeLinks: [],
    },
  ],
  createdAt: new Date().toISOString(),
  modifiedAt: new Date().toISOString(),
};
