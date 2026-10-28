import { describe, expect, it } from "vitest";
import type { GraphiumDocument } from "../document-types";
import type { StorageProvider } from "../storage/types";
import { DEMO_BUNDLE_FORMAT, DEMO_BUNDLE_VERSION, isProviderEmpty, loadBundleInto, parseDemoBundle } from "./bundle";

function doc(title: string): GraphiumDocument {
  return { version: 1, title, pages: [{ id: "p1", blocks: [] }], createdAt: "2026-10-27T00:00:00.000Z", modifiedAt: "2026-10-27T00:00:00.000Z" } as unknown as GraphiumDocument;
}

/** saveFile / saveWikiFile / writeAppData だけ持つ、記録用の偽プロバイダ */
function fakeProvider(initial: { files?: string[]; wiki?: string[] } = {}) {
  const files = new Map<string, GraphiumDocument>();
  const wiki = new Map<string, GraphiumDocument>();
  const appdata = new Map<string, unknown>();
  for (const id of initial.files ?? []) files.set(id, doc(id));
  for (const id of initial.wiki ?? []) wiki.set(id, doc(id));
  const p = {
    listFiles: async () => [...files.keys()].map((id) => ({ id, name: id, modifiedTime: "", createdTime: "" })),
    saveFile: async (id: string, d: GraphiumDocument) => { files.set(id, d); },
    listWikiFiles: async () => [...wiki.keys()].map((id) => ({ id, name: id, modifiedTime: "", createdTime: "" })),
    saveWikiFile: async (id: string, d: GraphiumDocument) => { wiki.set(id, d); },
    writeAppData: async (k: string, v: unknown) => { appdata.set(k, v); },
  } as unknown as StorageProvider;
  return { p, files, wiki, appdata };
}

const validBundle = {
  format: DEMO_BUNDLE_FORMAT,
  version: DEMO_BUNDLE_VERSION,
  id: "bread-ja",
  language: "ja",
  createdAt: "2026-10-27T00:00:00.000Z",
  generatedBy: "gpt-oss-120b",
  notes: [{ id: "n1", doc: doc("試作 1") }, { id: "n2", doc: doc("試作 2") }],
  wiki: [{ id: "w1", doc: doc("加水率") }],
  appdata: { "note-index": { version: 1, notes: [] } },
};

describe("parseDemoBundle", () => {
  it("正しい束を通す", () => {
    const b = parseDemoBundle(validBundle);
    expect(b.id).toBe("bread-ja");
    expect(b.notes).toHaveLength(2);
    expect(b.wiki).toHaveLength(1);
    expect(b.generatedBy).toBe("gpt-oss-120b");
    expect(b.appdata).toBeDefined();
  });

  it("形式名・版・id・配列の形が違えば断る", () => {
    expect(() => parseDemoBundle(null)).toThrow();
    expect(() => parseDemoBundle({ ...validBundle, format: "backup" })).toThrow(/format/);
    expect(() => parseDemoBundle({ ...validBundle, version: 2 })).toThrow(/version/);
    expect(() => parseDemoBundle({ ...validBundle, id: "" })).toThrow(/id/);
    expect(() => parseDemoBundle({ ...validBundle, notes: [{ id: "", doc: {} }] })).toThrow(/notes/);
    expect(() => parseDemoBundle({ ...validBundle, wiki: "x" })).toThrow(/wiki/);
  });

  it("language が無ければ en、generatedBy が無ければ付けない", () => {
    const { language: _l, generatedBy: _g, ...rest } = validBundle;
    const b = parseDemoBundle(rest);
    expect(b.language).toBe("en");
    expect("generatedBy" in b).toBe(false);
  });
});

describe("parseDemoBundle tour", () => {
  it("順路は形の正しい歩だけ残し、1 つも無ければ付けない", () => {
    const withTour = parseDemoBundle({ ...validBundle, tour: { steps: [
      { title: "a", body: "b", hash: "#note/x" },
      { title: "bad", body: "no hash", hash: "note/x" },
      { title: 1 },
    ] } });
    expect(withTour.tour?.steps).toEqual([{ title: "a", body: "b", hash: "#note/x" }]);
    expect("tour" in parseDemoBundle({ ...validBundle, tour: { steps: [] } })).toBe(false);
    expect("tour" in parseDemoBundle({ ...validBundle, tour: "x" })).toBe(false);
  });
});

describe("loadBundleInto", () => {
  it("束の id のままノート・ナレッジ・appdata を書く", async () => {
    const { p, files, wiki, appdata } = fakeProvider();
    const result = await loadBundleInto(p, parseDemoBundle(validBundle));
    expect(result).toEqual({ notes: 2, wiki: 1, appdata: 1 });
    expect([...files.keys()]).toEqual(["n1", "n2"]);
    expect(wiki.get("w1")?.title).toBe("加水率");
    expect(appdata.has("note-index")).toBe(true);
  });

  it("saveWikiFile の無いプロバイダではナレッジを飛ばす", async () => {
    const { p } = fakeProvider();
    delete (p as unknown as { saveWikiFile?: unknown }).saveWikiFile;
    const result = await loadBundleInto(p, parseDemoBundle(validBundle));
    expect(result.wiki).toBe(0);
    expect(result.notes).toBe(2);
  });
});

describe("isProviderEmpty", () => {
  it("ノートもナレッジも無いときだけ空", async () => {
    expect(await isProviderEmpty(fakeProvider().p)).toBe(true);
    expect(await isProviderEmpty(fakeProvider({ files: ["a"] }).p)).toBe(false);
    expect(await isProviderEmpty(fakeProvider({ wiki: ["w"] }).p)).toBe(false);
  });
});
