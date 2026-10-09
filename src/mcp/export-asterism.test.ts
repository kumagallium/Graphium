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
  writeWiki("t1", { title: "トピック", wikiMeta: { kind: "topic" } });
});

afterEach(() => rmSync(root, { recursive: true, force: true }));

describe("exportAsterismClaims", () => {
  const asterism = { vocabBaseIri: "https://example.org/v#" };

  it("既定では型ありの知見だけを出す", () => {
    const r = exportAsterismClaims({ asterism }, "2026-01-01T00:00:00.000Z", root);
    expect(r.count).toBe(1);
    const rows = JSON.parse(r.json);
    expect(rows[0]).toMatchObject({ id: "c1", type: "https://example.org/v#judgment", title: "型あり" });
    expect(r.skipped).toEqual([{ id: "c2", reason: "untyped" }]);
  });

  it("includeUntyped で型なしも含み、ids で絞れる", () => {
    const all = exportAsterismClaims({ includeUntyped: true, asterism }, "2026-01-01T00:00:00.000Z", root);
    expect(all.count).toBe(2);
    const one = exportAsterismClaims({ includeUntyped: true, ids: ["c2"], asterism }, "2026-01-01T00:00:00.000Z", root);
    expect(JSON.parse(one.json).map((r: { id: string }) => r.id)).toEqual(["c2"]);
    expect(JSON.parse(one.json)[0].type).toBeNull();
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
    const r = exportAsterismClaims({ asterism }, "2026-01-01T00:00:00.000Z", root);
    expect(JSON.parse(r.json).map((x: { id: string }) => x.id)).toEqual(["c1"]);
    const byId = exportAsterismClaims({ ids: ["c3", "c4"], asterism }, "2026-01-01T00:00:00.000Z", root);
    expect(byId.count).toBe(0);
  });

  it("asterism を省略しても型付きの知見は出る（type は null、type_term に語が残る）", () => {
    const r = exportAsterismClaims({}, "2026-01-01T00:00:00.000Z", root);
    expect(JSON.parse(r.json)[0]).toMatchObject({ id: "c1", type: null, type_term: "judgment" });
  });
});
