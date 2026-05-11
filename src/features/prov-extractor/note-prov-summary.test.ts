import { describe, it, expect } from "vitest";
import { summarizeNoteProv, parseParameterText } from "./note-prov-summary";
import type { GraphiumDocument, GraphiumPage } from "../../lib/document-types";

// ──────────────────────────────────────────────
// テスト用ドキュメント組み立てヘルパー
// ──────────────────────────────────────────────

function makeDoc(pages: Partial<GraphiumPage>[], title = "test-note"): GraphiumDocument {
  const filledPages: GraphiumPage[] = pages.map((p, i) => ({
    id: p.id ?? `page-${i}`,
    title: p.title ?? title,
    blocks: p.blocks ?? [],
    labels: p.labels ?? {},
    provLinks: p.provLinks ?? [],
    knowledgeLinks: p.knowledgeLinks ?? [],
    highlights: p.highlights,
    mediaInlineLabels: p.mediaInlineLabels,
  }));
  return {
    version: 5,
    title,
    pages: filledPages,
    createdAt: "2026-05-11T00:00:00Z",
    modifiedAt: "2026-05-11T00:00:00Z",
  };
}

// ──────────────────────────────────────────────
// シナリオ 1: ラベル完備（カレー実験を踏襲）
// ──────────────────────────────────────────────

const fullBlocks = [
  {
    id: "h2-cut",
    type: "heading",
    props: { level: 2 },
    content: [{ type: "text", text: "1. 具材を切る" }],
    children: [],
  },
  {
    id: "used-vegs",
    type: "paragraph",
    content: [{ type: "text", text: "にんじん、じゃがいも" }],
    children: [],
  },
  {
    id: "h2-fry",
    type: "heading",
    props: { level: 2 },
    content: [{ type: "text", text: "2. 炒める" }],
    children: [],
  },
  {
    id: "tool-pan",
    type: "paragraph",
    content: [{ type: "text", text: "フライパン" }],
    children: [],
  },
  {
    id: "cond-fire",
    type: "paragraph",
    content: [{ type: "text", text: "火力: 中火" }],
    children: [],
  },
  {
    id: "cond-time",
    type: "paragraph",
    content: [{ type: "text", text: "時間=5分" }],
    children: [],
  },
  {
    id: "result-curry",
    type: "paragraph",
    content: [{ type: "text", text: "カレー完成" }],
    children: [],
  },
];

const fullLabels: Record<string, string> = {
  "h2-cut": "procedure",
  "used-vegs": "material",
  "h2-fry": "procedure",
  "tool-pan": "tool",
  "cond-fire": "attribute",
  "cond-time": "attribute",
  "result-curry": "output",
};

describe("summarizeNoteProv: ラベル完備", () => {
  it("Activity / inputs / tools / outputs を正しく抽出する", () => {
    const doc = makeDoc([{ blocks: fullBlocks, labels: fullLabels }]);
    const summary = summarizeNoteProv(doc, { noteId: "note-full" });

    expect(summary.noteId).toBe("note-full");
    expect(summary.title).toBe("test-note");
    expect(summary.activities).toHaveLength(2);

    const cut = summary.activities.find((a) => a.label === "1. 具材を切る");
    expect(cut?.inputs).toEqual(["にんじん、じゃがいも"]);
    expect(cut?.tools).toEqual([]);

    const fry = summary.activities.find((a) => a.label === "2. 炒める");
    expect(fry?.tools).toEqual(["フライパン"]);
    expect(fry?.outputs).toEqual(["カレー完成"]);
  });

  it("[属性] を parameters として Activity に紐づけ、key/value に分離する", () => {
    const doc = makeDoc([{ blocks: fullBlocks, labels: fullLabels }]);
    const summary = summarizeNoteProv(doc);
    const fry = summary.activities.find((a) => a.label === "2. 炒める");
    expect(fry?.parameters).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: "火力", value: "中火" }),
        expect.objectContaining({ key: "時間", value: "5分" }),
      ]),
    );
  });
});

// ──────────────────────────────────────────────
// シナリオ 2: ラベル部分欠損（procedure だけ / result だけ）
// ──────────────────────────────────────────────

describe("summarizeNoteProv: ラベル部分欠損", () => {
  it("procedure ラベルが無くても、result のみ拾える（top-level results として）", () => {
    const blocks = [
      {
        id: "p1",
        type: "paragraph",
        content: [{ type: "text", text: "ゼーベック係数 180μV/K" }],
        children: [],
      },
    ];
    const labels: Record<string, string> = { p1: "output" };

    const summary = summarizeNoteProv(makeDoc([{ blocks, labels }]));
    expect(summary.activities).toHaveLength(0);
    expect(summary.results).toHaveLength(1);
    expect(summary.results[0]?.property).toBe("ゼーベック係数 180μV/K");
  });

  it("ラベル無し（生本文のみ）でも空のサマリを返してエラーで止まらない", () => {
    const blocks = [
      {
        id: "p1",
        type: "paragraph",
        content: [{ type: "text", text: "ただのメモ" }],
        children: [],
      },
    ];
    const summary = summarizeNoteProv(makeDoc([{ blocks, labels: {} }]));
    expect(summary.activities).toEqual([]);
    expect(summary.results).toEqual([]);
    expect(summary.plan).toBeUndefined();
  });

  it("attribute だけあっても落ちず、parameters が Activity 不在で出ない", () => {
    const blocks = [
      {
        id: "p1",
        type: "paragraph",
        content: [{ type: "text", text: "温度: 300K" }],
        children: [],
      },
    ];
    const labels: Record<string, string> = { p1: "attribute" };
    const summary = summarizeNoteProv(makeDoc([{ blocks, labels }]));
    expect(summary.activities).toEqual([]);
    expect(summary.results).toEqual([]);
  });
});

// ──────────────────────────────────────────────
// シナリオ 3: 構造化テーブル結果
// ──────────────────────────────────────────────

describe("summarizeNoteProv: 構造化テーブル", () => {
  it("結果テーブルの行ごとに property + attributes を抽出する", () => {
    const blocks = [
      {
        id: "tbl-result",
        type: "table",
        content: {
          rows: [
            { cells: [[{ type: "text", text: "property" }], [{ type: "text", text: "value" }], [{ type: "text", text: "method" }]] },
            { cells: [[{ type: "text", text: "ゼーベック係数" }], [{ type: "text", text: "180μV/K" }], [{ type: "text", text: "ZEM-3" }]] },
            { cells: [[{ type: "text", text: "相純度" }], [{ type: "text", text: "単相" }], [{ type: "text", text: "XRD" }]] },
          ],
        },
        children: [],
      },
    ];
    const labels: Record<string, string> = { "tbl-result": "output" };

    const summary = summarizeNoteProv(makeDoc([{ blocks, labels }]));
    expect(summary.results).toHaveLength(2);
    const seebeck = summary.results.find((r) => r.property === "ゼーベック係数");
    expect(seebeck?.attributes).toEqual({ value: "180μV/K", method: "ZEM-3" });
    const purity = summary.results.find((r) => r.property === "相純度");
    expect(purity?.attributes).toEqual({ value: "単相", method: "XRD" });
  });
});

// ──────────────────────────────────────────────
// シナリオ 4: plan phase の収集
// ──────────────────────────────────────────────

describe("summarizeNoteProv: plan phase", () => {
  it("plan phase 配下のインライン Entity を plan テキストに集約する", () => {
    const blocks = [
      {
        id: "h2-proc",
        type: "heading",
        props: { level: 2 },
        content: [{ type: "text", text: "実験" }],
        children: [],
      },
      {
        id: "h3-plan",
        type: "heading",
        props: { level: 3 },
        content: [{ type: "text", text: "計画" }],
        children: [],
      },
      {
        id: "p-plan",
        type: "paragraph",
        content: [
          {
            type: "text",
            text: "Al5Co2 を評価する",
            styles: { inlineMaterial: "ent-al5co2" },
          },
        ],
        children: [],
      },
    ];
    const labels: Record<string, string> = {
      "h2-proc": "procedure",
      "h3-plan": "plan",
    };
    const summary = summarizeNoteProv(makeDoc([{ blocks, labels }]));
    expect(summary.plan).toBeDefined();
    expect(summary.plan).toContain("Al5Co2 を評価する");
  });
});

// ──────────────────────────────────────────────
// parseParameterText のユニット
// ──────────────────────────────────────────────

describe("parseParameterText", () => {
  it("半角コロンで分離する", () => {
    expect(parseParameterText("回転数: 300rpm")).toEqual({
      key: "回転数",
      value: "300rpm",
      raw: "回転数: 300rpm",
    });
  });

  it("全角コロンで分離する", () => {
    expect(parseParameterText("温度:850°C")).toMatchObject({ key: "温度", value: "850°C" });
    expect(parseParameterText("圧力:50MPa")).toMatchObject({ key: "圧力", value: "50MPa" });
    expect(parseParameterText("時間：3h")).toMatchObject({ key: "時間", value: "3h" });
  });

  it("= 記号で分離する", () => {
    expect(parseParameterText("時間=5min")).toMatchObject({ key: "時間", value: "5min" });
  });

  it("区切りがなければ value にそのまま入る", () => {
    expect(parseParameterText("中火")).toEqual({ value: "中火", raw: "中火" });
    expect(parseParameterText("  spacy  ")).toEqual({ value: "spacy", raw: "  spacy  " });
  });

  it("複数区切りがある場合は最初に出現したものを採用", () => {
    expect(parseParameterText("ratio: 1:2")).toMatchObject({ key: "ratio", value: "1:2" });
  });

  it("空キー / 空値は失敗扱い", () => {
    expect(parseParameterText(": 300rpm")).toEqual({ value: ": 300rpm", raw: ": 300rpm" });
    expect(parseParameterText("回転数:")).toEqual({ value: "回転数:", raw: "回転数:" });
  });
});
