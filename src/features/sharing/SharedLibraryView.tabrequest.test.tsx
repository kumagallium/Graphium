// @vitest-environment jsdom
// SharedLibraryView の tabRequest（左ナビの共有フォルダ行から開くタブを指定する）のテスト。
// nonce が変わったときだけ表示中のタブが切り替わる（同じタブの再押下も nonce で効く）

import { describe, it, expect, afterEach, vi } from "vitest";

// 詳細パネルはブロック registry を読み込む。pdf ビューアは jsdom に無い API
// （DOMMatrix）を要求するので、他のテストと同じく差し替える
vi.mock("react-pdf", () => ({
  Document: () => null,
  Page: () => null,
  pdfjs: { GlobalWorkerOptions: {} },
}));
vi.mock("../../lib/pdfjs-config", () => ({}));
vi.mock("../../base/editor", () => ({
  SandboxEditor: () => <div data-testid="fake-editor" />,
}));

import { render, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { LocaleProvider } from "../../i18n";
import { SharedLibraryView } from "./SharedLibraryView";
import type { SharedLibraryTab } from "./SharedLibraryTable";
import type { SharedLibraryLoadResult } from "./shared-library-loader";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

class NoopResizeObserver {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}
(globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= NoopResizeObserver;

const EMPTY: SharedLibraryLoadResult = {
  entries: {
    note: [],
    knowledge: [],
    reference: [],
    "data-manifest": [],
    template: [],
    report: [],
    comment: [],
    proposal: [],
  },
  errors: {},
};

const NOOP_ASYNC = async () => {};

type Req = { tab: SharedLibraryTab; nonce: number } | null;

function ui(tabRequest: Req) {
  return (
    <LocaleProvider>
      <SharedLibraryView
        sharedRoot="/tmp/shared-root"
        currentIdentity={null}
        onForkNote={NOOP_ASYNC}
        onForkKnowledge={NOOP_ASYNC}
        onUnshare={NOOP_ASYNC}
        onBack={() => {}}
        loadEntries={async () => EMPTY}
        tabRequest={tabRequest}
      />
    </LocaleProvider>
  );
}

afterEach(() => {
  cleanup();
  localStorage.clear();
});

const tabButtons = (container: HTMLElement) =>
  Array.from(container.querySelectorAll<HTMLButtonElement>(".mt-3.flex button"));
// 選択中のタブだけが font-semibold を持つ
const selectedTabIndex = (container: HTMLElement) =>
  tabButtons(container).findIndex((b) => b.className.includes("font-semibold"));

describe("tabRequest", () => {
  it("nonce が変わると表示中のタブが切り替わり、同じ nonce では戻さない", async () => {
    const { container, rerender } = render(ui(null));
    await waitFor(() => expect(selectedTabIndex(container)).toBe(0));
    rerender(ui({ tab: "knowledge", nonce: 1 }));
    await waitFor(() => expect(selectedTabIndex(container)).toBeGreaterThan(0));
    const knowledgeIdx = selectedTabIndex(container);
    // 手でノートのタブに戻す → 同じ nonce の再 render では依頼を再適用しない
    fireEvent.click(tabButtons(container)[0]);
    rerender(ui({ tab: "knowledge", nonce: 1 }));
    expect(selectedTabIndex(container)).toBe(0);
    // nonce が増えれば同じタブでも効く
    rerender(ui({ tab: "knowledge", nonce: 2 }));
    await waitFor(() => expect(selectedTabIndex(container)).toBe(knowledgeIdx));
  });
});
