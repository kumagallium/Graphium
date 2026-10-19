// IngestToast の見出し件数（生成・エラー・分母）のテスト。
// 「Knowledge pipeline の進捗行や案内行を『生成』に数えない」という不変条件を確かめる。

import { describe, it, expect } from "vitest";
import { summarizeIngestToastCounts, formatElapsed, stampIngestTimings, type IngestToastItem } from "./IngestToast";

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

describe("formatElapsed", () => {
  it("秒・分・時で短く表す", () => {
    expect(formatElapsed(0)).toBe("0s");
    expect(formatElapsed(999)).toBe("0s");
    expect(formatElapsed(8_000)).toBe("8s");
    expect(formatElapsed(83_000)).toBe("1m 23s");
    expect(formatElapsed(3_900_000)).toBe("1h 05m");
  });

  it("負の値は 0s", () => {
    expect(formatElapsed(-5_000)).toBe("0s");
  });
});

describe("stampIngestTimings", () => {
  it("項目が走り始めたら startedAt、終わったら endedAt を刻む", () => {
    const t0 = stampIngestTimings(null, { items: [{ id: "a", status: "queued", noteTitle: "A" }] }, 1000);
    expect(t0?.items[0].startedAt).toBeUndefined();
    const t1 = stampIngestTimings(t0, { items: [{ id: "a", status: "generating", noteTitle: "A" }] }, 2000);
    expect(t1?.items[0].startedAt).toBe(2000);
    expect(t1?.items[0].endedAt).toBeUndefined();
    // mapper がスプレッドで時刻を落としても前の状態から引き継ぐ。再描画で startedAt は進まない
    const t2 = stampIngestTimings(t1, { items: [{ id: "a", status: "saving", noteTitle: "A", detail: "saving" }] }, 3000);
    expect(t2?.items[0].startedAt).toBe(2000);
    const t3 = stampIngestTimings(t2, { items: [{ id: "a", status: "success", noteTitle: "A", result: "2 wiki(s)" }] }, 9000);
    expect(t3?.items[0]).toMatchObject({ startedAt: 2000, endedAt: 9000 });
    // 終わった後の更新で endedAt は動かない
    const t4 = stampIngestTimings(t3, { items: [{ ...t3!.items[0], notice: "x" }] }, 20000);
    expect(t4?.items[0].endedAt).toBe(9000);
  });

  it("停止（aborted）も終了として刻む。走らずに終わった項目には時刻を付けない", () => {
    const t1 = stampIngestTimings(null, { items: [{ id: "a", status: "generating", noteTitle: "A" }] }, 1000);
    const t2 = stampIngestTimings(t1, { items: [{ id: "a", status: "aborted", noteTitle: "A" }] }, 4000);
    expect(t2?.items[0]).toMatchObject({ startedAt: 1000, endedAt: 4000 });
    // queued のまま aborted に畳まれた項目（停止で残りを畳む）には startedAt が無い → endedAt も付けない
    const q = stampIngestTimings(null, { items: [{ id: "b", status: "aborted", noteTitle: "B" }] }, 5000);
    expect(q?.items[0].startedAt).toBeUndefined();
    expect(q?.items[0].endedAt).toBeUndefined();
  });

  it("ステージは running で startedAt、done/error/skipped で endedAt。走らずに skipped なら時刻なし", () => {
    const mk = (status: "pending" | "running" | "done" | "skipped" | "error", key = "topics") =>
      ({ key, label: key, status });
    const p0 = stampIngestTimings(
      null,
      { items: [{ id: "p", status: "generating", noteTitle: "pipeline", stages: [mk("pending"), mk("pending", "atomize")] }] },
      100,
    );
    expect(p0?.items[0].stages?.[0].startedAt).toBeUndefined();
    const p1 = stampIngestTimings(
      p0,
      { items: [{ id: "p", status: "generating", noteTitle: "pipeline", stages: [mk("running"), mk("pending", "atomize")] }] },
      200,
    );
    expect(p1?.items[0].stages?.[0].startedAt).toBe(200);
    const p2 = stampIngestTimings(
      p1,
      { items: [{ id: "p", status: "generating", noteTitle: "pipeline", stages: [mk("done"), mk("skipped", "atomize")] }] },
      900,
    );
    expect(p2?.items[0].stages?.[0]).toMatchObject({ startedAt: 200, endedAt: 900 });
    expect(p2?.items[0].stages?.[1].startedAt).toBeUndefined();
    expect(p2?.items[0].stages?.[1].endedAt).toBeUndefined();
  });

  it("何も変わらなければ同じオブジェクトを返す（無駄な再描画を起こさない）", () => {
    const state = stampIngestTimings(null, { items: [{ id: "a", status: "queued", noteTitle: "A" }] }, 1);
    expect(stampIngestTimings(state, state, 2)).toBe(state);
    expect(stampIngestTimings(null, null, 2)).toBeNull();
  });
});
