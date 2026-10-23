import { describe, it, expect } from "vitest";
import { appendMaskTerms, buildMeetingMaskSection, findNameCandidates, maskText, parseMaskTerms, MAX_MASK_TERMS_CHARS } from "./meeting-mask";
import { buildMeetingCleanupSystemPrompt } from "../server/services/meeting-cleanup";
import { buildMeetingSummarySystemPrompt } from "../server/services/meeting-summary";

describe("parseMaskTerms", () => {
  it("カンマ・読点・改行で区切り、重複と空を除き、長い語から並べる", () => {
    expect(parseMaskTerms("田中, 田中商事、 佐藤\n田中,, ")).toEqual(["田中商事", "田中", "佐藤"]);
  });
  it("文字列でなければ空、上限の字数で切る", () => {
    expect(parseMaskTerms(undefined)).toEqual([]);
    expect(parseMaskTerms("あ".repeat(MAX_MASK_TERMS_CHARS + 50))[0]).toHaveLength(MAX_MASK_TERMS_CHARS);
  });
});

describe("maskText", () => {
  it("必ず伏せる語を［伏せ字］に（長い語が先・英字は大文字小文字を区別しない）", () => {
    const terms = parseMaskTerms("田中, 田中商事, Tanaka");
    expect(maskText("田中商事の田中さんと tanaka", terms, "ja")).toBe("［伏せ字］の［伏せ字］さんと ［伏せ字］");
  });
  it("日本語の印の半角の書き方を全角に揃える", () => {
    expect(maskText("[組織名]の[ 人名 ]と［番号］", [], "ja")).toBe("［組織名］の［人名］と［番号］");
    expect(maskText("[name] stays", [], "en")).toBe("[name] stays");
  });
  it("語に含まれる記号はそのまま照合する", () => {
    expect(maskText("A.B と AxB", ["A.B"], "en")).toBe("[redacted] と AxB");
  });
  it("メールと電話番号を連絡先の印に", () => {
    expect(maskText("連絡は taro@example.co.jp か 03-1234-5678、090-1234-5678 へ", [], "ja")).toBe(
      "連絡は ［連絡先］ か ［連絡先］、［連絡先］ へ",
    );
    expect(maskText("call +81 90-1234-5678 or 09012345678", [], "en")).toBe("call [contact] or [contact]");
  });
  it("日付・時刻・金額・年は電話番号とみなさない", () => {
    const s = "2026-10-21 の 10:30 に 1,000 円、2026 年度、型番 0123、12:30 - 14:00";
    expect(maskText(s, [], "ja")).toBe(s);
    const en = "on 05-10-2026 or 03-15-2026 at 08 30 1200";
    expect(maskText(en, [], "en")).toBe(en);
  });
  it("全角数字・各種ハイフン・括弧の電話番号と全角 @ のメールも伏せる", () => {
    expect(maskText("０９０－１２３４－５６７８ と (03)1234-5678 と 03(1234)5678", [], "ja")).toBe(
      "［連絡先］ と ［連絡先］ と ［連絡先］",
    );
    expect(maskText("03‐1234‐5678 / 03−1234−5678 / taro＠example.com", [], "ja")).toBe(
      "［連絡先］ / ［連絡先］ / ［連絡先］",
    );
  });
  it("必ず伏せる語が印の中を壊さない", () => {
    expect(maskText("［人名］さんの名前と[organization]", ["名", "organization"], "ja")).toBe(
      "［人名］さんの［伏せ字］前と[organization]",
    );
  });
});

describe("伏せる節を指示に足す", () => {
  it("清書・要約とも mask のときだけ、その言語の印で", () => {
    expect(buildMeetingCleanupSystemPrompt("ja")).not.toContain("Hide sensitive details");
    expect(buildMeetingCleanupSystemPrompt("ja", "", "", true)).toContain("［人名］");
    expect(buildMeetingSummarySystemPrompt("en", undefined, true)).toContain("[organization]");
    expect(buildMeetingSummarySystemPrompt("en")).not.toContain("Hide sensitive details");
    expect(buildMeetingMaskSection("en")).toContain('including "owner"');
  });
});

describe("findNameCandidates（伏せ損ねた名前の候補）", () => {
  it("敬称の前の名前を拾い、呼びかけ・役職・熟語・印は拾わない", () => {
    const text = "皆さん、天野さん、天田さんが発表。津田先生と［人名］さん、[人名]様、部長さん、仕様書、お客様、業者さん、ユーザーさん、ヤマダくん";
    expect(findNameCandidates(text)).toEqual(["天野", "天田", "津田", "ヤマダ"]);
  });
  it("英語の敬称のあとの名前", () => {
    expect(findNameCandidates("Ask Mr. Tanaka and Dr Sato. [name] agreed.")).toEqual(["Tanaka", "Sato"]);
  });
  it("同じ名前は 1 回だけ", () => {
    expect(findNameCandidates("天野さん。天野さんが。")).toEqual(["天野"]);
  });
});

describe("appendMaskTerms", () => {
  it("ない語だけを足す", () => {
    expect(appendMaskTerms("北斗, 天野", ["天野", "天田"])).toBe("北斗, 天野, 天田");
    expect(appendMaskTerms("", ["天野"])).toBe("天野");
    expect(appendMaskTerms("天野", ["天野"])).toBe("天野");
  });
});
