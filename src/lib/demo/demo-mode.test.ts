import { describe, expect, it } from "vitest";
import { DEMO_IDS, demoBundleUrl, demoDbName, isDemoId, parseDemoId } from "./demo-mode";

describe("demo-mode", () => {
  it("一覧にある id だけを見本として受け付ける", () => {
    expect(parseDemoId("?demo=bread-ja")).toBe("bread-ja");
    expect(parseDemoId("demo=bread-en")).toBe("bread-en");
    expect(parseDemoId("?demo=anything")).toBeNull();
    expect(parseDemoId("?demo=")).toBeNull();
    expect(parseDemoId("")).toBeNull();
    expect(parseDemoId("?other=1")).toBeNull();
  });

  it("isDemoId は一覧と一致する", () => {
    for (const id of DEMO_IDS) expect(isDemoId(id)).toBe(true);
    expect(isDemoId("graphium-local")).toBe(false);
    expect(isDemoId(null)).toBe(false);
  });

  it("見本の DB 名は本人用の graphium-local と重ならない", () => {
    expect(demoDbName("bread-ja")).toBe("graphium-demo-bread-ja");
    expect(demoDbName("bread-ja")).not.toBe("graphium-local");
  });

  it("束の URL は base の末尾スラッシュの有無に左右されない", () => {
    expect(demoBundleUrl("/Graphium/", "bread-ja")).toBe("/Graphium/demo/bread-ja.json");
    expect(demoBundleUrl("/Graphium", "bread-ja")).toBe("/Graphium/demo/bread-ja.json");
    expect(demoBundleUrl("/", "bread-en")).toBe("/demo/bread-en.json");
  });
});
