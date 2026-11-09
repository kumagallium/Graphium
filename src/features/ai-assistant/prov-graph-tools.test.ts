// 来歴の道具（agentic search の段 2）のテスト
// - find_notes_using: ラベルで横断し、出したノートに番号を振る。フォルダ範囲の外は出さない
// - get_note_steps: 手順を順に、手順ごとの材料・道具・条件と一緒に返す。#N / 題名で引ける
// - trace_lineage: PROV リンクの上流・下流を番号付きで返す。外部資料は名前で出す
// - データ未設定・未知の道具の扱い

import { beforeEach, describe, expect, it, vi } from "vitest";

const wikiTitles = vi.hoisted(() => new Map<string, string>());
const rememberMock = vi.hoisted(() => vi.fn());
vi.mock("../wiki/retriever", () => ({
  searchKnowledgeForTool: vi.fn(),
  readSourceForTool: vi.fn(),
  rememberCitedSource: rememberMock,
  getWikiTitleToIdMap: () => wikiTitles,
}));

import type { GraphiumDocument } from "../../lib/document-types";
import { buildIndexEntry, type NoteIndexEntry } from "../navigation/index-file";
import { runProvTool, setProvGraphData, type ProvToolContext } from "./prov-graph-tools";
import { createAgenticSearchSession } from "./agentic-search";

const t = (text: string, styles: Record<string, string> = {}) => ({ type: "text", text, styles });

/** 手順 2 つ（急冷 → SPS）。材料・道具・条件にラベル */
const quenchDoc = {
  title: "RuAl2 急冷 + SPS",
  pages: [
    {
      blocks: [
        {
          id: "s1",
          type: "step",
          content: [t("液体急冷")],
          children: [
            {
              id: "p1",
              type: "paragraph",
              content: [t("RuAl2", { inlineMaterial: "m1" }), t(" を "), t("Ar", { inlineAttribute: "a1" }), t(" 中で急冷")],
            },
          ],
        },
        {
          id: "s2",
          type: "step",
          content: [t("放電プラズマ焼結")],
          children: [
            {
              id: "p2",
              type: "paragraph",
              content: [t("SPS-515A", { inlineTool: "t1" }), t(" で "), t("1273 K", { inlineAttribute: "a2" })],
            },
          ],
        },
      ],
      provLinks: [],
    },
  ],
  sourcePdfFileId: "pdf1",
} as unknown as GraphiumDocument;

/** アーク溶解版。急冷ノートを上流（used）に持つ */
const arcDoc = {
  title: "RuAl2 アーク溶解",
  pages: [
    {
      blocks: [
        {
          id: "s9",
          type: "step",
          content: [t("アーク溶解")],
          children: [{ id: "p9", type: "paragraph", content: [t("RuAl2", { inlineMaterial: "m9" }), t(" を "), t("Ar", { inlineAttribute: "a9" })] }],
        },
      ],
      provLinks: [{ targetNoteId: "quench", sourceBlockId: "s9", targetBlockId: "s1", type: "used" }],
    },
  ],
} as unknown as GraphiumDocument;

const docs: Record<string, GraphiumDocument> = { quench: quenchDoc, arc: arcDoc };
const entries: NoteIndexEntry[] = Object.entries(docs).map(([id, d]) => buildIndexEntry(id, d));

function makeCtx(onlyIds?: Set<string>): ProvToolContext & { known: Map<number, string> } {
  const known = new Map<number, string>();
  let last = 10;
  return {
    known,
    onlyIds,
    titleOfNumber: (n) => known.get(n),
    cite: (_id, title) => {
      for (const [n, k] of known) if (k === title) return `[#${n} | "${title}"] (note)`;
      last += 1;
      known.set(last, title);
      return `[#${last} | "${title}"] (note)`;
    },
  };
}

beforeEach(() => {
  setProvGraphData({
    entries: () => entries,
    getCachedDoc: (key) => docs[key],
    media: () => [{ fileId: "pdf1", name: "79_JA201502.pdf", type: "pdf" } as never],
  });
});

describe("runProvTool", () => {
  it("来歴の道具でなければ null", async () => {
    expect(await runProvTool("search_my_knowledge", {}, makeCtx())).toBeNull();
  });

  it("データが渡されていなければ説明つきのエラー", async () => {
    setProvGraphData(null);
    expect(await runProvTool("list_entities", {}, makeCtx())).toMatch(/^Error: the note graph is not loaded/);
  });

  it("find_notes_using はラベルで横断し、ノートに番号を振る", async () => {
    const ctx = makeCtx();
    const out = (await runProvTool("find_notes_using", { text: "ar" }, ctx))!;
    expect(out).toContain("■ attribute: Ar — 2 note(s)");
    expect(out).toContain('[#11 | "RuAl2 急冷 + SPS"] (note)');
    expect(out).toContain('[#12 | "RuAl2 アーク溶解"] (note)');
    // label で絞れる（material の RuAl2 は出ない）
    const tools = (await runProvTool("find_notes_using", { text: "SPS", label: "tool" }, makeCtx()))!;
    expect(tools).toContain("tool: SPS-515A");
  });

  it("短い英数字の語は語の境界でだけ一致する（Ar が parameter に当たらない）", async () => {
    const extra = buildIndexEntry("param", {
      title: "パラメータのメモ",
      pages: [{ blocks: [{ id: "x", type: "paragraph", content: [t("Setting / parameter", { inlineAttribute: "z1" })] }] }],
    } as unknown as GraphiumDocument);
    setProvGraphData({ entries: () => [...entries, extra], getCachedDoc: (k) => docs[k], media: () => [] });
    const out = (await runProvTool("find_notes_using", { text: "Ar" }, makeCtx()))!;
    expect(out).not.toContain("parameter");
    expect(out).toContain("attribute: Ar");
    // 長い語・日本語は従来どおり部分一致
    expect(await runProvTool("find_notes_using", { text: "param" }, makeCtx())).toContain("Setting / parameter");
    expect(await runProvTool("find_notes_using", { text: "急冷" }, makeCtx())).toMatch(/^No notes/);
  });

  it("find_notes_using はフォルダ範囲の外のノートを出さない", async () => {
    const out = (await runProvTool("find_notes_using", { text: "Ar" }, makeCtx(new Set(["arc"]))))!;
    expect(out).toContain("1 note(s)");
    expect(out).not.toContain("急冷");
  });

  it("find_notes_using は見つからないとき代わりの道具を案内する", async () => {
    expect(await runProvTool("find_notes_using", { text: "存在しない" }, makeCtx())).toMatch(/^No notes label/);
    expect(await runProvTool("find_notes_using", {}, makeCtx())).toBe("Error: text is required.");
  });

  it("get_note_steps は手順を順に、手順ごとのラベルと一緒に返す（#N でも題名でも引ける）", async () => {
    const ctx = makeCtx();
    await runProvTool("find_notes_using", { text: "SPS" }, ctx); // #11 = 急冷ノート
    const out = (await runProvTool("get_note_steps", { ref: "#11" }, ctx))!;
    expect(out).toContain('[#11 | "RuAl2 急冷 + SPS"] (note)');
    expect(out).toContain("Steps (2, in order)");
    expect(out).toMatch(/1\. 液体急冷\n   material: RuAl2\n   attribute: Ar/);
    expect(out).toMatch(/2\. 放電プラズマ焼結\n   tool: SPS-515A\n   attribute: 1273 K/);
    expect(await runProvTool("get_note_steps", { ref: "RuAl2 アーク溶解" }, ctx)).toContain("1. アーク溶解");
    expect(await runProvTool("get_note_steps", { ref: "#99" }, ctx)).toMatch(/^Not found/);
  });

  it("get_note_steps はキャッシュに無いノートを loadDoc で読む", async () => {
    const loadDoc = vi.fn(async () => quenchDoc);
    setProvGraphData({ entries: () => entries, getCachedDoc: () => undefined, loadDoc, media: () => [] });
    const out = (await runProvTool("get_note_steps", { ref: "quench" }, makeCtx()))!;
    expect(loadDoc).toHaveBeenCalledWith("quench");
    expect(out).toContain("Steps (2, in order)");
  });

  it("trace_lineage は上流・下流を番号付きで返し、外部資料は名前で出す", async () => {
    const up = (await runProvTool("trace_lineage", { ref: "RuAl2 アーク溶解", direction: "upstream" }, makeCtx()))!;
    expect(up).toMatch(/\[prov\/used\] \[#\d+ \| "RuAl2 急冷 \+ SPS"\] \(note\)/);
    // 2 段目: 急冷ノートの元資料（PDF）が名前で出る
    expect(up).toContain("79_JA201502.pdf (source file)");

    const down = (await runProvTool("trace_lineage", { ref: "quench", direction: "downstream" }, makeCtx()))!;
    expect(down).toContain('"RuAl2 アーク溶解"');
    expect(down).toMatch(/Upstream[^\n]*\n  \(none\)/);
  });

  it("list_entities は記録されたラベルを横断件数の多い順に出す", async () => {
    const out = (await runProvTool("list_entities", {}, makeCtx()))!;
    const lines = out.split("\n").slice(1);
    expect(lines[0]).toMatch(/— 2 note\(s\)$/);
    expect(out).toContain("tool: SPS-515A — 1 note(s)");
  });
});

describe("セッションの道具の記録（経過表示の元）", () => {
  it("来歴の道具を道具一覧に足し、呼んだ順に件数つきで記録する", async () => {
    const onStep = vi.fn();
    const s = createAgenticSearchSession({ onStep });
    expect(s.toolNames).toEqual([
      "search_my_knowledge",
      "read_my_page",
      "find_notes_using",
      "get_note_steps",
      "trace_lineage",
      "list_entities",
    ]);
    await s.execute("find_notes_using", { text: "Ar" });
    await s.execute("get_note_steps", { ref: "#1" });
    await s.execute("find_notes_using", { text: "無い" });
    expect(s.steps()).toEqual([
      { tool: "find_notes_using", input: "Ar", hits: 2 },
      { tool: "get_note_steps", input: "RuAl2 急冷 + SPS", hits: 0 },
      { tool: "find_notes_using", input: "無い", hits: 0, empty: true },
    ]);
    expect(onStep).toHaveBeenCalledTimes(3);
    // 来歴の道具が振った番号は会話の番号空間に載り、引用の正規化に使える
    expect(s.collectedContext()).toContain('[#1 | "RuAl2 急冷 + SPS"] (note)');
  });
});

describe("同名のナレッジとの取り違えを防ぐ", () => {
  it("同名のナレッジがあるノートは題名に添え字を付けて引用し、番号から本体を引ける", async () => {
    wikiTitles.set("RuAl2 急冷 + SPS", "wiki-summary-1");
    try {
      const s = createAgenticSearchSession({});
      const out = await s.execute("find_notes_using", { text: "SPS" });
      const m = out.match(/\[#(\d+) \| "([^"]+)"\] \(note\)/)!;
      expect(m[2]).not.toBe("RuAl2 急冷 + SPS");
      expect(m[2].startsWith("RuAl2 急冷 + SPS")).toBe(true);
      // 引用リンクの解決先はノート（note:quench）として登録される
      expect(rememberMock).toHaveBeenCalledWith(m[2], "note:quench");
      // 番号で手順を読める（題名ではナレッジに当たらない）
      const steps = await s.execute("get_note_steps", { ref: `#${m[1]}` });
      expect(steps).toContain("Steps (2, in order)");
      // 同じノートは同じ番号のまま
      const again = await s.execute("trace_lineage", { ref: `#${m[1]}`, direction: "upstream" });
      expect(again).toContain(`[#${m[1]} |`);
    } finally {
      wikiTitles.clear();
    }
  });
});

// 本文の @ でつないだだけのノートは向きの無い「つながり」として上流・下流と分けて返す。
// 派生かどうかは相手の derivedFromNoteId で決まり、本体がキャッシュに無くても索引で見分ける
describe("trace_lineage のつながり", () => {
  const plain = (title: string, extra: Partial<GraphiumDocument> = {}) =>
    ({ title, pages: [{ blocks: [], provLinks: [] }], ...extra }) as unknown as GraphiumDocument;
  const link = (targetNoteId: string) => ({ targetNoteId, sourceBlockId: "b1", type: "derived_from" as const });

  // 10/19 の回が 9/24 の回を @ で引き、試作 6 は 10/19 の回から「派生」で作った
  const graphDocs: Record<string, GraphiumDocument> = {
    early: plain("9/24 の回"),
    late: plain("10/19 の回", { noteLinks: [link("early"), link("kid")] }),
    kid: plain("試作 6", { derivedFromNoteId: "late" }),
  };
  const graphEntries = Object.entries(graphDocs).map(([id, d]) => buildIndexEntry(id, d));

  it("@ のつながりは Connections に出し、派生させたノートだけを Downstream に出す", async () => {
    setProvGraphData({ entries: () => graphEntries, getCachedDoc: (k) => graphDocs[k], media: () => [] });
    const out = (await runProvTool("trace_lineage", { ref: "10/19 の回" }, makeCtx()))!;
    const [, afterDown] = out.split("Downstream (what was built from this note):");
    const [down, conn] = afterDown.split("Connections (");
    expect(down).toContain('"試作 6"');
    expect(down).not.toContain("9/24 の回");
    expect(conn).toMatch(/no direction/);
    expect(conn).toMatch(/\[connection\/reference\] \[#\d+ \| "9\/24 の回"\]/);

    // 引かれた側から辿っても上流には出ず、つながりとして出る
    const fromEarly = (await runProvTool("trace_lineage", { ref: "9/24 の回" }, makeCtx()))!;
    const [beforeConn, earlyConn] = fromEarly.split("Connections (");
    expect(beforeConn).not.toContain("10/19 の回");
    expect(earlyConn).toContain('"10/19 の回"');
  });

  it("相手の本体がキャッシュに無くても、索引の derivedFromNoteId で派生を見分ける", async () => {
    setProvGraphData({
      entries: () => graphEntries,
      // 起点のノートだけキャッシュにある（チャットの読み口はキャッシュしか見ない）
      getCachedDoc: (k) => (k === "late" ? graphDocs.late : undefined),
      media: () => [],
    });
    const out = (await runProvTool("trace_lineage", { ref: "10/19 の回", direction: "downstream" }, makeCtx()))!;
    const [down, conn] = out.split("Downstream (what was built from this note):")[1].split("Connections (");
    expect(down).toContain('"試作 6"');
    expect(conn).toContain('"9/24 の回"');
  });
});

describe("trace_lineage は開いていないノートも辿る", () => {
  // キャッシュには何も無い（アプリでどのノートも開いていない）
  const noCache = { entries: () => entries, getCachedDoc: () => undefined, media: () => [{ fileId: "pdf1", name: "79_JA201502.pdf", type: "pdf" } as never] };

  it("loadDoc が無くても索引の写しで上流・下流を出す", async () => {
    setProvGraphData(noCache);
    const out = (await runProvTool("trace_lineage", { ref: "RuAl2 急冷 + SPS" }, makeCtx()))!;
    const down = out.split("Downstream (what was built from this note):")[1].split("Connections (")[0];
    expect(down).toContain('"RuAl2 アーク溶解"');
  });

  it("来歴に出たノートだけ本体を読み足し、リンクの種類と取り込み元の資料まで本体と同じに出す", async () => {
    const loadDoc = vi.fn(async (id: string) => docs[id] ?? null);
    setProvGraphData({ ...noCache, loadDoc });
    const out = (await runProvTool("trace_lineage", { ref: "RuAl2 アーク溶解" }, makeCtx()))!;
    const up = out.split("Upstream (what this note was built from):")[1].split("Downstream (")[0];
    expect(up).toMatch(/\[prov\/used\] \[#\d+ \| "RuAl2 急冷 \+ SPS"\]/);
    expect(up).toContain("79_JA201502.pdf (source file)");
    expect(loadDoc.mock.calls.map(([id]) => id).sort()).toEqual(["arc", "quench"]);
  });
});

describe("trace_lineage がたどった線（チャットの横のグラフで描く）", () => {
  it("1 段目は起点から、2 段目はその手前のノートから、結果に出した分だけ知らせる", async () => {
    const walked: [string, string][] = [];
    const ctx = { ...makeCtx(), onWalk: (from: string, to: string) => walked.push([from, to]) };
    await runProvTool("trace_lineage", { ref: "RuAl2 アーク溶解", direction: "upstream" }, ctx);
    // arc → quench（1 段目）、quench → 元資料の PDF（2 段目）
    expect(walked[0]).toEqual(["arc", "quench"]);
    expect(walked.some(([from, to]) => from === "quench" && to.includes("pdf1"))).toBe(true);
  });

  it("セッションは向きを問わず同じ線を 1 本にまとめ、たどった順に返す", async () => {
    const s = createAgenticSearchSession({});
    await s.execute("trace_lineage", { ref: "RuAl2 アーク溶解", direction: "upstream" });
    await s.execute("trace_lineage", { ref: "quench", direction: "downstream" });
    const edges = s.walkedEdges();
    expect(edges[0]).toEqual({ from: "arc", to: "quench" });
    // quench → arc（下流）は arc → quench と同じ線なので増えない
    expect(edges.filter((e) => [e.from, e.to].sort().join() === "arc,quench")).toHaveLength(1);
  });
});
