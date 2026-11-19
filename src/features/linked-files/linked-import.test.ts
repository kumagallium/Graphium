import { describe, it, expect, vi, beforeEach } from "vitest";
import type { TableSource } from "../../lib/document-types";

const statLinks = vi.fn();
const readLinkedFile = vi.fn();
const readMediaIndex = vi.fn();
vi.mock("./places", () => ({
  statLinks: (...a: unknown[]) => statLinks(...a),
  readLinkedFile: (...a: unknown[]) => readLinkedFile(...a),
}));
vi.mock("../asset-browser/media-index", () => ({ readMediaIndex: () => readMediaIndex() }));

import {
  isLinkedDataImportable,
  isLinkedSourceChanged,
  linkedSnapshotOf,
  readLinkedText,
} from "./linked-import";

const opts = { headerRow: 1, endRow: 3, delimiter: "comma" as const, collapseConsecutive: false };
const base: TableSource = { kind: "delimited-file", fileName: "a.csv", fileId: "L1", importedAt: "x", options: opts };

beforeEach(() => {
  statLinks.mockReset();
  readLinkedFile.mockReset();
  readMediaIndex.mockReset();
});

describe("isLinkedDataImportable", () => {
  it("区切りファイルだけ", () => {
    for (const n of ["a.csv", "A.TSV", "x.txt", "y.dat"]) expect(isLinkedDataImportable(n)).toBe(true);
    for (const n of ["a.pdf", "a.xlsx", "csv", "a.csv.exe"]) expect(isLinkedDataImportable(n)).toBe(false);
  });
});

describe("readLinkedText", () => {
  it("data 目的で読み、UTF-8 に直して、読む前の大きさ・更新日時を返す", async () => {
    statLinks.mockResolvedValue([{ state: "ok", size: 7, mtimeMs: 99 }]);
    readLinkedFile.mockResolvedValue(new TextEncoder().encode("a,b\n1,2").buffer);
    const r = await readLinkedText("p", "d.csv");
    expect(readLinkedFile).toHaveBeenCalledWith("p", "d.csv", "data");
    expect(r).toEqual({ text: "a,b\n1,2", size: 7, mtimeMs: 99 });
  });
});

describe("元データの変化", () => {
  const link = { placeId: "p", relPath: "d.csv", size: 1, mtimeMs: 1, recordedAt: "x" };
  const index = { media: [{ fileId: "L1", type: "url", url: "graphium-place://p/d.csv", link }] };

  it("覚えている値は derivation か linkedStat から取る。なければ null", () => {
    expect(linkedSnapshotOf(base)).toBeNull();
    expect(linkedSnapshotOf({ ...base, linkedStat: { size: 1, mtimeMs: 2 } })).toEqual({ size: 1, mtimeMs: 2 });
    const d = { kind: "filter", fromFileName: "a", columns: [], conditions: [], sourceRows: 1, resultRows: 1, createdAt: "x", fromSize: 3, fromMtimeMs: 4 };
    expect(linkedSnapshotOf({ ...base, derivation: d as TableSource["derivation"] })).toEqual({ size: 3, mtimeMs: 4 });
  });

  it("大きさか更新日時が違えば変わっている。同じなら変わっていない", async () => {
    readMediaIndex.mockResolvedValue(index);
    const src = { ...base, linkedStat: { size: 5, mtimeMs: 6 } };
    statLinks.mockResolvedValue([{ state: "ok", size: 5, mtimeMs: 6 }]);
    expect(await isLinkedSourceChanged(src)).toBe(false);
    statLinks.mockResolvedValue([{ state: "ok", size: 5, mtimeMs: 7 }]);
    expect(await isLinkedSourceChanged(src)).toBe(true);
  });

  it("調べられないとき・覚えが無いときは変わったと言わない", async () => {
    readMediaIndex.mockResolvedValue(index);
    const src = { ...base, linkedStat: { size: 5, mtimeMs: 6 } };
    statLinks.mockResolvedValue([{ state: "unreachable" }]);
    expect(await isLinkedSourceChanged(src)).toBe(false);
    expect(await isLinkedSourceChanged(base)).toBe(false);
    expect(statLinks).toHaveBeenCalledTimes(1);
  });
});

describe("findLinkOf: このノートが使っている素材だけ", () => {
  const link = { placeId: "p", relPath: "d.csv", size: 1, mtimeMs: 1, recordedAt: "x" };
  const entry = (usedIn: { noteId: string }[]) => ({
    fileId: "L1",
    type: "url",
    url: "graphium-place://p/d.csv",
    link,
    usedIn,
  });

  it("noteId を渡したとき、そのノートが使っていなければ投げる", async () => {
    const { findLinkOf } = await import("./linked-import");
    readMediaIndex.mockResolvedValue({ media: [entry([{ noteId: "other" }])] });
    await expect(findLinkOf("L1", "mine")).rejects.toThrow("PLACE_READ_NOT_REFERENCED");
    readMediaIndex.mockResolvedValue({ media: [entry([{ noteId: "mine" }])] });
    expect(await findLinkOf("L1", "mine")).toMatchObject({ placeId: "p", relPath: "d.csv" });
  });

  it("noteId なし・リンクでない素材は従来どおり", async () => {
    const { findLinkOf } = await import("./linked-import");
    readMediaIndex.mockResolvedValue({ media: [entry([])] });
    expect(await findLinkOf("L1")).not.toBeNull();
    readMediaIndex.mockResolvedValue({ media: [{ fileId: "A", type: "pdf", url: "x", usedIn: [] }] });
    expect(await findLinkOf("A", "mine")).toBeNull();
  });
});
