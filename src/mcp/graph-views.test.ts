import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { buildIndexEntry, INDEX_SCHEMA_VERSION } from "../features/navigation/index-file";
import { createActivityLog } from "./activity";
import { buildFlowPayload, buildKnowledgePayload, buildLineagePayload } from "./graph-views";
import { resetSearchIndex } from "./search";

let root: string;
const p = (...s: string[]) => join(root, ...s);

function text(t: string, styles: Record<string, string> = {}) {
  return { type: "text", text: t, styles };
}

/** 手順 2 件（こねる → 焼く）のノート。こねるの生成物「生地」を焼くが使う */
function procedureDoc() {
  const step = (id: string, title: string, children: unknown[]) => ({
    id,
    type: "step",
    props: {},
    content: [text(title)],
    children,
  });
  return {
    version: 5,
    title: "パンの作り方",
    createdAt: "2026-01-01T00:00:00.000Z",
    modifiedAt: "2026-01-01T00:00:00.000Z",
    pages: [
      {
        id: "main",
        title: "パンの作り方",
        blocks: [
          step("s1", "こねる", [
            { id: "p1", type: "paragraph", props: {}, content: [text("強力粉", { inlineMaterial: "ent_m1" }), text(" をこねて "), text("生地", { inlineOutput: "ent_o1" })], children: [] },
          ]),
          step("s2", "焼く", [
            { id: "p2", type: "paragraph", props: {}, content: [text("生地", { inlineMaterial: "ent_m2" }), text(" を "), text("オーブン", { inlineTool: "ent_t1" }), text(" で焼く")], children: [] },
          ]),
        ],
        labels: {},
        provLinks: [{ id: "l1", sourceBlockId: "s2", targetBlockId: "s1", type: "informed_by", layer: "prov", createdBy: "human" }],
        knowledgeLinks: [],
      },
    ],
  };
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "graph-views-"));
  for (const d of ["notes", "wiki", "appdata"]) mkdirSync(p(d), { recursive: true });
  resetSearchIndex();
});
afterEach(() => {
  resetSearchIndex();
  rmSync(root, { recursive: true, force: true });
});

describe("buildFlowPayload", () => {
  it("手順と材料・道具・生成物を、アプリと同じ投影でノードと線にする", () => {
    const payload = buildFlowPayload(procedureDoc() as never);
    expect(payload?.mode).toBe("flow");
    const steps = payload!.nodes.filter((n) => n.kind === "step").map((n) => n.label);
    expect(steps).toEqual(["こねる", "焼く"]);
    const kinds = new Set(payload!.nodes.map((n) => n.kind));
    expect(kinds.has("material")).toBe(true);
    expect(kinds.has("tool")).toBe(true);
    // 線の両端はすべて描くノードにある
    const ids = new Set(payload!.nodes.map((n) => n.id));
    for (const e of payload!.edges) expect(ids.has(e.source) && ids.has(e.target)).toBe(true);
  });

  it("手順の無いノートは null", () => {
    const doc = procedureDoc();
    doc.pages[0].blocks = [];
    expect(buildFlowPayload(doc as never)).toBeNull();
  });
});

describe("buildLineagePayload", () => {
  it("上流は負の段・下流は正の段に置き、線は元 → 派生にそろえる", () => {
    const payload = buildLineagePayload(
      {
        noteId: "x",
        upstream: [{ noteId: "up", title: "上流", depth: 1, via: { type: "derived_from", layer: "prov", sourceBlockId: "", targetBlockId: "" } }],
        downstream: [{ noteId: "down", title: "下流", depth: 1, via: { type: "derived_from", layer: "knowledge", sourceBlockId: "", targetBlockId: "" } }],
        connections: [],
      },
      "起点",
    );
    const rank = Object.fromEntries(payload.nodes.map((n) => [n.id, n.rank]));
    expect(rank).toEqual({ x: 0, up: -1, down: 1 });
    expect(payload.nodes.find((n) => n.id === "x")?.focus).toBe(true);
    expect(payload.edges.map((e) => `${e.source}->${e.target}:${e.kind}`).sort()).toEqual(["up->x:prov", "x->down:knowledge"]);
  });
});

describe("buildKnowledgePayload", () => {
  function seed(): void {
    const note = (title: string, folders?: string[]) => ({
      version: 2,
      title,
      source: "human",
      createdAt: "2026-01-01T00:00:00.000Z",
      modifiedAt: "2026-01-01T00:00:00.000Z",
      pages: [{ id: "main", title, blocks: [], labels: {}, provLinks: [], knowledgeLinks: [] }],
      ...(folders ? { noteContexts: folders } : {}),
    });
    const claim = (title: string, from: string) => ({
      ...note(title),
      source: "ai",
      wikiMeta: { kind: "claim", derivedFromNotes: [from], generatedBy: { model: "m", at: "2026-01-01T00:00:00.000Z" } },
    });
    const docs: [string, string, unknown][] = [
      ["notes", "a", note("A", ["パン"])],
      ["notes", "b", note("B", ["カレー"])],
      ["wiki", "ca", claim("A の知見", "a")],
      ["wiki", "cb", claim("B の知見", "b")],
    ];
    for (const [dir, id, d] of docs) writeFileSync(p(dir, `${id}.json`), JSON.stringify(d));
    writeFileSync(
      p("appdata", "note-index.json"),
      JSON.stringify({ version: INDEX_SCHEMA_VERSION, updatedAt: "x", notes: docs.map(([, id, d]) => buildIndexEntry(id, d as never)) }),
    );
  }

  it("アプリの全体グラフと同じノード・線を返し、フォルダの外を out にする", () => {
    seed();
    const all = buildKnowledgePayload({}, root)!;
    expect(all.nodes.map((n) => n.id).sort()).toEqual(["a", "b", "ca", "cb"]);
    expect(all.edges.length).toBe(2);
    expect(all.live).toBe(true);
    const scoped = buildKnowledgePayload({ folder: "パン" }, root)!;
    const out = Object.fromEntries(scoped.nodes.map((n) => [n.id, !!n.out]));
    expect(out).toEqual({ a: false, ca: false, b: true, cb: true });
  });

  it("上限を超えたら範囲の外から落とす", () => {
    seed();
    const r = buildKnowledgePayload({ folder: "パン", maxNodes: 2 }, root)!;
    expect(r.nodes.map((n) => n.id).sort()).toEqual(["a", "ca"]);
    expect(r.truncated).toEqual({ shown: 2, total: 4 });
  });
});

describe("activity log", () => {
  it("since より後の出来事を古い順に返し、上限を超えたら古いものから捨てる", () => {
    const log = createActivityLog(3);
    log.push("read", "a");
    log.push("walk", "b", "a");
    log.push("wrote", "c");
    log.push("seen", "d");
    expect(log.size).toBe(3);
    const first = log.since(0);
    expect(first.events.map((e) => e.id)).toEqual(["b", "c", "d"]);
    expect(first.events[0].from).toBe("a");
    expect(log.since(first.cursor).events).toEqual([]);
    expect(log.since(first.cursor).cursor).toBe(first.cursor);
  });
});

describe("file activity log（別の MCP プロセスからも読める記録）", () => {
  it("書いた側と別の記録から読め、notBefore より前は返さず、cursor の続きから読む", async () => {
    const { createFileActivityLog } = await import("./activity");
    const dir = mkdtempSync(join(tmpdir(), "activity-"));
    try {
      const writer = createFileActivityLog(() => dir);
      const reader = createFileActivityLog(() => dir);
      writer.push("read", "a");
      writer.push("walk", "b", "a");
      const first = reader.since(0);
      expect(first.events.map((e) => `${e.kind}:${e.id}`)).toEqual(["read:a", "walk:b"]);
      expect(first.events[1].from).toBe("a");
      expect(reader.since(first.cursor).events).toEqual([]);
      writer.push("wrote", "c");
      expect(reader.since(first.cursor).events.map((e) => e.id)).toEqual(["c"]);
      expect(reader.since(0, { notBefore: "2999-01-01T00:00:00.000Z" }).events).toEqual([]);
      // 世代が回って cursor がファイルより大きくなったら、頭から読み直す
      expect(reader.since(10_000_000).events.map((e) => e.id)).toEqual(["a", "b", "c"]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
