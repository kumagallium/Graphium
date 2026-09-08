// @vitest-environment jsdom
// Library から全画面表示（SharedNoteView）へ入る導線のテスト。
//
// 対象の不変条件（一覧からの入り方は個人のノートの鏡）:
// - 詳細パネル（サイドピーク）の見出しに「開く」があり、そのエントリで onOpenFull を呼ぶ
// - onOpenFull を渡さない環境（全画面を持たない）では「開く」を出さない

import { describe, it, expect, afterEach, vi } from "vitest";

// 詳細パネルはブロック registry を読み込む。pdf ビューアは jsdom に無い API
// （DOMMatrix）を要求するので、他のテストと同じく差し替える
vi.mock("react-pdf", () => ({
  Document: () => null,
  Page: () => null,
  pdfjs: { GlobalWorkerOptions: {} },
}));
vi.mock("../../lib/pdfjs-config", () => ({}));
// BlockNote 実体は jsdom で描けないので、本文は中身を持たない箱に差し替える
vi.mock("../../base/editor", () => ({
  SandboxEditor: () => <div data-testid="fake-editor" />,
}));

import { render, screen, cleanup } from "@testing-library/react";
import { LocaleProvider } from "../../i18n";
import { SharedLibraryView } from "./SharedLibraryView";
import type { SharedLibraryLoadResult } from "./shared-library-loader";
import type { SharedEntry } from "../../lib/storage/shared";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

class NoopResizeObserver {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}
(globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= NoopResizeObserver;

const NOTE: SharedEntry = {
  id: "note-1",
  type: "note",
  author: { name: "佐藤 学生", email: "sato@example.ac.jp" },
  created_at: "2026-08-01T00:00:00.000Z",
  updated_at: "2026-08-20T00:00:00.000Z",
  hash: "sha256:aaa",
  prov: { derived_from: [] },
  version: 1,
  extra: { title: "焼結の記録" },
} as SharedEntry;

const LOAD_RESULT: SharedLibraryLoadResult = {
  entries: {
    note: [NOTE],
    knowledge: [],
    reference: [],
    "data-manifest": [],
    template: [],
    report: [],
    comment: [],
  },
  errors: {},
};

const NOOP_ASYNC = async () => {};

function renderView(onOpenFull?: (entry: SharedEntry) => void) {
  return render(
    <LocaleProvider>
      <SharedLibraryView
        sharedRoot="/tmp/shared-root"
        currentIdentity={null}
        onForkNote={NOOP_ASYNC}
        onForkKnowledge={NOOP_ASYNC}
        onUnshare={NOOP_ASYNC}
        onBack={() => {}}
        onOpenFull={onOpenFull}
        loadEntries={async () => LOAD_RESULT}
        readEntryBody={async () => ({
          body: new TextEncoder().encode("{}"),
          verified: true,
        })}
        // 一覧から選んだのと同じ状態（詳細パネルを開いた状態）で始める
        focusEntryId="note-1"
      />
    </LocaleProvider>,
  );
}

afterEach(() => {
  cleanup();
  localStorage.clear();
});

describe("詳細パネルの「開く」", () => {
  it("選んでいるエントリで onOpenFull を呼ぶ", async () => {
    const opened: string[] = [];
    renderView((entry) => opened.push(entry.id));
    const btn = await screen.findByTestId("shared-detail-open-full");
    btn.click();
    expect(opened).toEqual(["note-1"]);
  });

  it("onOpenFull が無い環境では「開く」を出さない", async () => {
    renderView();
    // 詳細パネルが開くのを待ってから、その中に「開く」が無いことを確かめる
    await screen.findByText("焼結の記録", { selector: "h2" });
    expect(screen.queryByTestId("shared-detail-open-full")).toBeNull();
  });
});
