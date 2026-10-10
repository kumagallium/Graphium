// @vitest-environment jsdom
// 一覧の「…」メニュー: Asterism 連携がオフなら書き出し項目を出さない（asterismEnabled のゲート）
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { WikiListView } from "./WikiListView";
import { LocaleProvider } from "../../i18n";
import type { WikiMetaSummary } from "../../lib/document-types";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
afterEach(cleanup);

function renderList(asterismEnabled: boolean | undefined) {
  const metas = new Map<string, WikiMetaSummary>([["c1", { title: "知見1", kind: "claim" }]]);
  return render(
    <LocaleProvider>
      <WikiListView
        noteIndex={null}
        wikiKind="claim"
        wikiFiles={[{ id: "c1", name: "知見1", modifiedTime: "2026-01-01T00:00:00Z", createdTime: "2026-01-01T00:00:00Z" }]}
        wikiMetas={metas}
        onOpenWiki={() => {}}
        onBack={() => {}}
        onDeleteWiki={async () => {}}
        onAsterismExport={() => {}}
        asterismEnabled={asterismEnabled}
      />
    </LocaleProvider>,
  );
}

const trigger = () => document.querySelector<HTMLButtonElement>('button[aria-haspopup="menu"]');

describe("WikiListView の Asterism 書き出し項目", () => {
  it("連携オフ（既定）ではメニュー自体が出ない", () => {
    renderList(undefined);
    expect(trigger()).toBeNull();
    cleanup();
    renderList(false);
    expect(trigger()).toBeNull();
  });
  it("連携オンなら書き出し項目が出る", () => {
    renderList(true);
    fireEvent.click(trigger()!);
    expect(screen.getAllByRole("menuitem")).toHaveLength(1);
  });
});
