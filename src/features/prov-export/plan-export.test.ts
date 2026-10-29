// 計画の書き出し（buildPlanProvJsonLd）のテスト
// fixture はパン作りの世界観: 計画「春のカンパーニュ試作」→ 工程 生地 / 焼成 / 試食
//   予定: 生地 → 焼成（計画どおりに実績もある）、焼成 → 試食（予定だけ。実績は無い）
//   実績: 試食 ← 生地（予定に無い受け渡し = 計画外）

import { describe, it, expect } from "vitest";
import { buildPlanProvJsonLd, type PlanProvExportInput } from "./plan-export";
import { generateProvDocument, type ProvJsonLd } from "../prov-generator/generator";
import type { GraphiumDocument, GraphiumPage } from "../../lib/document-types";
import type { GraphiumIndex } from "../navigation/index-file";
import type { W3CProvNode } from "./export-jsonld";

// ── ブロックの fixture ──

const text = (t: string, styles: Record<string, unknown> = {}) => [{ type: "text", text: t, styles }];
const heading = (id: string, t: string) => ({
  id,
  type: "heading",
  props: { level: 2 },
  content: text(t),
  children: [],
});
const para = (id: string, t: string) => ({ id, type: "paragraph", content: text(t), children: [] });
/** セルの先頭に tableRowIdentity を付けられる表 */
function table(id: string, rows: string[][], identities: (string | undefined)[] = []) {
  return {
    id,
    type: "table",
    content: {
      type: "tableContent",
      rows: rows.map((cells, i) => ({
        cells: cells.map((c, j) =>
          text(c, i > 0 && j === 0 && identities[i - 1] ? { tableRowIdentity: identities[i - 1] } : {}),
        ),
      })),
    },
    children: [],
  };
}

type NoteFixture = {
  provDoc: ProvJsonLd;
  title: string;
  page: GraphiumPage;
};

/** 手順 1 つ + 結果表（行 identity 付き）を持つ工程ノート */
function procNote(opts: {
  id: string;
  title: string;
  results: { name: string; identity: string }[];
  link?: { targetNoteId: string; targetEntityId: string; sourceEntityId?: string; stable?: boolean };
  materialRowIdentity?: string;
  /** ブロック ID の接頭辞（既定はノート ID）。別ノートで同じ内側 ID を再現するときに使う */
  bp?: string;
  documentProvenance?: any;
}): NoteFixture {
  const bp = opts.bp ?? opts.id;
  const blocks: any[] = [heading(`${bp}-h`, `${opts.title}する`), para(`${bp}-p`, "手でこねる")];
  const labels: Record<string, string> = { [`${bp}-h`]: "procedure" };
  if (opts.materialRowIdentity) {
    blocks.push(table(`${bp}-mat`, [["名前", "量"], ["仕込み生地", "500g"]], [opts.materialRowIdentity]));
    labels[`${bp}-mat`] = "material";
  }
  blocks.push(
    table(
      `${bp}-res`,
      [["名前", "状態"], ...opts.results.map((r) => [r.name, "良好"])],
      opts.results.map((r) => r.identity),
    ),
  );
  labels[`${bp}-res`] = "output";
  const links = opts.link
    ? [
        {
          id: `${opts.id}-link`,
          sourceBlockId: `${bp}-h`,
          targetBlockId: `${opts.link.targetNoteId}-h`,
          type: "informed_by" as const,
          layer: "prov" as const,
          createdBy: "human" as const,
          targetNoteId: opts.link.targetNoteId,
          targetEntityId: opts.link.targetEntityId,
          ...(opts.link.sourceEntityId ? { sourceEntityId: opts.link.sourceEntityId } : {}),
          ...(opts.link.stable === false ? { targetEntityStable: false } : {}),
        },
      ]
    : [];
  const page = { id: "p1", title: opts.title, blocks, labels, provLinks: [], knowledgeLinks: [] } as unknown as GraphiumPage;
  const provDoc = generateProvDocument({
    blocks,
    labels: new Map(Object.entries(labels)),
    links: links as any,
    ...(opts.documentProvenance ? { documentProvenance: opts.documentProvenance } : {}),
  });
  return { provDoc, title: opts.title, page };
}

const emptyNote = (id: string, title: string): NoteFixture => procNote({ id, title, results: [] });

// ── 計画ノート ──

const cellText = (t: string) => text(t);
function planTable(id: string, rows: string[][]) {
  return {
    id,
    type: "table",
    content: { type: "tableContent", rows: rows.map((cells) => ({ cells: cells.map(cellText) })) },
    children: [],
  };
}

function docOf(title: string, blocks: unknown[], tableMeta: Record<string, unknown> = {}, extra: Partial<GraphiumDocument> = {}): GraphiumDocument {
  return {
    version: 2,
    title,
    pages: [{ id: "p1", title, blocks, labels: {}, provLinks: [], knowledgeLinks: [], tableMeta }],
    createdAt: "2026-09-01T00:00:00.000Z",
    modifiedAt: "2026-09-01T00:00:00.000Z",
    ...extra,
  } as unknown as GraphiumDocument;
}

/** 親計画「春のカンパーニュ試作」の doc。表の列: 工程 / 入力元 / 温度 / 発酵 時間（空白入りの列名） */
function rootPlanDoc(): GraphiumDocument {
  return docOf(
    "春のカンパーニュ試作",
    [
      planTable("t1", [
        ["工程", "入力元", "温度", "発酵 時間"],
        ["生地", "", "24 ℃", "90 分"],
        ["焼成", "生地", "230 ℃", ""],
        ["試食", "焼成", "", ""],
      ]),
    ],
    {
      t1: {
        caption: "試作の工程",
        noteLinks: { 生地: "dough", 焼成: "bake", 試食: "tasting" },
        columns: { 工程: ["note-link"], 入力元: ["planned-input"] },
        edgeLabels: { 焼成: { 生地: "仕込み生地" }, 試食: { 焼成: "焼きたて" } },
      },
    },
  );
}

function makeIndex(extra: { noteId: string; title: string; noteContexts?: string[]; deletedAt?: string; archivedAt?: string }[] = []): GraphiumIndex {
  const base = [
    { noteId: "plan", title: "春のカンパーニュ試作", noteContexts: ["計画"] },
    { noteId: "dough", title: "生地" },
    { noteId: "bake", title: "焼成" },
    { noteId: "tasting", title: "試食" },
    ...extra,
  ];
  return {
    version: 32,
    updatedAt: "2026-09-01T00:00:00.000Z",
    notes: base.map((n) => ({
      modifiedAt: "2026-09-01T00:00:00.000Z",
      createdAt: "2026-09-01T00:00:00.000Z",
      headings: [],
      labels: [],
      outgoingLinks: [],
      ...n,
    })),
  } as unknown as GraphiumIndex;
}

const BUNDLE = (agentLabel: string): any => ({
  "@type": "prov:Bundle",
  "@graph": [
    { "@id": "agent_h", "@type": "prov:Agent", "rdfs:label": agentLabel, "graphium:agentType": "human" },
    {
      "@id": "edit_1",
      "@type": "prov:Activity",
      "graphium:editType": "human_edit",
      "prov:startedAtTime": "2026-06-05T00:00:00Z",
      "prov:endedAtTime": "2026-06-05T00:01:00Z",
      "prov:wasAssociatedWith": { "@id": "agent_h" },
    },
    {
      "@id": "rev_1",
      "@type": "prov:Entity",
      "prov:generatedAtTime": "2026-06-05T00:01:00Z",
      "prov:wasGeneratedBy": { "@id": "edit_1" },
      "graphium:contentHash": "abc",
    },
  ],
});

/** 親計画 + 工程 3 ノート。dough の出力「仕込み生地」を bake と tasting が使う */
function baseInput(over: Partial<PlanProvExportInput> = {}): PlanProvExportInput {
  const dough = procNote({
    id: "dough",
    title: "生地",
    results: [{ name: "仕込み生地", identity: "row_dough" }],
    documentProvenance: undefined,
  });
  // 編集履歴 Bundle は provDoc に直接足す（generateProvDocument の入力形に依存しない）
  dough.provDoc = { ...dough.provDoc, "graphium:documentProvenance": BUNDLE("パン職人") };
  const bake = procNote({
    id: "bake",
    title: "焼成",
    results: [{ name: "カンパーニュ", identity: "row_loaf" }],
    materialRowIdentity: "row_in",
    link: { targetNoteId: "dough", targetEntityId: "row_dough", sourceEntityId: "row_in" },
  });
  const tasting = procNote({
    id: "tasting",
    title: "試食",
    results: [],
    link: { targetNoteId: "dough", targetEntityId: "row_dough" },
  });
  const notes: PlanProvExportInput["notes"] = new Map([
    ["plan", planNote("plan", "春のカンパーニュ試作")],
    ["dough", dough],
    ["bake", bake],
    ["tasting", tasting],
  ]);
  return {
    planNoteId: "plan",
    index: makeIndex(),
    docs: new Map([["plan", rootPlanDoc()]]),
    notes,
    ...over,
  };
}

// ── 検査の道具 ──

const graphOf = (input: PlanProvExportInput) => buildPlanProvJsonLd(input)["@graph"];
const byId = (g: W3CProvNode[], id: string) => g.find((n) => n["@id"] === id);
const typesOf = (n: W3CProvNode | undefined): string[] => (n ? ([] as string[]).concat(n["@type"] as any) : []);
const PLAN = "graphium:note/plan";
const step = (name: string, plan = "plan") => `graphium:note/${plan}/step/${encodeURIComponent(name)}`;
const variable = (a: string, b: string, plan = "plan") =>
  `graphium:note/${plan}/var/${encodeURIComponent(a)}/${encodeURIComponent(b)}`;
const ofType = (g: W3CProvNode[], type: string) => g.filter((n) => typesOf(n).includes(type));
const warnings = (g: W3CProvNode[]) => ofType(g, "graphium:Warning");
const warningsOf = (g: W3CProvNode[], type: string) => warnings(g).filter((w) => w["graphium:warningType"] === type);

const REF_STRING_KEYS = new Set(["activity", "entity", "agent", "usedEntity", "generatedEntity"]);
function collectDeclared(nodes: any[], out: Set<string>): void {
  for (const n of nodes) {
    if (n && typeof n === "object" && typeof n["@id"] === "string" && n["@type"] !== undefined) out.add(n["@id"]);
    if (Array.isArray(n?.["@graph"])) collectDeclared(n["@graph"], out);
  }
}
function collectRefs(value: any, out: string[], key = ""): void {
  if (Array.isArray(value)) {
    for (const v of value) collectRefs(v, out, key);
    return;
  }
  if (typeof value === "string") {
    if (REF_STRING_KEYS.has(key)) out.push(value);
    return;
  }
  if (!value || typeof value !== "object") return;
  const keys = Object.keys(value);
  if (keys.length === 1 && keys[0] === "@id") {
    out.push(value["@id"]);
    return;
  }
  for (const [k, v] of Object.entries(value)) {
    if (k === "@id" || k === "@type") continue;
    collectRefs(v, out, k);
  }
}
function danglingRefs(graph: W3CProvNode[]): string[] {
  const declared = new Set<string>();
  collectDeclared(graph, declared);
  const refs: string[] = [];
  collectRefs(graph, refs);
  return [...new Set(refs)].filter((r) => (r.startsWith("graphium:") || r.startsWith("_:")) && !declared.has(r));
}
function stubAndBodyIds(graph: W3CProvNode[]): string[] {
  const ext = new Set<string>();
  const body = new Set<string>();
  const walk = (nodes: any[]) => {
    for (const n of nodes) {
      if (typeof n?.["@id"] !== "string") continue;
      (n["graphium:external"] === true ? ext : body).add(n["@id"]);
      if (Array.isArray(n["@graph"])) walk(n["@graph"]);
    }
  };
  walk(graph);
  return [...ext].filter((id) => body.has(id));
}

/** 実績の受け渡し（Usage）を { 受け側 Activity → 供給側 Entity } で引く */
const usages = (g: W3CProvNode[]) => ofType(g, "Usage").filter((n) => n["@id"].includes("cross_note_"));
const derivations = (g: W3CProvNode[]) => ofType(g, "Derivation").filter((n) => n["@id"].includes("cross_note_"));

// ── 計画ノートの doc を作る道具 ──

/** 計画ノートの doc。表は 1 つ: 工程 / 入力元 の 2 列（+ 追加列） */
function planDocOf(opts: {
  title: string;
  rows: string[][];
  noteLinks: Record<string, string>;
  edgeLabels?: Record<string, Record<string, string>>;
  extraHeaders?: string[];
}): GraphiumDocument {
  const headers = ["工程", "入力元", ...(opts.extraHeaders ?? [])];
  return docOf(
    opts.title,
    [planTable("t1", [headers, ...opts.rows])],
    {
      t1: {
        noteLinks: opts.noteLinks,
        columns: { 工程: ["note-link"], 入力元: ["planned-input"] },
        ...(opts.edgeLabels ? { edgeLabels: opts.edgeLabels } : {}),
      },
    },
  );
}

/** 計画ノートそのものの内容（手順 1 つ） */
const planNote = (id: string, title: string) => procNote({ id, title, results: [] });

type NoteEntry = PlanProvExportInput["notes"] extends Map<string, infer V> ? V : never;
const entryMap = (entries: Record<string, NoteEntry>): PlanProvExportInput["notes"] => new Map(Object.entries(entries));

// ────────────────────────────────────────────
// Plan / Step / Variable
// ────────────────────────────────────────────

describe("buildPlanProvJsonLd — Plan / Step / Variable", () => {
  it("@context はノート書き出しと同じ（p-plan / oa / dc を末尾追加）", () => {
    const doc = buildPlanProvJsonLd(baseInput());
    const [local, remote] = doc["@context"];
    expect(local["p-plan"]).toBe("http://purl.org/net/p-plan#");
    expect(local.oa).toBe("http://www.w3.org/ns/oa#");
    expect(local.dc).toBe("http://purl.org/dc/elements/1.1/");
    expect(remote).toBe("https://openprovenance.org/prov-jsonld/context.jsonld");
  });

  it("Plan は計画ノート Entity と同一の IRI で、型が Entity / prov:Plan / p-plan:Plan", () => {
    const g = graphOf(baseInput());
    const plan = byId(g, PLAN)!;
    expect(typesOf(plan)).toEqual(["Entity", "prov:Plan", "p-plan:Plan"]);
    expect(plan.label).toEqual([{ "@value": "春のカンパーニュ試作" }]);
    expect(g.filter((n) => n["@id"] === PLAN)).toHaveLength(1);
    // ノート Entity と同一ノードなので、本文 Entity（specializationOf Plan）も並ぶ
    const body = g.find((n) => n["@id"].startsWith(`${PLAN}/text/`));
    expect(body?.["prov:specializationOf"]).toEqual({ "@id": PLAN });
  });

  it("計画ノートが notes に無くても Plan は出る（label は索引の題名）", () => {
    const input = baseInput();
    input.notes.delete("plan");
    const plan = byId(graphOf(input), PLAN)!;
    expect(typesOf(plan)).toEqual(["Entity", "prov:Plan", "p-plan:Plan"]);
    expect(plan.label).toEqual([{ "@value": "春のカンパーニュ試作" }]);
  });

  it("行ごとに p-plan:Step が出て、isStepOfPlan・表の位置・行名が付く", () => {
    const g = graphOf(baseInput());
    const steps = ofType(g, "p-plan:Step");
    expect(steps.map((s) => s["@id"])).toEqual([step("生地"), step("焼成"), step("試食")]);
    const bake = byId(g, step("焼成"))!;
    expect(bake["@type"]).toBe("p-plan:Step");
    expect(bake.label).toEqual([{ "@value": "焼成" }]);
    expect(bake["p-plan:isStepOfPlan"]).toEqual({ "@id": PLAN });
    expect(bake["rdfs:seeAlso"]).toEqual({ "@id": "graphium:note/bake" });
    expect(bake["graphium:tableBlockId"]).toBe("t1");
    expect(bake["graphium:tableCaption"]).toBe("試作の工程");
    expect(bake["graphium:rowIndex"]).toBe(2);
    // graphium:noteId は付けない
    expect(bake["graphium:noteId"]).toBeUndefined();
  });

  it("行名の先頭 @ は label から外し、IRI は正規化名（小文字・@ なし）で作る", () => {
    const input = baseInput({
      docs: new Map([
        [
          "plan",
          planDocOf({ title: "計画", rows: [["@Dough", ""]], noteLinks: { "@Dough": "dough" } }),
        ],
      ]),
    });
    const g = graphOf(input);
    const s = byId(g, step("dough"))!;
    expect(s.label).toEqual([{ "@value": "Dough" }]);
  });

  it("条件セルが graphium:condition に列順で残り、空白入りの列名もそのまま出る", () => {
    const g = graphOf(baseInput());
    expect(byId(g, step("生地"))!["graphium:condition"]).toEqual([
      { "rdfs:label": "温度", "rdf:value": "24 ℃" },
      { "rdfs:label": "発酵 時間", "rdf:value": "90 分" },
    ]);
    // 空セルは含めない
    expect(byId(g, step("焼成"))!["graphium:condition"]).toEqual([{ "rdfs:label": "温度", "rdf:value": "230 ℃" }]);
    // 条件が 1 つも無い行はキーごと出さない
    expect(byId(g, step("試食"))!["graphium:condition"]).toBeUndefined();
  });

  it("予定の線: Variable と isPreceededBy / hasOutputVar / hasInputVar / isInputVarOf / isOutputVarOf", () => {
    const g = graphOf(baseInput());
    const v = byId(g, variable("生地", "焼成"))!;
    expect(v["@type"]).toBe("p-plan:Variable");
    expect(v.label).toEqual([{ "@value": "仕込み生地" }]); // 線の名前（予定）
    expect(v["p-plan:isVariableOfPlan"]).toEqual({ "@id": PLAN });
    expect(v["p-plan:isOutputVarOf"]).toEqual({ "@id": step("生地") });
    expect(v["p-plan:isInputVarOf"]).toEqual({ "@id": step("焼成") });

    expect(byId(g, step("生地"))!["p-plan:hasOutputVar"]).toEqual([{ "@id": variable("生地", "焼成") }]);
    expect(byId(g, step("焼成"))!["p-plan:hasInputVar"]).toEqual([{ "@id": variable("生地", "焼成") }]);
    // 綴りは公式 N3 の isPreceededBy（e が 2 つ）
    expect(byId(g, step("焼成"))!["p-plan:isPreceededBy"]).toEqual([{ "@id": step("生地") }]);
    expect(byId(g, step("試食"))!["p-plan:isPreceededBy"]).toEqual([{ "@id": step("焼成") }]);
    expect(byId(g, step("生地"))!["p-plan:isPreceededBy"]).toBeUndefined();
    expect(JSON.stringify(g)).not.toContain("isPrecededBy");
  });

  it("線の名前が無い予定の線は Variable に label を付けない", () => {
    const input = baseInput({
      docs: new Map([
        ["plan", planDocOf({ title: "計画", rows: [["生地", ""], ["焼成", "生地"]], noteLinks: { 生地: "dough", 焼成: "bake" } })],
      ]),
    });
    expect(byId(graphOf(input), variable("生地", "焼成"))!.label).toBeUndefined();
  });

  it("入力元が複数なら Variable も複数、同じ名前の重複は 1 本にまとまる", () => {
    const input = baseInput({
      docs: new Map([
        [
          "plan",
          planDocOf({
            title: "計画",
            rows: [["生地", ""], ["具材", ""], ["焼成", "生地、具材、@生地"]],
            noteLinks: { 生地: "dough", 具材: "tasting", 焼成: "bake" },
          }),
        ],
      ]),
    });
    const g = graphOf(input);
    expect(ofType(g, "p-plan:Variable")).toHaveLength(2);
    expect(byId(g, step("焼成"))!["p-plan:isPreceededBy"]).toEqual([{ "@id": step("生地") }, { "@id": step("具材") }]);
  });

  it("自己参照の入力元は捨てる（Variable も警告も出ない）", () => {
    const input = baseInput({
      docs: new Map([["plan", planDocOf({ title: "計画", rows: [["焼成", "焼成"]], noteLinks: { 焼成: "bake" } })]]),
    });
    const g = graphOf(input);
    expect(ofType(g, "p-plan:Variable")).toHaveLength(0);
    expect(byId(g, step("焼成"))!["p-plan:isPreceededBy"]).toBeUndefined();
    expect(warnings(g)).toHaveLength(0);
  });
});

// ────────────────────────────────────────────
// 行の状態別
// ────────────────────────────────────────────

describe("buildPlanProvJsonLd — 行の状態", () => {
  function withStates() {
    const index = makeIndex([
      { noteId: "gone", title: "ごみ箱の工程", deletedAt: "2026-09-02T00:00:00.000Z" },
      { noteId: "old", title: "しまった工程", archivedAt: "2026-09-02T00:00:00.000Z" },
    ]);
    const doc = planDocOf({
      title: "計画",
      rows: [["生地", ""], ["未作成", "生地"], ["生地", ""], ["捨てた", ""], ["しまった", ""], ["焼成", "未作成"]],
      noteLinks: { 生地: "dough", 焼成: "bake", 捨てた: "gone", しまった: "old" },
    });
    return baseInput({ index, docs: new Map([["plan", doc]]) });
  }

  it("通常: Step とノートの内容グラフが出る", () => {
    const g = graphOf(withStates());
    expect(byId(g, step("生地"))).toBeTruthy();
    expect(byId(g, "graphium:note/dough")).toBeTruthy();
    expect(byId(g, "graphium:note/dough/activity_dough-h")).toBeTruthy();
  });

  it("unlinked（noteId 無し）: Step のみ。seeAlso も警告も無い", () => {
    const g = graphOf(withStates());
    const s = byId(g, step("未作成"))!;
    expect(s["@type"]).toBe("p-plan:Step");
    expect(s["rdfs:seeAlso"]).toBeUndefined();
    expect(warnings(g).some((w) => w["graphium:step"]?.["@id"] === step("未作成"))).toBe(false);
  });

  it("duplicateName: Step を出さず duplicate-row の警告", () => {
    const g = graphOf(withStates());
    // 「生地」の Step は 1 つだけ（重複行の分は出ない）
    expect(g.filter((n) => n["@id"] === step("生地"))).toHaveLength(1);
    const w = warningsOf(g, "duplicate-row");
    expect(w).toHaveLength(1);
    expect(w[0]["graphium:name"]).toBe("生地");
  });

  it("trashed / archived: Step のみ。noteId は文字列で付けず seeAlso だけ。内容グラフは出ない。row-note-unavailable", () => {
    const g = graphOf(withStates());
    for (const [name, noteId] of [["捨てた", "gone"], ["しまった", "old"]]) {
      const s = byId(g, step(name))!;
      expect(s["@type"]).toBe("p-plan:Step");
      expect(s["rdfs:seeAlso"]).toEqual({ "@id": `graphium:note/${noteId}` });
      expect(s["graphium:noteId"]).toBeUndefined();
      // ノートの実体は出さず、参照先は外部スタブで宣言される（内容グラフの Activity は無い）
      const stub = byId(g, `graphium:note/${noteId}`)!;
      expect(stub["graphium:external"]).toBe(true);
      expect(byId(g, `graphium:note/${noteId}/activity_${noteId}-h`)).toBeUndefined();
    }
    const w = warningsOf(g, "row-note-unavailable");
    expect(w.map((x) => x["graphium:step"]["@id"]).sort()).toEqual([step("捨てた"), step("しまった")].sort());
    expect(w.every((x) => x["graphium:note"] && x["graphium:message"] === undefined)).toBe(true);
  });

  it("trashed / archived のノートを指す参照も外部スタブで解決され、dangling が無い", () => {
    const g = graphOf(withStates());
    expect(danglingRefs(g)).toEqual([]);
    expect(g.filter((n) => n["@id"] === "graphium:note/gone")).toHaveLength(1);
  });

  it("行のノートが notes に無ければ、外部スタブを宣言して seeAlso を解決可能にする", () => {
    const input = baseInput();
    input.notes.delete("tasting");
    const g = graphOf(input);
    const stub = byId(g, "graphium:note/tasting")!;
    expect(stub["graphium:external"]).toBe(true);
    expect(danglingRefs(g)).toEqual([]);
  });
});

// ────────────────────────────────────────────
// 実績の受け渡し
// ────────────────────────────────────────────

const DOUGH_OUT = "graphium:note/dough/result_dough-res_仕込み生地";

describe("buildPlanProvJsonLd — 実績の受け渡し", () => {
  it("Usage は受け側 Activity から供給側の出力ノードへ（B 側 id も A 側 id も前置）", () => {
    const g = graphOf(baseInput());
    const u = usages(g).find((x) => x.activity === "graphium:note/bake/activity_bake-h")!;
    expect(u).toBeTruthy();
    expect(u.entity).toBe(DOUGH_OUT);
    expect(u["@id"]).toMatch(/^_:note_bake_cross_note_usage_/);
    // 出力ノードは本体として宣言されている（外部スタブではない）
    expect(byId(g, DOUGH_OUT)!["graphium:external"]).toBeUndefined();
    expect(g.some((n) => n["@id"] === "graphium:note/dough/output/row_dough")).toBe(false);
  });

  it("線の名前（実績）が Usage の label に付く。Derivation は Usage があるとき label を付けない", () => {
    const g = graphOf(baseInput());
    const u = usages(g).find((x) => x.activity === "graphium:note/bake/activity_bake-h")!;
    expect(u.label).toEqual([{ "@value": "仕込み生地" }]);
    const d = derivations(g).find((x) => x.generatedEntity === "graphium:note/bake/entity_bake-mat_仕込み生地")!;
    expect(d.usedEntity).toBe(DOUGH_OUT);
    expect(d["graphium:linkType"]).toBe("cross_note_output");
    expect(d.label).toBeUndefined();
  });

  it("予定の線に名前が無い受け渡しは label を付けない", () => {
    const g = graphOf(baseInput());
    const u = usages(g).find((x) => x.activity === "graphium:note/tasting/activity_tasting-h")!;
    expect(u.entity).toBe(DOUGH_OUT);
    expect(u.label).toBeUndefined();
  });

  it("供給側の出力ノードに p-plan:Entity が足される", () => {
    const g = graphOf(baseInput());
    expect(typesOf(byId(g, DOUGH_OUT))).toEqual(["Entity", "p-plan:Entity"]);
  });

  it("Usage が作れず Derivation だけのとき、線の名前は Derivation に付く", () => {
    const input = baseInput();
    const bake = input.notes.get("bake")!;
    // 受け側 Activity が引けない（activity_<sourceBlockId> も無い）リンクにする
    const refs = bake.provDoc["graphium:crossNoteLinks"]!.map((r) => {
      const { activityId, ...rest } = r;
      return { ...rest, sourceBlockId: "ghost-block" };
    });
    input.notes.set("bake", { ...bake, provDoc: { ...bake.provDoc, "graphium:crossNoteLinks": refs } });
    const g = graphOf(input);
    expect(usages(g).some((x) => x.activity === "graphium:note/bake/activity_bake-h")).toBe(false);
    const d = derivations(g).find((x) => x.generatedEntity === "graphium:note/bake/entity_bake-mat_仕込み生地")!;
    expect(d.label).toEqual([{ "@value": "仕込み生地" }]);
  });

  it("targetEntityStable === false は解決せず、外部スタブ + 関係になる", () => {
    const input = baseInput();
    const bake = input.notes.get("bake")!;
    const refs = bake.provDoc["graphium:crossNoteLinks"]!.map((r) => ({ ...r, targetEntityStable: false }));
    input.notes.set("bake", { ...bake, provDoc: { ...bake.provDoc, "graphium:crossNoteLinks": refs } });
    const g = graphOf(input);
    const stub = byId(g, "graphium:note/dough/output/row_dough")!;
    expect(stub["graphium:external"]).toBe(true);
    const d = derivations(g).find((x) => x.generatedEntity === "graphium:note/bake/entity_bake-mat_仕込み生地")!;
    expect(d.usedEntity).toBe("graphium:note/dough/output/row_dough");
    expect(d["@id"]).toMatch(/^_:note_bake_cross_note_derivation_/);
    expect(d.label).toEqual([{ "@value": "仕込み生地" }]);
    expect(danglingRefs(g)).toEqual([]);
  });

  it("供給側ノートが書き出しに無ければ外部スタブ（tasting は Usage、B 側 id は前置）", () => {
    const input = baseInput();
    input.notes.delete("dough");
    const g = graphOf(input);
    const u = usages(g).find((x) => x.activity === "graphium:note/tasting/activity_tasting-h")!;
    expect(u.entity).toBe("graphium:note/dough/output/row_dough");
    expect(byId(g, "graphium:note/dough/output/row_dough")!["graphium:external"]).toBe(true);
    expect(danglingRefs(g)).toEqual([]);
  });

  it("名前があるのに関係を出せなかった辺は edge-label-dropped", () => {
    const input = baseInput();
    const bake = input.notes.get("bake")!;
    const refs = bake.provDoc["graphium:crossNoteLinks"]!.map((r) => {
      const { activityId, localEntityId, ...rest } = r;
      return { ...rest, sourceBlockId: "ghost-block" };
    });
    input.notes.set("bake", { ...bake, provDoc: { ...bake.provDoc, "graphium:crossNoteLinks": refs as any } });
    const g = graphOf(input);
    const w = warningsOf(g, "edge-label-dropped");
    expect(w).toHaveLength(1);
    expect(w[0]["graphium:step"]).toEqual({ "@id": step("焼成") });
    expect(w[0]["graphium:name"]).toBe("仕込み生地");
    // 関係が出なかったので p-plan:Entity も増えない（tasting の Usage 分は残る）
    expect(usages(g).some((x) => x.activity.includes("/bake/"))).toBe(false);
  });

  it("link.activityId が無くても activity_<sourceBlockId> で受け側 Activity を引く", () => {
    const input = baseInput();
    const bake = input.notes.get("bake")!;
    const refs = bake.provDoc["graphium:crossNoteLinks"]!.map((r) => {
      const { activityId, ...rest } = r;
      return rest;
    });
    input.notes.set("bake", { ...bake, provDoc: { ...bake.provDoc, "graphium:crossNoteLinks": refs } });
    const g = graphOf(input);
    const u = usages(g).find((x) => x.activity === "graphium:note/bake/activity_bake-h")!;
    expect(u.entity).toBe(DOUGH_OUT);
  });

  it("供給側 A が trashed のとき、外部スタブ + 関係になり、線の名前は付く", () => {
    const input = baseInput();
    input.index.notes.find((n) => n.noteId === "dough")!.deletedAt = "2026-09-02T00:00:00.000Z";
    const g = graphOf(input);
    const stub = byId(g, "graphium:note/dough/output/row_dough")!;
    expect(stub["graphium:external"]).toBe(true);
    const u = usages(g).find((x) => x.activity === "graphium:note/bake/activity_bake-h");
    const d = derivations(g).find((x) => x.generatedEntity === "graphium:note/bake/entity_bake-mat_仕込み生地")!;
    expect(u).toBeUndefined();
    expect(d.usedEntity).toBe("graphium:note/dough/output/row_dough");
    expect(d.label).toEqual([{ "@value": "仕込み生地" }]);
    // 供給側ノートそのものも外部スタブで宣言される
    expect(byId(g, "graphium:note/dough")!["graphium:external"]).toBe(true);
    expect(danglingRefs(g)).toEqual([]);
  });

  it("B が複数の行に現れるときは行を選べないので線の名前を付けない", () => {
    const input = baseInput();
    input.docs.set(
      "plan",
      planDocOf({
        title: "計画",
        rows: [["生地", ""], ["焼成", "生地"], ["焼成b", "生地"]],
        noteLinks: { 生地: "dough", 焼成: "bake", 焼成b: "bake" },
        edgeLabels: { 焼成: { 生地: "仕込み生地" }, 焼成b: { 生地: "別の名前" } },
      }),
    );
    const g = graphOf(input);
    const u = usages(g).find((x) => x.activity === "graphium:note/bake/activity_bake-h")!;
    expect(u.label).toBeUndefined();
    expect(warningsOf(g, "ambiguous-step")).toHaveLength(2);
  });

  describe("A が B と別の計画にいる", () => {
    function crossPlanInput(withA: boolean): PlanProvExportInput {
      const input = baseInput();
      input.index.notes.push({ ...input.index.notes[0], noteId: "sub", title: "準備", noteContexts: ["計画"] } as any);
      input.docs.set(
        "plan",
        planDocOf({
          title: "計画",
          rows: withA ? [["生地", ""], ["準備", ""]] : [["準備", ""]],
          noteLinks: { 生地: "dough", 準備: "sub" },
        }),
      );
      input.docs.set(
        "sub",
        planDocOf({
          title: "準備",
          rows: [["焼成", ""]],
          noteLinks: { 焼成: "bake" },
          edgeLabels: { 焼成: { 生地: "仕込み生地" } },
        }),
      );
      input.notes.set("sub", planNote("sub", "準備"));
      return input;
    }

    it("親計画の行から A を探して線の名前を付ける", () => {
      const g = graphOf(crossPlanInput(true));
      const u = usages(g).find((x) => x.activity === "graphium:note/bake/activity_bake-h")!;
      expect(u.label).toEqual([{ "@value": "仕込み生地" }]);
      expect(warningsOf(g, "edge-label-dropped")).toHaveLength(0);
    });

    it("どの計画にも A の行が無く B の行に線の名前があれば edge-label-dropped", () => {
      const g = graphOf(crossPlanInput(false));
      // A がどの計画にもいないので供給側は外部スタブ。関係は出るが名前は付かない
      const d = derivations(g).find((x) => x.generatedEntity === "graphium:note/bake/entity_bake-mat_仕込み生地")!;
      expect(d.label).toBeUndefined();
      const w = warningsOf(g, "edge-label-dropped");
      expect(w).toHaveLength(1);
      expect(w[0]["graphium:step"]).toEqual({ "@id": step("焼成", "sub") });
    });
  });

  it("出力ノードの探索: tableRowId 一致 → inline_output_ 厳密一致 → @id 一致", () => {
    const input = baseInput();
    const dough = input.notes.get("dough")!;
    // 3 通りの目印を持つ出力ノードを用意して、それぞれで引けることを確かめる
    const mk = (id: string, extra: Record<string, unknown> = {}) => ({
      "@id": id,
      "@type": "prov:Entity" as const,
      "rdfs:label": id,
      "prov:wasGeneratedBy": [{ "@id": "activity_dough-h" }],
      ...extra,
    });
    const graph = [
      ...dough.provDoc["@graph"].filter((n) => n["graphium:tableRowId"] !== "row_dough"),
      mk("by_row", { "graphium:tableRowId": "target_a" }),
      mk("inline_output_target_b"),
      mk("target_c"),
      mk("target_b_decoy"),
    ] as any;
    input.notes.set("dough", { ...dough, provDoc: { ...dough.provDoc, "@graph": graph } });
    const bake = input.notes.get("bake")!;
    const mkRef = (n: string, entityId: string) => ({
      linkId: `l-${n}`,
      type: "informed_by" as const,
      sourceBlockId: "bake-h",
      activityId: "activity_bake-h",
      targetNoteId: "dough",
      targetBlockId: "dough-h",
      targetEntityId: entityId,
    });
    input.notes.set("bake", {
      ...bake,
      provDoc: { ...bake.provDoc, "graphium:crossNoteLinks": [mkRef("a", "target_a"), mkRef("b", "target_b"), mkRef("c", "target_c")] },
    });
    const ents = usages(graphOf(input))
      .filter((x) => x.activity === "graphium:note/bake/activity_bake-h")
      .map((x) => x.entity)
      .sort();
    expect(ents).toEqual(
      ["graphium:note/dough/by_row", "graphium:note/dough/inline_output_target_b", "graphium:note/dough/target_c"].sort(),
    );
  });

  it("出力でないノード（wasGeneratedBy も result_ も無い）は引かない", () => {
    const input = baseInput();
    const dough = input.notes.get("dough")!;
    const graph = [
      ...dough.provDoc["@graph"],
      { "@id": "plain_entity", "@type": "prov:Entity" as const, "rdfs:label": "材料", "graphium:tableRowId": "t_in" },
    ] as any;
    input.notes.set("dough", { ...dough, provDoc: { ...dough.provDoc, "@graph": graph } });
    const bake = input.notes.get("bake")!;
    input.notes.set("bake", {
      ...bake,
      provDoc: {
        ...bake.provDoc,
        "graphium:crossNoteLinks": [
          { linkId: "x", type: "informed_by", sourceBlockId: "bake-h", activityId: "activity_bake-h", targetNoteId: "dough", targetBlockId: "dough-h", targetEntityId: "t_in" },
        ],
      },
    });
    const g = graphOf(input);
    expect(byId(g, "graphium:note/dough/output/t_in")!["graphium:external"]).toBe(true);
  });
});

// ────────────────────────────────────────────
// 計画どおり / 計画外 / 予定だけ（独自語で出さず、判定手順で読める）
// ────────────────────────────────────────────

describe("buildPlanProvJsonLd — 判定手順", () => {
  /** 判定手順: Usage(actB, E) の actB が correspondsToStep sB、E が wasGeneratedBy actA で actA が
   *  correspondsToStep sA、sB hasInputVar V かつ V isOutputVarOf sA なら計画どおり */
  function isAsPlanned(g: W3CProvNode[], usage: W3CProvNode): boolean {
    const actB = byId(g, usage.activity);
    const sB = actB?.["p-plan:correspondsToStep"]?.["@id"];
    const gen = ofType(g, "Generation").find((x) => x.entity === usage.entity);
    const actA = gen && byId(g, gen.activity);
    const sA = actA?.["p-plan:correspondsToStep"]?.["@id"];
    if (!sB || !sA) return false;
    const inputs: { "@id": string }[] = byId(g, sB)?.["p-plan:hasInputVar"] ?? [];
    return inputs.some((v) => byId(g, v["@id"])?.["p-plan:isOutputVarOf"]?.["@id"] === sA);
  }

  it("計画どおり: bake が dough の出力を使い、生地→焼成の Variable がある", () => {
    const g = graphOf(baseInput());
    const u = usages(g).find((x) => x.activity === "graphium:note/bake/activity_bake-h")!;
    expect(isAsPlanned(g, u)).toBe(true);
  });

  it("計画外: tasting が dough の出力を使うが、生地→試食の Variable は無い", () => {
    const g = graphOf(baseInput());
    const u = usages(g).find((x) => x.activity === "graphium:note/tasting/activity_tasting-h")!;
    expect(u).toBeTruthy();
    expect(isAsPlanned(g, u)).toBe(false);
    // 試食は入力 Variable（焼成→試食）を持つが、isOutputVarOf が生地ではない
    expect(byId(g, step("試食"))!["p-plan:hasInputVar"]).toHaveLength(1);
  });

  it("予定だけ: 焼成→試食の Variable はあるが、焼成の出力を試食が使った Usage は無い", () => {
    const g = graphOf(baseInput());
    const bakeOutputs = ofType(g, "Generation")
      .filter((x) => x.activity === "graphium:note/bake/activity_bake-h")
      .map((x) => x.entity);
    expect(bakeOutputs.length).toBeGreaterThan(0);
    expect(byId(g, variable("焼成", "試食"))).toBeTruthy();
    const used = usages(g).filter((x) => x.activity === "graphium:note/tasting/activity_tasting-h").map((x) => x.entity);
    expect(used.some((e) => bakeOutputs.includes(e))).toBe(false);
  });

  it("独自語（計画どおり等）をグラフに出さない", () => {
    const text = JSON.stringify(graphOf(baseInput()));
    expect(text).not.toMatch(/asPlanned|unplanned|plannedOnly|qualifiedAssociation|hadPlan/);
  });
});

// ────────────────────────────────────────────
// correspondsToVariable / correspondsToStep
// ────────────────────────────────────────────

describe("buildPlanProvJsonLd — 対応づけ", () => {
  it("correspondsToVariable: 予定の消費先が 1 つだけのときだけ付く", () => {
    const g = graphOf(baseInput());
    expect(byId(g, DOUGH_OUT)!["p-plan:correspondsToVariable"]).toEqual({ "@id": variable("生地", "焼成") });
  });

  it("消費先が複数なら correspondsToVariable は付けない（functional 制約）", () => {
    const input = baseInput({
      docs: new Map([
        [
          "plan",
          planDocOf({
            title: "計画",
            rows: [["生地", ""], ["焼成", "生地"], ["試食", "生地"]],
            noteLinks: { 生地: "dough", 焼成: "bake", 試食: "tasting" },
          }),
        ],
      ]),
    });
    const g = graphOf(input);
    expect(ofType(g, "p-plan:Variable")).toHaveLength(2);
    const out = byId(g, DOUGH_OUT)!;
    expect(typesOf(out)).toContain("p-plan:Entity"); // 実績は繋がる
    expect(out["p-plan:correspondsToVariable"]).toBeUndefined();
  });

  it("予定の線が無い受け渡しには correspondsToVariable が付かない", () => {
    const input = baseInput({
      docs: new Map([
        ["plan", planDocOf({ title: "計画", rows: [["生地", ""], ["焼成", ""], ["試食", ""]], noteLinks: { 生地: "dough", 焼成: "bake", 試食: "tasting" } })],
      ]),
    });
    const out = byId(graphOf(input), DOUGH_OUT)!;
    expect(out["p-plan:correspondsToVariable"]).toBeUndefined();
  });

  it("correspondsToStep: 通常の Activity にだけ付き、型が Activity / p-plan:Activity になる", () => {
    const g = graphOf(baseInput());
    const act = byId(g, "graphium:note/bake/activity_bake-h")!;
    expect(typesOf(act)).toEqual(["Activity", "p-plan:Activity"]);
    expect(act["p-plan:correspondsToStep"]).toEqual({ "@id": step("焼成") });
  });

  it("ルート計画ノート自身の Activity には付けない", () => {
    const g = graphOf(baseInput());
    const act = byId(g, "graphium:note/plan/activity_plan-h")!;
    expect(act).toBeTruthy();
    expect(act["@type"]).toBe("Activity");
    expect(act["p-plan:correspondsToStep"]).toBeUndefined();
  });

  it("stage 子の Activity と system Activity には付けない", () => {
    const input = baseInput();
    const bake = input.notes.get("bake")!;
    const extra = [
      { "@id": "activity_stage1", "@type": "prov:Activity", "rdfs:label": "段階1", "graphium:activityKind": "stage", "graphium:partOf": [{ "@id": "activity_bake-h" }] },
      { "@id": "activity_tr", "@type": "prov:Activity", "rdfs:label": "文字起こし", "prov:type": "graphium:Transcription" },
      { "@id": "activity_other", "@type": "prov:Activity", "rdfs:label": "もう一つの手順" },
    ] as any;
    input.notes.set("bake", { ...bake, provDoc: { ...bake.provDoc, "@graph": [...bake.provDoc["@graph"], ...extra] } });
    const g = graphOf(input);
    const p = "graphium:note/bake/";
    expect(byId(g, `${p}activity_stage1`)!["p-plan:correspondsToStep"]).toBeUndefined();
    expect(byId(g, `${p}activity_stage1`)!["@type"]).toBe("Activity");
    expect(byId(g, `${p}activity_tr`)!["p-plan:correspondsToStep"]).toBeUndefined();
    expect(byId(g, `${p}activity_other`)!["p-plan:correspondsToStep"]).toEqual({ "@id": step("焼成") });
    expect(byId(g, `${p}activity_bake-h`)!["p-plan:correspondsToStep"]).toEqual({ "@id": step("焼成") });
  });

  it("同じノートが複数の行に現れたら correspondsToStep を付けず ambiguous-step（内容グラフは 1 回だけ）", () => {
    const input = baseInput({
      docs: new Map([
        ["plan", planDocOf({ title: "計画", rows: [["生地", ""], ["生地もう一度", ""], ["焼成", ""]], noteLinks: { 生地: "dough", 生地もう一度: "dough", 焼成: "bake" } })],
      ]),
    });
    const g = graphOf(input);
    const act = byId(g, "graphium:note/dough/activity_dough-h")!;
    expect(act["p-plan:correspondsToStep"]).toBeUndefined();
    expect(g.filter((n) => n["@id"] === "graphium:note/dough")).toHaveLength(1);
    const w = warningsOf(g, "ambiguous-step");
    expect(w.map((x) => x["graphium:step"]["@id"]).sort()).toEqual([step("生地"), step("生地もう一度")].sort());
    expect(w.every((x) => x["graphium:note"]["@id"] === "graphium:note/dough")).toBe(true);
    // もう一方の行ノート（焼成）は 1 つに決まるので付く
    expect(byId(g, "graphium:note/bake/activity_bake-h")!["p-plan:correspondsToStep"]).toEqual({ "@id": step("焼成") });
    expect(danglingRefs(g)).toEqual([]);
  });

  it("別々の計画に同じノートが現れても付けない", () => {
    const index = makeIndex([{ noteId: "plan2", title: "別の計画", noteContexts: ["計画"] }]);
    const input = baseInput({
      index,
      docs: new Map([
        ["plan", planDocOf({ title: "計画", rows: [["焼成", ""], ["別計画", ""]], noteLinks: { 焼成: "bake", 別計画: "plan2" } })],
        ["plan2", planDocOf({ title: "別の計画", rows: [["焼成し直し", ""]], noteLinks: { 焼成し直し: "bake" } })],
      ]),
    });
    input.notes.set("plan2", planNote("plan2", "別の計画"));
    const g = graphOf(input);
    expect(byId(g, "graphium:note/bake/activity_bake-h")!["p-plan:correspondsToStep"]).toBeUndefined();
    expect(warningsOf(g, "ambiguous-step")).toHaveLength(2);
  });
});

// ────────────────────────────────────────────
// 入れ子（MultiStep）
// ────────────────────────────────────────────

describe("buildPlanProvJsonLd — 入れ子", () => {
  /** 親計画: 準備（= 計画ノート sub）→ 焼成。sub の中: 計量 → 混ぜる */
  function nestedInput(): PlanProvExportInput {
    const index = makeIndex([
      { noteId: "sub", title: "準備", noteContexts: ["計画"] },
      { noteId: "weigh", title: "計量" },
      { noteId: "mix", title: "混ぜる" },
    ]);
    const rootDoc = planDocOf({
      title: "春のカンパーニュ試作",
      rows: [["準備", ""], ["焼成", "準備"]],
      noteLinks: { 準備: "sub", 焼成: "bake" },
    });
    const subDoc = planDocOf({
      title: "準備",
      rows: [["計量", ""], ["混ぜる", "計量"]],
      noteLinks: { 計量: "weigh", 混ぜる: "mix" },
      edgeLabels: { 混ぜる: { 計量: "小麦粉" } },
    });
    const weigh = procNote({ id: "weigh", title: "計量", results: [{ name: "小麦粉", identity: "row_flour" }] });
    const mix = procNote({
      id: "mix",
      title: "混ぜる",
      results: [{ name: "生地", identity: "row_mix" }],
      materialRowIdentity: "row_flour_in",
      link: { targetNoteId: "weigh", targetEntityId: "row_flour", sourceEntityId: "row_flour_in" },
    });
    const bake = procNote({
      id: "bake",
      title: "焼成",
      results: [{ name: "カンパーニュ", identity: "row_loaf" }],
      materialRowIdentity: "row_dough_in",
      link: { targetNoteId: "mix", targetEntityId: "row_mix", sourceEntityId: "row_dough_in" },
    });
    return {
      planNoteId: "plan",
      index,
      docs: new Map([["plan", rootDoc], ["sub", subDoc]]),
      notes: entryMap({
        plan: planNote("plan", "春のカンパーニュ試作"),
        sub: planNote("sub", "準備"),
        weigh,
        mix,
        bake,
      }),
    };
  }

  it("計画ノートの行は MultiStep になり、isDecomposedAsPlan / isSubPlanOfPlan で結ばれる", () => {
    const g = graphOf(nestedInput());
    const multi = byId(g, step("準備"))!;
    expect(typesOf(multi)).toEqual(["p-plan:Step", "p-plan:MultiStep"]);
    expect(multi["p-plan:isDecomposedAsPlan"]).toEqual({ "@id": "graphium:note/sub" });
    expect(multi["p-plan:isStepOfPlan"]).toEqual({ "@id": PLAN });
    const sub = byId(g, "graphium:note/sub")!;
    expect(typesOf(sub)).toEqual(["Entity", "prov:Plan", "p-plan:Plan"]);
    expect(sub["p-plan:isSubPlanOfPlan"]).toEqual({ "@id": PLAN });
    // 通常の行は MultiStep にならない
    expect(byId(g, step("焼成"))!["@type"]).toBe("p-plan:Step");
    // ルート計画に isSubPlanOfPlan は付かない
    expect(byId(g, PLAN)!["p-plan:isSubPlanOfPlan"]).toBeUndefined();
  });

  it("子計画の Step / Variable は子計画の IRI の下に出て、子の工程ノートの内容グラフも並ぶ", () => {
    const g = graphOf(nestedInput());
    const inner = byId(g, step("混ぜる", "sub"))!;
    expect(inner["p-plan:isStepOfPlan"]).toEqual({ "@id": "graphium:note/sub" });
    const v = byId(g, variable("計量", "混ぜる", "sub"))!;
    expect(v["p-plan:isVariableOfPlan"]).toEqual({ "@id": "graphium:note/sub" });
    expect(v.label).toEqual([{ "@value": "小麦粉" }]);
    expect(byId(g, "graphium:note/mix/activity_mix-h")!["p-plan:correspondsToStep"]).toEqual({ "@id": step("混ぜる", "sub") });
  });

  it("入れ子計画ノートの Activity は、その行の MultiStep に対応づく", () => {
    const g = graphOf(nestedInput());
    expect(byId(g, "graphium:note/sub/activity_sub-h")!["p-plan:correspondsToStep"]).toEqual({ "@id": step("準備") });
  });

  it("子計画の工程の出力は、子の Variable に対応する", () => {
    const g = graphOf(nestedInput());
    const out = byId(g, "graphium:note/weigh/result_weigh-res_小麦粉")!;
    expect(out["p-plan:correspondsToVariable"]).toEqual({ "@id": variable("計量", "混ぜる", "sub") });
  });

  it("子計画の末端出力を親の工程が使う実績は繋がるが、親の Variable への correspondsToVariable は付かない", () => {
    const g = graphOf(nestedInput());
    const out = byId(g, "graphium:note/mix/result_mix-res_生地")!;
    expect(typesOf(out)).toContain("p-plan:Entity");
    expect(out["p-plan:correspondsToVariable"]).toBeUndefined();
    const u = usages(g).find((x) => x.activity === "graphium:note/bake/activity_bake-h")!;
    expect(u.entity).toBe("graphium:note/mix/result_mix-res_生地");
    // 親の予定 準備→焼成 の Variable は残る
    expect(byId(g, variable("準備", "焼成"))).toBeTruthy();
  });

  it("dangling が無く、external 付きの本体も無い", () => {
    const g = graphOf(nestedInput());
    expect(danglingRefs(g)).toEqual([]);
    expect(stubAndBodyIds(g)).toEqual([]);
    // 子計画ノートの partOf 等のスタブは Plan 本体に置き換わる
    expect(g.filter((n) => n["@id"] === "graphium:note/sub")).toHaveLength(1);
  });

  it("計画ノートが docs に無ければ入れ子にせず通常の Step として扱う", () => {
    const input = nestedInput();
    input.docs.delete("sub");
    const g = graphOf(input);
    expect(byId(g, step("準備"))!["@type"]).toBe("p-plan:Step");
    expect(byId(g, step("準備"))!["p-plan:isDecomposedAsPlan"]).toBeUndefined();
    expect(byId(g, step("混ぜる", "sub"))).toBeUndefined();
  });

  it("計画ノートが互いを行に持つ循環は止まる", () => {
    const index = makeIndex([{ noteId: "sub", title: "準備", noteContexts: ["計画"] }]);
    const input: PlanProvExportInput = {
      planNoteId: "plan",
      index,
      docs: new Map([
        ["plan", planDocOf({ title: "計画", rows: [["準備", ""]], noteLinks: { 準備: "sub" } })],
        ["sub", planDocOf({ title: "準備", rows: [["親へ戻る", ""]], noteLinks: { 親へ戻る: "plan" } })],
      ]),
      notes: entryMap({ plan: planNote("plan", "計画"), sub: planNote("sub", "準備") }),
    };
    const g = graphOf(input);
    const back = byId(g, step("親へ戻る", "sub"))!;
    expect(back["@type"]).toBe("p-plan:Step"); // 祖先なので MultiStep にしない
    expect(back["p-plan:isDecomposedAsPlan"]).toBeUndefined();
    expect(g.filter((n) => n["@id"] === "graphium:note/plan")).toHaveLength(1);
    expect(danglingRefs(g)).toEqual([]);
    // 祖先に戻る行は黙らず nested-cycle
    const w = warningsOf(g, "nested-cycle");
    expect(w).toHaveLength(1);
    expect(w[0]["graphium:step"]).toEqual({ "@id": step("親へ戻る", "sub") });
    expect(w[0]["graphium:note"]).toEqual({ "@id": PLAN });
  });

  it("ルート以外の祖先に戻る行も nested-cycle（Step は MultiStep にしない）", () => {
    const index = makeIndex([
      { noteId: "a", title: "A", noteContexts: ["計画"] },
      { noteId: "b", title: "B", noteContexts: ["計画"] },
    ]);
    const input: PlanProvExportInput = {
      planNoteId: "plan",
      index,
      docs: new Map([
        ["plan", planDocOf({ title: "計画", rows: [["a行", ""]], noteLinks: { a行: "a" } })],
        ["a", planDocOf({ title: "A", rows: [["b行", ""]], noteLinks: { b行: "b" } })],
        ["b", planDocOf({ title: "B", rows: [["a戻り", ""]], noteLinks: { a戻り: "a" } })],
      ]),
      notes: new Map(),
    };
    const g = graphOf(input);
    expect(byId(g, step("a戻り", "b"))!["@type"]).toBe("p-plan:Step");
    const w = warningsOf(g, "nested-cycle");
    expect(w).toHaveLength(1);
    expect(w[0]["graphium:step"]).toEqual({ "@id": step("a戻り", "b") });
    expect(w[0]["graphium:note"]).toEqual({ "@id": "graphium:note/a" });
  });

  it("ダイヤモンド: 2 つ目の親の Step も MultiStep で同じ子 Plan を指し、子 Plan の isSubPlanOfPlan は複数値。木は最初の親の下にだけ出る", () => {
    const index = makeIndex([
      { noteId: "a", title: "A", noteContexts: ["計画"] },
      { noteId: "b", title: "B", noteContexts: ["計画"] },
      { noteId: "c", title: "C", noteContexts: ["計画"] },
    ]);
    const input: PlanProvExportInput = {
      planNoteId: "plan",
      index,
      docs: new Map([
        ["plan", planDocOf({ title: "計画", rows: [["a行", ""], ["b行", ""]], noteLinks: { a行: "a", b行: "b" } })],
        ["a", planDocOf({ title: "A", rows: [["共通1", ""]], noteLinks: { 共通1: "c" } })],
        ["b", planDocOf({ title: "B", rows: [["共通2", ""]], noteLinks: { 共通2: "c" } })],
        ["c", planDocOf({ title: "C", rows: [["末端", ""]], noteLinks: {} })],
      ]),
      notes: new Map(),
    };
    const g = graphOf(input);
    for (const [name, parent] of [["共通1", "a"], ["共通2", "b"]]) {
      const s = byId(g, step(name, parent))!;
      expect(typesOf(s)).toEqual(["p-plan:Step", "p-plan:MultiStep"]);
      expect(s["p-plan:isDecomposedAsPlan"]).toEqual({ "@id": "graphium:note/c" });
    }
    expect(byId(g, "graphium:note/c")!["p-plan:isSubPlanOfPlan"]).toEqual([
      { "@id": "graphium:note/a" },
      { "@id": "graphium:note/b" },
    ]);
    // 子計画の木は 1 回だけ
    expect(g.filter((n) => n["@id"] === step("末端", "c"))).toHaveLength(1);
    const w = warningsOf(g, "nested-shared");
    expect(w).toHaveLength(1);
    expect(w[0]["graphium:step"]).toEqual({ "@id": step("共通2", "b") });
    expect(danglingRefs(g)).toEqual([]);
  });

  it("行のノートが計画ノートなのに docs に無ければ plan-doc-missing", () => {
    const input = nestedInput();
    input.docs.delete("sub");
    const g = graphOf(input);
    const w = warningsOf(g, "plan-doc-missing");
    expect(w).toHaveLength(1);
    expect(w[0]["graphium:step"]).toEqual({ "@id": step("準備") });
    expect(w[0]["graphium:note"]).toEqual({ "@id": "graphium:note/sub" });
  });

  it("深さ上限（8）を超える入れ子は再帰せず depth-limit の警告", () => {
    const ids = Array.from({ length: 12 }, (_, i) => `p${i}`);
    const index = makeIndex(ids.map((noteId) => ({ noteId, title: noteId, noteContexts: ["計画"] })));
    const docs = new Map<string, GraphiumDocument>();
    ids.forEach((id, i) => {
      if (i === ids.length - 1) return;
      docs.set(id, planDocOf({ title: id, rows: [[`次${i}`, ""]], noteLinks: { [`次${i}`]: ids[i + 1] } }));
    });
    const g = graphOf({ planNoteId: "p0", index, docs, notes: new Map() });
    // plan-flow と同じ数え方: p0（ルート）の行ノート p1 が深さ 0、p9 が深さ 8（展開される）。
    // p9 の行が指す p10 は深さ 9 > 8 なので再帰されない
    expect(byId(g, step("次8", "p8"))!["@type"]).toEqual(["p-plan:Step", "p-plan:MultiStep"]);
    expect(byId(g, step("次9", "p9"))!["@type"]).toBe("p-plan:Step");
    expect(byId(g, step("次10", "p10"))).toBeUndefined();
    const w = warningsOf(g, "depth-limit");
    expect(w).toHaveLength(1);
    expect(w[0]["graphium:step"]).toEqual({ "@id": step("次9", "p9") });
  });
});

// ────────────────────────────────────────────
// 警告
// ────────────────────────────────────────────

describe("buildPlanProvJsonLd — 警告ノード", () => {
  it("警告が無ければ graphium:Warning は出ない", () => {
    expect(warnings(graphOf(baseInput()))).toHaveLength(0);
  });

  it("unresolved-planned: 入力元が行名に解決できない", () => {
    const input = baseInput({
      docs: new Map([["plan", planDocOf({ title: "計画", rows: [["焼成", "存在しない行"]], noteLinks: { 焼成: "bake" } })]]),
    });
    const g = graphOf(input);
    const w = warningsOf(g, "unresolved-planned");
    expect(w).toHaveLength(1);
    expect(w[0]["graphium:step"]).toEqual({ "@id": step("焼成") });
    expect(w[0]["graphium:name"]).toBe("存在しない行");
    expect(ofType(g, "p-plan:Variable")).toHaveLength(0);
  });

  it("planned-cycle: 循環する辺はそのまま出し、循環上の Step ごとに警告", () => {
    const input = baseInput({
      docs: new Map([
        [
          "plan",
          planDocOf({
            title: "計画",
            rows: [["生地", "焼成"], ["焼成", "生地"], ["試食", "焼成"]],
            noteLinks: { 生地: "dough", 焼成: "bake", 試食: "tasting" },
          }),
        ],
      ]),
    });
    const g = graphOf(input);
    expect(ofType(g, "p-plan:Variable")).toHaveLength(3);
    const w = warningsOf(g, "planned-cycle");
    expect(w.map((x) => x["graphium:step"]["@id"]).sort()).toEqual([step("生地"), step("焼成")].sort());
  });

  it("警告の IRI は <計画ノート>/warning/<n> で一意。message は出さない", () => {
    const input = baseInput({
      docs: new Map([
        ["plan", planDocOf({ title: "計画", rows: [["生地", "x"], ["生地", ""], ["焼成", "y"]], noteLinks: { 生地: "dough", 焼成: "bake" } })],
      ]),
    });
    const w = warnings(graphOf(input));
    expect(w).toHaveLength(3);
    expect(new Set(w.map((x) => x["@id"])).size).toBe(3);
    for (const x of w) {
      expect(x["@id"]).toMatch(/^graphium:note\/plan\/warning\/\d+$/);
      expect(x["@type"]).toBe("graphium:Warning");
      expect(Object.keys(x).some((k) => /message/i.test(k))).toBe(false);
    }
  });
});

// ────────────────────────────────────────────
// 全体の整合
// ────────────────────────────────────────────

describe("buildPlanProvJsonLd — 全体の整合", () => {
  it("同じ内側 id を持つノートを並べても @id が衝突しない", () => {
    const mk = (id: string, title: string) => procNote({ id, title, bp: "blk", results: [{ name: "成果", identity: "same_row" }] });
    const input = baseInput({
      docs: new Map([
        ["plan", planDocOf({ title: "計画", rows: [["生地", ""], ["焼成", "生地"]], noteLinks: { 生地: "dough", 焼成: "bake" } })],
      ]),
    });
    input.notes.set("dough", mk("dough", "生地"));
    input.notes.set("bake", mk("bake", "焼成"));
    const g = graphOf(input);
    const a = byId(g, "graphium:note/dough/activity_blk-h")!;
    const b = byId(g, "graphium:note/bake/activity_blk-h")!;
    expect(a).toBeTruthy();
    expect(b).toBeTruthy();
    // 最上位の @id は（同一内容の重複を除いて）一意
    const ids = g.map((n) => n["@id"]);
    expect(new Set(ids).size).toBe(ids.length);
    // blank node も衝突しない（関係ノードの @id はノートごとに別の接頭辞）
    const blanks = g.filter((n) => n["@id"].startsWith("_:")).map((n) => n["@id"]);
    expect(new Set(blanks).size).toBe(blanks.length);
    expect(danglingRefs(g)).toEqual([]);
  });

  it("全参照に宣言がある（dangling 無し）", () => {
    expect(danglingRefs(graphOf(baseInput()))).toEqual([]);
  });

  it("external 付きの本体ノードが無い（Plan への partOf スタブは Plan 本体に置き換わる）", () => {
    const input = baseInput();
    // 工程ノートに「この計画に所属」を付けると、ノート Entity が計画スタブを参照する
    const dough = input.notes.get("dough")!;
    input.notes.set("dough", { ...dough, extras: { partOfPlanNoteId: "plan" } });
    const g = graphOf(input);
    expect(byId(g, "graphium:note/dough")!["dcterms:isPartOf"]).toEqual({ "@id": PLAN });
    expect(g.filter((n) => n["@id"] === PLAN)).toHaveLength(1);
    expect(byId(g, PLAN)!["graphium:external"]).toBeUndefined();
    expect(stubAndBodyIds(g)).toEqual([]);
  });

  it("計画の書き出しに含まれない計画への所属は外部スタブのまま残る", () => {
    const input = baseInput();
    const dough = input.notes.get("dough")!;
    input.notes.set("dough", { ...dough, extras: { partOfPlanNoteId: "other-plan" } });
    const g = graphOf(input);
    expect(byId(g, "graphium:note/other-plan")!["graphium:external"]).toBe(true);
  });

  it("複数のノートで重なる内容（フォルダ・人の Agent）は 1 つにまとまる", () => {
    const input = baseInput();
    for (const id of ["dough", "bake"]) {
      const n = input.notes.get(id)!;
      input.notes.set(id, { ...n, extras: { folders: ["パン作り"] } });
    }
    const g = graphOf(input);
    expect(g.filter((n) => n["@id"] === `graphium:folder/${encodeURIComponent("パン作り")}`)).toHaveLength(1);
    expect(byId(g, "graphium:note/dough")!["prov:atLocation"]).toEqual([{ "@id": `graphium:folder/${encodeURIComponent("パン作り")}` }]);
  });

  it("孤立サロゲートを含む行名でも例外にならず、IRI は整形される", () => {
    const input = baseInput();
    input.docs.set("plan", planDocOf({ title: "計画", rows: [["\uD83D", ""]], noteLinks: {} }));
    expect(() => buildPlanProvJsonLd(input)).not.toThrow();
    const g = graphOf(input);
    expect(ofType(g, "p-plan:Step").some((n) => n["@id"].includes("%EF%BF%BD"))).toBe(true);
  });

  it("JSON として直列化できる", () => {
    expect(() => JSON.stringify(buildPlanProvJsonLd(baseInput()))).not.toThrow();
  });

  it("docs に計画ノート自体が無ければ Plan だけの書き出しになる", () => {
    const input = baseInput();
    input.docs.clear();
    const g = graphOf(input);
    expect(ofType(g, "p-plan:Step")).toHaveLength(0);
    expect(typesOf(byId(g, PLAN))).toContain("p-plan:Plan");
  });
});

// ────────────────────────────────────────────
// Bundle
// ────────────────────────────────────────────

describe("buildPlanProvJsonLd — 編集履歴 Bundle", () => {
  const bundleIri = (id: string) => `graphium:documentProvenance/${id}`;

  it("Bundle は noteId キーで並置され、ノート Entity の provenanceBundle も noteId キーを指す", () => {
    const g = graphOf(baseInput());
    const b = byId(g, bundleIri("dough"))!;
    expect(b["@type"]).toBe("prov:Bundle");
    expect(Array.isArray(b["@graph"])).toBe(true);
    expect(byId(g, "graphium:note/dough")!["graphium:provenanceBundle"]).toEqual({ "@id": bundleIri("dough") });
    // 題名キーの Bundle は残らない
    expect(byId(g, bundleIri(encodeURIComponent("生地")))).toBeUndefined();
  });

  it("Bundle を入れ子にしない（Bundle の @graph に prov:Bundle が無い）", () => {
    const g = graphOf(baseInput());
    for (const b of ofType(g, "prov:Bundle")) {
      expect((b["@graph"] as W3CProvNode[]).some((n) => typesOf(n).includes("prov:Bundle"))).toBe(false);
    }
  });

  it("履歴が無いノートには provenanceBundle も Bundle も出ない", () => {
    const g = graphOf(baseInput());
    expect(byId(g, "graphium:note/bake")!["graphium:provenanceBundle"]).toBeUndefined();
    expect(byId(g, bundleIri("bake"))).toBeUndefined();
  });

  it("同じ題名のノートが複数あっても Bundle が衝突しない", () => {
    const input = baseInput();
    for (const id of ["dough", "bake"]) {
      const n = input.notes.get(id)!;
      input.notes.set(id, { ...n, title: "同じ題名", provDoc: { ...n.provDoc, "graphium:documentProvenance": BUNDLE(`作者-${id}`) } });
    }
    const g = graphOf(input);
    expect(byId(g, bundleIri("dough"))).toBeTruthy();
    expect(byId(g, bundleIri("bake"))).toBeTruthy();
    expect(byId(g, "graphium:note/bake")!["graphium:provenanceBundle"]).toEqual({ "@id": bundleIri("bake") });
    expect(danglingRefs(g)).toEqual([]);
  });
});
