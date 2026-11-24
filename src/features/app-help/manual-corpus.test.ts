import { describe, expect, it } from "vitest";
import { parseManualPage } from "./manual-corpus";
import { MANUAL_BASE_URL } from "./manual-url";

describe("parseManualPage", () => {
  const md = [
    "---",
    "title: x",
    "---",
    "<script setup>const a = 1</script>",
    "# ページ題 <Badge type=\"tip\" text=\"v1\" />",
    "",
    "導入 <!-- 隠す --> です。[リンク](/ja/faq) と ![画像](/a.png) と <span>中身</span>。",
    "",
    "## 第一節 <Badge type=\"tip\" text=\"v1 で追加\" /> {#first}",
    "",
    "::: tip 注意題",
    "本文A",
    ":::",
    "",
    "```md",
    "## 見出しではない",
    "```",
    "",
    "### 小節",
    "小節の本文",
    "",
    "## 空の節",
    "",
    "## 長い節",
    "",
    ...Array.from({ length: 200 }, (_, i) => `これは長い文章の ${i} 番目の文です。`),
  ].join("\n");
  const secs = parseManualPage("demo", md, "ja");

  it("導入は pageTitle の節になる", () => {
    expect(secs[0].heading).toBe("ページ題");
    expect(secs[0].text).toBe("導入  です。リンク と  と 中身。".replace("  と  と", "  と  と"));
    expect(secs[0].url).toBe(`${MANUAL_BASE_URL}ja/demo`);
  });
  it("見出しの Badge と {#id} を落とし anchor にする", () => {
    const s = secs.find((x) => x.anchor === "first")!;
    expect(s.heading).toBe("第一節");
    expect(s.url).toBe(`${MANUAL_BASE_URL}ja/demo#first`);
    expect(s.text).toContain("注意題");
    expect(s.text).toContain("本文A");
    expect(s.text).not.toContain(":::");
    expect(s.text).toContain("## 見出しではない");
  });
  it("### で分かれ、見出しは親からの道になり、空の節は捨てる", () => {
    const sub = secs.find((x) => x.heading === "第一節 › 小節");
    expect(sub?.text).toBe("小節の本文");
    // 自分にアンカーが無い小節は、親のアンカーへリンクする
    expect(sub?.url).toBe(`${MANUAL_BASE_URL}ja/demo#first`);
    expect(secs.find((x) => x.heading === "空の節")).toBeUndefined();
  });
  it("長い節は分割され id が一意", () => {
    const longs = secs.filter((x) => x.heading === "長い節");
    expect(longs.length).toBeGreaterThan(1);
    expect(longs.every((x) => x.text.length <= 2400)).toBe(true);
    expect(new Set(secs.map((x) => x.id)).size).toBe(secs.length);
  });
  it("index ページと en の URL", () => {
    const en = parseManualPage("index", "# Top\n\nhello", "en");
    expect(en[0].url).toBe(MANUAL_BASE_URL);
    const ja = parseManualPage("index", "# Top\n\nhello", "ja");
    expect(ja[0].url).toBe(`${MANUAL_BASE_URL}ja/`);
  });
  it("見出しが無いページは page 名が題", () => {
    expect(parseManualPage("p", "本文だけ", "en")[0].pageTitle).toBe("p");
  });
  it("#### まで分かれ、次の ## で道が戻る", () => {
    const s = parseManualPage("p", ["# P", "## A {#a}", "x", "### B", "y", "#### C {#c}", "z", "## D", "w"].join("\n"), "ja");
    expect(s.map((x) => [x.heading, x.anchor])).toEqual([
      ["A", "a"],
      ["A › B", "a"],
      ["A › B › C", "c"],
      ["D", undefined],
    ]);
  });
});
