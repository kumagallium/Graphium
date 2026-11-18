import { describe, expect, it } from "vitest";
import {
  PASSAGE_CONTEXT_MAX_CHARS,
  capturePassageContexts,
  contextOf,
  passageContextChange,
  sameSentence,
  sharesNumberOrTerm,
  splitSentences,
  withPassageContexts,
} from "./passage-context";

const note = [
  "# 発酵の記録",
  "室温は 24 度だった。一次発酵の湿度は 65% だった。生地はよく膨らんだ。",
  "- 焼成は 230 度で 35 分",
  "The crumb was open. It rose well.",
].join("\n");

describe("passage-context", () => {
  it("行と文末記号で文に分ける（小数点では分けない）", () => {
    expect(splitSentences("a は 1.5 倍。b だった。\nThe value was 2.5 g. Next one!")).toEqual([
      "a は 1.5 倍。",
      "b だった。",
      "The value was 2.5 g.",
      "Next one!",
    ]);
  });

  it("一節の直前・直後の文を取る（先頭・末尾は片側だけ）", () => {
    expect(contextOf("一次発酵の湿度は 65% だった", note)).toEqual({ before: "室温は 24 度だった。", after: "生地はよく膨らんだ。" });
    expect(contextOf("It rose well", note)).toEqual({ before: "The crumb was open." });
    expect(contextOf("ノートに無い一節です", note)).toBeUndefined();
  });

  it("長い前後の文は一節に近い側を残す", () => {
    const long = "あ".repeat(400) + "。";
    const ctx = contextOf("一次発酵の湿度は 65% だった", `${long}一次発酵の湿度は 65% だった。`);
    expect(ctx?.before?.length).toBe(PASSAGE_CONTEXT_MAX_CHARS);
    expect(ctx?.before?.endsWith("。")).toBe(true);
  });

  it("読んだノートは取り直し、読んでいないノートは持ち越し、本文に無い一節と外部資料は捨てる", () => {
    const md = [
      "- 湿度は 65%。[[source:n1|一次発酵の湿度は 65% だった]]",
      "- 塩は 2%。[[source:n2|塩は粉に対して 2% にした]]",
      "- 焼成。[[source:pdf:f|焼成は 230 度で 35 分]]",
      "- 未確認。[[source:n1|?|どこにも無い一節です]]",
    ].join("\n");
    const prev = [
      { sourceId: "n2", passage: "塩は粉に対して 2% にした", before: "前の文。" },
      { sourceId: "n3", passage: "もう本文に無い一節です", after: "x" },
    ];
    expect(capturePassageContexts(md, [{ id: "n1", text: note }], prev)).toEqual([
      { sourceId: "n1", passage: "一次発酵の湿度は 65% だった", before: "室温は 24 度だった。", after: "生地はよく膨らんだ。" },
      { sourceId: "n2", passage: "塩は粉に対して 2% にした", before: "前の文。" },
    ]);
    expect(capturePassageContexts("引用なし", [], prev)).toBeUndefined();
  });

  it("withPassageContexts は控えが無くなれば欄を外す", () => {
    const doc = { wikiMeta: { topicMarkdown: "引用なし", passageContexts: [{ sourceId: "n1", passage: "p" }] } };
    expect(withPassageContexts(doc, [])).toEqual({ wikiMeta: { topicMarkdown: "引用なし" } });
  });

  it("誤字の修正は同じ、数字の変更と 3 字以上の書き換えは違う", () => {
    expect(sameSentence("生地はよく膨らんだ。", "生地はよくふくらんだ。")).toBe(true);
    expect(sameSentence("生地はよく膨らんだ。", "生地は膨らまなかった。")).toBe(false);
    expect(sameSentence("The crumb was open.", "The crumb was opne.")).toBe(true);
    expect(sameSentence("湿度は 65% だった。", "湿度は 66% だった。")).toBe(false);
    expect(sameSentence("生地はよく膨らんだ。", "生地は よく膨らんだ。")).toBe(true);
  });

  it("末尾だった一節のあとの書き足しは、同じ数字か同じ語を含むときだけ知らせる", () => {
    const en = { sourceId: "n1", passage: "The yield was 65%", before: "We weighed the loaf." };
    const base = "We weighed the loaf. The yield was 65%.";
    expect(passageContextChange(en, base)).toBeNull();
    // 関係ない追記は見ない
    expect(passageContextChange(en, `${base} Baked a second batch the next day.`)).toBeNull();
    // 同じ語（yield）
    expect(passageContextChange(en, `${base} Re-measured: the yield came to 58%.`)).toEqual({
      after: { now: "Re-measured: the yield came to 58%." },
    });
    // 同じ数字（65）
    expect(passageContextChange(en, `${base}\nCorrection: 65% was before calibration.`)).toEqual({
      after: { now: "Correction: 65% was before calibration." },
    });
    // よくある語（with / that）だけが同じなら見ない
    const common = { sourceId: "n1", passage: "We baked that with steam", before: "Day one." };
    expect(passageContextChange(common, "Day one. We baked that with steam. Lunch with friends after that.")).toBeNull();
    // 和文: 漢字の 2 字の並び・カタカナ語
    const ja = { sourceId: "n1", passage: "焼成温度は高めにした", before: "二次発酵は短かった。" };
    const jaBase = "二次発酵は短かった。焼成温度は高めにした。";
    expect(passageContextChange(ja, `${jaBase}翌日も焼いた。`)).toBeNull();
    expect(passageContextChange(ja, `${jaBase}温度計が低く出ていたとあとで分かった。`)).toEqual({
      after: { now: "温度計が低く出ていたとあとで分かった。" },
    });
    const kata = { sourceId: "n1", passage: "クラストは均一に色づいた" };
    expect(passageContextChange(kata, "クラストは均一に色づいた。ただしクラストの底は焦げていた。")).toEqual({
      after: { now: "ただしクラストの底は焦げていた。" },
    });
    // 一節が何か所にもあり、どこかが今も末尾なら変わっていない
    expect(passageContextChange(en, `${base} The yield changed later. We weighed the loaf. The yield was 65%.`)).toBeNull();
    expect(sharesNumberOrTerm("湿度は 65% だった", "65 回こねた")).toBe(true);
    expect(sharesNumberOrTerm("湿度は 65% だった", "165 回こねた")).toBe(false);
    // 日付・時刻・1 桁の数字は、同じ数字に数えない
    expect(sharesNumberOrTerm("Rested the dough for 18 hours", "2026-11-18: baked a new batch")).toBe(false);
    expect(sharesNumberOrTerm("温度は 11 度だった", "2026/11/18 新しい生地を仕込んだ")).toBe(false);
    expect(sharesNumberOrTerm("加水は 11 割だった", "11月18日 新しい生地を仕込んだ")).toBe(false);
    expect(sharesNumberOrTerm("Dough rested for 2 hours", "Step 2: buy flour.")).toBe(false);
    // 全角の数字も同じ数字
    expect(sharesNumberOrTerm("湿度は ６５％ だった", "再計測したら 65% ではなかった")).toBe(true);
    // 日誌によく出る語は数えない
    expect(sharesNumberOrTerm("今日は生地を確認した", "明日は窯を確認する")).toBe(false);
    expect(sharesNumberOrTerm("Baked today with steam", "Shopping list for today")).toBe(false);
    // ハングルは語の頭 2 字
    expect(sharesNumberOrTerm("수율은 높았다", "수율이 다시 떨어졌다")).toBe(true);
    expect(sharesNumberOrTerm("수율은 높았다", "다음 날 빵을 구웠다")).toBe(false);
  });

  it("すぐ隣に文が書き足されたら変わった。離れた場所・関係ない末尾への追記は見ない", () => {
    const stored = { sourceId: "n1", passage: "一次発酵の湿度は 65% だった", before: "室温は 24 度だった。", after: "生地はよく膨らんだ。" };
    expect(passageContextChange(stored, note)).toBeNull();
    expect(passageContextChange(stored, "室温は 24 度だった。一次発酵の湿度は 65% だった。ただし湿度計は校正前だった。生地はよく膨らんだ。")).toEqual({
      after: { was: "生地はよく膨らんだ。", now: "ただし湿度計は校正前だった。" },
    });
    expect(passageContextChange(stored, `${note}\n翌日の追記。`)).toBeNull();
    const atEnd = { sourceId: "n1", passage: "It rose well", before: "The crumb was open." };
    expect(passageContextChange(atEnd, `${note} Then we sliced it.`)).toBeNull();
    expect(passageContextChange(stored, "室温は 24 度だった。一次発酵の湿度は 65% だった。")).toEqual({
      after: { was: "生地はよく膨らんだ。" },
    });
    expect(passageContextChange(stored, "室温は 30 度だった。一次発酵の湿度は 65% だった。生地はよく膨らんだ。")).toEqual({
      before: { was: "室温は 24 度だった。", now: "室温は 30 度だった。" },
    });
    // 一節が無ければ（消えたことは別に知らせる）null
    expect(passageContextChange(stored, "別の文。")).toBeNull();
  });
});
