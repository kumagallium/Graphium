import { describe, expect, it } from "vitest";
import {
  formatSourceCitation,
  parseSourceCitations,
  passageAppearsIn,
  stripCitationPassages,
} from "./source-citations";

describe("source-citations", () => {
  it("一節の有無どちらの引用も読む", () => {
    expect(parseSourceCitations("A。[[source:n1]] B。[[source:pdf:x|焼成は 230 度]]")).toEqual([
      { raw: "[[source:n1]]", sourceId: "n1" },
      { raw: "[[source:pdf:x|焼成は 230 度]]", sourceId: "pdf:x", passage: "焼成は 230 度" },
    ]);
  });

  it("論文の一節の [12] や表の | が入っていても引用ごと読める", () => {
    const body = "文。[[source:pdf:x|as reported in [12], the loss | gain was 3%]] 次。[[source:n]]";
    expect(parseSourceCitations(body)).toEqual([
      { raw: "[[source:pdf:x|as reported in [12], the loss | gain was 3%]]", sourceId: "pdf:x", passage: "as reported in [12], the loss | gain was 3%" },
      { raw: "[[source:n]]", sourceId: "n" },
    ]);
  });

  it("一節に引用の終わりの印が入ったら外す・一節を外した本文に戻せる", () => {
    expect(formatSourceCitation("a", "x ]] z")).toBe("[[source:a|x z]]");
    expect(formatSourceCitation("a", "see [3]")).toBe("[[source:a|see [3]]]");
    expect(parseSourceCitations(formatSourceCitation("a", "see [3]"))[0].passage).toBe("see [3]");
    // AI が書いた「一節が ] で終わる」引用も、末尾の ] を一節に含めて読む（本文に ] を残さない）
    const body = "文。[[source:p|to more recent ALIGNN [ 14 ]]]。次。[[source:q]]";
    expect(parseSourceCitations(body).map((c) => c.passage)).toEqual(["to more recent ALIGNN [ 14 ]", undefined]);
    expect(stripCitationPassages(body)).toBe("文。[[source:p]]。次。[[source:q]]");
    expect(formatSourceCitation("a", "  ")).toBe("[[source:a]]");
    expect(stripCitationPassages("文。[[source:a|一節]]")).toBe("文。[[source:a]]");
  });

  it("PDF の行末のハイフン・ダッシュの字形・空白と改行の違いは吸収する", () => {
    const pdf = "couples the pretrained TabPFN trans-\nformer with graph neural network (GNN)-derived embeddings";
    expect(passageAppearsIn("couples the pretrained TabPFN transformer with graph neural network", pdf)).toBe(true);
    expect(passageAppearsIn("Al‐Siの共晶組成でリボン試料を作製し", "Al-Si の共晶組成でリボン試料を作製し、")).toBe(true);
  });

  it("参照番号の脱落と、末尾の句読点の違いは吸収する", () => {
    expect(passageAppearsIn("信頼は 54% に落ち込みました。", "信頼は 54% に落ち込みました[8]。最も一般的な")).toBe(true);
    expect(passageAppearsIn("MGM and CAP mitigate the identified failure modes.", "MGM and CAP mitigate the identified failure modes, while MMPFN")).toBe(true);
  });

  it("「…」での省略・言い換え・短すぎる一節は見つからない扱い", () => {
    const src = "プロダクトデベロッパーは、AI を活用して定型作業を減らす。AI 生成コードは同僚が書いたかのようにレビューする。";
    expect(passageAppearsIn("プロダクトデベロッパーは、AI を活用して定型作業… AI 生成コードは同僚が書いたかのようにレビューする", src)).toBe(false);
    expect(passageAppearsIn("AI", src)).toBe(false);
  });
});
