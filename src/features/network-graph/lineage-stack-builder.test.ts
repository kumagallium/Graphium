import { describe, it, expect } from "vitest";
import { buildLineageTree } from "./lineage-builder";
import { buildLineageStack, VIRTUAL_ROOT_ID, type LineageStackLabels } from "./lineage-stack-builder";
import type { GraphiumDocument, GraphiumFile } from "../../lib/document-types";
import type { MediaIndex } from "../asset-browser/media-index";
import type { ProcessIndex, ProcessIndexEntry } from "./process-index";

// ── テスト用の最小データ ──

const LABELS: LineageStackLabels = {
  wholeNote: "ノート全体から",
  sources: "出典",
  groupMaterials: "資料",
  groupNotes: "ノート",
  groupKnowledge: "知識",
  groupClaims: "知見",
  groupTopics: "話題",
};

type Blocks = Record<string, unknown>[];
const text = (t: string) => [{ type: "text", text: t, styles: {} }];
const heading = (id: string, t: string) => ({ id, type: "heading", content: text(t), children: [] });
const para = (id: string, t: string) => ({ id, type: "paragraph", content: text(t), children: [] });

function note(title: string, extra: Record<string, unknown> = {}, blocks: Blocks = []): GraphiumDocument {
  return { title, source: "human", pages: [{ id: "p", title, blocks }], ...extra } as unknown as GraphiumDocument;
}
function claim(title: string, derivedFromNotes: string[]): GraphiumDocument {
  return {
    title,
    source: "ai",
    pages: [{ id: "p", title, blocks: [] }],
    wikiMeta: { kind: "claim", derivedFromNotes, derivedFromChats: [] },
  } as unknown as GraphiumDocument;
}
function file(id: string): GraphiumFile {
  return { id, name: `${id}.graphium.json`, modifiedTime: "", createdTime: "" };
}

function build(
  currentId: string,
  docs: Map<string, GraphiumDocument>,
  opts: { media?: MediaIndex | null; processIndex?: ProcessIndex | null } = {},
) {
  const files = [...docs.keys()].map(file);
  const tree = buildLineageTree(currentId, files, docs, opts.media ?? null);
  return buildLineageStack({
    currentId,
    tree,
    files,
    docs,
    mediaIndex: opts.media ?? null,
    processIndex: opts.processIndex ?? null,
    labels: LABELS,
  });
}

function entry(noteId: string, title: string, partial: Partial<ProcessIndexEntry>): ProcessIndexEntry {
  return {
    noteId,
    title,
    sourceModifiedAt: "t",
    projectedAt: "t",
    graph: { steps: [], entities: [], edges: [] },
    summary: { stepCount: 0, materialCount: 0, toolCount: 0, outputCount: 0, branching: false },
    ...partial,
  } as ProcessIndexEntry;
}

describe("buildLineageStack — 起点と初期の開き方", () => {
  it("tree が null なら null", () => {
    const m = buildLineageStack({
      currentId: null,
      tree: null,
      files: [],
      docs: new Map(),
      mediaIndex: null,
      processIndex: null,
      labels: LABELS,
    });
    expect(m).toBeNull();
  });

  it("親なし: root = current、path は 1 つ", () => {
    const m = build("a", new Map([["a", note("A")]]))!;
    expect(m.rootId).toBe("a");
    expect(m.initialPath).toEqual(["a"]);
    expect(m.nodes.a.isCurrent).toBe(true);
    expect(m.nodes.a.open).toEqual({ type: "note", navId: "a" });
  });

  it("祖父 → 親 → current の一本道: root = 祖父、path 3 つ", () => {
    const docs = new Map([
      ["gp", note("祖父")],
      ["p", note("親", { derivedFromNoteId: "gp" })],
      ["c", note("子", { derivedFromNoteId: "p" })],
    ]);
    const m = build("c", docs)!;
    expect(m.rootId).toBe("gp");
    expect(m.initialPath).toEqual(["gp", "p", "c"]);
    expect(m.nodes.gp.groups[0].children).toEqual(["p"]);
    expect(m.nodes.p.groups[0].children).toEqual(["c"]);
  });

  it("知識が pdf とノートの 2 つの出典を持つ: 仮想ルートで資料とノートの 2 箱", () => {
    const docs = new Map([
      ["n1", note("元ノート")],
      ["k", claim("知見K", ["pdf:m1", "n1"])],
    ]);
    const media = {
      version: 2,
      updatedAt: "",
      media: [{ fileId: "m1", name: "paper.pdf", type: "pdf", mimeType: "application/pdf", url: "cdn://m1", thumbnailUrl: "", uploadedAt: "", usedIn: [] }],
    } as unknown as MediaIndex;
    const m = build("k", docs, { media })!;
    expect(m.rootId).toBe(VIRTUAL_ROOT_ID);
    expect(m.nodes[VIRTUAL_ROOT_ID].kind).toBe("root");
    expect(m.nodes[VIRTUAL_ROOT_ID].groups.map((g) => g.label)).toEqual(["資料", "ノート"]);
    expect(m.initialPath[0]).toBe(VIRTUAL_ROOT_ID);
    expect(m.initialPath[m.initialPath.length - 1]).toBe("k");
    expect(m.nodes["pdf:m1"].kind).toBe("asset");
    expect(m.nodes["pdf:m1"].open).toEqual({ type: "media", fileId: "m1" });
    expect(m.nodes.k.kind).toBe("knowledge");
    expect(m.nodes.k.open).toEqual({ type: "note", navId: "wiki:k" });
    expect(m.nodes.k.sources).toEqual(expect.arrayContaining(["paper.pdf", "元ノート"]));
  });
});

describe("buildLineageStack — 見出しによる箱分け", () => {
  it("見出し A/B の箱 + ブロック id 無しは「ノート全体から」が最後", () => {
    const blocks = [
      heading("h1", "見出しA"),
      para("b1", "x"),
      para("b2", "y"),
      heading("h2", "見出しB"),
      para("b3", "z"),
    ];
    const docs = new Map([
      ["p", note("親", {}, blocks)],
      ["c1", note("子1", { derivedFromNoteId: "p", derivedFromBlockId: "b1" })],
      ["c2", note("子2", { derivedFromNoteId: "p", derivedFromBlockId: "b2" })],
      ["c3", note("子3", { derivedFromNoteId: "p", derivedFromBlockId: "b3" })],
      ["c4", note("子4", { derivedFromNoteId: "p" })],
    ]);
    const m = build("c1", docs)!;
    const groups = m.nodes.p.groups;
    expect(groups.map((g) => g.label)).toEqual(["見出しA", "見出しB", "ノート全体から"]);
    expect(groups[0].children).toEqual(["c1", "c2"]);
    expect(groups[1].children).toEqual(["c3"]);
    expect(groups[2].children).toEqual(["c4"]);
  });

  it("noteLinks(derived_from) 経由の子も同じ箱に入り、両経路で来ても 1 つ", () => {
    const docs = new Map([
      ["p", note("親", { noteLinks: [{ targetNoteId: "c", sourceBlockId: "b1", type: "derived_from" }] }, [heading("h1", "見出しA"), para("b1", "x")])],
      ["c", note("子", { derivedFromNoteId: "p", derivedFromBlockId: "b1" })],
    ]);
    const m = build("c", docs)!;
    expect(m.nodes.p.groups).toHaveLength(1);
    expect(m.nodes.p.groups[0].children).toEqual(["c"]);
  });
});

describe("buildLineageStack — 手順ノートの中身", () => {
  it("processIndex がある子は proc: steps / inputFrom / outputs と、隣の札との links", () => {
    const docs = new Map([
      ["p", note("親")],
      ["c1", note("生地ノート", { derivedFromNoteId: "p" })],
      ["c2", note("焼成ノート", { derivedFromNoteId: "p" })],
    ]);
    const c1 = entry("c1", "生地ノート", {
      graph: {
        steps: [{ id: "s1", name: "混ぜる", params: [] }],
        entities: [{ id: "o1", label: "生地", kind: "output", attrs: [] }],
        edges: [{ id: "e1", kind: "generates", source: "s1", target: "o1" }],
      },
    } as unknown as Partial<ProcessIndexEntry>);
    const c2 = entry("c2", "焼成ノート", {
      graph: {
        steps: [{ id: "s2", name: "焼く", params: [] }],
        entities: [{ id: "o2", label: "パン", kind: "output", attrs: [] }],
        edges: [{ id: "e2", kind: "generates", source: "s2", target: "o2" }],
      },
      crossNoteLinks: [
        {
          id: "l1",
          sourceBlockId: "s2",
          targetBlockId: "s1",
          type: "informed_by",
          layer: "prov",
          createdBy: "human",
          targetNoteId: "c1",
          targetEntityId: "o1",
        },
      ],
    } as unknown as Partial<ProcessIndexEntry>);
    const processIndex = { version: 5, updatedAt: "", processes: [c1, c2] } as ProcessIndex;
    const m = build("c2", docs, { processIndex })!;
    expect(m.nodes.c1.kind).toBe("proc");
    expect(m.nodes.c1.outputs).toEqual(["生地"]);
    expect(m.nodes.c2.steps).toEqual([{ name: "焼く", inputFrom: "生地ノート · 生地" }]);
    expect(m.nodes.c2.outputs).toEqual(["パン"]);
    expect(m.nodes.p.links).toEqual([{ from: "c1", to: "c2" }]);
    expect(m.nodes.p.kind).toBe("text");
  });
});

describe("buildLineageStack — 1 箱の上限", () => {
  it("21 件 → 20 件 + more 1。ただし経路上の子は残る", () => {
    const docs = new Map<string, GraphiumDocument>([["p", note("親")]]);
    for (let i = 0; i < 20; i++) {
      docs.set(`c${String(i).padStart(2, "0")}`, note(`子${String(i).padStart(2, "0")}`, { derivedFromNoteId: "p" }));
    }
    // title 順で最後になる子を current（経路上）にする
    docs.set("zz", note("子zz", { derivedFromNoteId: "p" }));
    const m = build("zz", docs)!;
    const g = m.nodes.p.groups[0];
    expect(g.children).toHaveLength(20);
    expect(g.more).toBe(1);
    expect(g.children).toContain("zz");
    expect(m.initialPath).toEqual(["p", "zz"]);
  });

  it("上限以内なら more を付けない", () => {
    const docs = new Map<string, GraphiumDocument>([
      ["p", note("親")],
      ["c", note("子", { derivedFromNoteId: "p" })],
    ]);
    const m = build("c", docs)!;
    expect(m.nodes.p.groups[0].more).toBeUndefined();
  });
});

describe("buildLineageStack — 大量の派生", () => {
  it("見出し 300 × 子 20 でも、ノード数 ≤ 400・1 段の札 ≤ 60・経路は壊れず、速い", () => {
    const blocks: Blocks = [];
    const docs = new Map<string, GraphiumDocument>();
    for (let h = 0; h < 300; h++) {
      blocks.push(heading(`h${h}`, `見出し${String(h).padStart(3, "0")}`));
      for (let c = 0; c < 20; c++) {
        const bid = `b${h}-${c}`;
        blocks.push(para(bid, "x"));
        docs.set(`c${h}-${c}`, note(`子${h}-${c}`, { derivedFromNoteId: "p", derivedFromBlockId: bid }));
      }
    }
    docs.set("p", note("親", {}, blocks));
    const files = [...docs.keys()].map(file);
    const tree = buildLineageTree("c250-7", files, docs, null);
    const t0 = performance.now();
    const m = buildLineageStack({
      currentId: "c250-7",
      tree,
      files,
      docs,
      mediaIndex: null,
      processIndex: null,
      labels: LABELS,
    })!;
    const elapsed = performance.now() - t0;
    expect(Object.keys(m.nodes).length).toBeLessThanOrEqual(400);
    const cards = m.nodes.p.groups.reduce((n, g) => n + g.children.length, 0);
    expect(cards).toBeLessThanOrEqual(60);
    expect(m.initialPath).toEqual(["p", "c250-7"]);
    expect(m.nodes.p.groups.some((g) => g.children.includes("c250-7"))).toBe(true);
    expect(m.nodes.p.groups.some((g) => g.children.length === 0 && (g.more ?? 0) > 0)).toBe(true);
    expect(elapsed).toBeLessThan(200);
  });
});
