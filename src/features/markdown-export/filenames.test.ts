// filenames.ts（ファイル名 sanitize / zip 内 dedupe）のユニットテスト

import { describe, it, expect } from "vitest";
import { sanitizeFilename, assignZipNames, stripStorageExt } from "./filenames";

describe("sanitizeFilename", () => {
  it("禁止文字を _ に置換する", () => {
    expect(sanitizeFilename('a/b\\c?d%e*f:g|h"i<j>k')).toBe("a_b_c_d_e_f_g_h_i_j_k");
  });

  it("通常のタイトルはそのまま返す", () => {
    expect(sanitizeFilename("実験ノート 2026-07-03")).toBe("実験ノート 2026-07-03");
  });

  it("空文字はフォールバックを返す", () => {
    expect(sanitizeFilename("")).toBe("Untitled");
    expect(sanitizeFilename("   ")).toBe("Untitled");
  });

  it("禁止文字だけのタイトルは _ の連なりになる（空にはならない）", () => {
    expect(sanitizeFilename("???")).toBe("___");
  });

  it("フォールバックを指定できる", () => {
    expect(sanitizeFilename("", "dup")).toBe("dup");
  });

  it("前後の空白と末尾のドットを除去する", () => {
    expect(sanitizeFilename("  note  ")).toBe("note");
    expect(sanitizeFilename("note...")).toBe("note");
  });

  it("先頭のドットを除去する（隠しファイル化を防ぐ）", () => {
    expect(sanitizeFilename(".hidden")).toBe("hidden");
  });

  it("制御文字（改行など）をスペースに置き換える", () => {
    expect(sanitizeFilename("line1\nline2")).toBe("line1 line2");
    expect(sanitizeFilename("tab\there")).toBe("tab here");
  });

  it("120 文字で切り詰める", () => {
    const long = "あ".repeat(200);
    expect(sanitizeFilename(long).length).toBe(120);
  });
});

describe("stripStorageExt", () => {
  it(".graphium.json 拡張子を取り除く（local プロバイダの name 形式）", () => {
    expect(stripStorageExt("My Note.graphium.json")).toBe("My Note");
  });

  it(".json 拡張子を取り除く（filesystem プロバイダの name 形式）", () => {
    expect(stripStorageExt("0f8a-uuid.json")).toBe("0f8a-uuid");
  });

  it("拡張子が無ければそのまま返す", () => {
    expect(stripStorageExt("plain name")).toBe("plain name");
  });
});

describe("assignZipNames", () => {
  it("衝突しないタイトルはそのまま拡張子付きで割り当てる", () => {
    const names = assignZipNames(
      [
        { id: "id-1", title: "Note A" },
        { id: "id-2", title: "Note B" },
      ],
      ".md",
    );
    expect(names.get("id-1")).toBe("Note A.md");
    expect(names.get("id-2")).toBe("Note B.md");
  });

  it("同名衝突時は 2 件目以降に id サフィックスを付ける", () => {
    const names = assignZipNames(
      [
        { id: "id-1", title: "Same" },
        { id: "id-2", title: "Same" },
        { id: "id-3", title: "Same" },
      ],
      ".md",
    );
    expect(names.get("id-1")).toBe("Same.md");
    expect(names.get("id-2")).toBe("Same-id-2.md");
    expect(names.get("id-3")).toBe("Same-id-3.md");
  });

  it("sanitize 後に同名になるタイトルも dedupe される", () => {
    const names = assignZipNames(
      [
        { id: "a", title: "x/y" },
        { id: "b", title: "x?y" },
      ],
      ".md",
    );
    expect(names.get("a")).toBe("x_y.md");
    expect(names.get("b")).toBe("x_y-b.md");
  });

  it("id に禁止文字が含まれてもサフィックスは sanitize される", () => {
    const names = assignZipNames(
      [
        { id: "notes/one.json", title: "T" },
        { id: "notes/two.json", title: "T" },
      ],
      ".graphium.json",
    );
    expect(names.get("notes/one.json")).toBe("T.graphium.json");
    expect(names.get("notes/two.json")).toBe("T-notes_two.json.graphium.json");
  });

  it("全エントリ名がユニークになる", () => {
    const items = Array.from({ length: 50 }, (_, i) => ({ id: `id-${i}`, title: "Dup" }));
    const names = assignZipNames(items, ".md");
    const unique = new Set(names.values());
    expect(unique.size).toBe(items.length);
  });
});
