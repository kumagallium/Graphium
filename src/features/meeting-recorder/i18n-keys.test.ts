import { describe, expect, it } from "vitest";
import { ja } from "../../i18n/ja";
import { en } from "../../i18n/en";

describe("meeting.* の i18n キー", () => {
  it("ja / en の両方に同じキーがある", () => {
    const keys = (d: Record<string, string>) => Object.keys(d).filter((k) => k.startsWith("meeting.")).sort();
    expect(keys(ja).length).toBeGreaterThan(0);
    expect(keys(en)).toEqual(keys(ja));
  });
});
