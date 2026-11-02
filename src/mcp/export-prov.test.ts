// export-prov.ts（export_prov の本体）の回帰テスト。

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { GraphiumDocument } from "../lib/document-types";
import { buildProvJsonLdText, resolveExportScope } from "./export-prov";

function heading(id: string, title: string) {
  return { id, type: "heading", props: { level: 2 }, content: [{ type: "text", text: title }], children: [] };
}

describe("buildProvJsonLdText", () => {
  it("@context と手順の Activity を含む JSON-LD を返す", () => {
    const doc = {
      title: "テスト",
      pages: [{ id: "p", blocks: [heading("h1", "1. 焼く")], labels: { h1: "procedure" }, provLinks: [] }],
    } as unknown as GraphiumDocument;
    const text = buildProvJsonLdText(doc, "n1")!;
    const parsed = JSON.parse(text);
    expect(parsed["@context"]).toBeDefined();
    expect(text).toContain("焼く");
  });

  it("他ノートへの informed_by は外部の参照として出る", () => {
    const doc = {
      title: "テスト",
      pages: [
        {
          id: "p",
          blocks: [heading("h1", "1. 焼く")],
          labels: { h1: "procedure" },
          provLinks: [
            { id: "l", sourceBlockId: "h1", targetBlockId: "x", targetNoteId: "other-note", targetEntityId: "ent1", type: "informed_by", layer: "prov", createdBy: "human" },
          ],
        },
      ],
    } as unknown as GraphiumDocument;
    expect(buildProvJsonLdText(doc, "n1")).toContain("other-note");
  });

  it("ページが無ければ null", () => {
    expect(buildProvJsonLdText({ title: "空", pages: [] } as unknown as GraphiumDocument, "n")).toBeNull();
  });
});

// ── scope / includeChats / plan（一時 vault で確かめる）──
describe("buildProvJsonLdText scope / includeChats / plan", () => {
  let root: string;
  const writeNote = (id: string, doc: unknown) =>
    writeFileSync(join(root, "notes", `${id}.json`), JSON.stringify(doc), "utf8");
  const entry = (noteId: string, noteContexts?: string[]) => ({
    noteId, title: noteId, modifiedAt: "2026-08-01T00:00:00.000Z", createdAt: "2026-08-01T00:00:00.000Z",
    headings: [], labels: [], outgoingLinks: [], ...(noteContexts ? { noteContexts } : {}),
  });
  const cell = (text: string) => ({ type: "tableCell", content: [{ type: "text", text, styles: {} }], props: {} });
  const planDoc = () => ({
    version: 6, title: "計画", noteContexts: ["計画"],
    pages: [{
      id: "p", blocks: [{
        id: "t1", type: "table", props: {}, children: [],
        content: { type: "tableContent", rows: [{ cells: [cell("工程")] }, { cells: [cell("焼成")] }] },
      }],
      labels: {}, provLinks: [], tableMeta: { t1: { noteLinks: { 焼成: "step1" }, columns: { 工程: ["note-link"] } } },
    }],
  });
  const stepDoc = () => ({
    version: 6, title: "焼成ノート",
    chats: [{ id: "c1", scopeType: "page", messages: [{ role: "user", content: "秘密のチャット質問", timestamp: "2026-08-01T00:00:00.000Z" }] }],
    pages: [{ id: "p", blocks: [heading("h1", "1. 焼く")], labels: { h1: "procedure" }, provLinks: [] }],
  });

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "graphium-mcp-prov-"));
    mkdirSync(join(root, "notes"), { recursive: true });
    mkdirSync(join(root, "appdata"), { recursive: true });
    writeNote("plan1", planDoc());
    writeNote("step1", stepDoc());
    writeFileSync(
      join(root, "appdata", "note-index.json"),
      JSON.stringify({ version: 1, updatedAt: "2026-08-01T00:00:00.000Z", notes: [entry("plan1", ["計画"]), entry("step1")] }),
      "utf8",
    );
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it("scope の既定: 計画ノートは plan、それ以外は note", () => {
    const idx = JSON.parse(JSON.stringify({ notes: [entry("plan1", ["計画"]), entry("step1")] }));
    expect(resolveExportScope(undefined, "plan1", idx)).toEqual({ scope: "plan" });
    expect(resolveExportScope(undefined, "step1", idx)).toEqual({ scope: "note" });
  });

  it("計画ノートでないのに scope=plan なら分かる文言のエラー", () => {
    const idx: any = { notes: [entry("step1")] };
    const r = resolveExportScope("plan", "step1", idx);
    expect("error" in r && r.error).toContain("計画ノート");
    expect(() => buildProvJsonLdText(stepDoc() as any, "step1", { scope: "plan", root })).toThrow(/計画ノート/);
  });

  it("scope=plan は工程ノートの手順を含む（既定でも plan になる）", () => {
    const text = buildProvJsonLdText(planDoc() as any, "plan1", { root })!;
    expect(text).toContain("焼く");
    expect(text).toContain("p-plan:Plan");
    expect(text).toContain("graphium:note/plan1/step/");
  });

  it("scope=note は計画ノートでもノート 1 件（Plan 型を付けない）", () => {
    const text = buildProvJsonLdText(planDoc() as any, "plan1", { scope: "note", root })!;
    expect(text).not.toContain("p-plan:Plan");
  });

  it("チャットは includeChats: true のときだけ出る", () => {
    const off = buildProvJsonLdText(stepDoc() as any, "step1", { root })!;
    const on = buildProvJsonLdText(stepDoc() as any, "step1", { root, includeChats: true })!;
    expect(off).not.toContain("秘密のチャット質問");
    expect(on).toContain("秘密のチャット質問");
  });

  it("索引が無くても doc.noteContexts が計画なら scope の既定は plan", () => {
    expect(resolveExportScope(undefined, "plan1", null, planDoc() as any)).toEqual({ scope: "plan" });
    expect(resolveExportScope(undefined, "step1", null, stepDoc() as any)).toEqual({ scope: "note" });
    // 索引のエントリが無い場合も doc に fallback する
    expect(resolveExportScope(undefined, "plan1", { notes: [] } as any, planDoc() as any)).toEqual({ scope: "plan" });
    // 索引のエントリがあればそちらを優先する
    expect(resolveExportScope(undefined, "plan1", { notes: [entry("plan1", ["その他"])] } as any, planDoc() as any)).toEqual({ scope: "note" });
  });

  it("scope=plan で索引が読めず doc でも判定できないときは索引の案内を返す", () => {
    const r = resolveExportScope("plan", "step1", null, stepDoc() as any);
    expect("error" in r && r.error).toContain("索引を読めません");
    expect("error" in r && r.error).toContain("Graphium を一度起動してください");
    expect("error" in resolveExportScope("plan", "plan1", null)).toBe(true);
    expect(resolveExportScope("plan", "plan1", null, planDoc() as any)).toEqual({ scope: "plan" });
  });

  it("title が空なら noteId を Plan / Step の label に使う", () => {
    const text = buildProvJsonLdText({ ...stepDoc(), title: "" } as any, "step1", { root })!;
    expect(text).toContain("step1");
    const plan = buildProvJsonLdText({ ...planDoc(), title: "" } as any, "plan1", { root })!;
    expect(plan).toContain("\"plan1\"");
  });

  it("入れ子の計画ノート（索引で計画と分かる行ノート）の先の工程ノートも読む", () => {
    const nested = {
      ...planDoc(), title: "入れ子計画",
      pages: [{
        ...planDoc().pages[0],
        tableMeta: { t1: { noteLinks: { 焼成: "step1" }, columns: { 工程: ["note-link"] } } },
      }],
    };
    const outer = {
      ...planDoc(), title: "外計画",
      pages: [{
        ...planDoc().pages[0],
        tableMeta: { t1: { noteLinks: { 焼成: "plan2" }, columns: { 工程: ["note-link"] } } },
      }],
    };
    writeNote("plan1", outer);
    writeNote("plan2", nested);
    writeFileSync(
      join(root, "appdata", "note-index.json"),
      JSON.stringify({ version: 1, updatedAt: "2026-08-01T00:00:00.000Z", notes: [entry("plan1", ["計画"]), entry("plan2", ["計画"]), entry("step1")] }),
      "utf8",
    );
    const text = buildProvJsonLdText(outer as any, "plan1", { root })!;
    expect(text).toContain("graphium:note/plan2");
    expect(text).toContain("焼く");
  });
});
