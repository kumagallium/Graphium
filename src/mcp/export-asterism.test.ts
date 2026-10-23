// export-asterism.ts（export_asterism_claims の本体）の回帰テスト。

import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { markAsterismSent } from "./asterism-sent";
import { exportAsterismClaims } from "./export-asterism";

let root: string;

function writeWiki(id: string, doc: unknown) {
  writeFileSync(join(root, "wiki", `${id}.json`), JSON.stringify(doc));
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "asterism-export-"));
  mkdirSync(join(root, "notes"));
  mkdirSync(join(root, "wiki"));
  writeWiki("c1", {
    title: "型あり",
    wikiMeta: { kind: "claim", asterism: { typeSlug: "judgment" } },
  });
  writeWiki("c2", { title: "型なし", wikiMeta: { kind: "claim" } });
  writeWiki("r1", {
    title: "規則",
    wikiMeta: {
      kind: "claim",
      asterism: { typeSlug: "rule" },
      ruleFrame: { conditions: [{ item: "温度", comparator: ">", value: 80, unit: "C" }], consequences: [{ item: "劣化" }] },
    },
  });
  writeWiki("t1", { title: "トピック", wikiMeta: { kind: "topic" } });
});

afterEach(() => rmSync(root, { recursive: true, force: true }));

const AT = "2026-01-01T00:00:00.000Z";
const BASE = "https://kumagallium.github.io/graphium/claim/";

describe("exportAsterismClaims", () => {
  const asterism = {
    vocabBaseIri: "https://example.org/v#",
    claimBaseIri: BASE,
    typeSlugs: { judgment: "judgment", rule: "rule" },
  };
  const ok = (r: ReturnType<typeof exportAsterismClaims>) => {
    if ("error" in r) throw new Error(r.error);
    return r;
  };

  it("既定では型ありの知見だけをファイルごとに出す", () => {
    const r = ok(exportAsterismClaims({ asterism }, AT, root));
    expect(Object.keys(r.files).sort()).toEqual(["judgments.json", "rule_terms.json", "rules.json"]);
    expect(r.counts).toMatchObject({ "judgments.json": 1, "rules.json": 1 });
    const j = JSON.parse(r.files["judgments.json"]);
    expect(j[0]).toMatchObject({ id: "c1", iri: `${BASE}c1`, title: "型あり" });
    expect(JSON.parse(r.files["rule_terms.json"])[0]).toMatchObject({ rule_id: "r1", rule_iri: `${BASE}r1`, role: "condition", value_number: 80, value_text: null });
    expect(r.skipped).toEqual([{ id: "c2", reason: "untyped" }]);
  });

  it("includeUntyped で型なしも untyped.json に入り、ids で絞れる", () => {
    const all = ok(exportAsterismClaims({ includeUntyped: true, asterism }, AT, root));
    expect(Object.keys(all.files)).toContain("untyped.json");
    const one = ok(exportAsterismClaims({ includeUntyped: true, ids: ["c2"], asterism }, AT, root));
    expect(Object.keys(one.files)).toEqual(["untyped.json"]);
    expect(JSON.parse(one.files["untyped.json"])[0]).toMatchObject({ id: "c2", type: null });
  });

  it("ゴミ箱・アーカイブ済みは ids 指定でも出さない", () => {
    writeWiki("c3", { title: "アーカイブ", wikiMeta: { kind: "claim", asterism: { typeSlug: "rule" } } });
    writeWiki("c4", { title: "ゴミ箱", wikiMeta: { kind: "claim", asterism: { typeSlug: "rule" } } });
    mkdirSync(join(root, "appdata"), { recursive: true });
    writeFileSync(
      join(root, "appdata", "note-index.json"),
      JSON.stringify({
        version: 1,
        notes: [
          { noteId: "c3", archivedAt: "2026-01-01T00:00:00.000Z" },
          { noteId: "c4", deletedAt: "2026-01-01T00:00:00.000Z" },
        ],
      }),
    );
    const r = ok(exportAsterismClaims({ asterism }, AT, root));
    expect(JSON.parse(r.files["rules.json"]).map((x: { id: string }) => x.id)).toEqual(["r1"]);
    const byId = ok(exportAsterismClaims({ ids: ["c3", "c4"], asterism }, AT, root));
    expect(byId.files).toEqual({});
  });

  it("onlyUnsent: 台帳にある知見を外し already-sent で返す。noteUrlBase が source_url に効く", async () => {
    await markAsterismSent({ ids: ["c1"], datasetId: "ds1" }, AT, root);
    const all = ok(exportAsterismClaims({ asterism }, AT, root));
    expect(all.counts).toMatchObject({ "judgments.json": 1 });
    const r = ok(exportAsterismClaims({ onlyUnsent: true, asterism: { ...asterism, noteUrlBase: "https://g.test/app" } }, AT, root));
    expect(r.files).not.toHaveProperty("judgments.json");
    expect(r.skipped).toContainEqual({ id: "c1", reason: "already-sent" });
    expect(JSON.parse(r.files["rules.json"])[0].source_url).toBe("https://g.test/app/#knowledge/claim/r1");
  });

  it("includeTopics: topics.json が出て、onlyUnsent は topic にも効く", async () => {
    writeWiki("t2", { title: "材料", wikiMeta: { kind: "topic", topicType: "material", derivedFromClaims: ["c1", "zzz"] } });
    const off = ok(exportAsterismClaims({ asterism }, AT, root));
    expect(off.files).not.toHaveProperty("topics.json");
    const on = ok(exportAsterismClaims({ includeTopics: true, asterism }, AT, root));
    expect(on.counts["topics.json"]).toBe(2);
    const row = JSON.parse(on.files["topics.json"]).find((x: { id: string }) => x.id === "t2");
    expect(row).toMatchObject({ topic_type: "material", claim_iri: [`${BASE}c1`], source_url: expect.stringContaining("#knowledge/topic/t2") });
    await markAsterismSent({ ids: ["t2"], datasetId: "ds1" }, AT, root);
    const un = ok(exportAsterismClaims({ includeTopics: true, onlyUnsent: true, asterism }, AT, root));
    expect(JSON.parse(un.files["topics.json"]).map((x: { id: string }) => x.id)).toEqual(["t1"]);
    expect(un.skipped).toContainEqual({ id: "t2", reason: "already-sent" });
  });

  it("includeTopics: ゴミ箱・アーカイブ済み topic は出ず、ids と onlyUnsent を併用できる", async () => {
    writeWiki("t3", { title: "古", wikiMeta: { kind: "topic" } });
    writeWiki("t4", { title: "捨", wikiMeta: { kind: "topic" } });
    mkdirSync(join(root, "appdata"), { recursive: true });
    writeFileSync(
      join(root, "appdata", "note-index.json"),
      JSON.stringify({ version: 1, notes: [{ noteId: "t3", archivedAt: AT }, { noteId: "t4", deletedAt: AT }] }),
    );
    const r = ok(exportAsterismClaims({ includeTopics: true, ids: ["t1", "t3", "t4"], asterism }, AT, root));
    expect(JSON.parse(r.files["topics.json"]).map((x: { id: string }) => x.id)).toEqual(["t1"]);
    await markAsterismSent({ ids: ["t1"], datasetId: "ds1" }, AT, root);
    const u = ok(exportAsterismClaims({ includeTopics: true, onlyUnsent: true, ids: ["t1", "c1"], asterism }, AT, root));
    expect(u.files).not.toHaveProperty("topics.json");
    expect(u.skipped).toContainEqual({ id: "t1", reason: "already-sent" });
    expect(Object.keys(u.files)).toEqual(["judgments.json"]);
  });

  it("onlyUnsent で既送信の知見を外しても、新しい topic の claim_iri には残る", async () => {
    writeWiki("t5", { title: "新", wikiMeta: { kind: "topic", derivedFromClaims: ["c1", "c2", "t1"] } });
    await markAsterismSent({ ids: ["c1"], datasetId: "ds1" }, AT, root);
    const r = ok(exportAsterismClaims({ includeTopics: true, onlyUnsent: true, asterism }, AT, root));
    expect(r.files).not.toHaveProperty("judgments.json");
    const t5 = JSON.parse(r.files["topics.json"]).find((x: { id: string }) => x.id === "t5");
    // c2 は型なしで書き出せない・t1 は topic
    expect(t5.claim_iri).toEqual([`${BASE}c1`]);
  });

  it("onlyUnsent: 台帳が壊れていれば全件を出さず error", () => {
    mkdirSync(join(root, "appdata"), { recursive: true });
    writeFileSync(join(root, "appdata", "asterism-sent.json"), "{broken");
    const r = exportAsterismClaims({ onlyUnsent: true, asterism }, AT, root);
    expect(r).toHaveProperty("error");
    expect((r as { error: string }).error).toContain("台帳が壊れています");
    expect(exportAsterismClaims({ asterism }, AT, root)).not.toHaveProperty("error");
  });

  it("noteUrlBase に # か ? があれば error", () => {
    for (const noteUrlBase of ["https://g.test/app#x", "https://g.test/app?x=1"]) {
      expect(exportAsterismClaims({ asterism: { ...asterism, noteUrlBase } }, AT, root)).toHaveProperty("error");
    }
  });

  it("claimBaseIri が無ければ error を返す", () => {
    expect(exportAsterismClaims({}, AT, root)).toHaveProperty("error");
    expect(exportAsterismClaims({ asterism: { vocabBaseIri: "https://example.org/v#" } }, AT, root)).toHaveProperty("error");
  });
});
