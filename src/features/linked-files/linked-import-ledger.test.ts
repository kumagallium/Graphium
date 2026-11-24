// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import {
  LINKED_LEDGER_MAX,
  addToLedger,
  isInLedger,
  needsReadConfirm,
  readLinkedLedger,
  recordLinkedImport,
} from "./linked-import-ledger";

const e = (n: number | string) => ({ fileId: `f${n}`, placeId: "p", relPath: `a/${n}.csv` });

describe("linked-import-ledger", () => {
  beforeEach(() => localStorage.clear());

  it("控えにある組は確かめ不要、無い組・一部違う組は必要", () => {
    recordLinkedImport(e(1));
    expect(needsReadConfirm(e(1))).toBe(false);
    expect(needsReadConfirm(e(2))).toBe(true);
    expect(needsReadConfirm({ ...e(1), relPath: "other.csv" })).toBe(true);
    expect(needsReadConfirm({ ...e(1), placeId: "q" })).toBe(true);
    expect(needsReadConfirm({ ...e(1), fileId: "x" })).toBe(true);
  });

  it("同じ組は重ねず、上限を超えたら古いものから捨てる", () => {
    let list = addToLedger([], e(1));
    list = addToLedger(list, e(1));
    expect(list).toHaveLength(1);
    list = [];
    for (let i = 0; i < 5; i++) list = addToLedger(list, e(i), 3);
    expect(list.map((x) => x.fileId)).toEqual(["f2", "f3", "f4"]);
    expect(isInLedger(list, e(0))).toBe(false);
    expect(LINKED_LEDGER_MAX).toBe(500);
  });

  it("壊れた保存内容は空として扱う", () => {
    localStorage.setItem("graphium:linked-import-ledger", "{not json");
    expect(readLinkedLedger()).toEqual([]);
    localStorage.setItem("graphium:linked-import-ledger", JSON.stringify({ a: 1 }));
    expect(readLinkedLedger()).toEqual([]);
    localStorage.setItem("graphium:linked-import-ledger", JSON.stringify([e(1), { fileId: 1 }, null]));
    expect(readLinkedLedger()).toEqual([e(1)]);
    expect(needsReadConfirm(e(1))).toBe(false);
  });

  it("保存時に書けなくても投げない", () => {
    const orig = Storage.prototype.setItem;
    Storage.prototype.setItem = () => {
      throw new Error("quota");
    };
    try {
      expect(() => recordLinkedImport(e(1))).not.toThrow();
    } finally {
      Storage.prototype.setItem = orig;
    }
  });
});
