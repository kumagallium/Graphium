import { describe, expect, it, vi } from "vitest";
import {
  buildCleanupDoc,
  buildCleanupWriteOut,
  buildSummaryDoc,
  buildTranscriptWriteOut,
  cleanupToUtterances,
  segmentsToUtterances,
  summaryDocToPlanInput,
  writeOutAnchor,
  writeOutBlocks,
  writeOutSummary,
  type WriteOutLabels,
} from "./artifact-actions";
import type { CleanupDoc, SummaryDoc } from "../../features/meeting-recorder/artifacts";
import type { TranscriptSegment } from "../../features/meeting-recorder/transcript-format";

const segs: TranscriptSegment[] = [
  { track: "system", startMs: 39_000, text: "コード量すげえ増えたなっていうのと" },
  { track: "system", startMs: 44_000, text: "プロリク1個に対するファイルチェンジも" },
  { track: "mic", startMs: 50_000, text: "うん" },
  { track: "system", startMs: 54_000, text: "  " },
];

const labels: WriteOutLabels = {
  summaryHeading: "要約",
  aiNote: "AI がまとめました",
  decisions: "決定事項",
  todos: "TODO",
  issues: "論点",
  transcriptHeading: "文字起こし",
  owner: "担当",
  due: "期限",
  other: "相手",
  self: "自分",
  cleanupHeading: "清書",
  cleanupAiNote: "AI が整えた文です",
};

/** 並びを持つ偽のエディタ（insertBlocks / removeBlocks / updateBlock / getNextBlock） */
function docEditor(initial: any[]) {
  const doc = [...initial];
  let n = 0;
  const idx = (id: string) => doc.findIndex((b) => b.id === id);
  return {
    doc,
    getBlock: (id: string) => doc.find((b) => b.id === id),
    getNextBlock: (b: any) => doc[idx(b.id) + 1],
    getParentBlock: () => undefined,
    insertBlocks: vi.fn((bs: any[], ref: any, pos: "before" | "after") => {
      const made = bs.map((b) => ({ props: {}, ...b, id: `n${n++}` }));
      const at = idx(ref.id) + (pos === "after" ? 1 : 0);
      doc.splice(at, 0, ...made);
      return made;
    }),
    removeBlocks: vi.fn((ids: any[]) => {
      for (const x of ids) {
        const i = idx(typeof x === "string" ? x : x.id);
        if (i >= 0) doc.splice(i, 1);
      }
    }),
    updateBlock: vi.fn((b: any, u: any) => {
      const t = doc[idx(b.id)];
      t.props = { ...t.props, ...u.props };
    }),
  };
}
const linkStore = () => ({ addLink: vi.fn(), removeLinksForBlock: vi.fn() });
const text = (b: any) => (b.content ?? []).map((c: any) => c.text).join("");

describe("segmentsToUtterances / cleanupToUtterances", () => {
  it("空の発言を除いて s1, s2, … を振る", () => {
    const u = segmentsToUtterances(segs);
    expect(u.map((x) => x.id)).toEqual(["s1", "s2", "s3"]);
    expect(u[2]).toEqual({ id: "s3", track: "mic", startMs: 50_000, text: "うん" });
  });
});

describe("buildCleanupDoc", () => {
  const u = segmentsToUtterances(segs);
  it("根拠の id を (track, startMs) に戻し、話者と開始時刻は根拠から取る", () => {
    const doc = buildCleanupDoc(
      [
        { text: "コード量がかなり増えたと感じています。プルリク 1 件あたりの変更ファイル数も増えました。", sources: ["s1", "s2"] },
        { text: "根拠なし", sources: ["zz"] },
        { text: "  ", sources: ["s3"] },
      ],
      u,
      "model-x",
      new Date("2026-10-20T00:00:00Z"),
    );
    expect(doc?.paragraphs).toEqual([
      {
        id: "c1",
        track: "system",
        startMs: 39_000,
        text: "コード量がかなり増えたと感じています。プルリク 1 件あたりの変更ファイル数も増えました。",
        sources: [
          { track: "system", startMs: 39_000 },
          { track: "system", startMs: 44_000 },
        ],
      },
    ]);
    expect(doc?.model).toBe("model-x");
    expect(doc?.createdAt).toBe("2026-10-20T00:00:00.000Z");
  });
  it("段落が残らなければ null", () => {
    expect(buildCleanupDoc([{ text: "x", sources: [] }], u, "m")).toBeNull();
  });
  it("時刻順に並べて c1, c2, … を振り直す", () => {
    const doc = buildCleanupDoc([{ text: "後", sources: ["s3"] }, { text: "先", sources: ["s1"] }], u, "m")!;
    expect(doc.paragraphs.map((p) => [p.id, p.text])).toEqual([["c1", "先"], ["c2", "後"]]);
    expect(cleanupToUtterances(doc).map((x) => x.id)).toEqual(["c1", "c2"]);
  });
});

describe("buildSummaryDoc", () => {
  const u = segmentsToUtterances(segs);
  const cleanup = buildCleanupDoc([{ text: "まとめた文", sources: ["s1", "s2"] }, { text: "相づち", sources: ["s3"] }], u, "m")!;
  it("清書から作ると、根拠は清書がまとめた元の発言まで戻す（重複は 1 つ）", () => {
    const doc = buildSummaryDoc(
      { decisions: [{ text: "決めた", sources: ["c1", "c1"] }], todos: [{ text: "やる", owner: "A", sources: ["c2"] }], issues: [], model: "m" },
      cleanupToUtterances(cleanup),
      cleanup,
    )!;
    expect(doc.basedOn).toBe("cleanup");
    expect(doc.decisions[0].sources).toEqual([
      { track: "system", startMs: 39_000 },
      { track: "system", startMs: 44_000 },
    ]);
    expect(doc.todos[0]).toEqual({ text: "やる", owner: "A", sources: [{ track: "mic", startMs: 50_000 }] });
  });
  it("文字起こしから作ると、根拠はその発言", () => {
    const doc = buildSummaryDoc({ decisions: [], todos: [], issues: [{ text: "論点", sources: ["s2"] }], model: "m" }, u, null)!;
    expect(doc.basedOn).toBe("transcript");
    expect(doc.issues[0].sources).toEqual([{ track: "system", startMs: 44_000 }]);
  });
  it("項目が無ければ null", () => {
    expect(buildSummaryDoc({ decisions: [], todos: [], issues: [], model: "m" }, u, null)).toBeNull();
  });
});

const summaryDoc: SummaryDoc = {
  version: 1,
  createdAt: "",
  model: "m",
  basedOn: "cleanup",
  decisions: [],
  todos: [{ text: "観点を決める", owner: "A", sources: [{ track: "system", startMs: 246_000 }, { track: "system", startMs: 66_000 }] }],
  issues: [{ text: "レビューが詰まる", sources: [] }],
};

describe("書き出しの組み立て", () => {
  it("要約の項目の後ろに根拠の時刻を付ける（早い順）", () => {
    const r = summaryDocToPlanInput(summaryDoc);
    expect(r.todos[0].text).toBe("観点を決める [01:06] [04:06]");
    expect(r.todos[0].owner).toBe("A");
    expect(r.issues[0].text).toBe("レビューが詰まる");
  });
  it("原本は見出し + 発言ごとの段落、清書は見出し + 注記 + 段落", () => {
    const t = buildTranscriptWriteOut(segs.slice(0, 1), labels);
    expect(t.map(text)).toEqual(["文字起こし", "[00:39] 相手: コード量すげえ増えたなっていうのと"]);
    const cleanup: CleanupDoc = {
      version: 1,
      createdAt: "",
      model: "m",
      paragraphs: [{ id: "c1", track: "mic", startMs: 5_000, text: "了解です。", sources: [] }],
    };
    expect(buildCleanupWriteOut(cleanup, labels).map(text)).toEqual(["清書", "AI が整えた文です", "[00:05] 自分: 了解です。"]);
  });
});

describe("writeOutAnchor / writeOutBlocks", () => {
  it("前に書き出したものの後ろに順に足し、各ブロックからこのブロックへ derived_from を張る", () => {
    const e = docEditor([{ id: "m", type: "meetingTranscript", props: {} }, { id: "after", type: "paragraph", props: {} }]);
    const ls = linkStore();
    const first = writeOutBlocks(e, ls, e.doc[0], [{ type: "paragraph", content: [] }], "system");
    const second = writeOutBlocks(e, ls, e.doc[0], [{ type: "paragraph", content: [] }, { type: "paragraph", content: [] }], "ai");
    expect(e.doc.map((b) => b.id)).toEqual(["m", ...first, ...second, "after"]);
    expect(JSON.parse(e.getBlock("m")!.props.writtenBlockIds)).toEqual([...first, ...second]);
    expect(ls.addLink).toHaveBeenCalledWith(
      expect.objectContaining({ sourceBlockId: second[0], targetBlockId: "m", type: "derived_from", createdBy: "ai" }),
    );
  });
  it("字下げして子になった書き出し済みのブロックも、文書全体から見つける", () => {
    const blocks: Record<string, any> = { m: { id: "m" }, a: { id: "a" }, b: { id: "b" }, c: { id: "c" } };
    const e = {
      // m の後ろに a（子に b）、その後ろに c。書き出したのは a と b
      document: [{ id: "m", children: [] }, { id: "a", children: [{ id: "b", children: [] }] }, { id: "c", children: [] }],
      getBlock: (id: string) => blocks[id],
    };
    expect(writeOutAnchor(e, blocks.m, ["a", "b"]).id).toBe("b");
    // 書き出し済みがブロックより前にしか無ければ、ブロックの直後
    expect(writeOutAnchor({ ...e, document: [{ id: "a", children: [] }, { id: "m", children: [] }] }, blocks.m, ["a"]).id).toBe("m");
  });
  it("書き出したブロックが消えていればブロックの直後", () => {
    const e = docEditor([{ id: "m", type: "meetingTranscript", props: {} }]);
    expect(writeOutAnchor(e, e.doc[0], ["gone"]).id).toBe("m");
  });
});

describe("writeOutSummary", () => {
  it("初回は書き出し済みの後ろ、2 回目は前回の要約の場所で差し替える", () => {
    const e = docEditor([{ id: "m", type: "meetingTranscript", props: {} }, { id: "tail", type: "paragraph", props: {} }]);
    const ls = linkStore();
    const cleanupIds = writeOutBlocks(e, ls, e.doc[0], [{ type: "paragraph", content: [] }], "ai");
    const ids1 = writeOutSummary(e, ls, e.doc[0], summaryDoc, labels)!;
    expect(e.doc.map((b) => b.id)).toEqual(["m", ...cleanupIds, ...ids1, "tail"]);
    // 項目（箇条書き）だけからブロックへ derived_from（ai）
    const bulletIds = ids1.filter((id) => e.getBlock(id)?.type === "bulletListItem");
    expect(ls.addLink.mock.calls.filter((c) => c[0].createdBy === "ai" && bulletIds.includes(c[0].sourceBlockId))).toHaveLength(bulletIds.length);
    const ids2 = writeOutSummary(e, ls, e.doc[0], summaryDoc, labels)!;
    expect(e.doc.map((b) => b.id)).toEqual(["m", ...cleanupIds, ...ids2, "tail"]);
    expect(ids1.every((id) => !e.getBlock(id))).toBe(true);
    const props = e.getBlock("m")!.props;
    expect(JSON.parse(props.summaryBlockIds)).toEqual(ids2);
    expect(JSON.parse(props.writtenBlockIds)).toEqual([...cleanupIds, ...ids2]);
  });
  it("項目の無い要約は書き出さない", () => {
    const e = docEditor([{ id: "m", type: "meetingTranscript", props: {} }]);
    expect(writeOutSummary(e, null, e.doc[0], { ...summaryDoc, todos: [], issues: [] }, labels)).toBeNull();
  });
});
