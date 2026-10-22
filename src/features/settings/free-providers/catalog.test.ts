import { describe, expect, it } from "vitest";
import { en } from "../../../i18n/en";
import { ja } from "../../../i18n/ja";
import { FREE_PROVIDERS } from "./catalog";

describe("FREE_PROVIDERS", () => {
  it("名前の順に並ぶ（手で並べて優先を作らない）", () => {
    const names = FREE_PROVIDERS.map((p) => p.name);
    expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b, "en")));
  });

  it("全社が同じ項目の文言を日英とも持つ", () => {
    for (const p of FREE_PROVIDERS) {
      for (const field of ["amount", "training", "signup"]) {
        const key = `${p.i18nKey}.${field}`;
        expect(ja[key], key).toBeTruthy();
        expect(en[key], key).toBeTruthy();
      }
    }
  });

  it("ベース URL は https で、id は重ならない", () => {
    expect(new Set(FREE_PROVIDERS.map((p) => p.id)).size).toBe(FREE_PROVIDERS.length);
    for (const p of FREE_PROVIDERS) expect(p.apiBase.startsWith("https://")).toBe(true);
  });
});
