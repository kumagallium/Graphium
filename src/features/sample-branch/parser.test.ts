import { describe, it, expect } from "vitest";
import { parseSampleTable, matchSampleId, validateSampleIds } from "./parser";
import { expandSampleBranch, propagateBranches } from "./expander";

// テスト用テーブルブロック（Cu粉末アニール実験の試料テーブル）
const sampleTableBlock = {
  id: "block-sample-1",
  type: "table",
  content: {
    type: "tableContent",
    rows: [
      {
        cells: [
          [{ type: "text", text: "試料名" }],
          [{ type: "text", text: "温度" }],
          [{ type: "text", text: "時間" }],
        ],
      },
      {
        cells: [
          [{ type: "text", text: "sample_A" }],
          [{ type: "text", text: "600℃" }],
          [{ type: "text", text: "24h" }],
        ],
      },
      {
        cells: [
          [{ type: "text", text: "sample_B" }],
          [{ type: "text", text: "700℃" }],
          [{ type: "text", text: "24h" }],
        ],
      },
      {
        cells: [
          [{ type: "text", text: "sample_C" }],
          [{ type: "text", text: "800℃" }],
          [{ type: "text", text: "24h" }],
        ],
      },
    ],
  },
};

// 結果テーブル
const resultTableBlock = {
  id: "block-result-1",
  type: "table",
  content: {
    type: "tableContent",
    rows: [
      {
        cells: [
          [{ type: "text", text: "試料名" }],
          [{ type: "text", text: "観察結果" }],
        ],
      },
      {
        cells: [
          [{ type: "text", text: "sample_A" }],
          [{ type: "text", text: "相転移あり" }],
        ],
      },
      {
        cells: [
          [{ type: "text", text: "sample_B" }],
          [{ type: "text", text: "変化なし" }],
        ],
      },
      {
        cells: [
          [{ type: "text", text: "sample_X" }], // 不一致ID
          [{ type: "text", text: "?" }],
        ],
      },
    ],
  },
};

describe("parseSampleTable", () => {
  it("3試料のテーブルを正しく解析できる", () => {
    const result = parseSampleTable(sampleTableBlock);
    expect(result).not.toBeNull();
    expect(result!.headers).toEqual(["試料名", "温度", "時間"]);
    expect(result!.rows).toHaveLength(3);
    expect(result!.rows[0].sampleId).toBe("sample_A");
    expect(result!.rows[0].params).toEqual({ "温度": "600℃", "時間": "24h" });
    expect(result!.rows[2].sampleId).toBe("sample_C");
    expect(result!.rows[2].params).toEqual({ "温度": "800℃", "時間": "24h" });
  });

  it("テーブル以外のブロックではnullを返す", () => {
    expect(parseSampleTable({ id: "x", type: "paragraph" })).toBeNull();
  });

  it("ヘッダーのみのテーブルではnullを返す", () => {
    const block = {
      id: "x",
      type: "table",
      content: {
        rows: [{ cells: [[{ type: "text", text: "試料名" }]] }],
      },
    };
    expect(parseSampleTable(block)).toBeNull();
  });
});

describe("matchSampleId", () => {
  it("完全一致する", () => {
    expect(matchSampleId("sample_A", "sample_A")).toBe(true);
  });

  it("大文字小文字を区別する", () => {
    expect(matchSampleId("sample_A", "sample_a")).toBe(false);
  });
});

describe("validateSampleIds", () => {
  it("一致と不一致を正しく報告する", () => {
    const sampleTable = parseSampleTable(sampleTableBlock)!;
    const resultTable = parseSampleTable(resultTableBlock)!;
    const { matched, unmatched } = validateSampleIds(sampleTable, resultTable);
    expect(matched).toEqual(["sample_A", "sample_B"]);
    expect(unmatched).toEqual(["sample_X"]);
  });
});

describe("expandSampleBranch", () => {
  it("3試料で3つのActivityに分岐する", () => {
    const sampleTable = parseSampleTable(sampleTableBlock)!;
    const expansion = expandSampleBranch("block-step-2", "アニールする", sampleTable);

    expect(expansion.activities).toHaveLength(3);
    expect(expansion.activities[0].label).toBe("アニールする [sample_A]");
    expect(expansion.activities[0].sampleId).toBe("sample_A");
    expect(expansion.activities[2].label).toBe("アニールする [sample_C]");

    expect(expansion.entities).toHaveLength(3);
    expect(expansion.entities[0].sampleId).toBe("sample_A");
    expect(expansion.entities[0].params).toEqual({ "温度": "600℃", "時間": "24h" });
  });
});

describe("propagateBranches", () => {
  it("前ステップの分岐が後続ステップに伝播する", () => {
    const sampleTable = parseSampleTable(sampleTableBlock)!;
    const branch = expandSampleBranch("block-step-2", "アニールする", sampleTable);
    const branchMap = new Map([["block-step-2", branch]]);

    const links = [{
      id: "link-1",
      sourceBlockId: "block-step-3",
      targetBlockId: "block-step-2",
      type: "informed_by" as const,
      layer: "prov" as const,
      createdBy: "human" as const,
    }];

    const result = propagateBranches("block-step-3", "評価する", links, branchMap);
    expect(result).not.toBeNull();
    expect(result!.activities).toHaveLength(3);
    expect(result!.activities[0].label).toBe("評価する [sample_A]");
    expect(result!.activities[2].label).toBe("評価する [sample_C]");
  });

  it("前ステップが分岐していなければnullを返す", () => {
    const branchMap = new Map<string, any>();
    const links = [{
      id: "link-1",
      sourceBlockId: "block-step-3",
      targetBlockId: "block-step-2",
      type: "informed_by" as const,
      layer: "prov" as const,
      createdBy: "human" as const,
    }];

    const result = propagateBranches("block-step-3", "評価する", links, branchMap);
    expect(result).toBeNull();
  });
});
