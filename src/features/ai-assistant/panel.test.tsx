// @vitest-environment jsdom
// ChatBubble（AI チャットの 1 メッセージ）の回答表示のテスト。
// ノート内チャット・ノートに紐づかないチャット・共有ノートのチャットがすべてこの部品で回答を出す。
//
// 対象の不変条件:
// - 回答の <sup> / <sub> が上付き・下付きで出る（rehypeSupSub が配線されている）
// - 上付きの中の [Source: "..."] も、ほかの本文と同じく開けるリンクになる
// - remark-gfm が脚注参照に作る <sup> も同じ components を通るが、中のリンクごと出る

import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { LocaleProvider } from "../../i18n";
import { ChatBubble, type SourceLinkHandlers } from "./panel";

afterEach(cleanup);

function renderAnswer(content: string, sourceLinks?: SourceLinkHandlers) {
  return render(
    <LocaleProvider>
      <ChatBubble
        message={{ role: "assistant", content, timestamp: "2026-09-25T00:00:00Z" }}
        sourceLinks={sourceLinks}
      />
    </LocaleProvider>,
  );
}

describe("ChatBubble の回答表示", () => {
  it("<sup> / <sub> を上付き・下付きで出し、タグを文字として残さない", () => {
    const { container } = renderAnswer("10<sup>5</sup> Pa で H<sub>2</sub>O を流す");
    expect(container.querySelector("sup")?.textContent).toBe("5");
    expect(container.querySelector("sub")?.textContent).toBe("2");
    expect(container.textContent).toContain("105 Pa で H2O を流す");
  });

  it("上付きの中の [Source: ...] もリンクにする", () => {
    const opened: string[] = [];
    const { container } = renderAnswer('焼結は 1050 ℃ で行う<sup>[Source: "焼結条件"]</sup>', {
      titleToRef: new Map([["焼結条件", "wiki-1"]]),
      onOpenWiki: (id) => opened.push(id),
    });
    const button = container.querySelector<HTMLButtonElement>("sup button");
    expect(button?.textContent).toContain("焼結条件");
    button?.click();
    expect(opened).toEqual(["wiki-1"]);
  });

  it("脚注参照の <sup> は中のリンクごと出る", () => {
    const { container } = renderAnswer("焼結は 1050 ℃ で行う[^1]。\n\n[^1]: 文献値。");
    const ref = container.querySelector('sup > a[href="#user-content-fn-1"]');
    expect(ref?.textContent).toBe("1");
  });
});
