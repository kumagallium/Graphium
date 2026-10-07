import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { GraphiumDocument } from "../../lib/document-types";
import { getFlags, readIndexStrict, setFlag, upsertEntry, writeIndex } from "./index-store";

let root: string;
const indexFile = () => join(root, "appdata", "note-index.json");

function makeDoc(title: string): GraphiumDocument {
  return {
    version: 1,
    title,
    modifiedAt: "2026-10-01T00:00:00.000Z",
    pages: [
      {
        id: "p1",
        blocks: [{ id: "b1", type: "paragraph", content: [{ type: "text", text: title, styles: {} }], children: [] }],
      },
    ],
    wikiMeta: { kind: "topic" },
  } as unknown as GraphiumDocument;
}

function writeWiki(id: string, doc: GraphiumDocument) {
  mkdirSync(join(root, "wiki"), { recursive: true });
  writeFileSync(join(root, "wiki", `${id}.json`), JSON.stringify(doc));
}

function writeRawIndex(notes: unknown[], version = 30) {
  mkdirSync(join(root, "appdata"), { recursive: true });
  writeFileSync(indexFile(), JSON.stringify({ version, updatedAt: "2020-01-01T00:00:00.000Z", notes }));
}

const readIdx = () => JSON.parse(readFileSync(indexFile(), "utf8"));

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "idxst-"));
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe("readIndexStrict", () => {
  it("無ければ NO_INDEX、壊れていれば INDEX_UNREADABLE", () => {
    expect(readIndexStrict(root)).toEqual({ ok: false, code: "NO_INDEX" });
    mkdirSync(join(root, "appdata"), { recursive: true });
    writeFileSync(indexFile(), "{oops");
    expect(readIndexStrict(root)).toEqual({ ok: false, code: "INDEX_UNREADABLE" });
    writeFileSync(indexFile(), JSON.stringify({ version: 1 }));
    expect(readIndexStrict(root)).toEqual({ ok: false, code: "INDEX_UNREADABLE" });
  });

  it("読めれば ok", () => {
    writeRawIndex([]);
    const r = readIndexStrict(root);
    expect(r.ok).toBe(true);
  });
});

describe("writeIndex", () => {
  it("version と他のエントリを保ち updatedAt だけ進める", async () => {
    writeRawIndex([{ noteId: "a", title: "A" }], 7);
    const r = readIndexStrict(root);
    if (!r.ok) throw new Error("x");
    await writeIndex(root, r.index);
    const idx = readIdx();
    expect(idx.version).toBe(7);
    expect(idx.notes).toEqual([{ noteId: "a", title: "A" }]);
    expect(idx.updatedAt).not.toBe("2020-01-01T00:00:00.000Z");
  });
});

describe("upsertEntry", () => {
  it("既存エントリを差し替えつつフラグを保ち、他は不変", async () => {
    writeRawIndex(
      [
        { noteId: "other", title: "Other", marker: 1 },
        { noteId: "w1", title: "Old", deletedAt: "2026-01-01T00:00:00.000Z", archivedAt: "2026-02-01T00:00:00.000Z" },
      ],
      30,
    );
    await upsertEntry(root, "w1", makeDoc("New"));
    const idx = readIdx();
    expect(idx.version).toBe(30);
    expect(idx.notes[0]).toEqual({ noteId: "other", title: "Other", marker: 1 });
    expect(idx.notes[1].title).toBe("New");
    expect(idx.notes[1].deletedAt).toBe("2026-01-01T00:00:00.000Z");
    expect(idx.notes[1].archivedAt).toBe("2026-02-01T00:00:00.000Z");
  });

  it("無ければ末尾に挿入する（フラグは付かない）", async () => {
    writeRawIndex([{ noteId: "other", title: "Other" }]);
    await upsertEntry(root, "w2", makeDoc("Two"));
    const idx = readIdx();
    expect(idx.notes.map((n: { noteId: string }) => n.noteId)).toEqual(["other", "w2"]);
    expect(idx.notes[1].deletedAt).toBeUndefined();
  });

  it("索引が無ければ throw する", async () => {
    await expect(upsertEntry(root, "w", makeDoc("x"))).rejects.toThrow("NO_INDEX");
  });
});

describe("setFlag / getFlags", () => {
  it("既存エントリにフラグを立てて外せる", async () => {
    writeRawIndex([{ noteId: "w1", title: "T" }]);
    expect(getFlags(root, "w1")).toEqual({ deletedAt: null, archivedAt: null });
    await setFlag(root, "w1", "archivedAt", "2026-10-07T00:00:00.000Z");
    expect(getFlags(root, "w1")).toEqual({ deletedAt: null, archivedAt: "2026-10-07T00:00:00.000Z" });
    await setFlag(root, "w1", "archivedAt", null);
    expect(getFlags(root, "w1")).toEqual({ deletedAt: null, archivedAt: null });
  });

  it("エントリが無ければ readNote から挿入してから立てる", async () => {
    writeRawIndex([{ noteId: "other", title: "O" }]);
    writeWiki("w9", makeDoc("Nine"));
    expect(getFlags(root, "w9")).toBeNull();
    await setFlag(root, "w9", "deletedAt", "2026-10-07T00:00:00.000Z");
    expect(getFlags(root, "w9")?.deletedAt).toBe("2026-10-07T00:00:00.000Z");
    expect(readIdx().notes).toHaveLength(2);
  });

  it("エントリも本体も無ければ throw する", async () => {
    writeRawIndex([]);
    await expect(setFlag(root, "ghost", "deletedAt", "x")).rejects.toThrow();
  });

  it("索引が無ければ getFlags は null、setFlag は throw", async () => {
    expect(getFlags(root, "a")).toBeNull();
    await expect(setFlag(root, "a", "deletedAt", "x")).rejects.toThrow("NO_INDEX");
  });
});
