import { describe, expect, it } from "vitest";
import { profileColumns, profileColumnsAsync } from "./profile";

describe("profileColumns", () => {
  it("空でないセルの 9 割以上が数値なら number、それ未満は text", () => {
    const rows = [
      ...Array.from({ length: 9 }, (_, i) => [String(i), "x"]),
      ["abc", "1"], // 10 件中 9 件が数値 = ちょうど 9 割
    ];
    const p = profileColumns(["a", "b"], rows);
    expect(p[0].kind).toBe("number");
    expect(p[1].kind).toBe("text");
  });

  it("9 割に満たなければ text", () => {
    const rows = [["1"], ["2"], ["x"], ["y"]];
    expect(profileColumns(["a"], rows)[0].kind).toBe("text");
  });

  it("単位つき（12 g）も数値として読める", () => {
    const p = profileColumns(["w"], [["12 g"], ["30 g"], ["5.5 g"]]);
    expect(p[0].kind).toBe("number");
  });

  it("空セルは数に入れない。全部空なら text", () => {
    const p = profileColumns(["a", "b"], [["1", ""], ["", " "], ["3", ""]]);
    expect(p[0].kind).toBe("number");
    expect(p[1].kind).toBe("text");
    expect(p[1].distinct).toBeUndefined();
  });

  it("同名の列は最初の 1 つ。空の見出しは対象外", () => {
    const p = profileColumns(["a", "", "a", "b"], [["1", "x", "y", "z"]]);
    expect(p.map((c) => c.name)).toEqual(["a", "b"]);
    expect(p[0].kind).toBe("number"); // 最初の a（1）を見ている
  });

  it("種類が 50 以下なら distinct を多い順に入れる", () => {
    const rows = [["b"], ["a"], ["a"], ["c"], ["c"], ["c"], [""]];
    expect(profileColumns(["k"], rows)[0].distinct).toEqual(["c", "a", "b"]);
  });

  it("同数の値は最初に現れた順", () => {
    const rows = [["x"], ["y"], ["z"]];
    expect(profileColumns(["k"], rows)[0].distinct).toEqual(["x", "y", "z"]);
  });

  it("種類が 51 以上なら distinct を付けない（50 ちょうどは付ける）", () => {
    const rows50 = Array.from({ length: 50 }, (_, i) => [`v${i}`]);
    const rows51 = Array.from({ length: 51 }, (_, i) => [`v${i}`]);
    expect(profileColumns(["k"], rows50)[0].distinct).toHaveLength(50);
    expect(profileColumns(["k"], rows51)[0].distinct).toBeUndefined();
  });

  it("非同期版は同期版と同じ結果", async () => {
    const rows = Array.from({ length: 5000 }, (_, i) => [String(i), i % 2 ? "a" : "b"]);
    expect(await profileColumnsAsync(["n", "s"], rows, { sliceMs: 0 })).toEqual(
      profileColumns(["n", "s"], rows)
    );
  });
});
