import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { INDEX_SCHEMA_VERSION } from "../../features/navigation/index-file";
import { resetSearchIndex } from "../search";
import { setSourceDate } from "./source-date";

const ctx = { getClientName: () => "test-client" };
let root: string;
const p = (...s: string[]) => join(root, ...s);
const readJson = (path: string) => JSON.parse(readFileSync(path, "utf8"));
const noteOf = (id: string) => readJson(p("notes", `${id}.json`));
const entryOf = (id: string) =>
  readJson(p("appdata", "note-index.json")).notes.find((n: { noteId: string }) => n.noteId === id);

const CREATED = "2026-11-22T01:00:00.000Z";

function humanNote(title: string, extra: Record<string, unknown> = {}) {
  return {
    version: 2,
    title,
    pages: [
      {
        id: "main",
        title,
        blocks: [{ id: "b1", type: "paragraph", props: {}, content: [{ type: "text", text: "本文", styles: {} }], children: [] }],
        labels: {},
        provLinks: [],
        knowledgeLinks: [],
      },
    ],
    source: "human",
    noteContexts: ["公開情報/論文"],
    createdAt: CREATED,
    modifiedAt: CREATED,
    ...extra,
  };
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "set-source-date-"));
  for (const d of ["notes", "wiki", "appdata"]) mkdirSync(p(d), { recursive: true });
  writeFileSync(p("notes", "paper.json"), JSON.stringify(humanNote("2012 年の論文")));
  writeFileSync(p("notes", "blog.json"), JSON.stringify(humanNote("ブログ", { sourceDate: "2026-11" })));
  writeFileSync(p("wiki", "t1.json"), JSON.stringify({ ...humanNote("トピック"), source: "ai", wikiMeta: { kind: "topic" } }));
  writeFileSync(
    p("appdata", "note-index.json"),
    JSON.stringify({ version: INDEX_SCHEMA_VERSION, updatedAt: CREATED, notes: [] }),
  );
  resetSearchIndex();
});
afterEach(() => {
  resetSearchIndex();
  rmSync(root, { recursive: true, force: true });
});

describe("set_source_date", () => {
  it("資料の日付だけを書き、作成日時・本文・フォルダは変えず、索引と編集の記録に残す", async () => {
    const reply = await setSourceDate({ items: [{ noteId: "paper", sourceDate: "2012年3月" }] }, ctx, root);
    expect(reply).toContain("1 件のノートに資料の日付を付けました");
    expect(reply).toContain("前 なし → 2012-03");

    const doc = noteOf("paper");
    expect(doc.sourceDate).toBe("2012-03");
    expect(doc.createdAt).toBe(CREATED);
    expect(doc.noteContexts).toEqual(["公開情報/論文"]);
    expect(doc.pages[0].blocks[0].content[0].text).toBe("本文");
    expect(doc.modifiedAt).not.toBe(CREATED);

    const acts = Object.values(doc.documentProvenance.activities) as { type: string }[];
    expect(acts.map((a) => a.type)).toContain("source_date_set");
    const agents = Object.values(doc.documentProvenance.agents) as { label: string; type: string }[];
    expect(agents.some((a) => a.label === "graphium-mcp (test-client)" && a.type === "ai")).toBe(true);

    expect(entryOf("paper")?.sourceDate).toBe("2012-03");
  });

  it("null で外せる・同じ値なら何もしない", async () => {
    expect(await setSourceDate({ items: [{ noteId: "blog", sourceDate: "2026-11" }] }, ctx, root)).toContain(
      "変える必要のあるノートはありませんでした",
    );
    const reply = await setSourceDate({ items: [{ noteId: "blog", sourceDate: null }] }, ctx, root);
    expect(reply).toContain("前 2026-11 → なし（外した）");
    expect(noteOf("blog").sourceDate).toBeUndefined();
  });

  it("1 件でも読めない日付・無いノート・ナレッジのページがあれば、どれも書かない", async () => {
    const reply = await setSourceDate(
      {
        items: [
          { noteId: "paper", sourceDate: "2012" },
          { noteId: "blog", sourceDate: "そのうち" },
          { noteId: "t1", sourceDate: "2020" },
          { noteId: "nope", sourceDate: "2020" },
        ],
      },
      ctx,
      root,
    );
    expect(reply).toMatch(/^INVALID_ARGUMENT/);
    expect(reply).toContain("そのうち");
    expect(reply).toContain("t1");
    expect(reply).toContain("nope");
    expect(noteOf("paper").sourceDate).toBeUndefined();
    expect(noteOf("blog").sourceDate).toBe("2026-11");
  });

  it("Graphium の起動中は断る", async () => {
    writeFileSync(p("appdata", "app-heartbeat.json"), JSON.stringify({ via: "web", at: new Date().toISOString() }));
    const reply = await setSourceDate({ items: [{ noteId: "paper", sourceDate: "2012" }] }, ctx, root);
    expect(reply).toMatch(/^APP_RUNNING/);
    expect(noteOf("paper").sourceDate).toBeUndefined();
  });
});
