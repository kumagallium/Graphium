import { describe, it, expect } from "vitest";
import { describeOperation } from "./summary";
import { makeOp } from "./test-helpers";

describe("describeOperation", () => {
  it("統合は残す側の題と吸収数", () => {
    const d = describeOperation(
      makeOp({
        id: "o",
        subject: { wikiId: "w", title: "A" },
        related: [{ wikiId: "x", title: "B", role: "absorbed" }],
      }),
    );
    expect(d).toEqual({ key: "maintenance.op.merge_topics", params: { title: "A", count: 1 } });
  });
  it("アーカイブは 1 件なら題、複数なら件数", () => {
    const rel = (id: string) => ({ wikiId: id, title: id, role: "archived" as const });
    expect(describeOperation(makeOp({ id: "o", kind: "archive", related: [rel("a")] })).key).toBe(
      "maintenance.op.archive_one",
    );
    expect(
      describeOperation(makeOp({ id: "o", kind: "archive", related: [rel("a"), rel("b")] })).params,
    ).toEqual({ count: 2 });
  });
  it("undo は subject が無ければ件数", () => {
    expect(describeOperation(makeOp({ id: "o", kind: "undo" })).key).toBe("maintenance.op.undo_generic");
  });
  it("想定外の値（related が配列でない・title が文字列でない）でも例外にならない", () => {
    expect(() =>
      describeOperation(makeOp({ id: "o", related: "x" as never, subject: { wikiId: "w", title: 1 as never } })),
    ).not.toThrow();
    expect(
      describeOperation(
        makeOp({ id: "o", kind: "archive", related: [null as never, { wikiId: "a", title: 2 as never, role: "archived" }] }),
      ),
    ).toEqual({ key: "maintenance.op.archive_one", params: { title: "" } });
    expect(() => describeOperation(makeOp({ id: "o", kind: "undo", pages: null as never, flags: null as never }))).not.toThrow();
  });
});
