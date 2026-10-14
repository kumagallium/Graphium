import { describe, it, expect, vi } from "vitest";
import type { GraphiumDocument, WikiMetaSummary } from "../../lib/document-types";
import {
  pickBackfillTargets,
  filterVisibleMetas,
  collectSourcesFor,
  siblingTitlesFor,
  toWikiMetaFrames,
  applyBackfillToDoc,
  runFrameBackfill,
  type BackfillDeps,
} from "./frame-backfill";

const meta = (o: Partial<WikiMetaSummary>): WikiMetaSummary => ({ title: "t", kind: "claim", ...o }) as WikiMetaSummary;

const makeDoc = (id: string, derived: string[], extra: object = {}): GraphiumDocument =>
  ({
    version: 1,
    title: `title-${id}`,
    pages: [{ id: "p", title: "p", blocks: [{ id: "b", type: "paragraph", content: [{ type: "text", text: "本文", styles: {} }] }] }],
    wikiMeta: { kind: "claim", derivedFromNotes: derived, claimRole: ["decision"], ...extra },
  }) as unknown as GraphiumDocument;

describe("pickBackfillTargets", () => {
  it("decision / principle の claim だけ、hasFrames 済みと claim 以外は除外", () => {
    const m = new Map<string, WikiMetaSummary>([
      ["a", meta({ claimRole: ["decision"] })],
      ["b", meta({ level: "principle" })],
      ["c", meta({ claimRole: ["decision"], hasFrames: true })],
      ["d", meta({ kind: "topic" as never, claimRole: ["decision"] })],
      ["e", meta({ claimRole: ["finding"] })],
    ]);
    expect(pickBackfillTargets(m).map((x) => x.id)).toEqual(["a", "b"]);
  });
});

describe("collectSourcesFor", () => {
  it("wiki id を除き、同じ id は 2 回取得しない", async () => {
    const resolveSource = vi.fn(async (id: string) => ({ ok: true as const, text: `T-${id}` }));
    const deps = { resolveSource, isWikiId: (id: string) => id === "w1" };
    const cache = new Map();
    const a = await collectSourcesFor({ derivedFromNotes: ["n1", "w1"] }, deps, cache);
    const b = await collectSourcesFor({ derivedFromNotes: ["n1"] }, deps, cache);
    expect(a.sources.map((s) => s.id)).toEqual(["n1"]);
    expect(b.sources).toHaveLength(1);
    expect(resolveSource).toHaveBeenCalledTimes(1);
  });
  it("出典が無い・読めない知見は理由付きでスキップ", async () => {
    const deps = { resolveSource: async () => ({ ok: false as const, reason: "deleted" }), isWikiId: () => false };
    expect((await collectSourcesFor({ derivedFromNotes: [] }, deps, new Map())).skippedReason).toBe("no-sources");
    expect((await collectSourcesFor({ derivedFromNotes: ["x"] }, deps, new Map())).skippedReason).toBe("deleted");
  });
});

describe("siblingTitlesFor", () => {
  it("自分を除き、上限で打ち切る", () => {
    const m = new Map<string, WikiMetaSummary>();
    m.set("me", meta({ derivedFromNotes: ["n1"] }));
    for (let i = 0; i < 60; i++) m.set(`s${i}`, meta({ title: `s${i}`, derivedFromNotes: ["n1"] }));
    m.set("other", meta({ derivedFromNotes: ["zzz"] }));
    const r = siblingTitlesFor("me", { derivedFromNotes: ["n1"] }, m);
    expect(r).toHaveLength(50);
    expect(r.some((x) => x.id === "me" || x.id === "other")).toBe(false);
    expect(siblingTitlesFor("me", { derivedFromNotes: ["n1"] }, m, 3)).toHaveLength(3);
  });
});

describe("toWikiMetaFrames", () => {
  const sib = [{ title: "きっかけ", id: "k1" }];
  it("trigger が解決できれば inferred、できなければ extracted", () => {
    const withT = toWikiMetaFrames({ id: "me", decisionFrame: { triggerTitles: ["きっかけ"], action: "a", rationale: "r" } }, sib, "me");
    expect(withT.decisionFrame).toMatchObject({ triggerClaimIds: ["k1"], reviewState: "inferred", inferredFields: ["trigger"], rationaleBy: "extracted" });
    const noT = toWikiMetaFrames({ id: "me", decisionFrame: { triggerTitles: ["無い"], action: "a", rationale: null } }, sib, "me");
    expect(noT.decisionFrame?.reviewState).toBe("extracted");
    expect(noT.decisionFrame?.inferredFields).toBeUndefined();
  });
  it("rule / observation は extracted", () => {
    const r = toWikiMetaFrames(
      { id: "me", ruleFrame: { conditions: [], consequences: [] }, observationFrame: { results: [] } },
      [],
      "me",
    );
    expect(r.ruleFrame?.reviewState).toBe("extracted");
    expect(r.observationFrame?.reviewState).toBe("extracted");
  });
});

function setup(over: Partial<BackfillDeps> = {}) {
  const docs = new Map<string, GraphiumDocument>([
    ["c1", makeDoc("c1", ["n1"])],
    ["c2", makeDoc("c2", ["n1"])],
  ]);
  const order: string[] = [];
  const saved: GraphiumDocument[] = [];
  const deps: BackfillDeps = {
    loadDoc: async (id) => docs.get(id) ?? null,
    resolveSource: async (id) => ({ ok: true, text: `T-${id}` }),
    isWikiId: () => false,
    wikiMetas: new Map([
      ["c1", meta({ derivedFromNotes: ["n1"], title: "c1" })],
      ["c2", meta({ derivedFromNotes: ["n1"], title: "c2" })],
    ]),
    callApi: async (req) => ({
      frames: [{ id: req.claims[0].id, decisionFrame: { triggerTitles: [], action: "a", rationale: null } }],
      droppedFrames: 1,
      truncatedSources: [],
    }),
    takeSnapshot: async () => {
      order.push("snap");
    },
    saveWiki: async (_id, d) => {
      order.push("save");
      saved.push(d);
      return true;
    },
    label: "L",
    ...over,
  };
  return { deps, docs, order, saved };
}
const targets = [
  { id: "c1", title: "c1" },
  { id: "c2", title: "c2" },
];

describe("runFrameBackfill", () => {
  it("版が保存より前、本文は不変、出典は 1 回だけ取得", async () => {
    const resolveSource = vi.fn(async (id: string) => ({ ok: true as const, text: `T-${id}` }));
    const { deps, docs, order, saved } = setup({ resolveSource });
    const before = JSON.stringify(docs.get("c1")!.pages[0].blocks);
    const s = await runFrameBackfill(targets, deps);
    expect(s.done).toHaveLength(2);
    expect(order).toEqual(["snap", "save", "snap", "save"]);
    expect(JSON.stringify(saved[0].pages[0].blocks)).toBe(before);
    expect(saved[0].wikiMeta?.decisionFrame?.action).toBe("a");
    expect(resolveSource).toHaveBeenCalledTimes(1);
    expect(s.droppedFrames).toBe(2);
  });
  it("API 失敗でも後続が続く", async () => {
    let n = 0;
    const base = setup();
    const { deps } = setup({
      callApi: async (req) => {
        if (n++ === 0) throw new Error("boom");
        return base.deps.callApi(req);
      },
    });
    const s = await runFrameBackfill(targets, deps);
    expect(s.failed).toHaveLength(1);
    expect(s.done.map((d) => d.id)).toEqual(["c2"]);
  });
  it("保存が一度 false でも再試行して成功する", async () => {
    let calls = 0;
    const { deps } = setup({ saveWiki: async () => ++calls > 1 });
    const s = await runFrameBackfill([targets[0]], deps);
    expect(calls).toBe(2);
    expect(s.done).toHaveLength(1);
  });
  it("出典が読めない知見はスキップ、frame 無し応答は版を取らない", async () => {
    const a = setup({ resolveSource: async () => ({ ok: false, reason: "deleted" }) });
    const s1 = await runFrameBackfill(targets, a.deps);
    expect(s1.skipped.map((x) => x.reason)).toEqual(["deleted", "deleted"]);
    const b = setup({ callApi: async () => ({ frames: [], droppedFrames: 0, truncatedSources: ["n1"] }) });
    const s2 = await runFrameBackfill([targets[0]], b.deps);
    expect(s2.skipped[0].reason).toBe("no-frame");
    expect(b.order).toEqual([]);
    expect(s2.truncatedSources).toEqual(["n1"]);
  });
});

describe("applyBackfillToDoc", () => {
  it("既存の confirmed frame は守られる", () => {
    const doc = makeDoc("c", ["n"], { decisionFrame: { triggerClaimIds: [], action: "人", rationale: "人の理由", rationaleBy: "human", reviewState: "confirmed" } });
    const out = applyBackfillToDoc(doc, { decisionFrame: { triggerClaimIds: [], action: "x", rationale: null, reviewState: "extracted" } });
    expect(out.wikiMeta?.decisionFrame?.action).toBe("人");
    expect(out.wikiMeta?.decisionFrame?.rationale).toBe("人の理由");
  });
});

describe("applyBackfillToDoc - asterism", () => {
  const set = { vocabBaseIri: "", typeSlugs: { observation: "", interpretation: "", rule: "rule", judgment: "judgment" } };
  const empty = { vocabBaseIri: "", typeSlugs: { observation: "", interpretation: "", rule: "", judgment: "" } };
  const frames = { statementForm: "general" as const };
  it("設定があれば typeSlug が付く", () => {
    const out = applyBackfillToDoc(makeDoc("c", ["n"], {}), frames, set);
    expect(out.wikiMeta?.asterism).toEqual({ typeSlug: "judgment", typeSlugBy: "auto" });
  });
  it("全て空なら付かない", () => {
    const out = applyBackfillToDoc(makeDoc("c", ["n"], {}), frames, empty);
    expect(out.wikiMeta?.asterism).toBeUndefined();
  });
});

describe("filterVisibleMetas", () => {
  it("ゴミ箱・アーカイブ（可視 id に無いもの）を対象にも兄弟にも含めない", () => {
    const m = new Map<string, WikiMetaSummary>([
      ["a", meta({ claimRole: ["decision"], derivedFromNotes: ["n"] })],
      ["trashed", meta({ claimRole: ["decision"], derivedFromNotes: ["n"] })],
    ]);
    const v = filterVisibleMetas(m, new Set(["a"]));
    expect(pickBackfillTargets(v).map((x) => x.id)).toEqual(["a"]);
    expect(siblingTitlesFor("a", { derivedFromNotes: ["n"] }, v)).toEqual([]);
  });
});

describe("runFrameBackfill の編集保護と中止", () => {
  const baseDeps = (over: Partial<BackfillDeps>): BackfillDeps => ({
    loadDoc: async () => makeDoc("a", ["n1"]),
    resolveSource: async () => ({ ok: true as const, text: "T" }),
    isWikiId: () => false,
    wikiMetas: new Map(),
    callApi: async () => ({
      frames: [{ id: "a", decisionFrame: { triggerTitles: [], action: "act", rationale: null } }],
      droppedFrames: 0,
      truncatedSources: [],
    }),
    takeSnapshot: async () => undefined,
    saveWiki: async () => true,
    label: "L",
    ...over,
  });

  it("API 待ちの間の編集を巻き戻さない（保存直前に読み直す）", async () => {
    let calls = 0;
    const saved: GraphiumDocument[] = [];
    const edited = { ...makeDoc("a", ["n1"]), title: "edited" } as GraphiumDocument;
    await runFrameBackfill([{ id: "a", title: "a" }], baseDeps({
      loadDoc: async () => (++calls === 1 ? makeDoc("a", ["n1"]) : edited),
      saveWiki: async (_id, d) => (saved.push(d), true),
    }));
    expect(saved).toHaveLength(1);
    expect(saved[0].title).toBe("edited");
    expect(saved[0].wikiMeta?.decisionFrame?.action).toBe("act");
  });

  it("signal が中止済みなら残りを処理しない", async () => {
    const ac = new AbortController();
    const callApi = vi.fn(async () => {
      ac.abort();
      throw new Error("aborted");
    });
    const r = await runFrameBackfill(
      [{ id: "a", title: "a" }, { id: "b", title: "b" }],
      baseDeps({ signal: ac.signal, callApi }),
    );
    expect(r.aborted).toBe(true);
    expect(callApi).toHaveBeenCalledTimes(1);
    expect(r.failed).toEqual([]);
  });

  it("エディタで開いている知見は API も版も保存もせずスキップ（frame が自動保存で消えるため）", async () => {
    const callApi = vi.fn(async (req: { claims: { id: string }[] }) => ({
      frames: [{ id: req.claims[0].id, decisionFrame: { triggerTitles: [], action: "a", rationale: null } }],
      droppedFrames: 0,
      truncatedSources: [],
    }));
    const { deps, order } = setup({ callApi, isOpenInEditor: (id) => id === "c1" });
    const r = await runFrameBackfill(targets, deps);
    expect(r.skipped).toEqual([{ id: "c1", title: "c1", reason: "open-in-editor" }]);
    expect(r.done.map((d) => d.id)).toEqual(["c2"]);
    expect(callApi).toHaveBeenCalledTimes(1);
    expect(order).toEqual(["snap", "save"]);
  });

  it("API 待ちの間に開かれた知見は保存しない", async () => {
    let open = false;
    const { deps, order } = setup({
      isOpenInEditor: () => open,
      callApi: async (req) => {
        open = true;
        return {
          frames: [{ id: req.claims[0].id, decisionFrame: { triggerTitles: [], action: "a", rationale: null } }],
          droppedFrames: 0,
          truncatedSources: [],
        };
      },
    });
    const r = await runFrameBackfill([targets[0]], deps);
    expect(r.skipped[0].reason).toBe("open-in-editor");
    expect(order).toEqual([]);
  });
});
