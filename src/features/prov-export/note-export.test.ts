// ノート書き出し（buildNoteProvJsonLd）のテスト
// fixture は generateProvDocument に BlockNote 風ブロックを渡す統合型と、手書き ProvJsonLd の両方

import { createHash } from "node:crypto";
import { describe, it, expect } from "vitest";
import {
  buildNoteProvJsonLd,
  computePageHashSync,
  dedupeStubs,
  normalizeTime,
  sha1Hex,
  sha256Hex,
  type MemoExportEntry,
  type NoteProvExportInput,
  type NoteProvExtras,
} from "./note-export";
import { generateProvDocument, type ProvJsonLd } from "../prov-generator/generator";
import { computePageHash } from "../document-provenance/diff";
import type { GraphiumPage } from "../../lib/document-types";
import type { BlockLink } from "../block-link/link-types";
import type { WikiEntityInfo, W3CProvNode } from "./export-jsonld";

// ── fixture ──

const heading = (id: string, text: string, level = 2) => ({
  id,
  type: "heading",
  props: { level },
  content: [{ type: "text", text, styles: {} }],
  children: [],
});
const paragraph = (id: string, text: string) => ({
  id,
  type: "paragraph",
  content: [{ type: "text", text, styles: {} }],
  children: [],
});
const table = (id: string, headers: string[], rows: string[][]) => ({
  id,
  type: "table",
  content: {
    type: "tableContent",
    rows: [
      { cells: headers.map((h) => [{ type: "text", text: h, styles: {} }]) },
      ...rows.map((r) => ({ cells: r.map((v) => [{ type: "text", text: v, styles: {} }]) })),
    ],
  },
  children: [],
});
const image = (id: string, url: string, caption: string) => ({
  id,
  type: "image",
  props: { url, name: "fig.png", caption },
  children: [],
});

const NOTE_ID = "note-1";
const NOTE_IRI = "graphium:note/note-1";
const P = `${NOTE_IRI}/`;

/** 手順 1 つ + 材料表 + 結果表 + 段階表 + 画像を持つノート */
function makePage(): GraphiumPage {
  return {
    id: "p1",
    title: "焼成",
    blocks: [
      heading("h-proc", "焼成する"),
      paragraph("para-1", "窯に入れて焼く"),
      table("t-mat", ["名前", "量"], [
        ["試料A", "1g"],
        ["試料B", "2g"],
      ]),
      table("t-stage", ["温度", "時間"], [
        ["600℃", "1h"],
        ["800℃", "2h"],
      ]),
      image("img1", "media-server://file-img", "図1 断面"),
    ],
    labels: { "h-proc": "procedure", "t-mat": "material", "t-stage": "attribute" },
    provLinks: [],
    knowledgeLinks: [],
  } as GraphiumPage;
}

function makeProvDoc(page: GraphiumPage, extra?: Partial<Parameters<typeof generateProvDocument>[0]>): ProvJsonLd {
  return generateProvDocument({
    blocks: page.blocks,
    labels: new Map(Object.entries(page.labels)),
    links: [],
    mediaInlineLabels: new Map([["img1", { label: "material", entityId: "e-img" }]]),
    ...extra,
  });
}

function makeInput(over?: Partial<NoteProvExportInput>): NoteProvExportInput {
  const page = makePage();
  return {
    provDoc: makeProvDoc(page),
    title: "焼成ノート",
    noteId: NOTE_ID,
    page,
    ...over,
  };
}

const graphOf = (input: NoteProvExportInput) => buildNoteProvJsonLd(input)["@graph"];
const byId = (graph: W3CProvNode[], id: string) => graph.find((n) => n["@id"] === id);
const noteEntity = (graph: W3CProvNode[]) => byId(graph, NOTE_IRI)!;

// ── 全参照に宣言があるか（dangling 検査）──

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
/** 同じ @id に external 付きと無しが並んでいる @id（最終出力では空であるべき） */
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

// ── 豊富な付属情報 ──

const wikiEntity: WikiEntityInfo = {
  id: "wiki-1",
  title: "Annealing note",
  kind: "claim",
  status: "active",
  generatedAt: "2026-05-10T00:00:00Z",
  model: "claude-sonnet",
  derivedFromNotes: ["note-1"],
};

function richExtras(): NoteProvExtras {
  return {
    modifiedAt: "2026-10-29T10:00:00+09:00",
    folders: ["計画/工程", "材料X", "材料X"],
    sources: [
      { kind: "url", id: "https://example.com/a?x=1", label: "Example" },
      { kind: "pdf", id: "pdf-1" },
      { kind: "document", id: "doc-1", label: "report.docx" },
      { kind: "text", id: "txt-1" },
      { kind: "note", id: "note-parent", label: "親ノート" },
      { kind: "template", id: "tpl-1", label: "実験テンプレート" },
      { kind: "shared", id: "sh-1" },
      { kind: "import", id: "sha256:abc", label: "data/x.txt" },
    ],
    influences: [
      { kind: "asset", id: "pdf-1", type: "pdf" },
      { kind: "asset", id: "img-1", type: "image" },
      { kind: "wiki", id: "wiki-1" },
      { kind: "wiki", id: "wiki-unknown", label: "未知の知見" },
    ],
    partOfPlanNoteId: "plan-1",
    assets: [
      {
        fileId: "pdf-1",
        type: "pdf",
        name: "paper.pdf",
        sourceInfo: { authors: ["A. Author", "B. Author"], year: 2024, venue: "J. Test", doi: "10.1000/xyz(1)" },
      },
      { fileId: "file-img", type: "image", name: "fig.png" },
    ],
    tableMeta: {
      "t-mat": {
        caption: "材料表",
        source: {
          kind: "delimited-file",
          fileName: "raw.csv",
          importedAt: "2026-10-01T00:00:00Z",
          options: { headerRow: 1, endRow: 10, delimiter: "custom", customDelimiter: "|", collapseConsecutive: false },
          meta: [{ key: "Device", value: "XRD-1" }],
        },
      },
      "t-stage": { caption: "昇温条件" },
    },
    resolveFileId: (url) => (url === "media-server://file-img" ? "file-img" : null),
    humanAgent: { name: "山田太郎", email: "Yamada@Example.com" },
  };
}

// ────────────────────────────────────────────
// ハッシュ
// ────────────────────────────────────────────

describe("純 JS ハッシュ", () => {
  const samples = ["", "abc", "日本語のテキスト", "a".repeat(55), "a".repeat(56), "a".repeat(64), "x".repeat(1000)];
  it("sha1 は node:crypto と一致する", () => {
    for (const s of samples) expect(sha1Hex(s)).toBe(createHash("sha1").update(s).digest("hex"));
  });
  it("sha256 は node:crypto と一致する", () => {
    for (const s of samples) expect(sha256Hex(s)).toBe(createHash("sha256").update(s).digest("hex"));
  });
  it("computePageHashSync は computePageHash と同じ値になる", async () => {
    const page = makePage();
    expect(computePageHashSync(page)).toBe(await computePageHash(page));
  });
});

describe("normalizeTime", () => {
  it("+09:00 を Z に直し、不正な日時は undefined", () => {
    expect(normalizeTime("2026-10-29T10:00:00+09:00")).toBe("2026-10-29T01:00:00.000Z");
    expect(normalizeTime("not a date")).toBeUndefined();
    expect(normalizeTime(undefined)).toBeUndefined();
    expect(normalizeTime("")).toBeUndefined();
  });
});

// ────────────────────────────────────────────
// ノート Entity・本文 Entity
// ────────────────────────────────────────────

describe("buildNoteProvJsonLd — ノート Entity と本文 Entity", () => {
  it("context に p-plan / oa / dc を末尾追加し、既存キーは変えない", () => {
    const doc = buildNoteProvJsonLd(makeInput());
    const ctx = doc["@context"][0];
    expect(ctx["p-plan"]).toBe("http://purl.org/net/p-plan#");
    expect(ctx.oa).toBe("http://www.w3.org/ns/oa#");
    expect(ctx.dc).toBe("http://purl.org/dc/elements/1.1/");
    expect(ctx.label).toEqual({ "@id": "rdfs:label" });
    expect(doc["@context"][1]).toBe("https://openprovenance.org/prov-jsonld/context.jsonld");
  });

  it("空の手順グラフでもノート Entity が出る（label = title）", () => {
    const empty: ProvJsonLd = { "@context": {} as any, "@graph": [] };
    const page = { ...makePage(), blocks: [] } as GraphiumPage;
    const g = graphOf({ provDoc: empty, title: "空", noteId: NOTE_ID, page });
    const n = noteEntity(g);
    expect(n["@type"]).toBe("Entity");
    expect(n.label).toEqual([{ "@value": "空" }]);
  });

  it("本文 Entity は note/<id>/text/<hash> で、ノートの specializationOf・純テキスト・時刻を持つ", () => {
    const input = makeInput({ extras: { modifiedAt: "2026-10-29T10:00:00+09:00" } });
    const g = graphOf(input);
    const hash = computePageHashSync(input.page);
    const body = byId(g, `${NOTE_IRI}/text/${hash}`)!;
    expect(body).toBeDefined();
    expect(body["prov:specializationOf"]).toEqual({ "@id": NOTE_IRI });
    expect(body["dc:format"]).toBe("text/plain");
    expect(body["prov:value"]).toContain("焼成する");
    expect(body["prov:value"]).toContain("窯に入れて焼く");
    expect(body["prov:generatedAtTime"]).toEqual({ "@value": "2026-10-29T01:00:00.000Z", "@type": "xsd:dateTime" });
  });

  it("includeBody:false なら本文 Entity は出ない。不正な modifiedAt は出さない", () => {
    const g = graphOf(makeInput({ options: { includeBody: false } }));
    expect(g.some((n) => String(n["@id"]).includes("/text/"))).toBe(false);
    const g2 = graphOf(makeInput({ extras: { modifiedAt: "garbage" } }));
    const body = g2.find((n) => String(n["@id"]).includes("/text/"))!;
    expect(body["prov:generatedAtTime"]).toBeUndefined();
  });

  it("内容ノードは idPrefix で前置され、dcterms:isPartOf でノートに結ばれる", () => {
    const g = graphOf(makeInput());
    const act = byId(g, `${P}activity_h-proc`)!;
    expect(act).toBeDefined();
    expect(act["dcterms:isPartOf"]).toEqual({ "@id": NOTE_IRI });
    // 関係ノードには isPartOf を付けない
    const usage = g.find((n) => n["@type"] === "Usage")!;
    expect(usage["dcterms:isPartOf"]).toBeUndefined();
    expect(usage["@id"]).toMatch(/^_:note_note_1_usage_/);
  });

  it("フォルダ・出典・派生元・影響を持つ（Location は 1 回ずつ宣言）", () => {
    const g = graphOf(makeInput({ extras: richExtras(), wikiEntities: [wikiEntity] }));
    const n = noteEntity(g);

    expect(n["prov:atLocation"]).toEqual([
      { "@id": `graphium:folder/${encodeURIComponent("計画/工程")}` },
      { "@id": `graphium:folder/${encodeURIComponent("材料X")}` },
    ]);
    const locs = g.filter((x) => x["@type"] === "prov:Location");
    expect(locs).toHaveLength(2);
    expect(locs[0].label).toEqual([{ "@value": "計画/工程" }]);

    expect(n["prov:hadPrimarySource"]).toEqual([
      { "@id": `graphium:url/${encodeURIComponent("https://example.com/a?x=1")}` },
      { "@id": "graphium:pdf/pdf-1" },
      { "@id": "graphium:document/doc-1" },
      { "@id": "graphium:text/txt-1" },
    ]);
    expect(n["prov:wasDerivedFrom"]).toEqual([
      { "@id": "graphium:note/note-parent" },
      { "@id": "graphium:template/tpl-1" },
      { "@id": "graphium:shared/sh-1" },
      { "@id": `graphium:import/${encodeURIComponent("sha256:abc")}` },
    ]);
    // 影響: 素材 / wiki（id 一致は既存 IRI、不一致は note スタブ）
    expect(n["prov:wasInfluencedBy"]).toEqual([
      { "@id": "graphium:pdf/pdf-1" },
      { "@id": "graphium:image/img-1" },
      { "@id": `graphium:wiki/${encodeURIComponent("Annealing note")}` },
      { "@id": "graphium:note/wiki-unknown" },
    ]);
    expect(n["dcterms:isPartOf"]).toEqual({ "@id": "graphium:note/plan-1" });

    // ラベルはスタブにも載る
    expect(byId(g, "graphium:template/tpl-1")!.label).toEqual([{ "@value": "実験テンプレート" }]);
    expect(byId(g, `graphium:import/${encodeURIComponent("sha256:abc")}`)!.label).toEqual([{ "@value": "data/x.txt" }]);
    expect(byId(g, "graphium:note/note-parent")!["graphium:external"]).toBe(true);
    expect(byId(g, "graphium:note/plan-1")!["@type"]).toBe("Entity");
  });

  it("値の無いキーは出さない（extras 無し）", () => {
    const n = noteEntity(graphOf(makeInput()));
    for (const k of [
      "prov:atLocation",
      "prov:hadPrimarySource",
      "prov:wasDerivedFrom",
      "prov:wasInfluencedBy",
      "dcterms:isPartOf",
      "graphium:provenanceBundle",
    ]) {
      expect(n[k]).toBeUndefined();
    }
  });

  it("編集履歴 Bundle があれば graphium:provenanceBundle で結ぶ", () => {
    const provDoc: ProvJsonLd = {
      ...makeProvDoc(makePage()),
      "graphium:documentProvenance": {
        "@type": "prov:Bundle",
        "@graph": [
          { "@id": "agent_h", "@type": "prov:Agent", "rdfs:label": "Author", "graphium:agentType": "human" },
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
      } as any,
    };
    const g = graphOf({ ...makeInput(), provDoc });
    const bundleId = `graphium:documentProvenance/${encodeURIComponent("焼成ノート")}`;
    expect(noteEntity(g)["graphium:provenanceBundle"]).toEqual({ "@id": bundleId });
    expect(byId(g, bundleId)!["@type"]).toBe("prov:Bundle");
  });
});

// ────────────────────────────────────────────
// 表 Collection
// ────────────────────────────────────────────

describe("buildNoteProvJsonLd — 表 Collection", () => {
  it("Entity 行を持つ表は、名前または取り込み元があれば Collection になり、メンバーは Entity だけ", () => {
    const g = graphOf(makeInput({ extras: richExtras() }));
    const col = byId(g, `${P}collection/t-mat`)!;
    expect(col).toBeDefined();
    expect(col["@type"]).toEqual(["Entity", "prov:Collection"]);
    expect(col.label).toEqual([{ "@value": "材料表" }]);
    expect(col["dcterms:isPartOf"]).toEqual({ "@id": NOTE_IRI });
    const members = col["prov:hadMember"].map((m: any) => m["@id"]);
    expect(members).toHaveLength(2);
    for (const id of members) expect(byId(g, id)!["@type"]).toBe("Entity");
    expect(members.some((id: string) => id.includes("activity_"))).toBe(false);
    // 取り込み元
    expect(col["prov:wasDerivedFrom"]).toEqual([{ "@id": `${P}import/t-mat` }]);
    const imp = byId(g, `${P}import/t-mat`)!;
    expect(imp.label).toEqual([{ "@value": "raw.csv" }]);
    expect(imp["graphium:meta"]).toEqual([{ "rdfs:label": "Device", "rdf:value": "XRD-1" }]);
    expect(imp["graphium:delimiter"]).toBe("|");
  });

  it("名前も取り込み元も無い表は Collection にならない。caption だけなら label = caption", () => {
    const g = graphOf(makeInput({ extras: { tableMeta: { "t-mat": {} } } }));
    expect(g.some((n) => String(n["@id"]).includes("/collection/"))).toBe(false);
    const g2 = graphOf(makeInput({ extras: { tableMeta: { "t-mat": { caption: "  表A  " } } } }));
    const col = byId(g2, `${P}collection/t-mat`)!;
    expect(col.label).toEqual([{ "@value": "表A" }]);
    expect(col["prov:wasDerivedFrom"]).toBeUndefined();
  });

  it("段階表（メンバーが Activity のみ）は Collection を作らず、親 Activity に graphium:tableCaption", () => {
    const g = graphOf(makeInput({ extras: richExtras() }));
    expect(byId(g, `${P}collection/t-stage`)).toBeUndefined();
    const parent = byId(g, `${P}activity_h-proc`)!;
    expect(parent["graphium:tableCaption"]).toBe("昇温条件");
    // 段階子 Activity が Collection のメンバーになることはない
    const allMembers = g
      .filter((n) => Array.isArray(n["prov:hadMember"]))
      .flatMap((n) => n["prov:hadMember"].map((m: any) => m["@id"]));
    expect(allMembers.some((id: string) => byId(g, id)?.["@type"] === "Activity")).toBe(false);
  });
});

// ────────────────────────────────────────────
// 素材
// ────────────────────────────────────────────

describe("buildNoteProvJsonLd — 素材 Entity", () => {
  it("参照された素材だけ宣言し、出どころ（dc:*）と doi.org を持つ", () => {
    const extras = richExtras();
    extras.assets!.push({ fileId: "unused", type: "pdf", name: "unused.pdf" });
    const g = graphOf(makeInput({ extras }));
    const pdf = byId(g, "graphium:pdf/pdf-1")!;
    expect(pdf.label).toEqual([{ "@value": "paper.pdf" }]);
    expect(pdf["graphium:sourceKind"]).toBe("pdf");
    expect(pdf["dc:format"]).toBe("application/pdf");
    expect(pdf["dc:creator"]).toEqual(["A. Author", "B. Author"]);
    expect(pdf["dc:date"]).toBe("2024");
    expect(pdf["dc:publisher"]).toBe("J. Test");
    expect(pdf["dc:identifier"]).toBe("doi:10.1000/xyz(1)");
    expect(pdf["rdfs:seeAlso"]).toEqual({ "@id": "https://doi.org/10.1000/xyz(1)" });
    expect(byId(g, "graphium:pdf/unused")).toBeUndefined();
    // 本体があるので同じ IRI のスタブは出ない
    expect(g.filter((n) => n["@id"] === "graphium:pdf/pdf-1")).toHaveLength(1);
  });

  it("内容グラフのメディアノードは resolveFileId が素材に当たれば specializationOf を持つ", () => {
    const g = graphOf(makeInput({ extras: richExtras() }));
    const media = g.find((n) => n["graphium:mediaUrl"] === "media-server://file-img")!;
    expect(media).toBeDefined();
    expect(media["prov:specializationOf"]).toEqual({ "@id": "graphium:image/file-img" });
    expect(media["rdfs:comment"]).toBe("図1 断面");
    const asset = byId(g, "graphium:image/file-img")!;
    expect(asset["dc:format"]).toBe("image/png");
    // 当たらなければ付けない
    const g2 = graphOf(makeInput({ extras: { ...richExtras(), resolveFileId: () => null } }));
    expect(g2.find((n) => n["graphium:mediaUrl"])!["prov:specializationOf"]).toBeUndefined();
  });
});

// ────────────────────────────────────────────
// メモ
// ────────────────────────────────────────────

describe("buildNoteProvJsonLd — メモ（oa:Annotation）", () => {
  const baseMemo = (over: Partial<MemoExportEntry>): MemoExportEntry => ({
    id: "m1",
    text: "メモ本文",
    createdAt: "2026-10-01T09:00:00+09:00",
    edited: false,
    usedInThisNote: false,
    isQuote: false,
    createdBy: "yamada@example.com",
    ...over,
  });
  const memoOf = (memo: MemoExportEntry, extras?: NoteProvExtras) => {
    const g = graphOf(makeInput({ extras: { ...richExtras(), ...extras, memos: [memo] } }));
    return { g, node: byId(g, `graphium:memo/${memo.id}`) };
  };

  it("ノートのメモ: target はノート。Annotation ∧ Entity で本文は常に TextualBody", () => {
    const { node } = memoOf(baseMemo({ sourceNote: { fileId: NOTE_ID } }));
    expect(node!["@type"]).toEqual(["oa:Annotation", "Entity"]);
    expect(node!["oa:motivatedBy"]).toEqual([{ "@id": "oa:commenting" }]);
    expect(node!["oa:hasBody"]).toEqual({ "@type": "oa:TextualBody", "rdf:value": "メモ本文", "dc:format": "text/plain" });
    expect(node!["oa:hasTarget"]).toEqual([{ "@id": NOTE_IRI }]);
    // 時刻は Z に正規化。modified が無ければ出さない
    expect(node!["dcterms:created"]).toEqual({ "@value": "2026-10-01T00:00:00.000Z", "@type": "xsd:dateTime" });
    expect(node!["prov:generatedAtTime"]).toEqual(node!["dcterms:created"]);
    expect(node!["dcterms:modified"]).toBeUndefined();
  });

  it("ブロックのメモ: SpecificResource + Fragment/Css セレクタ + そのブロックの PROV ノード 1 つ", () => {
    const { node } = memoOf(baseMemo({ sourceNote: { fileId: NOTE_ID, blockId: "h-proc", blockText: "焼成する" } }));
    const targets = node!["oa:hasTarget"];
    expect(targets).toHaveLength(2);
    expect(targets[0]).toMatchObject({
      "@type": "oa:SpecificResource",
      "oa:hasSource": { "@id": NOTE_IRI },
      "graphium:blockText": "焼成する",
    });
    expect(targets[0]["oa:hasSelector"]).toEqual([
      {
        "@type": "oa:FragmentSelector",
        "rdf:value": "h-proc",
        "dcterms:conformsTo": { "@id": "https://graphium.app/ns#block-id" },
      },
      { "@type": "oa:CssSelector", "rdf:value": '[data-id="h-proc"]' },
    ]);
    expect(targets[1]).toEqual({ "@id": `${P}activity_h-proc` });
  });

  it("ブロックのメモ: Activity が無ければ blockId 一致の最初の Entity、どれも無ければ PROV ノードは並べない", () => {
    const { g, node } = memoOf(baseMemo({ sourceNote: { fileId: NOTE_ID, blockId: "img1" } }));
    const prov = node!["oa:hasTarget"][1]["@id"];
    expect(byId(g, prov)!["@type"]).toBe("Entity");
    expect(byId(g, prov)!["graphium:blockId"]).toBe("img1");
    const { node: n2 } = memoOf(baseMemo({ sourceNote: { fileId: NOTE_ID, blockId: "para-1" } }));
    expect(n2!["oa:hasTarget"]).toHaveLength(1);
  });

  it("素材のメモ: target は素材", () => {
    const { node } = memoOf(baseMemo({ sourceAsset: { fileId: "pdf-1", type: "pdf" } }));
    expect(node!["oa:hasTarget"]).toEqual([{ "@id": "graphium:pdf/pdf-1" }]);
    expect(node!["oa:motivatedBy"]).toEqual([{ "@id": "oa:commenting" }]);
  });

  it("引用メモ（未編集・ページ有り）: highlighting+commenting、page= の Fragment が TextQuote で絞られる", () => {
    const text = "引用された一文\n\n— paper.pdf p.3";
    const { node } = memoOf(baseMemo({ text, isQuote: true, sourceAsset: { fileId: "pdf-1", type: "pdf", pageNumber: 3 } }));
    expect(node!["oa:motivatedBy"]).toEqual([{ "@id": "oa:highlighting" }, { "@id": "oa:commenting" }]);
    expect(node!["oa:hasBody"]["rdf:value"]).toBe(text);
    expect(node!["oa:hasTarget"]).toEqual([
      {
        "@type": "oa:SpecificResource",
        "oa:hasSource": { "@id": "graphium:pdf/pdf-1" },
        "oa:hasSelector": {
          "@type": "oa:FragmentSelector",
          "rdf:value": "page=3",
          "dcterms:conformsTo": { "@id": "http://tools.ietf.org/rfc/rfc3778" },
          "oa:refinedBy": { "@type": "oa:TextQuoteSelector", "oa:exact": "引用された一文" },
        },
      },
    ]);
  });

  it("引用メモ（編集済み）: TextQuote は付けず、ページの Fragment だけ", () => {
    const { node } = memoOf(
      baseMemo({
        text: "書き換えた\n\n— paper.pdf p.3",
        edited: true,
        isQuote: true,
        sourceAsset: { fileId: "pdf-1", type: "pdf", pageNumber: 3 },
      }),
    );
    const sel = node!["oa:hasTarget"][0]["oa:hasSelector"];
    expect(sel["rdf:value"]).toBe("page=3");
    expect(sel["oa:refinedBy"]).toBeUndefined();
  });

  it("引用メモ（引用部が空・ページ無し）: セレクタを付けず target は素材そのもの", () => {
    const { node } = memoOf(
      baseMemo({ text: "\n\n— paper.pdf", isQuote: true, sourceAsset: { fileId: "pdf-1", type: "pdf" } }),
    );
    expect(node!["oa:hasTarget"]).toEqual([{ "@id": "graphium:pdf/pdf-1" }]);
    // 引用部があってページが無ければ TextQuote だけを selector にする
    const { node: n2 } = memoOf(
      baseMemo({ id: "m2", text: "一文\n\n— paper.pdf", isQuote: true, sourceAsset: { fileId: "pdf-1", type: "pdf" } }),
    );
    expect(n2!["oa:hasTarget"][0]["oa:hasSelector"]).toEqual({ "@type": "oa:TextQuoteSelector", "oa:exact": "一文" });
  });

  it("他ノートの出典: external スタブを宣言して target にする", () => {
    const { g, node } = memoOf(
      baseMemo({ sourceNote: { fileId: "note-other" }, sourceAsset: { fileId: "pdf-1", type: "pdf" } }),
    );
    expect(node!["oa:hasTarget"]).toEqual([{ "@id": "graphium:note/note-other" }, { "@id": "graphium:pdf/pdf-1" }]);
    expect(byId(g, "graphium:note/note-other")!["graphium:external"]).toBe(true);
  });

  it("target が決まらないメモ（挿入済みだけ）はノートを target にし、ノート Entity が wasInfluencedBy で参照する", () => {
    const { g, node } = memoOf(baseMemo({ usedInThisNote: true }));
    expect(node!["oa:hasTarget"]).toEqual([{ "@id": NOTE_IRI }]);
    expect(noteEntity(g)["prov:wasInfluencedBy"]).toContainEqual({ "@id": "graphium:memo/m1" });
  });

  it("含める範囲: どの条件にも当たらないメモ・assets に無い素材のメモは出ない。includeMemos:false なら全部出ない", () => {
    const stray = baseMemo({ id: "stray", sourceNote: { fileId: "note-other" } });
    const noAsset = baseMemo({ id: "noasset", sourceAsset: { fileId: "not-in-assets", type: "pdf" } });
    const g = graphOf(makeInput({ extras: { ...richExtras(), memos: [stray, noAsset] } }));
    expect(g.some((n) => String(n["@id"]).startsWith("graphium:memo/"))).toBe(false);

    const g2 = graphOf(
      makeInput({
        extras: { ...richExtras(), memos: [baseMemo({ usedInThisNote: true })] },
        options: { includeMemos: false },
      }),
    );
    expect(g2.some((n) => String(n["@id"]).startsWith("graphium:memo/"))).toBe(false);
    expect(noteEntity(g2)["prov:wasInfluencedBy"]).not.toContainEqual({ "@id": "graphium:memo/m1" });
  });

  it("不正な時刻は出さない（created が読めなければ created / generatedAtTime とも無し）", () => {
    const { node } = memoOf(baseMemo({ sourceNote: { fileId: NOTE_ID }, createdAt: "???", modifiedAt: "2026-10-02T00:00:00+09:00" }));
    expect(node!["dcterms:created"]).toBeUndefined();
    expect(node!["prov:generatedAtTime"]).toBeUndefined();
    expect(node!["dcterms:modified"]).toEqual({ "@value": "2026-10-01T15:00:00.000Z", "@type": "xsd:dateTime" });
  });
});

// ────────────────────────────────────────────
// 人の Agent
// ────────────────────────────────────────────

describe("buildNoteProvJsonLd — 人の Agent", () => {
  const memos = (): MemoExportEntry[] => [
    {
      id: "a",
      text: "A",
      createdAt: "2026-10-01T00:00:00Z",
      edited: false,
      usedInThisNote: true,
      isQuote: false,
      createdBy: "yamada@example.com",
    },
    {
      id: "b",
      text: "B",
      createdAt: "2026-10-01T00:00:00Z",
      edited: false,
      usedInThisNote: true,
      isQuote: false,
      createdBy: "YAMADA@example.com ",
    },
    { id: "c", text: "C", createdAt: "2026-10-01T00:00:00Z", edited: false, usedInThisNote: true, isQuote: false },
  ];

  it("sha1(email) の IRI で 1 回だけ宣言し、生のメールは出さない。識別情報が無ければ anonymous", () => {
    const g = graphOf(makeInput({ extras: { ...richExtras(), memos: memos() } }));
    const hash = createHash("sha1").update("yamada@example.com").digest("hex");
    const agents = g.filter((n) => String(n["@id"]).startsWith("graphium:agent/person/"));
    expect(agents.map((a) => a["@id"]).sort()).toEqual(
      [`graphium:agent/person/${hash}`, "graphium:agent/person/anonymous"].sort(),
    );
    const person = byId(g, `graphium:agent/person/${hash}`)!;
    expect(person["@type"]).toEqual(["Agent", "prov:Person"]);
    expect(person["foaf:name"]).toBe("山田太郎");
    expect(person["foaf:mbox_sha1sum"]).toBe(createHash("sha1").update("mailto:yamada@example.com").digest("hex"));
    expect(JSON.stringify(g)).not.toMatch(/yamada@/i);
    // メモ a と b は同じ Agent を指す
    expect(byId(g, "graphium:memo/a")!["dcterms:creator"]).toEqual({ "@id": `graphium:agent/person/${hash}` });
    expect(byId(g, "graphium:memo/b")!["prov:wasAttributedTo"]).toEqual({ "@id": `graphium:agent/person/${hash}` });
    expect(byId(g, "graphium:memo/c")!["dcterms:creator"]).toEqual({ "@id": "graphium:agent/person/anonymous" });
  });

  it("メモもチャットも無ければ人の Agent は宣言しない", () => {
    const g = graphOf(makeInput({ extras: richExtras() }));
    expect(g.some((n) => String(n["@id"]).startsWith("graphium:agent/person/"))).toBe(false);
  });
});

// ────────────────────────────────────────────
// チャット
// ────────────────────────────────────────────

describe("buildNoteProvJsonLd — AI チャット（既定 OFF）", () => {
  const chats = () => [
    {
      id: "c1",
      scopeBlockId: "h-proc",
      scopeType: "heading" as const,
      model: "claude-sonnet-4",
      messages: [
        { role: "user" as const, content: "焼成温度は？", timestamp: "2026-10-02T10:00:00+09:00" },
        { role: "assistant" as const, content: "800℃です", timestamp: "2026-10-02T10:00:05+09:00" },
      ],
    },
  ];
  const chatIri = `graphium:chat/note-1/c1`;

  it("既定では出ない（extras に chats があっても）", () => {
    const g = graphOf(makeInput({ extras: { ...richExtras(), chats: chats() } }));
    expect(g.some((n) => String(n["@id"]).startsWith("graphium:chat/"))).toBe(false);
    expect(g.some((n) => String(n["@id"]).startsWith("graphium:agent/person/"))).toBe(false);
  });

  it("includeChats:true で Collection + メッセージ Entity が出る", () => {
    const g = graphOf(makeInput({ extras: { ...richExtras(), chats: chats() }, options: { includeChats: true } }));
    const col = byId(g, chatIri)!;
    expect(col["@type"]).toEqual(["Entity", "prov:Collection"]);
    expect(col.label).toEqual([{ "@value": "焼成温度は？" }]);
    expect(col["prov:wasInfluencedBy"]).toEqual([{ "@id": NOTE_IRI }, { "@id": `${P}activity_h-proc` }]);
    const members = col["prov:hadMember"].map((m: any) => m["@id"]);
    expect(members).toEqual([
      `${chatIri}/msg/${encodeURIComponent("2026-10-02T10:00:00+09:00")}`,
      `${chatIri}/msg/${encodeURIComponent("2026-10-02T10:00:05+09:00")}`,
    ]);
    const user = byId(g, members[0])!;
    const ai = byId(g, members[1])!;
    expect(user["prov:value"]).toBe("焼成温度は？");
    expect(user["graphium:role"]).toBe("user");
    expect(user["graphium:messageIndex"]).toBe(0);
    expect(user["prov:generatedAtTime"]).toEqual({ "@value": "2026-10-02T01:00:00.000Z", "@type": "xsd:dateTime" });
    expect(ai["graphium:role"]).toBe("assistant");
    expect(ai["prov:wasInfluencedBy"]).toEqual({ "@id": members[0] });
    expect(ai["prov:wasAttributedTo"]).toEqual({ "@id": "graphium:agent/claude-sonnet-4" });
    expect(byId(g, "graphium:agent/claude-sonnet-4")!["graphium:agentType"]).toBe("ai");
    // 人の Agent は 1 回
    expect(g.filter((n) => String(n["@id"]).startsWith("graphium:agent/person/"))).toHaveLength(1);
    expect(user["prov:wasAttributedTo"]["@id"]).toMatch(/^graphium:agent\/person\//);
  });

  it("model 不明の assistant には wasAttributedTo を付けない。ラベルは先頭 60 字", () => {
    const long = "あ".repeat(100);
    const g = graphOf(
      makeInput({
        extras: {
          chats: [
            {
              id: "c2",
              scopeType: "page",
              messages: [
                { role: "user", content: long, timestamp: "2026-10-02T00:00:00Z" },
                { role: "assistant", content: "ok", timestamp: "2026-10-02T00:00:01Z" },
              ],
            },
          ],
        },
        options: { includeChats: true },
      }),
    );
    const col = byId(g, "graphium:chat/note-1/c2")!;
    expect(col.label![0]["@value"]).toHaveLength(60);
    const ai = g.find((n) => n["graphium:role"] === "assistant")!;
    expect(ai["prov:wasAttributedTo"]).toBeUndefined();
    // humanAgent が無い user は anonymous
    const user = g.find((n) => n["graphium:role"] === "user")!;
    expect(user["prov:wasAttributedTo"]).toEqual({ "@id": "graphium:agent/person/anonymous" });
  });
});

// ────────────────────────────────────────────
// 線の名前（実績）
// ────────────────────────────────────────────

describe("buildNoteProvJsonLd — 線の名前（実績）", () => {
  const crossLink: BlockLink = {
    id: "link-x",
    sourceBlockId: "h-proc",
    targetBlockId: "src-step",
    type: "informed_by",
    layer: "prov",
    createdBy: "human",
    targetNoteId: "note-b",
    targetEntityId: "row_123",
    targetEntityLabel: "試料X",
  };

  it("受け側 Activity への Usage の label に線の名前を付ける（無ければ付けない）", () => {
    const page = makePage();
    const provDoc = makeProvDoc(page, { links: [crossLink] });
    const named = graphOf({
      provDoc,
      title: "t",
      noteId: NOTE_ID,
      page,
      crossNoteLinks: [crossLink],
      extras: { edgeLabelForLink: () => " 前駆体 " },
    });
    const usage = named.find((n) => n["@type"] === "Usage" && String(n["@id"]).includes("cross_note_"))!;
    expect(usage).toBeDefined();
    expect(usage.activity).toBe(`${P}activity_h-proc`);
    expect(usage.label).toEqual([{ "@value": "前駆体" }]);

    const plain = graphOf({ provDoc, title: "t", noteId: NOTE_ID, page, crossNoteLinks: [crossLink] });
    expect(plain.find((n) => String(n["@id"]).includes("cross_note_"))!.label).toBeUndefined();

    const unnamed = graphOf({
      provDoc,
      title: "t",
      noteId: NOTE_ID,
      page,
      crossNoteLinks: [crossLink],
      extras: { edgeLabelForLink: () => undefined },
    });
    expect(unnamed.find((n) => String(n["@id"]).includes("cross_note_"))!.label).toBeUndefined();
  });

  it("受け側ローカルノードがあれば Derivation の label に付く", () => {
    // 手書き ProvJsonLd: 表の行 identity を持つ Entity が受け側
    const provDoc: ProvJsonLd = {
      "@context": {} as any,
      "@graph": [
        { "@id": "activity_h-proc", "@type": "prov:Activity", "rdfs:label": "焼成", "graphium:blockId": "h-proc" },
        {
          "@id": "entity_row",
          "@type": "prov:Entity",
          "rdfs:label": "行",
          "graphium:blockId": "t1",
          "graphium:tableRowId": "row_123",
        },
      ],
    };
    const g = graphOf({
      provDoc,
      title: "t",
      noteId: NOTE_ID,
      page: makePage(),
      crossNoteLinks: [{ ...crossLink, sourceEntityId: "row_123" }],
      extras: { edgeLabelForLink: () => "原料" },
    });
    const deriv = g.find((n) => n["@type"] === "Derivation" && String(n["@id"]).includes("cross_note_"))!;
    expect(deriv.generatedEntity).toBe(`${P}entity_row`);
    expect(deriv.label).toEqual([{ "@value": "原料" }]);
  });
});

// ────────────────────────────────────────────
// 全体の整合
// ────────────────────────────────────────────

describe("buildNoteProvJsonLd — 整合（dangling / スタブと本体）", () => {
  const rich = (): NoteProvExportInput => {
    const page = makePage();
    const link: BlockLink = {
      id: "link-x",
      sourceBlockId: "h-proc",
      targetBlockId: "src-step",
      type: "informed_by",
      layer: "prov",
      createdBy: "human",
      targetNoteId: "note-b",
      targetEntityId: "row_123",
    };
    return {
      provDoc: makeProvDoc(page, { links: [link] }),
      title: "焼成ノート",
      noteId: NOTE_ID,
      page,
      crossNoteLinks: [link],
      wikiEntities: [
        { ...wikiEntity, derivedFromNotes: ["note-1", "pdf:pdf-1", "note-parent"], documentProvenance: undefined },
      ],
      extras: {
        ...richExtras(),
        memos: [
          {
            id: "m1",
            text: "引用\n\n— paper.pdf p.2",
            createdAt: "2026-10-01T00:00:00Z",
            edited: false,
            usedInThisNote: true,
            isQuote: true,
            createdBy: "yamada@example.com",
            sourceAsset: { fileId: "pdf-1", type: "pdf", pageNumber: 2 },
            sourceNote: { fileId: NOTE_ID, blockId: "h-proc" },
          },
        ],
        chats: [
          {
            id: "c1",
            scopeBlockId: "h-proc",
            scopeType: "heading",
            model: "m",
            messages: [{ role: "user", content: "q", timestamp: "2026-10-02T00:00:00Z" }],
          },
        ],
      },
      options: { includeChats: true },
    };
  };

  it("全参照に宣言がある（dangling 無し）", () => {
    const g = graphOf(rich());
    expect(danglingRefs(g)).toEqual([]);
  });

  it("extras 無しの最小入力でも dangling が無い", () => {
    expect(danglingRefs(graphOf(makeInput()))).toEqual([]);
  });

  it("external 付きの本体ノードが無い（同じ @id にスタブと本体が並ばない）", () => {
    const g = graphOf(rich());
    expect(stubAndBodyIds(g)).toEqual([]);
    // wiki の Derivation が pdf:pdf-1 を参照するが、素材本体があるのでスタブは出ない
    expect(g.filter((n) => n["@id"] === "graphium:pdf/pdf-1")).toHaveLength(1);
    expect(byId(g, "graphium:pdf/pdf-1")!["graphium:external"]).toBeUndefined();
    // ノート自身を指す wiki の Derivation スタブも、ノート Entity があるので落ちる
    expect(g.filter((n) => n["@id"] === NOTE_IRI)).toHaveLength(1);
    expect(noteEntity(g)["graphium:external"]).toBeUndefined();
  });

  it("計画ノートの本体が並ぶ書き出しでは、partOf のスタブが落ちる（dedupeStubs）", () => {
    const g = graphOf(rich());
    const planStub = byId(g, "graphium:note/plan-1")!;
    expect(planStub["graphium:external"]).toBe(true);
    const merged = dedupeStubs([...g, { "@type": ["Entity", "prov:Plan"], "@id": "graphium:note/plan-1" } as any]);
    expect(merged.filter((n) => n["@id"] === "graphium:note/plan-1")).toHaveLength(1);
    expect(byId(merged, "graphium:note/plan-1")!["graphium:external"]).toBeUndefined();
  });

  it("検査自体が働く: 宣言を消した出力では dangling を検出する", () => {
    const g = graphOf(rich()).filter((n) => n["@id"] !== "graphium:agent/claude-sonnet");
    const g2 = g.filter((n) => !String(n["@id"]).startsWith("graphium:folder/"));
    expect(danglingRefs(g2)).toContain(`graphium:folder/${encodeURIComponent("材料X")}`);
  });

  it("JSON として直列化できる（循環参照が無い）", () => {
    expect(() => JSON.stringify(buildNoteProvJsonLd(rich()))).not.toThrow();
  });
});

describe("dedupeStubs", () => {
  it("本体が無いスタブは残し、同じ @id に本体があるスタブだけ落とす。Bundle 内も同様", () => {
    const out = dedupeStubs([
      { "@type": "Entity", "@id": "a", "graphium:external": true },
      { "@type": "Entity", "@id": "a" },
      { "@type": "Entity", "@id": "b", "graphium:external": true },
      {
        "@type": "prov:Bundle",
        "@id": "bundle",
        "@graph": [
          { "@type": "Entity", "@id": "a", "graphium:external": true },
          { "@type": "Entity", "@id": "b", "graphium:external": true },
          { "@type": "Entity", "@id": "c" },
          { "@type": "Entity", "@id": "c", "graphium:external": true },
        ],
      } as any,
    ]);
    expect(out.map((n) => `${n["@id"]}${n["graphium:external"] ? "*" : ""}`)).toEqual(["a", "b*", "bundle"]);
    const inner = out[2]["@graph"].map((n: any) => `${n["@id"]}${n["graphium:external"] ? "*" : ""}`);
    expect(inner).toEqual(["b*", "c"]);
  });
});

describe("buildNoteProvJsonLd — 標準で読める双子（graphium:parameter / graphium:entityType）", () => {
  function makeTwinInput(): NoteProvExportInput {
    const page = makePage();
    (page as any).blocks = [
      ...page.blocks,
      table("t-stage2", ["温度 (℃)", "時間"], [["600", "1h"]]),
    ];
    (page.labels as any)["t-stage2"] = "attribute";
    return makeInput({
      page,
      provDoc: makeProvDoc(page),
    });
  }
  const graph = () => graphOf(makeTwinInput());
  const content = (g: W3CProvNode[]) => g.filter((n) => n["@type"] === "Activity" || n["@type"] === "Entity");

  it("空白を含む列名だけが graphium:parameter に写り、元のキーも残る", () => {
    const withParam = content(graph()).filter((n) => n["graphium:parameter"]);
    expect(withParam.length).toBeGreaterThan(0);
    for (const n of withParam) {
      const key = "graphium:温度 (℃)";
      expect(n[key]).toBeDefined();
      expect(n["graphium:parameter"]).toContainEqual({ "rdfs:label": "温度 (℃)", "rdf:value": n[key] });
      const labels = (n["graphium:parameter"] as any[]).map((p) => p["rdfs:label"]);
      expect(labels).not.toContain("時間");
      expect(labels).not.toContain("温度");
    }
  });

  it("空白を含まない列（時間）は双子にならず、該当の無いノードには graphium:parameter が無い", () => {
    const g = graph();
    const timeOnly = content(g).filter((n) => "graphium:時間" in n && !("graphium:温度 (℃)" in n));
    for (const n of timeOnly) expect("graphium:parameter" in n).toBe(false);
    for (const n of content(g)) {
      if (!Object.keys(n).some((k) => /^graphium:.*[\s]/.test(k))) expect("graphium:parameter" in n).toBe(false);
    }
  });

  it("type が @value 配列のノードに graphium:entityType が付き、type は残る", () => {
    const g = graph();
    const typed = content(g).filter((n) => Array.isArray((n as any).type));
    expect(typed.length).toBeGreaterThan(0);
    for (const n of typed) {
      expect(n["graphium:entityType"]).toBe((n as any).type[0]["@value"]);
    }
    expect(typed.some((n) => n["graphium:entityType"] === "material")).toBe(true);
    for (const n of content(g)) {
      if (!Array.isArray((n as any).type)) expect("graphium:entityType" in n).toBe(false);
    }
  });

  it("関係ノードには付かない", () => {
    const rel = graph().filter((n) => ["Usage", "Generation", "Derivation", "Communication"].includes(n["@type"] as string));
    expect(rel.length).toBeGreaterThan(0);
    for (const n of rel) {
      expect("graphium:parameter" in n).toBe(false);
      expect("graphium:entityType" in n).toBe(false);
    }
  });
});

// ────────────────────────────────────────────
// レビュー指摘の回帰
// ────────────────────────────────────────────

describe("buildNoteProvJsonLd — レビュー指摘の回帰", () => {
  const memo = (over: Partial<MemoExportEntry>): MemoExportEntry => ({
    id: "m1",
    text: "メモ",
    createdAt: "2026-10-01T00:00:00Z",
    edited: false,
    usedInThisNote: false,
    isQuote: false,
    ...over,
  });

  it("wiki: 接頭辞付きの noteId・メモ sourceNote でも照合できる", () => {
    const g = graphOf(
      makeInput({
        noteId: "wiki:abc",
        extras: { memos: [memo({ sourceNote: { fileId: "wiki:abc" } })] },
      }),
    );
    const node = byId(g, "graphium:memo/m1")!;
    expect(node).toBeDefined();
    // 自ノート扱い（外部スタブを作らない）
    expect(node["oa:hasTarget"]).toEqual([{ "@id": "graphium:note/wiki%3Aabc" }]);
    expect(g.some((n) => n["graphium:external"] === true)).toBe(false);
  });

  it("接頭辞なしの noteId と wiki: 付きのメモも同じノートとして照合する", () => {
    const g = graphOf(makeInput({ noteId: "abc", extras: { memos: [memo({ sourceNote: { fileId: "wiki:abc" } })] } }));
    expect(byId(g, "graphium:memo/m1")!["oa:hasTarget"]).toEqual([{ "@id": "graphium:note/abc" }]);
  });

  it("PDF 以外の引用メモは pageNumber があっても page= を出さず TextQuote だけ", () => {
    const g = graphOf(
      makeInput({
        extras: {
          assets: [{ fileId: "img-1", type: "image", name: "a.png" }],
          memos: [
            memo({
              text: "引用\n\n— a.png",
              isQuote: true,
              sourceAsset: { fileId: "img-1", type: "image", pageNumber: 3 },
            }),
          ],
        },
      }),
    );
    const target = byId(g, "graphium:memo/m1")!["oa:hasTarget"][0];
    expect(target["oa:hasSelector"]).toEqual({ "@type": "oa:TextQuoteSelector", "oa:exact": "引用" });
    expect(JSON.stringify(target)).not.toContain("page=");
  });

  it("PDF の引用メモは page= + rfc3778", () => {
    const g = graphOf(
      makeInput({
        extras: {
          assets: [{ fileId: "pdf-1", type: "pdf" }],
          memos: [
            memo({ text: "引用\n\n— p", isQuote: true, sourceAsset: { fileId: "pdf-1", type: "pdf", pageNumber: 3 } }),
          ],
        },
      }),
    );
    const sel = byId(g, "graphium:memo/m1")!["oa:hasTarget"][0]["oa:hasSelector"];
    expect(sel["rdf:value"]).toBe("page=3");
  });

  it("name だけで email が無い人は anonymous に名前を付けない（メモとチャットの呼び出し順に依存しない）", () => {
    const chat = {
      id: "c1",
      scopeType: "page" as const,
      messages: [{ role: "user" as const, content: "Q", timestamp: "2026-10-01T00:00:00Z" }],
    };
    const noMailMemo = memo({ usedInThisNote: true });
    // メモ（作者不明）とチャット（name のみ）が同じ anonymous を指しても、名前は付かない
    const input = makeInput({
      extras: { humanAgent: { name: "山田" }, memos: [noMailMemo], chats: [chat] },
      options: { includeChats: true },
    });
    const anon = byId(graphOf(input), "graphium:agent/person/anonymous")!;
    expect(anon).toBeDefined();
    expect(anon.label).toBeUndefined();
    expect(anon["foaf:name"]).toBeUndefined();
  });

  it("title が空なら label を省き、本文が空なら本文 Entity を作らない", () => {
    const page = { ...makePage(), blocks: [], labels: {} } as GraphiumPage;
    const g = graphOf(makeInput({ title: "", page, provDoc: makeProvDoc(page) }));
    expect(noteEntity(g).label).toBeUndefined();
    expect(g.some((n) => String(n["@id"]).includes("/text/"))).toBe(false);
    expect(JSON.stringify(g)).not.toContain('"prov:value":""');
  });

  it("title が空でも本文があれば本文 Entity に label は付かない", () => {
    const g = graphOf(makeInput({ title: "" }));
    const body = g.find((n) => String(n["@id"]).includes("/text/"))!;
    expect(body).toBeDefined();
    expect(body.label).toBeUndefined();
  });

  it("同じ @id の最小ノード（wiki 由来の url: と sources の url）は 1 つだけ残り、label は読める方", () => {
    const wiki: WikiEntityInfo = { ...wikiEntity, derivedFromNotes: ["url:https://example.com/x"] };
    const g = graphOf(
      makeInput({
        wikiEntities: [wiki],
        extras: { sources: [{ kind: "url", id: "https://example.com/x", label: "記事タイトル" }] },
      }),
    );
    const same = g.filter((n) => n["@id"] === "graphium:url/https%3A%2F%2Fexample.com%2Fx");
    expect(same).toHaveLength(1);
  });

  it("dedupeStubs: 同じ @id の最小ノードは URL そのままでない label を持つ方を残す", () => {
    const out = dedupeStubs([
      { "@type": "Entity", "@id": "u", label: [{ "@value": "https://e.com" }], "graphium:sourceKind": "url" },
      { "@type": "Entity", "@id": "u", label: [{ "@value": "タイトル" }], "graphium:sourceKind": "url" },
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].label).toEqual([{ "@value": "タイトル" }]);
  });

  it("取り込み元 Entity に generatedAtTime と、素材への wasDerivedFrom（索引にあれば本体・無ければ外部スタブ）", () => {
    const tm = (fileId?: string) => ({
      "t-mat": {
        source: {
          kind: "delimited-file" as const,
          fileName: "raw.csv",
          ...(fileId ? { fileId } : {}),
          importedAt: "2026-10-01T09:00:00+09:00",
          options: { headerRow: 1, endRow: 10, delimiter: "comma" as const, collapseConsecutive: false },
        },
      },
    });
    const g = graphOf(
      makeInput({ extras: { tableMeta: tm("data-1"), assets: [{ fileId: "data-1", type: "data", name: "raw.csv" }] } }),
    );
    const imp = byId(g, `${P}import/t-mat`)!;
    expect(imp["prov:generatedAtTime"]).toEqual({ "@value": "2026-10-01T00:00:00.000Z", "@type": "xsd:dateTime" });
    expect(imp["prov:wasDerivedFrom"]).toEqual({ "@id": "graphium:data/data-1" });
    const asset = byId(g, "graphium:data/data-1")!;
    expect(asset["graphium:external"]).toBeUndefined();

    const g2 = graphOf(makeInput({ extras: { tableMeta: tm("data-2") } }));
    expect(byId(g2, `${P}import/t-mat`)!["prov:wasDerivedFrom"]).toEqual({ "@id": "graphium:data/data-2" });
    expect(byId(g2, "graphium:data/data-2")!["graphium:external"]).toBe(true);
    expect(danglingRefs(g2)).toEqual([]);

    // fileId が無ければ wasDerivedFrom は出ない
    const g3 = graphOf(makeInput({ extras: { tableMeta: tm() } }));
    expect(byId(g3, `${P}import/t-mat`)!["prov:wasDerivedFrom"]).toBeUndefined();
  });
});
