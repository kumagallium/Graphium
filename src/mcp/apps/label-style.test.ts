import { describe, expect, it } from "vitest";

import { en } from "../../i18n/en";
import { ja } from "../../i18n/ja";
import { LABEL_I18N_KEYS, LABEL_NAMES } from "./label-style";

// プレビューはアプリの辞書を持ち込まずに名前を写しているので、辞書を変えたら追従させる
describe("プレビューのラベル名はアプリの辞書と同じ", () => {
  for (const [label, key] of Object.entries(LABEL_I18N_KEYS)) {
    it(`${label}（${key}）`, () => {
      expect(LABEL_NAMES.ja[label]).toBe(ja[key]);
      expect(LABEL_NAMES.en[label]).toBe(en[key]);
    });
  }
});
