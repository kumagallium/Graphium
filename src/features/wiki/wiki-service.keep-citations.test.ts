// @vitest-environment jsdom
//
// 改訂で「今回読んでいない資料の文」が丸ごと消えたときの検出と 1 回だけの書き直し、
// References の「引用中を先に・引用していない資料に注記」を確かめる。

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildSourceBackedWikiDocument,
  citedSourceIds,
  droppedOtherSourceCitations,
  reviseTopicFromSource,
} from "./wiki-service";

const PREV = [
  "## 要点",
  "- 発酵は 65% の湿度で行った。[[source:old]]",
  "- 焼成は 230 度。[[source:keep]]",
].join("\n");

describe("citedSourceIds / droppedOtherSourceCitations", () => {
  it("引用の印が無ければ null（言い切れない）", () => {
    expect(citedSourceIds("ただの文。")).toBeNull();
    expect([...citedSourceIds(PREV)!]).toEqual(["old", "keep"]);
  });

  it("今回読んでいない資料の引用が消えたら、その資料と前の行を返す", () => {
    const next = "## 要点\n- 発酵は 70% の湿度で行った。[[source:new]]\n- 焼成は 230 度。[[source:keep]]";
    expect(droppedOtherSourceCitations(PREV, next, "new")).toEqual({
      sourceIds: ["old"],
      lines: ["- 発酵は 65% の湿度で行った。[[source:old]]"],
    });
  });

  it("今回読み直した資料の引用が消えるのは検出しない（取り込み直しで言わなくなった）", () => {
    const next = "## 要点\n- 焼成は 230 度。[[source:keep]]";
    expect(droppedOtherSourceCitations(PREV, next, "old").sourceIds).toEqual([]);
  });
});

describe("References: 引用中を先に、引用していない資料に注記", () => {
  it("本文で引用していない資料は後ろに回り、注記が付く", () => {
    const doc = buildSourceBackedWikiDocument(
      "topic",
      "パン",
      "## 要点\n- 焼成は 230 度。[[source:b]]",
      [{ id: "a", title: "古い記録" }, { id: "b", title: "焼成の記録" }],
      null,
      undefined,
      "ja",
    );
    const blocks = doc.pages[0].blocks as any[];
    const refIdx = blocks.findIndex((b) => b.type === "heading" && b.content?.[0]?.text === "References");
    const rows = blocks.slice(refIdx + 1).map((b) => (b.content as any[]).map((c) => c.text).join(""));
    expect(rows).toEqual(["@焼成の記録", "@古い記録（読んだ資料。今の本文では引用していない）"]);
    // 読んだ事実（PROV の元）は全件残す
    expect(doc.wikiMeta?.derivedFromNotes).toEqual(["a", "b"]);
  });
});

function okResponse(body: unknown): Response {
  return { ok: true, status: 200, json: async () => body } as unknown as Response;
}

describe("reviseTopicFromSource: 他の資料の文を消したら 1 回だけ書き直させる", () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  const SRC = { id: "new", title: "新しい試行", text: "70% だった" };
  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  const dropped = "## 要点\n- 発酵は 70% の湿度で行った。[[source:new]]\n- 焼成は 230 度。[[source:keep]]";
  const kept = `${dropped}\n- 発酵は 65% の湿度で行った。[[source:old]]\n\n## 食い違い・未解決\n- 湿度が 65% と 70% で違う。[[source:old]][[source:new]]`;

  it("消えた文を keepSentences で渡し、2 回目の本文を採る", async () => {
    fetchMock
      .mockImplementationOnce(async () => okResponse({ body: dropped }))
      .mockImplementationOnce(async () => okResponse({ body: kept }));
    const out = await reviseTopicFromSource("パン", PREV, SRC, "ja");
    expect(out).toBe(kept);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const second = JSON.parse(fetchMock.mock.calls[1][1].body as string);
    expect(second.keepSentences).toEqual(["- 発酵は 65% の湿度で行った。[[source:old]]"]);
    const first = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(first.keepSentences).toBeUndefined();
  });

  it("書き直しが失敗したら 1 回目の本文を返し、onError は呼ばない", async () => {
    fetchMock
      .mockImplementationOnce(async () => okResponse({ body: dropped }))
      .mockImplementationOnce(async () => ({ ok: false, status: 500, json: async () => ({ error: "x" }) }) as unknown as Response);
    const onError = vi.fn();
    const out = await reviseTopicFromSource("パン", PREV, SRC, "ja", undefined, undefined, undefined, undefined, undefined, onError);
    expect(out).toBe(dropped);
    expect(onError).not.toHaveBeenCalled();
  });

  it("消えていなければ 1 回で終わる", async () => {
    fetchMock.mockImplementationOnce(async () => okResponse({ body: kept }));
    expect(await reviseTopicFromSource("パン", PREV, SRC, "ja")).toBe(kept);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

import { verifyCitationPassages, resolveSourceCitationsWithPassages } from "./wiki-service";

describe("一節の照合（verifyCitationPassages）", () => {
  const source = { id: "s", text: "焼成は 230 度で 35 分とした。湿度は 65% だった。" };
  it("今回の資料に見つからない一節は印を付けて残す", () => {
    const body = "- 焼成は 230 度。[[source:s|焼成は 230 度で 35 分とした]]\n- 湿度は 70%。[[source:s|湿度は 70% だった]]";
    const out = verifyCitationPassages("", body, source);
    expect(out.body).toBe("- 焼成は 230 度。[[source:s|焼成は 230 度で 35 分とした]]\n- 湿度は 70%。[[source:s|?|湿度は 70% だった]]");
    expect(out.kept).toBe(1);
    expect(out.unverified).toEqual([{ sourceId: "s", passage: "湿度は 70% だった" }]);
  });
  it("他の資料の一節は前の本文と同じなら残し、書き換わっていたら印を付ける", () => {
    const prev = "- a [[source:o|古い記録の一節]]";
    expect(verifyCitationPassages(prev, "- a [[source:o|古い記録の一節]]", source).body).toBe("- a [[source:o|古い記録の一節]]");
    expect(verifyCitationPassages(prev, "- a [[source:o|作り直した一節]]", source).body).toBe("- a [[source:o|?|作り直した一節]]");
  });
});

describe("一節はリンク記録（targetQuote）に載る", () => {
  it("資料の題に解決し、一節を番号の目印で運ぶ", () => {
    const r = resolveSourceCitationsWithPassages("文 *強調*。[[source:p|式 $x*y$ の一節]]", [{ id: "p", title: "論文" }]);
    expect(r.passages).toEqual([{ quote: "式 $x*y$ の一節" }]);
    expect(r.text).toBe("文 *強調*。[[論文⟦P:0⟧]]");
  });
  it("組み立てた本文のリンクに一節が付き、表示の文字には出ない", () => {
    const doc = buildSourceBackedWikiDocument("topic", "パン", "## 要点\n- 焼成は 230 度。[[source:pdf:f|焼成は 230 度で 35 分]]", [{ id: "pdf:f", title: "焼成の論文" }], null, undefined, "ja");
    const page = doc.pages[0];
    const bodyBlock = (page.blocks as any[]).find((b) => (b.content as any[])?.some((c: any) => c.text === "@焼成の論文"));
    expect(bodyBlock).toBeDefined();
    const link = page.knowledgeLinks.find((l) => l.sourceBlockId === bodyBlock.id);
    expect(link?.targetQuote).toBe("焼成は 230 度で 35 分");
    expect(JSON.stringify(bodyBlock.content)).not.toContain("⟦");
    // 正本の markdown には一節ごと残る（次の改訂・出典照合が読む）
    expect(doc.wikiMeta?.topicMarkdown).toContain("[[source:pdf:f|焼成は 230 度で 35 分]]");
  });
});

import { keepKnownPassages } from "./wiki-service";

describe("窓をまたぐ一節と統合の一節", () => {
  it("前の窓で控えた同じ資料の一節は、今の窓の文字に無くても残す", () => {
    const prev = "- a [[source:s|窓 1 だけにある一節の文]]";
    const out = verifyCitationPassages(prev, `${prev}\n- b [[source:s|窓 2 にある一節の文]]`, { id: "s", text: "ここは窓 2 にある一節の文です。" });
    expect(out.body).toBe(`${prev}\n- b [[source:s|窓 2 にある一節の文]]`);
    expect(out.unverified).toEqual([]);
  });
  it("統合では、元の本文にあった一節だけを残す", () => {
    const out = keepKnownPassages(["- a [[source:s|元の一節その一]]", "- b [[source:t|元の一節その二]]"], "- ab [[source:s|元の一節その一]][[source:t|書き換えた一節]]");
    expect(out).toBe("- ab [[source:s|元の一節その一]][[source:t|?|書き換えた一節]]");
  });
});


import { setSourceDateLookup } from "./wiki-service";

describe("資料の全文での照合（取り込み直し・窓）", () => {
  it("全文があれば、前の本文で照合済みの一節も全文と照らし直す（ノートから消えた一節には印）", () => {
    const prev = "- a [[source:s|前は書いてあった一節の文]]";
    const out = verifyCitationPassages(prev, prev, { id: "s", text: "窓", fullText: "編集後のノートの全文。" });
    expect(out.body).toBe("- a [[source:s|?|前は書いてあった一節の文]]");
    expect(out.unverified).toHaveLength(1);
  });
  it("全文にあれば、窓の文字に無くても照合済み", () => {
    const out = verifyCitationPassages("", "- a [[source:s|前の窓にある一節の文]]", { id: "s", text: "今の窓", fullText: "前の窓にある一節の文です。今の窓" });
    expect(out.body).toBe("- a [[source:s|前の窓にある一節の文]]");
  });
  it("印の付いた一節が全文に現れたら印を外す・持ち越した印は数え直さない", () => {
    const prev = "- a [[source:s|?|あとで書き足された一節]]\n- b [[source:o|?|他の資料の一節の文]]";
    const out = verifyCitationPassages(prev, prev, { id: "s", text: "x", fullText: "ここに、あとで書き足された一節がある。" });
    expect(out.body).toBe("- a [[source:s|あとで書き足された一節]]\n- b [[source:o|?|他の資料の一節の文]]");
    expect(out.unverified).toEqual([]);
  });
});

describe("印の付いた一節の表示と、食い違いの節の日付", () => {
  it("印の付いた一節はリンクに載せず、引用の後ろに注記を出す", () => {
    const doc = buildSourceBackedWikiDocument("topic", "パン", "## 要点\n- 湿度は 70%。[[source:pdf:f|?|湿度は 70% だった]]", [{ id: "pdf:f", title: "論文" }], null, undefined, "ja");
    const page = doc.pages[0];
    const block = (page.blocks as any[]).find((b) => (b.content as any[])?.some((c: any) => c.text === "@論文"));
    const texts = (block.content as any[]).map((c: any) => c.text);
    expect(texts).toContain("（AI が写した一節が資料に見つからない）");
    expect(page.knowledgeLinks.find((l) => l.sourceBlockId === block.id)?.targetQuote).toBeUndefined();
  });
  it("食い違いの節の引用にだけ資料の日付を添える", () => {
    setSourceDateLookup((id) => (id === "n1" ? "2026-09-01" : id === "n2" ? "2026-10-15" : undefined));
    try {
      const r = resolveSourceCitationsWithPassages(
        "## 要点\n- 湿度は 65%。[[source:n1]]\n\n## 食い違い・未解決\n- 湿度は 65% と 70% で違う。[[source:n1]][[source:n2]]",
        [{ id: "n1", title: "9 月の試行" }, { id: "n2", title: "10 月の試行" }],
        "ja",
      );
      expect(r.text).toContain("- 湿度は 65%。[[9 月の試行]]\n");
      expect(r.text).toContain("[[9 月の試行]] (2026-09-01) [[10 月の試行]] (2026-10-15)");
      expect(r.text.endsWith("(2026-10-15)")).toBe(true);
    } finally {
      setSourceDateLookup(null);
    }
  });
  it("資料の参照に date があればそれを使い、引けなければ添えない", () => {
    const r = resolveSourceCitationsWithPassages("## Disagreements & open questions\n- x [[source:a]][[source:b]]", [{ id: "a", title: "A", date: "2021" }, { id: "b", title: "B" }], "en");
    expect(r.text).toBe("## Disagreements & open questions\n- x [[A]] (2021) [[B]]");
  });
});
