// プロセスインデックス（投影キャッシュ）のテスト。
//
// 検証の軸は 3 つ:
//   - 投影が右パネルと同じ関数を通っていること（P-1）と、URL を持ち帰らないこと（P-2）
//   - 鮮度判定が modifiedTime で正しく効くこと
//   - step 再利用のパラメータ集計が「key だけ・件数順・正規化なし」であること

import { describe, it, expect } from "vitest";
import {
  addForkedProcess,
  buildProcessEntry,
  ensureProcessIndex,
  collectStepInheritance,
  findStaleProcessFiles,
  collectParamKeysForStep,
  collectStepNames,
  collectCrossNoteOutputs,
  resolveCrossNoteOutput,
  clearLatestProcessIndex,
  requestLatestProcessIndexRefresh,
  setLatestProcessIndexRefreshRequester,
  setLatestProcessIndex,
  subscribeLatestProcessIndex,
  wouldCreateCrossNoteCycle,
  PROCESS_INDEX_VERSION,
  type ProcessIndex,
  type ProcessIndexEntry,
} from "./process-index";
import { splitAttrLabel } from "./activity-graph-adapter";
import type { GraphiumDocument, GraphiumFile } from "../../lib/document-types";
import type { StorageProvider } from "../../lib/storage/types";
import { t } from "../../i18n";

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

  it("構造化 table output の rowIdentity をプロセス投影まで保持する", () => {
    // pageToGeneratorInput はページのラベルを使うため、テスト用 doc へ明示的に設定する。
    const withLabel = doc([
      step("s1", "焼成", [{
        id: "output-table",
        type: "table",
        content: {
          type: "tableContent",
          rows: [
            { cells: [[styled("名前")]] },
            { cells: [[styled("焼成体", { tableRowIdentity: "row_product" })]] },
          ],
        },
        children: [],
      }]),
    ], "テストノート");
    withLabel.pages[0].labels = { "output-table": "output" };
    const projected = buildProcessEntry("n1", withLabel, file(NOW));
    expect(projected?.graph.entities).toContainEqual(expect.objectContaining({
      label: "焼成体",
      rowIdentity: "row_product",
    }));
  });

  it("ノート横断リンクをプロセス一覧の外部由来表示へ引き継ぐ", () => {
    const source = doc([step("s1", "観察")]);
    source.pages[0].provLinks = [{
      id: "link-1",
      sourceBlockId: "s1",
      targetBlockId: "source-step",
      type: "informed_by",
      layer: "prov",
      createdBy: "human",
      targetNoteId: "source-note",
      targetEntityId: "source-output",
      sourceEntityId: "current-input",
    }];

    const entry = buildProcessEntry("n1", source, file(NOW));

    expect(entry?.crossNoteLinks).toEqual(source.pages[0].provLinks);
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

describe("addForkedProcess", () => {
  it("フォークしたノートを一覧へ追加し、元ノートのスナップショットを保持する", () => {
    const source = buildProcessEntry("source", doc([step("s1", "焼成")]), file(NOW))!;
    const index: ProcessIndex = {
      version: PROCESS_INDEX_VERSION,
      updatedAt: NOW,
      processes: [source],
    };
    const childDoc = doc([step("s2", "冷却")], "派生ノート");
    const forkedAt = "2026-08-21T00:00:00.000Z";

    const next = addForkedProcess(
      index,
      "child",
      childDoc,
      file(forkedAt),
      { noteId: "source", title: "元ノート", forkedAt },
    );

    expect(next.processes).toHaveLength(2);
    expect(next.processes.find((process) => process.noteId === "child")).toMatchObject({
      title: "派生ノート",
      forkedFrom: { noteId: "source", title: "元ノート", forkedAt },
    });
  });
});

describe("wouldCreateCrossNoteCycle", () => {
  const externalLink = (targetNoteId: string) => ({
    id: `link-${targetNoteId}`,
    sourceBlockId: "source-step",
    targetBlockId: "target-step",
    targetNoteId,
    type: "informed_by" as const,
    layer: "prov" as const,
    createdBy: "human" as const,
  });

  it("参照先から現在ノートへ戻る依存があれば拒否する", () => {
    const index: ProcessIndex = {
      version: PROCESS_INDEX_VERSION,
      updatedAt: NOW,
      processes: [{
        noteId: "note-b",
        title: "B",
        sourceModifiedAt: NOW,
        projectedAt: NOW,
        graph: { steps: [], entities: [], edges: [] },
        crossNoteLinks: [externalLink("note-a")],
        summary: {
          stepCount: 0,
          materialCount: 0,
          toolCount: 0,
          outputCount: 0,
          branching: false,
        },
      }],
    };

    expect(
      wouldCreateCrossNoteCycle(index, "note-a", "note-b", []),
    ).toBe(true);
  });

  it("現在ノートへ戻らない別ノート参照は許可する", () => {
    const index: ProcessIndex = {
      version: PROCESS_INDEX_VERSION,
      updatedAt: NOW,
      processes: [{
        noteId: "note-b",
        title: "B",
        sourceModifiedAt: NOW,
        projectedAt: NOW,
        graph: { steps: [], entities: [], edges: [] },
        crossNoteLinks: [externalLink("note-c")],
        summary: {
          stepCount: 0,
          materialCount: 0,
          toolCount: 0,
          outputCount: 0,
          branching: false,
        },
      }],
    };

    expect(
      wouldCreateCrossNoteCycle(index, "note-a", "note-b", []),
    ).toBe(false);
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

describe("ensureProcessIndex の scope 失効", () => {
  it("provider 切替後に完了した loadDoc を共有 cache へ入れない", async () => {
    const files: GraphiumFile[] = [
      {
        id: "n1",
        name: "n1.graphium.json",
        modifiedTime: NOW,
        createdTime: NOW,
      },
    ];
    const cache = new Map<string, GraphiumDocument>();
    let current = true;
    let releaseLoad!: () => void;
    let markLoadStarted!: () => void;
    const loadGate = new Promise<void>((resolve) => {
      releaseLoad = resolve;
    });
    const loadStarted = new Promise<void>((resolve) => {
      markLoadStarted = resolve;
    });
    const operation = ensureProcessIndex(
      files,
      cache,
      async () => {
        markLoadStarted();
        await loadGate;
        return doc([step("s1", "合成")]);
      },
      null,
      () => current,
      {} as StorageProvider,
    );

    await loadStarted;
    current = false;
    releaseLoad();
    await operation;

    expect(cache.has("n1")).toBe(false);
  });
});

describe("ノート横断 output 参照", () => {
  const outputEntry = (
    noteId: string,
    outputs: Array<{
      id: string;
      entityId?: string;
      label: string;
      tableRef?: { blockId: string; rowName: string };
      rowIdentity?: string;
    }>,
  ): ProcessIndexEntry =>
    ({
      noteId,
      title: `${noteId} のノート`,
      sourceModifiedAt: NOW,
      graph: {
        steps: [{ id: `${noteId}-step`, name: "合成", params: [] }],
        entities: outputs.map((output) => ({
          ...output,
          kind: "output",
          attrs: [],
        })),
        edges: outputs.map((output, i) => ({
          id: `${noteId}-edge-${i}`,
          kind: "generates",
          source: `${noteId}-step`,
          target: output.id,
        })),
      },
    }) as any;
  const index = (processes: ProcessIndexEntry[]): ProcessIndex => ({
    version: PROCESS_INDEX_VERSION,
    updatedAt: NOW,
    processes,
  });

  it("generates 辺から同名 output を identity 付きで別々に列挙する", () => {
    const i = index([
      outputEntry("n1", [
        { id: "inline_output_a", entityId: "output-a", label: "生成物" },
        { id: "inline_output_b", entityId: "output-b", label: "生成物" },
      ]),
      outputEntry("n2", [{ id: "result_table_row", label: "生成物" }]),
    ]);
    expect(collectCrossNoteOutputs(i, { excludeNoteId: "n2" })).toEqual([
      {
        noteId: "n1",
        noteTitle: "n1 のノート",
        sourceModifiedAt: NOW,
        stepId: "n1-step",
        stepName: "合成",
        entityIdentity: "output-a",
        identityStable: true,
        label: "生成物",
        outputIndex: 0,
        outputCount: 2,
      },
      {
        noteId: "n1",
        noteTitle: "n1 のノート",
        sourceModifiedAt: NOW,
        stepId: "n1-step",
        stepName: "合成",
        entityIdentity: "output-b",
        identityStable: true,
        label: "生成物",
        outputIndex: 1,
        outputCount: 2,
      },
    ]);
  });

  it("entityId が安定していればラベル変更後も同じ output を解決する", () => {
    const i = index([
      outputEntry("n1", [{ id: "inline_output_new", entityId: "output-a", label: "改名後" }]),
    ]);
    expect(
      resolveCrossNoteOutput(i, {
        noteId: "n1",
        stepId: "n1-step",
        entityIdentity: "output-a",
        identityStable: true,
        outputIndex: 0,
        outputCount: 1,
      })?.label,
    ).toBe("改名後");
  });

  it("表 output は参照元が未更新なら identity と位置で解決する", () => {
    const i = index([
      outputEntry("n1", [
        {
          id: "result_table_a",
          label: "A",
          tableRef: { blockId: "table", rowName: "A" },
        },
        {
          id: "result_table_b",
          label: "B",
          tableRef: { blockId: "table", rowName: "B" },
        },
      ]),
    ]);
    expect(
      resolveCrossNoteOutput(i, {
        noteId: "n1",
        sourceModifiedAt: NOW,
        stepId: "n1-step",
        entityIdentity: "result_table_a",
        identityStable: false,
        outputIndex: 0,
        outputCount: 2,
      })?.label,
    ).toBe("A");
  });

  it("表の行削除と追加で ID・位置・件数が再利用されても別行へ誤接続しない", () => {
    const i = index([
      outputEntry("n1", [
        {
          id: "result_table_same",
          label: "同名",
          tableRef: { blockId: "table", rowName: "同名" },
        },
      ]),
    ]);
    expect(
      resolveCrossNoteOutput(i, {
        noteId: "n1",
        sourceModifiedAt: "2026-08-19T00:00:00.000Z",
        stepId: "n1-step",
        // 更新後も ID・位置・件数が同じだが、実体は削除後に追加された別行。
        entityIdentity: "result_table_same",
        identityStable: false,
        outputIndex: 0,
        outputCount: 2,
      }),
    ).toBeNull();
  });

  it("stable output は件数・位置が一致しても identity 不一致なら解決しない", () => {
    const i = index([
      outputEntry("n1", [
        { id: "inline_output_new", entityId: "output-new", label: "別出力" },
      ]),
    ]);
    expect(
      resolveCrossNoteOutput(i, {
        noteId: "n1",
        stepId: "n1-step",
        entityIdentity: "output-old",
        identityStable: true,
        outputIndex: 0,
        outputCount: 1,
      }),
    ).toBeNull();
  });

  it("表 output は参照元の更新後に改名されると安全側で broken にする", () => {
    const i = index([
      outputEntry("n1", [
        {
          id: "result_table_renamed",
          label: "改名後",
          tableRef: { blockId: "table", rowName: "改名後" },
        },
        {
          id: "result_table_added",
          label: "追加",
          tableRef: { blockId: "table", rowName: "追加" },
        },
      ]),
    ]);
    expect(
      resolveCrossNoteOutput(i, {
        noteId: "n1",
        sourceModifiedAt: "2026-08-19T00:00:00.000Z",
        stepId: "n1-step",
        entityIdentity: "result_table_before-rename",
        identityStable: false,
        outputIndex: 0,
        outputCount: 1,
      }),
    ).toBeNull();
  });

  it("永続 row identity の表 output は更新時刻・ノート名・行名の変更後も解決する", () => {
    const i = index([
      {
        ...outputEntry("n1", [{
          id: "result_table_rename",
          label: "改名後の行",
          tableRef: { blockId: "table", rowName: "改名後の行" },
          rowIdentity: "row_stable",
        }]),
        title: "改名後のノート",
        sourceModifiedAt: "2026-08-21T00:00:00.000Z",
      },
    ]);
    expect(
      resolveCrossNoteOutput(i, {
        noteId: "n1",
        sourceModifiedAt: NOW,
        stepId: "n1-step",
        entityIdentity: "row_stable",
        identityStable: true,
        outputIndex: 0,
        outputCount: 1,
      }),
    ).toMatchObject({
      noteTitle: "改名後のノート",
      label: "改名後の行",
      entityIdentity: "row_stable",
      identityStable: true,
    });
  });

  it("元行削除後に別 identity の行を追加した場合は broken にする", () => {
    const i = index([
      outputEntry("n1", [{
        id: "result_table_new",
        label: "追加された別行",
        tableRef: { blockId: "table", rowName: "追加された別行" },
        rowIdentity: "row_new",
      }]),
    ]);
    expect(
      resolveCrossNoteOutput(i, {
        noteId: "n1",
        stepId: "n1-step",
        entityIdentity: "row_removed",
        identityStable: true,
        outputIndex: 0,
        outputCount: 1,
      }),
    ).toBeNull();
  });

  it("stable output は別 output が追加されても exact identity で継続する", () => {
    const i = index([
      outputEntry("n1", [
        { id: "inline_output_a", entityId: "output-a", label: "継続" },
        { id: "inline_output_b", entityId: "output-b", label: "追加" },
      ]),
    ]);
    expect(
      resolveCrossNoteOutput(i, {
        noteId: "n1",
        stepId: "n1-step",
        entityIdentity: "output-a",
        identityStable: true,
        outputIndex: 0,
        outputCount: 1,
      })?.label,
    ).toBe("継続");
  });

  it("latest index の set / clear を購読先へ通知する", () => {
    let notified = 0;
    const unsubscribe = subscribeLatestProcessIndex(() => {
      notified += 1;
    });

    const i = index([]);
    setLatestProcessIndex(i);
    clearLatestProcessIndex();
    unsubscribe();
    setLatestProcessIndex(null);
    expect(notified).toBe(2);
  });

  it("step ピッカーから登録済みの遅延投影を要求できる", () => {
    let requested = 0;
    setLatestProcessIndexRefreshRequester(() => {
      requested += 1;
    });
    requestLatestProcessIndexRefresh();
    expect(requested).toBe(1);
    setLatestProcessIndexRefreshRequester(null);
    requestLatestProcessIndexRefresh();
    expect(requested).toBe(1);
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

  // 実データでは手順の条件が step 直結ではなく、その手順に入る素材や使う装置の
  // 属性として書かれていることのほうが多い。step.params だけ見ると候補が出ない。
  const withEntityAttrs = (
    noteId: string,
    stepName: string,
    entity: { kind: string; labels: string[] },
    edgeKind: "used" | "generates" = "used",
  ): ProcessIndexEntry =>
    ({
      noteId,
      title: noteId,
      graph: {
        steps: [{ id: `${noteId}-s1`, name: stepName, params: [] }],
        entities: [
          {
            id: `${noteId}-e1`,
            label: "素材",
            kind: entity.kind,
            attrs: entity.labels.map((label) => ({ label })),
          },
        ],
        edges: [
          edgeKind === "used"
            ? { id: "e", kind: "used", source: `${noteId}-e1`, target: `${noteId}-s1` }
            : { id: "e", kind: "generates", source: `${noteId}-s1`, target: `${noteId}-e1` },
        ],
      },
    }) as any;

  it("手順に入る素材の属性も、その手順のパラメータとして拾う", () => {
    const i = index([
      withEntityAttrs("n1", "焼結", { kind: "material", labels: ["圧力: 100 MPa", "温度: 1273 K"] }),
    ]);
    const stats = collectParamKeysForStep(i, "焼結", splitAttrLabel);
    expect(stats.map((s) => s.key)).toEqual(["圧力", "温度"]);
    expect(stats[0].origin).toBe("material");
  });

  it("手順が使う装置の設定も拾う", () => {
    const i = index([
      withEntityAttrs("n1", "急冷", { kind: "tool", labels: ["ロール回転数: 8000 rpm"] }),
    ]);
    const [stat] = collectParamKeysForStep(i, "急冷", splitAttrLabel);
    expect(stat.key).toBe("ロール回転数");
    expect(stat.origin).toBe("tool");
  });

  it("手順が生成した物の属性も拾う", () => {
    const i = index([
      withEntityAttrs("n1", "焼成", { kind: "output", labels: ["相: RuAl2"] }, "generates"),
    ]);
    const [stat] = collectParamKeysForStep(i, "焼成", splitAttrLabel);
    expect(stat.origin).toBe("output");
  });

  it("別の手順に繋がる素材の属性は混ざらない", () => {
    const entry = withEntityAttrs("n1", "焼結", {
      kind: "material",
      labels: ["圧力: 100 MPa"],
    });
    // 素材は別 step にだけ繋がっている状態にする
    entry.graph.steps.push({ id: "n1-s2", name: "粉砕", params: [] } as any);
    entry.graph.edges = [
      { id: "e", kind: "used", source: "n1-e1", target: "n1-s2" } as any,
    ];
    expect(collectParamKeysForStep(index([entry]), "焼結", splitAttrLabel)).toEqual([]);
  });

  it("step 直結のパラメータと素材の属性は同じ一覧にまとまる", () => {
    const entry = withEntityAttrs("n1", "焼結", {
      kind: "material",
      labels: ["圧力: 100 MPa"],
    });
    entry.graph.steps[0].params = [{ label: "保持時間: 5 min" }] as any;
    const keys = collectParamKeysForStep(index([entry]), "焼結", splitAttrLabel).map((s) => s.key);
    expect(keys).toContain("圧力");
    expect(keys).toContain("保持時間");
  });

  it("引き継げるパラメータを持つ手順を先に並べる（名前だけの手順も落とさない）", () => {
    const withP = withParams("n1", "焼成", ["温度: 500℃", "保持時間: 2h"]);
    const noP = withParams("n2", "乾燥", []);
    const noP2 = withParams("n3", "乾燥", []);
    const stats = collectStepNames(index([withP, noP, noP2]), splitAttrLabel);
    // 「乾燥」のほうがノート数は多いが、引き継げるものがある「焼成」が先
    expect(stats.map((s) => [s.name, s.noteCount, s.paramCount])).toEqual([
      ["焼成", 1, 2],
      ["乾燥", 2, 0],
    ]);
  });

  it("題の無い手順（投影で「(無題)」になる）は候補にしない", () => {
    const i = index([withParams("n1", t("nav.untitled"), []), withParams("n2", "焼成", [])]);
    expect(collectStepNames(i).map((s) => s.name)).toEqual(["焼成"]);
  });

  // 実データでは手順直結のパラメータが 1 件も無く、条件はすべて素材か装置に
  // 付いていた。書かれていた場所ごとに分けないと、引き継ぎで書き方が変わる。
  it("素材の属性と装置の設定を、別々の Entity として分けて返す", () => {
    const entry = withEntityAttrs("n1", "焼結", {
      kind: "material",
      labels: ["圧力: 100 MPa", "温度: 1273 K"],
    });
    entry.graph.entities.push({
      id: "n1-e2",
      label: "SPS-515A",
      kind: "tool",
      attrs: [{ label: "出力: 5 kW" }],
    } as any);
    entry.graph.edges.push({ id: "e2", kind: "used", source: "n1-e2", target: "n1-s1" } as any);

    const result = collectStepInheritance(index([entry]), "焼結", splitAttrLabel);
    expect(result.stepParams).toEqual([]);
    const byLabel = Object.fromEntries(result.entities.map((e) => [e.label, e]));
    expect(byLabel["素材"].kind).toBe("material");
    expect(byLabel["素材"].attrs.map((a) => a.key)).toEqual(["圧力", "温度"]);
    expect(byLabel["SPS-515A"].kind).toBe("tool");
    expect(byLabel["SPS-515A"].attrs.map((a) => a.key)).toEqual(["出力"]);
  });

  it("属性を持たない Entity も落とさない（名前だけ引き継ぐ価値がある）", () => {
    const entry = withEntityAttrs("n1", "焼結", { kind: "tool", labels: [] });
    const result = collectStepInheritance(index([entry]), "焼結", splitAttrLabel);
    expect(result.entities.map((e) => [e.label, e.attrs.length])).toEqual([["素材", 0]]);
  });

  it("同じ名前でも素材と道具は別扱いにする", () => {
    const entry = withEntityAttrs("n1", "焼結", { kind: "material", labels: [] });
    entry.graph.entities.push({ id: "n1-e2", label: "素材", kind: "tool", attrs: [] } as any);
    entry.graph.edges.push({ id: "e2", kind: "used", source: "n1-e2", target: "n1-s1" } as any);
    const result = collectStepInheritance(index([entry]), "焼結", splitAttrLabel);
    expect(result.entities.map((e) => e.kind).sort()).toEqual(["material", "tool"]);
  });

  it("step 直結のパラメータは Entity 側に混ぜない", () => {
    const entry = withEntityAttrs("n1", "焼結", { kind: "material", labels: ["圧力: 100 MPa"] });
    entry.graph.steps[0].params = [{ label: "保持時間: 5 min" }] as any;
    const result = collectStepInheritance(index([entry]), "焼結", splitAttrLabel);
    expect(result.stepParams.map((p) => p.key)).toEqual(["保持時間"]);
    expect(result.entities[0].attrs.map((a) => a.key)).toEqual(["圧力"]);
  });

  it("いま書いている step 自身は候補にしない（引き継いだ内容が候補として戻らないように）", () => {
    const own = withEntityAttrs("n1", "焼結", { kind: "material", labels: ["圧力: 100 MPa"] });
    const other = withEntityAttrs("n2", "焼結", { kind: "material", labels: ["温度: 1273 K"] });
    const all = collectStepInheritance(index([own, other]), "焼結", splitAttrLabel);
    expect(all.entities.flatMap((e) => e.attrs.map((a) => a.key)).sort()).toEqual(["圧力", "温度"]);

    const excluded = collectStepInheritance(index([own, other]), "焼結", splitAttrLabel, {
      excludeStepId: "n1-s1",
    });
    expect(excluded.entities.flatMap((e) => e.attrs.map((a) => a.key))).toEqual(["温度"]);
  });

  it("step 名を使用ノート数の多い順に並べる", () => {
    const i = index([
      withParams("n1", "焼成", []),
      withParams("n2", "焼成", []),
      withParams("n3", "粉砕", []),
    ]);
    expect(collectStepNames(i)).toEqual([
      { name: "焼成", noteCount: 2, paramCount: 0 },
      { name: "粉砕", noteCount: 1, paramCount: 0 },
    ]);
  });
});
