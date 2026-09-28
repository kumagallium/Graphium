// IngestToast の見出し件数（生成・エラー・分母）のテスト。
// 「Knowledge pipeline の進捗行や案内行を『生成』に数えない」という不変条件を確かめる。

import { describe, it, expect } from "vitest";
import { summarizeIngestToastCounts, type IngestToastItem } from "./IngestToast";

describe("summarizeIngestToastCounts", () => {
  it("実ノートの取り込み結果だけを生成・エラーに数える", () => {
    const items: IngestToastItem[] = [
      { id: "1", status: "success", noteTitle: "note1" },
      { id: "2", status: "error", noteTitle: "note2" },
    ];
    expect(summarizeIngestToastCounts(items)).toEqual({ completed: 1, error: 1, aborted: 0, total: 2 });
  });

  it("空のノートで実ノートが失敗しても、Knowledge pipeline の進捗行（stages 付き）は生成に数えない", () => {
    // 空ノート: 実ノートの ingest 自体は失敗、pipeline 行は topics=skipped のまま success 確定
    const items: IngestToastItem[] = [
      { id: "1", status: "error", noteTitle: "空ノート" },
      {
        id: "pipeline:1",
        status: "success",
        noteTitle: "🧠 Knowledge pipeline",
        stages: [
          { key: "topics", label: "Topics", status: "skipped" },
          { key: "atomize", label: "Atomize", status: "done" },
          { key: "lint", label: "Lint", status: "done" },
        ],
      },
    ];
    // 生成 0 件・エラー 1 件・分母 1（pipeline 行は分母からも除く）
    expect(summarizeIngestToastCounts(items)).toEqual({ completed: 0, error: 1, aborted: 0, total: 1 });
  });

  it("トピック段が断られた行（stages 無し・status error）はエラーに数える（今のまま）", () => {
    const items: IngestToastItem[] = [
      { id: "1", status: "success", noteTitle: "note1" },
      {
        id: "pipeline:1",
        status: "success",
        noteTitle: "🧠 Knowledge pipeline",
        stages: [{ key: "topics", label: "Topics", status: "done" }],
      },
      { id: "topic-failure:1", status: "error", noteTitle: "書き直せなかったトピック 1 件", result: "..." },
    ];
    // 生成 1 件（note1）・エラー 1 件（topic-failure）・分母 2（pipeline 行だけ除く）
    expect(summarizeIngestToastCounts(items)).toEqual({ completed: 1, error: 1, aborted: 0, total: 2 });
  });

  it("出典照合の案内の行（excludeFromCount）は生成に数えない・分母からも除く", () => {
    const items: IngestToastItem[] = [
      { id: "1", status: "success", noteTitle: "note1" },
      {
        id: "source-check-prompt:1",
        status: "success",
        noteTitle: "出典照合",
        result: "未照合 3 文",
        excludeFromCount: true,
      },
    ];
    expect(summarizeIngestToastCounts(items)).toEqual({ completed: 1, error: 0, aborted: 0, total: 1 });
  });

  it("停止（aborted）も同じ基準で数える", () => {
    const items: IngestToastItem[] = [
      { id: "1", status: "aborted", noteTitle: "note1" },
      {
        id: "pipeline:1",
        status: "aborted",
        noteTitle: "🧠 Knowledge pipeline",
        stages: [{ key: "topics", label: "Topics", status: "pending" }],
      },
    ];
    expect(summarizeIngestToastCounts(items)).toEqual({ completed: 0, error: 0, aborted: 1, total: 1 });
  });
});
