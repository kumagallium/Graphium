// export-asterism.ts（export_asterism_claims の本体）の回帰テスト。

import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

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

  it("claimBaseIri が無ければ error を返す", () => {
    expect(exportAsterismClaims({}, AT, root)).toHaveProperty("error");
    expect(exportAsterismClaims({ asterism: { vocabBaseIri: "https://example.org/v#" } }, AT, root)).toHaveProperty("error");
  });
});
