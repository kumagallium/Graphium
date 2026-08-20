// プロセスインデックス（投影キャッシュ）のテスト。
//
// 検証の軸は 3 つ:
//   - 投影が右パネルと同じ関数を通っていること（P-1）と、URL を持ち帰らないこと（P-2）
//   - 鮮度判定が modifiedTime で正しく効くこと
//   - step 再利用のパラメータ集計が「key だけ・件数順・正規化なし」であること

import { describe, it, expect } from "vitest";
import {
  buildProcessEntry,
  findStaleProcessFiles,
  collectParamKeysForStep,
  collectStepNames,
  PROCESS_INDEX_VERSION,
  type ProcessIndex,
  type ProcessIndexEntry,
} from "./process-index";
import { splitAttrLabel } from "./activity-graph-adapter";
import type { GraphiumDocument, GraphiumFile } from "../../lib/document-types";

const styled = (text: string, styles: Record<string, string | boolean> = {}) => ({
  type: "text",
  text,
  styles,
});

const para = (id: string, content: any[]) => ({ id, type: "paragraph", content, children: [] });

const step = (id: string, title: string, children: any[] = []) => ({
  id,
  type: "step",
  content: [styled(title)],
  children,
});

const doc = (blocks: any[], title = "テストノート"): GraphiumDocument =>
  ({
    version: 6,
    title,
    pages: [{ id: "p1", title, blocks, labels: {}, provLinks: [], knowledgeLinks: [] }],
  }) as any;

const file = (modifiedTime: string): Pick<GraphiumFile, "modifiedTime"> => ({ modifiedTime });

const NOW = "2026-08-20T00:00:00.000Z";

describe("buildProcessEntry", () => {
  it("手順を持たないノートは投影しない（一覧に出さない）", () => {
    const entry = buildProcessEntry("n1", doc([para("b1", [styled("ただのメモ")])]), file(NOW));
    expect(entry).toBeNull();
  });

  it("step から手順を投影し、サマリを数える", () => {
    const entry = buildProcessEntry(
      "n1",
      doc([
        step("s1", "焼成", [
          para("b1", [styled("前駆体粉末", { inlineMaterial: "material_m1" })]),
          para("b2", [styled("電気炉", { inlineTool: "tool_t1" })]),
          para("b3", [styled("焼成体", { inlineOutput: "output_o1" })]),
        ]),
      ]),
      file(NOW),
    );

    expect(entry).not.toBeNull();
    expect(entry!.noteId).toBe("n1");
    expect(entry!.sourceModifiedAt).toBe(NOW);
    expect(entry!.summary.stepCount).toBe(1);
    expect(entry!.summary.materialCount).toBe(1);
    expect(entry!.summary.toolCount).toBe(1);
    expect(entry!.summary.outputCount).toBe(1);
  });

  it("直線の手順は branching にならない", () => {
    const entry = buildProcessEntry(
      "n1",
      doc([
        step("s1", "秤量", [para("b1", [styled("中間体", { inlineOutput: "output_o1" })])]),
        step("s2", "焼成", [para("b2", [styled("中間体", { inlineMaterial: "material_m1" })])]),
      ]),
      file(NOW),
    );
    expect(entry!.summary.stepCount).toBe(2);
    expect(entry!.summary.branching).toBe(false);
  });

  // 同名でも material と output は別 Entity なので、枝分かれは
  // 「同じ素材が複数の手順に使われる」形で現れる。
  it("同じ素材を 2 つの手順が使うと branching になる", () => {
    const entry = buildProcessEntry(
      "n1",
      doc([
        step("s1", "合成", [para("b1", [styled("試料A", { inlineOutput: "output_o1" })])]),
        step("s2", "XRD 測定", [para("b2", [styled("試料A", { inlineMaterial: "material_m1" })])]),
        step("s3", "SEM 観察", [para("b3", [styled("試料A", { inlineMaterial: "material_m2" })])]),
      ]),
      file(NOW),
    );
    expect(entry!.summary.branching).toBe(true);
  });

  it("URL は持ち帰らない（P-2: 署名 URL は腐る）", () => {
    const entry = buildProcessEntry(
      "n1",
      doc([step("s1", "撮影", [para("b1", [styled("試料", { inlineMaterial: "material_m1" })])])]),
      file(NOW),
    );
    for (const e of entry!.graph.entities) {
      expect(e).not.toHaveProperty("mediaUrl");
      expect(e).not.toHaveProperty("mediaType");
    }
  });

  it("フォーク元は投影で消えず、前のエントリから引き継がれる", () => {
    const prior = {
      noteId: "n1",
      forkedFrom: { noteId: "n0", title: "元プロセス", forkedAt: NOW },
    } as ProcessIndexEntry;
    const entry = buildProcessEntry("n1", doc([step("s1", "焼成")]), file(NOW), prior);
    expect(entry!.forkedFrom).toEqual({ noteId: "n0", title: "元プロセス", forkedAt: NOW });
  });
});

describe("findStaleProcessFiles", () => {
  const index = (entries: Partial<ProcessIndexEntry>[]): ProcessIndex => ({
    version: PROCESS_INDEX_VERSION,
    updatedAt: NOW,
    processes: entries as ProcessIndexEntry[],
  });
  const gfile = (id: string, modifiedTime: string): GraphiumFile => ({
    id,
    name: id,
    modifiedTime,
    createdTime: modifiedTime,
  });

  it("インデックスが無ければ全件が対象", () => {
    expect(findStaleProcessFiles(null, [gfile("n1", NOW)])).toHaveLength(1);
  });

  it("バージョンが違えば全件が対象（投影ロジックが変わったとき）", () => {
    const stale = { version: 0, updatedAt: NOW, processes: [] } as ProcessIndex;
    expect(findStaleProcessFiles(stale, [gfile("n1", NOW)])).toHaveLength(1);
  });

  it("更新されていないノートは対象外", () => {
    const i = index([{ noteId: "n1", sourceModifiedAt: NOW }]);
    expect(findStaleProcessFiles(i, [gfile("n1", NOW)])).toHaveLength(0);
  });

  it("ノートが新しくなったら対象になる", () => {
    const i = index([{ noteId: "n1", sourceModifiedAt: NOW }]);
    const files = [gfile("n1", "2026-08-21T00:00:00.000Z")];
    expect(findStaleProcessFiles(i, files)).toHaveLength(1);
  });

  it("1 秒以内の差では再投影しない（丸め差でループしない）", () => {
    const i = index([{ noteId: "n1", sourceModifiedAt: NOW }]);
    const files = [gfile("n1", "2026-08-20T00:00:00.500Z")];
    expect(findStaleProcessFiles(i, files)).toHaveLength(0);
  });
});

describe("パラメータ辞書", () => {
  const withParams = (noteId: string, stepName: string, labels: string[]): ProcessIndexEntry =>
    ({
      noteId,
      title: noteId,
      graph: {
        steps: [{ id: "s1", name: stepName, params: labels.map((label) => ({ label })) }],
        entities: [],
        edges: [],
      },
    }) as any;

  const index = (processes: ProcessIndexEntry[]): ProcessIndex => ({
    version: PROCESS_INDEX_VERSION,
    updatedAt: NOW,
    processes,
  });

  it("同名 step のパラメータ key を件数順に返す", () => {
    const i = index([
      withParams("n1", "焼成", ["温度: 500℃", "保持時間: 2h"]),
      withParams("n2", "焼成", ["温度: 600℃", "保持時間: 1h", "昇温速度: 5℃/min"]),
      withParams("n3", "焼成", ["温度: 700℃"]),
    ]);
    const stats = collectParamKeysForStep(i, "焼成", splitAttrLabel);
    expect(stats.map((s) => [s.key, s.noteCount])).toEqual([
      ["温度", 3],
      ["保持時間", 2],
      ["昇温速度", 1],
    ]);
  });

  it("value ではなく key を集める（値は思い出すための例として 1 つだけ）", () => {
    const i = index([withParams("n1", "焼成", ["温度: 500℃"])]);
    const [stat] = collectParamKeysForStep(i, "焼成", splitAttrLabel);
    expect(stat.key).toBe("温度");
    expect(stat.sampleValue).toBe("500℃");
  });

  it("表記ゆれは統合しない（意味の違うものを混ぜない）", () => {
    const i = index([
      withParams("n1", "焼成", ["温度: 500℃"]),
      withParams("n2", "焼成", ["焼成温度: 600℃"]),
    ]);
    const keys = collectParamKeysForStep(i, "焼成", splitAttrLabel).map((s) => s.key);
    expect(keys).toContain("温度");
    expect(keys).toContain("焼成温度");
  });

  it("key: value の形になっていないパラメータは候補にしない", () => {
    const i = index([withParams("n1", "焼成", ["よく混ぜる"])]);
    expect(collectParamKeysForStep(i, "焼成", splitAttrLabel)).toEqual([]);
  });

  it("別名の step のパラメータは混ざらない", () => {
    const i = index([
      withParams("n1", "焼成", ["温度: 500℃"]),
      withParams("n2", "粉砕", ["回転数: 300rpm"]),
    ]);
    const keys = collectParamKeysForStep(i, "焼成", splitAttrLabel).map((s) => s.key);
    expect(keys).toEqual(["温度"]);
  });

  it("step 名を使用ノート数の多い順に並べる", () => {
    const i = index([
      withParams("n1", "焼成", []),
      withParams("n2", "焼成", []),
      withParams("n3", "粉砕", []),
    ]);
    expect(collectStepNames(i)).toEqual([
      { name: "焼成", noteCount: 2 },
      { name: "粉砕", noteCount: 1 },
    ]);
  });
});
