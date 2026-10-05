// @vitest-environment jsdom
// WikiLogView（読むだけのログ画面）のテスト

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { LocaleProvider, syncLocale, t } from "../../i18n";
import { WikiLogView } from "./WikiLogView";
import { wikiLog } from "./wiki-log";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

beforeEach(() => {
  syncLocale("ja");
  vi.spyOn(wikiLog, "getRecent").mockResolvedValue([]);
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  syncLocale("en");
});

function renderView(onOpenWiki = vi.fn()) {
  render(
    <LocaleProvider>
      <WikiLogView onBack={() => {}} onOpenWiki={onOpenWiki} />
    </LocaleProvider>,
  );
  return { onOpenWiki };
}

describe("WikiLogView（読むだけの画面）", () => {
  it("ログの種別 restore を出せる（アイコン・色の対応がある）", async () => {
    vi.mocked(wikiLog.getRecent).mockResolvedValue([
      {
        id: "e1",
        timestamp: new Date().toISOString(),
        type: "restore",
        wikiIds: ["w1"],
        summary: "Restored \"x\" to an earlier version",
      },
    ]);
    renderView();
    await waitFor(() => expect(screen.getByText("restore")).toBeTruthy());
  });
});
