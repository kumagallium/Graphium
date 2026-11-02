import { describe, expect, it } from "vitest";
import { DEMO_IDS, demoBundleUrl, demoDbName, isDemoId, parseDemoId } from "./demo-mode";

describe("demo-mode", () => {
  it("一覧にある id だけを見本として受け付ける", () => {
    expect(parseDemoId("?demo=curry-ja")).toBe("curry-ja");
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
    expect(demoDbName("curry-ja")).toBe("graphium-demo-curry-ja");
    expect(demoDbName("curry-ja")).not.toBe("graphium-local");
  });

  it("束の URL は base の末尾スラッシュの有無に左右されない", () => {
    expect(demoBundleUrl("/Graphium/", "curry-ja")).toBe("/Graphium/demo/curry-ja.json");
    expect(demoBundleUrl("/Graphium", "curry-ja")).toBe("/Graphium/demo/curry-ja.json");
    expect(demoBundleUrl("/", "bread-en")).toBe("/demo/bread-en.json");
  });
});
