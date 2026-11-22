import { describe, it, expect } from "vitest";
import {
  isInLegacyPlanFolder,
  isPlanFolderPath,
  isPlanNote,
  normalizeFolderKey,
  resolveNoteKind,
} from "./reserved-folders";

describe("normalizeFolderKey", () => {
  it("trim + 小文字化する", () => {
    expect(normalizeFolderKey(" Plan ")).toBe("plan");
  });

  it("全角英字は NFKC で半角に畳む（IME の変換残りを取りこぼさない）", () => {
    expect(normalizeFolderKey("ｐｌａｎ")).toBe("plan");
    expect(isPlanFolderPath("Ｐｌａｎ")).toBe(true);
  });
});

describe("isPlanFolderPath", () => {
  it("予約語そのもの（大文字小文字・前後空白ゆれ）は true", () => {
    expect(isPlanFolderPath("計画")).toBe(true);
    expect(isPlanFolderPath("Plan")).toBe(true);
    expect(isPlanFolderPath(" plan ")).toBe(true);
  });

  it("韓国語の「계획」も予約語", () => {
    expect(isPlanFolderPath("계획")).toBe(true);
    expect(isPlanFolderPath("계획/실험")).toBe(true);
    expect(isPlanFolderPath("계획서")).toBe(false);
  });

  it("子フォルダは true", () => {
    expect(isPlanFolderPath("計画/2026春")).toBe(true);
    expect(isPlanFolderPath("plan/x/y")).toBe(true);
  });

  it("前方一致もどき（別語の一部）は false", () => {
    expect(isPlanFolderPath("計画中")).toBe(false);
    expect(isPlanFolderPath("planning")).toBe(false);
    expect(isPlanFolderPath("myplan")).toBe(false);
  });

  it("空文字は false", () => {
    expect(isPlanFolderPath("")).toBe(false);
  });
});

describe("isInLegacyPlanFolder", () => {
  it("旧予約フォルダを含む noteContexts は true", () => {
    expect(isInLegacyPlanFolder(["計画"])).toBe(true);
    expect(isInLegacyPlanFolder(["その他", "plan/x"])).toBe(true);
  });

  it("undefined / null / 空配列は false", () => {
    expect(isInLegacyPlanFolder(undefined)).toBe(false);
    expect(isInLegacyPlanFolder(null)).toBe(false);
    expect(isInLegacyPlanFolder([])).toBe(false);
  });

  it("予約フォルダを含まない配列は false", () => {
    expect(isInLegacyPlanFolder(["計画中", "planning"])).toBe(false);
  });

  it("数値混じりの配列は文字列要素だけ見る", () => {
    expect(isInLegacyPlanFolder([1, "計画", null])).toBe(true);
    expect(isInLegacyPlanFolder([1, 2, null])).toBe(false);
  });
});

describe("resolveNoteKind / isPlanNote", () => {
  it("kind があれば kind に従う（フォルダは見ない）", () => {
    expect(resolveNoteKind({ kind: "plan" })).toBe("plan");
    expect(isPlanNote({ kind: "plan", noteContexts: ["焼結"] })).toBe(true);
    // 「計画」フォルダは今は普通のフォルダ。kind が note ならそこに入れても計画にならない
    expect(resolveNoteKind({ kind: "note", noteContexts: ["計画"] })).toBe("note");
    expect(isPlanNote({ kind: "note", noteContexts: ["計画"] })).toBe(false);
  });

  it("kind の無い旧ノートは旧予約フォルダで読み替える", () => {
    expect(resolveNoteKind({ noteContexts: ["計画"] })).toBe("plan");
    expect(resolveNoteKind({ noteContexts: ["Plan/2026"] })).toBe("plan");
    expect(resolveNoteKind({ noteContexts: ["焼結"] })).toBe("note");
    expect(resolveNoteKind({})).toBe("note");
  });

  it("知らない kind の値は無いものとして扱う", () => {
    expect(resolveNoteKind({ kind: "experiment", noteContexts: ["計画"] })).toBe("plan");
    expect(resolveNoteKind({ kind: 1 })).toBe("note");
  });

  it("null / undefined は計画ではない", () => {
    expect(isPlanNote(null)).toBe(false);
    expect(isPlanNote(undefined)).toBe(false);
  });
});
