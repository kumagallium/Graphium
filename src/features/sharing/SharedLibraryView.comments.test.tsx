// @vitest-environment jsdom
// Library 詳細パネルの「段落を選んでコメントする」導線のテスト。
//
// 対象の不変条件:
// - 選んでいる段落はプレビュー側でも分かる（ノート編集画面の履歴ハイライトと
//   同じ見た目を、このパネルのプレビューにだけ効く動的 <style> で当てる）
// - 同じ段落をもう一度クリックしたら指定が外れる（付け外しは同じ操作）
// - コメントのドックは畳んでも入力欄が残り、段落を選ぶと開く
//   （上の段落を選んでから一番下まで戻る、をさせない）

import { describe, it, expect, afterEach, vi } from "vitest";

// 詳細パネルはブロック registry を読み込む。pdf ビューアは jsdom に無い API
// （DOMMatrix）を要求するので、他のテストと同じく差し替える
vi.mock("react-pdf", () => ({
  Document: () => null,
  Page: () => null,
  pdfjs: { GlobalWorkerOptions: {} },
}));
vi.mock("../../lib/pdfjs-config", () => ({}));
// BlockNote 実体は jsdom で描けないので、ブロックの外枠だけを持つ偽エディタに差し替える。
// 段落の指定はこの外枠（data-id + data-node-type="blockOuter"）を起点にしている
vi.mock("../../base/editor", () => ({
  SandboxEditor: ({ initialContent }: { initialContent: any[] }) => (
    <div>
      {initialContent.map((b) => (
        <div key={b.id} data-id={b.id} data-node-type="blockOuter">
          {b.content?.[0]?.text ?? ""}
        </div>
      ))}
    </div>
  ),
}));

import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { LocaleProvider, t } from "../../i18n";
import { SharedLibraryView } from "./SharedLibraryView";
import type { SharedLibraryLoadResult } from "./shared-library-loader";
import type { GraphiumDocument } from "../../lib/document-types";
import type { SharedEntry } from "../../lib/storage/shared";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

class NoopResizeObserver {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}
(globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= NoopResizeObserver;

const TEACHER = { name: "山田 先生", email: "yamada@example.ac.jp" };

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

const DOC: GraphiumDocument = {
  version: 6,
  title: "焼結の記録",
  pages: [
    {
      id: "p1",
      title: "焼結の記録",
      blocks: [
        {
          id: "b-weigh",
          type: "paragraph",
          content: [{ type: "text", text: "Cu 粉末を秤量した", styles: {} }],
          children: [],
        },
        {
          id: "b-sinter",
          type: "paragraph",
          content: [{ type: "text", text: "1050 ℃ で 2 時間保持した", styles: {} }],
          children: [],
        },
      ],
      labels: {},
      provLinks: [],
      knowledgeLinks: [],
    },
  ],
} as any;

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

function renderView() {
  return render(
    <LocaleProvider>
      <SharedLibraryView
        sharedRoot="/tmp/shared-root"
        currentIdentity={TEACHER}
        onForkNote={NOOP_ASYNC}
        onForkKnowledge={NOOP_ASYNC}
        onUnshare={NOOP_ASYNC}
        onBack={() => {}}
        loadEntries={async () => LOAD_RESULT}
        readEntryBody={async () => ({
          body: new TextEncoder().encode(JSON.stringify(DOC)),
          verified: true,
        })}
        // 一覧から選んだのと同じ状態（詳細パネルを開いた状態）で始める
        focusEntryId="note-1"
      />
    </LocaleProvider>,
  );
}

/** プレビュー用に差し込まれた動的 <style> の中身（無ければ空文字） */
function highlightCss(): string {
  return Array.from(document.head.querySelectorAll("style[data-shared-preview-highlight]"))
    .map((el) => el.textContent ?? "")
    .join("\n");
}

afterEach(() => {
  cleanup();
  document.head.querySelectorAll("style[data-shared-preview-highlight]").forEach((el) => el.remove());
  localStorage.clear();
});

describe("SharedLibraryView 詳細パネル: 段落の指定", () => {
  it("段落をクリックすると、その段落だけが強調され ¶ チップが出る", async () => {
    renderView();

    const block = await screen.findByText("1050 ℃ で 2 時間保持した");
    // 押せることが分かるよう、ノートのプレビューには常時 cursor が付く
    expect(highlightCss()).toContain("cursor: pointer");
    expect(highlightCss()).not.toContain('data-id="b-sinter"');

    fireEvent.click(block);

    const css = highlightCss();
    expect(css).toContain('[data-id="b-sinter"][data-node-type="blockOuter"]');
    // ノート編集画面の highlightBlockIds と同じ見た目
    expect(css).toContain("background: rgba(59, 130, 246, 0.08)");
    expect(css).toContain("border-left: 2px solid rgba(59, 130, 246, 0.5)");
    // 別の段落は強調しない
    expect(css).not.toContain('data-id="b-weigh"');
    expect(screen.getByText(t("comment.anchorPrefix"))).toBeTruthy();
  });

  it("同じ段落をもう一度クリックすると指定が外れて強調も消える", async () => {
    renderView();

    const block = await screen.findByText("1050 ℃ で 2 時間保持した");
    fireEvent.click(block);
    expect(highlightCss()).toContain('data-id="b-sinter"');

    fireEvent.click(block);
    expect(highlightCss()).not.toContain('data-id="b-sinter"');
    expect(screen.queryByText(t("comment.anchorPrefix"))).toBeNull();
  });

  it("コメントのドックは畳んでも入力欄が残り、段落を選んでも畳んだまま抜粋が出る", async () => {
    renderView();
    await screen.findByText("1050 ℃ で 2 時間保持した");

    // 開いている間はスレッド一覧（ここでは 0 件の案内）が見える
    expect(screen.getByText(t("comment.empty"))).toBeTruthy();

    fireEvent.click(screen.getByTitle(t("comment.collapseList")));
    expect(screen.queryByText(t("comment.empty"))).toBeNull();
    // 畳んでも書き始められる
    expect(screen.getByPlaceholderText(t("comment.composerPlaceholder"))).toBeTruthy();

    // 段落を選んでも一覧は畳んだまま（プレビューを縮めて選んだ段落を隠さない）。
    // 入力欄に「この段落に」の指定が出る
    fireEvent.click(screen.getByText("1050 ℃ で 2 時間保持した"));
    expect(screen.queryByText(t("comment.empty"))).toBeNull();
    expect(screen.getByText(t("comment.anchorPrefix"))).toBeTruthy();
    expect(screen.getByTitle(t("comment.expandList"))).toBeTruthy();
  });
});
