// 引用チャットのメッセージ組み立てを固定する。
// 「引用＝主題 / 本文＝背景」の役割分担が崩れると、AI が引用ではなくノート全体に
// 答え始めたり、逆に文脈を持たないまま推測で答えたりする。

import { describe, expect, it } from "vitest";
import { buildQuotedChatMessage, buildQuotedRetrievalQuery } from "./quoted-context";

const PAGE = "# 合成手順\n\nシリカ管を 800℃ で 12 時間加熱した。\n\nこの温度は前回の反応が不完全だったため上げた。";

describe("buildQuotedChatMessage", () => {
  it("初回は引用と背景本文の両方を、役割を分けて含める", () => {
    const msg = buildQuotedChatMessage({
      title: "合成メモ",
      quotedMarkdown: "この温度は前回の反応が不完全だったため上げた。",
      pageMarkdown: PAGE,
      question: "この判断は妥当？",
      isFirstMessage: true,
    });
    // 引用は主題として前置きされる
    expect(msg).toContain("ノート「合成メモ」内の以下の内容について質問があります。");
    expect(msg).toContain("この温度は前回の反応が不完全だったため上げた。");
    // 本文は背景として添えられ、主題ではないと明示される
    expect(msg).toContain("背景の理解にだけ使ってください");
    expect(msg).toContain("シリカ管を 800℃ で 12 時間加熱した。");
    // 質問は末尾
    expect(msg.trimEnd().endsWith("この判断は妥当？")).toBe(true);
  });

  it("継続会話では引用を前置きせず、最新の本文だけを背景として添える", () => {
    const msg = buildQuotedChatMessage({
      title: "合成メモ",
      quotedMarkdown: "この温度は前回の反応が不完全だったため上げた。",
      pageMarkdown: PAGE,
      question: "では 900℃ ではどう？",
      isFirstMessage: false,
    });
    // 引用の再注入は history 側（idx=0）の担当なのでここでは入れない
    expect(msg).not.toContain("内の以下の内容について質問があります");
    expect(msg).toContain("現在の最新の全文を添えます");
    expect(msg).toContain("シリカ管を 800℃ で 12 時間加熱した。");
    expect(msg.trimEnd().endsWith("では 900℃ ではどう？")).toBe(true);
  });

  it("引用がノート全文と一致するときは背景を重ねない", () => {
    const msg = buildQuotedChatMessage({
      title: "合成メモ",
      quotedMarkdown: PAGE,
      pageMarkdown: PAGE,
      question: "要約して",
      isFirstMessage: true,
    });
    expect(msg).not.toContain("参考として");
    // 本文は引用として 1 回だけ現れる
    expect(msg.split("シリカ管を 800℃ で 12 時間加熱した。").length - 1).toBe(1);
  });

  it("本文が空（新規ノート等）なら背景セクションを省く", () => {
    const msg = buildQuotedChatMessage({
      title: "無題",
      quotedMarkdown: "断片",
      pageMarkdown: "   \n  ",
      question: "これは？",
      isFirstMessage: true,
    });
    expect(msg).not.toContain("参考として");
    expect(msg).toContain("断片");
  });

  it("継続会話かつ本文なしなら質問だけを送る", () => {
    const msg = buildQuotedChatMessage({
      title: "無題",
      quotedMarkdown: "断片",
      pageMarkdown: "",
      question: "これは？",
      isFirstMessage: false,
    });
    expect(msg).toBe("これは？");
  });
});

describe("buildQuotedRetrievalQuery", () => {
  it("検索クエリは引用と質問だけで、背景本文を含めない", () => {
    const q = buildQuotedRetrievalQuery("シリカ管の加熱温度", "この判断は妥当？");
    expect(q).toBe("シリカ管の加熱温度\n\nこの判断は妥当？");
  });

  it("引用が空でも質問だけのクエリになる（余分な空行を作らない）", () => {
    expect(buildQuotedRetrievalQuery("  ", "これは？")).toBe("これは？");
  });
});
