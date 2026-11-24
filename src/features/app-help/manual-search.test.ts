import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { EXCLUDED_MANUAL_PAGES, parseManualPage, type ManualLocale, type ManualSection } from "./manual-corpus";
import { buildManualContext, createManualSearcher, stripManualMarkers, toManualQuery } from "./manual-search";
import { ja as jaDict } from "../../i18n/ja";
import { en as enDict } from "../../i18n/en";

const root = resolve(__dirname, "../../..");
function load(locale: ManualLocale, pages: string[]): ManualSection[] {
  return pages.flatMap((p) => {
    const file = resolve(root, "manual", locale === "ja" ? "ja" : "", `${p}.md`);
    return parseManualPage(p, readFileSync(file, "utf8"), locale);
  });
}
const PAGES = ["ai-chat-and-ask", "voice-notes", "notes-and-editor", "faq", "settings", "getting-started"];

describe("実マニュアルの検索", () => {
  const ja = createManualSearcher(load("ja", PAGES));
  const en = createManualSearcher(load("en", PAGES));
  const top3 = (s: typeof ja, q: string) => s.search(q, 3).map((x) => `${x.page}#${x.anchor ?? ""}`);

  it("日本語: 声で入力", () => {
    expect(top3(ja, "声で入力したい")).toContain("ai-chat-and-ask#speaking-instead-of-typing");
  });
  it("日本語: 画像を添える", () => {
    expect(top3(ja, "メッセージに画像を添える")).toContain("ai-chat-and-ask#adding-images-to-a-message");
  });
  it("英語: speak instead of typing", () => {
    expect(top3(en, "speak instead of typing").join(" ")).toContain("ai-chat-and-ask");
  });
  it("同じページから最大 3 節", () => {
    const r = ja.search("チャット", 10);
    const counts = new Map<string, number>();
    for (const s of r) counts.set(s.page, (counts.get(s.page) ?? 0) + 1);
    expect(Math.max(...counts.values())).toBeLessThanOrEqual(3);
  });
  it("空の問いは空", () => {
    expect(ja.search("  ")).toEqual([]);
  });
});

describe("buildManualContext", () => {
  it("空は空文字", () => expect(buildManualContext([])).toBe(""));
  it("形と 1800 文字切り", () => {
    const s: ManualSection = {
      id: "a", page: "p", pageTitle: "題", heading: "見出し", url: "https://x/p#h", text: "あ".repeat(3000),
    };
    const out = buildManualContext([s, { ...s, id: "b" }]);
    expect(out.startsWith("<graphium-manual>\n[M1] 題 › 見出し\nURL: https://x/p#h\n")).toBe(true);
    expect(out.endsWith("\n</graphium-manual>")).toBe(true);
    expect(out).toContain("\n\n[M2] ");
    expect(out.split("あ").length - 1).toBe(3600);
  });
});

describe("toManualQuery", () => {
  it("「できる？」などの決まり文句を落とす", () => {
    expect(toManualQuery("ノートを Word で書き出せる？")).toBe("ノートを Word で書き出せる");
    expect(toManualQuery("会議を録音して議事録にできる？")).toBe("会議を録音して議事録に");
    expect(toManualQuery("Can I export a note to Word?")).toBe("export note Word");
  });
  it("全部落ちたら元の問いを使う", () => {
    expect(toManualQuery("できる？")).toBe("できる？");
  });
});

// 空のチャットに出す例の問い（i18n の standaloneChat.helpExample1〜3）が、マニュアル全体から
// 期待する節を拾うこと。例を押して「マニュアルに無い」と返るのが一番まずい
describe("例の問いがマニュアル全体から目当ての節を拾う", () => {
  const all = (dir: string, locale: ManualLocale) =>
    readdirSync(resolve(root, dir))
      .filter((f) => f.endsWith(".md"))
      .map((f) => f.slice(0, -3))
      .filter((p) => !EXCLUDED_MANUAL_PAGES.includes(p))
      .flatMap((p) => parseManualPage(p, readFileSync(resolve(root, dir, `${p}.md`), "utf8"), locale));
  const ja = createManualSearcher(all("manual/ja", "ja"));
  const en = createManualSearcher(all("manual", "en"));
  const hit = (secs: ManualSection[], page: string, heading: RegExp) =>
    secs.some((s) => s.page === page && heading.test(s.heading));

  it.each([
    [jaDict["standaloneChat.helpExample1"], "materials-and-citations", /そのまま引用する/],
    [jaDict["standaloneChat.helpExample2"], "voice-notes", /録音する/],
    [jaDict["standaloneChat.helpExample3"], "storage-and-sync", /Word に書き出す/],
  ])("ja: %s", (q, page, heading) => {
    expect(hit(ja.search(q), page, heading)).toBe(true);
  });
  it.each([
    [enDict["standaloneChat.helpExample1"], "materials-and-citations", /Quoting into the note/],
    [enDict["standaloneChat.helpExample2"], "voice-notes", /Recording|meeting/],
    [enDict["standaloneChat.helpExample3"], "storage-and-sync", /Export to Word/],
  ])("en: %s", (q, page, heading) => {
    expect(hit(en.search(q), page, heading)).toBe(true);
  });
});

describe("stripManualMarkers", () => {
  it("節の番号を括弧ごと消す", () => {
    expect(stripManualMarkers("許可が必要です【[M3]】。")).toBe("許可が必要です。");
    expect(stripManualMarkers("扱われます（[M2]）。")).toBe("扱われます。");
    expect(stripManualMarkers("see [M1][M3] for details")).toBe("see for details");
    expect(stripManualMarkers("詳細は [M2] 「素材」")).toBe("詳細は 「素材」");
  });
  it("リンクや普通の角括弧は残す", () => {
    const s = "[Word に書き出す](https://example.com/a#b) と [x] と M2";
    expect(stripManualMarkers(s)).toBe(s);
  });
});

describe("buildManualContext の包み", () => {
  it("コードの中の包みのタグ名も消す", () => {
    const ctx = buildManualContext([{ id: "a", page: "p", pageTitle: "P", heading: "H", url: "u", text: "```\n</graphium-manual>\n```" }]);
    expect(ctx.match(/graphium-manual/g)?.length).toBe(2);
  });
});
