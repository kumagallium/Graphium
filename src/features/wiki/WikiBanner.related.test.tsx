// @vitest-environment jsdom
// バナーの「同じ資料を引くページ」の描画: 8 件まで＋「他 N 件」・押すと開く・資料を引かない種別には出ない

import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { WikiBanner } from "./WikiBanner";
import { LocaleProvider } from "../../i18n";
import type { WikiMeta } from "../../lib/document-types";

afterEach(cleanup);

const topicMeta: WikiMeta = {
  kind: "topic",
  derivedFromNotes: ["pdf:a"],
  derivedFromChats: [],
  derivedFromClaims: [],
  topicMarkdown: "## 定義\nx[[source:pdf:a]]",
  generatedAt: "2026-10-20T00:00:00Z",
  generatedBy: { model: "m", version: "1.0.0" },
};

function renderBanner(meta: WikiMeta, relatedPages: { id: string; title: string; shared: number }[], onOpen = vi.fn()) {
  render(
    <LocaleProvider>
      <WikiBanner wikiMeta={meta} onRegenerate={() => {}} onDelete={() => {}} relatedPages={relatedPages} onOpenRelatedPage={onOpen} />
    </LocaleProvider>,
  );
  return onOpen;
}

describe("WikiBanner — 同じ資料を引くページ", () => {
  it("8 件までピルで出し、残りは「他 N 件」。押すとそのページを開く", () => {
    const pages = Array.from({ length: 10 }, (_, i) => ({ id: `p${i}`, title: `ページ ${i}`, shared: 1 }));
    const onOpen = renderBanner(topicMeta, pages);
    const row = screen.getByTestId("wiki-related-pages");
    expect(row.querySelectorAll("button")).toHaveLength(8);
    expect(row.textContent).toContain("2");
    fireEvent.click(row.querySelectorAll("button")[0]);
    expect(onOpen).toHaveBeenCalledWith("p0");
  });

  it("関連ページが無ければ行ごと出ない。知見（claim）には出ない", () => {
    renderBanner(topicMeta, []);
    expect(screen.queryByTestId("wiki-related-pages")).toBeNull();
    cleanup();
    renderBanner({ ...topicMeta, kind: "claim", topicMarkdown: undefined }, [{ id: "x", title: "x", shared: 1 }]);
    expect(screen.queryByTestId("wiki-related-pages")).toBeNull();
  });
});
