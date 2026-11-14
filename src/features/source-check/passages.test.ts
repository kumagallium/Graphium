// 本文の引用に控えた一節を、出典照合の文と @資料 のクリックが読めるか
import { describe, expect, it } from "vitest";
import { extractSourceTopicStatements } from "./topic-statements";
import { mentionClickFocus } from "../block-link/mention-click";

describe("出典照合の文に一節が付く", () => {
  it("一節は文から外れ、出典 id ごとに控える", () => {
    const doc: any = {
      title: "t",
      pages: [],
      wikiMeta: { kind: "topic", topicMarkdown: "## 要点\n- 焼成は 230 度。[[source:pdf:a|焼成は 230 度で 35 分]][[source:n2]]" },
    };
    const [st] = extractSourceTopicStatements(doc);
    expect(st.text).toBe("- 焼成は 230 度。");
    expect(st.claimIds).toEqual(["pdf:a", "n2"]);
    expect(st.passages).toEqual({ "pdf:a": "焼成は 230 度で 35 分" });
  });
});

describe("@資料 のクリックで PDF を一節の位置で開く", () => {
  const links = [
    { sourceBlockId: "b1", targetNoteId: "pdf:a", targetQuote: "焼成は  230 度" },
    { sourceBlockId: "b2", targetNoteId: "pdf:a" },
  ];
  it("同じブロックのリンクに一節があれば focus を返す", () => {
    expect(mentionClickFocus({ blockId: "b1", links }, "pdf:a")?.quote).toEqual({ exact: "焼成は 230 度" });
  });
  it("一節が無い・PDF 以外は undefined", () => {
    expect(mentionClickFocus({ blockId: "b2", links }, "pdf:a")).toBeUndefined();
    expect(mentionClickFocus({ blockId: "b1", links: [{ sourceBlockId: "b1", targetNoteId: "n1", targetQuote: "x" }] }, "n1")).toBeUndefined();
  });
});
