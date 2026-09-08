// @vitest-environment jsdom
// 全画面表示の「差分」タブのテスト（§25 D-3）。
//
// 対象の不変条件:
// - 差分タブは変更の提案のときだけ出る（他の種別には比べる相手がいない）
// - 提案を開いたら差分から始まる（提案は「元との違い」が中身そのもの）
// - 基準版があるときだけ「誰が変えたか」を出す。無いときは 2 者比較だと断る
//   —— 分けられないものを分かったように見せない
// - 読むだけであることを毎回言う（取り込みは 8b で作者のノート側）

import { describe, it, expect, afterEach, vi } from "vitest";

// 本文は SharedEntryBody 経由でブロック registry を読み込む。pdf ビューアは
// jsdom に無い API（DOMMatrix）を要求するので、他のテストと同じく差し替える
vi.mock("react-pdf", () => ({
  Document: () => null,
  Page: () => null,
  pdfjs: { GlobalWorkerOptions: {} },
}));
vi.mock("../../lib/pdfjs-config", () => ({}));
vi.mock("../../base/editor", () => ({
  SandboxEditor: () => <div data-testid="sandbox-editor" />,
}));

import { render, screen, cleanup } from "@testing-library/react";
import { LocaleProvider, t } from "../../i18n";
import { SharedNoteView } from "./SharedNoteView";
import { createEmptySharedProjection } from "./shared-projection";
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
const STUDENT = { name: "佐藤 学生", email: "sato@example.ac.jp" };

const NOTE: SharedEntry = {
  id: "note-1",
  type: "note",
  author: TEACHER,
  created_at: "2026-09-01T00:00:00.000Z",
  updated_at: "2026-09-02T00:00:00.000Z",
  hash: "sha256:note",
  prov: { derived_from: [] },
  version: 1,
  extra: { title: "焼結の記録" },
} as SharedEntry;

const PROPOSAL: SharedEntry = {
  id: "proposal-1",
  type: "proposal",
  author: STUDENT,
  created_at: "2026-09-03T00:00:00.000Z",
  updated_at: "2026-09-03T00:00:00.000Z",
  hash: "sha256:proposal",
  prov: { derived_from: ["note-1"] },
  version: 1,
  extra: {
    title: "焼結の記録 (forked)",
    target: "note-1",
    targetHash: "sha256:note",
    targetTitle: "焼結の記録",
  },
} as SharedEntry;

const para = (id: string, text: string) => ({
  id,
  type: "paragraph",
  content: [{ type: "text", text, styles: {} }],
  children: [],
});

const doc = (title: string, blocks: unknown[]): GraphiumDocument =>
  ({
    version: 6,
    title,
    pages: [{ id: "p1", title, blocks, labels: {}, provLinks: [], knowledgeLinks: [] }],
  }) as any;

// 提案者だけが保持時間を書き換えた（base = mine ≠ theirs → by: "theirs"）
const BASE = doc("焼結の記録", [para("b1", "1050 ℃ で 2 時間保持した")]);
const MINE = doc("焼結の記録", [para("b1", "1050 ℃ で 2 時間保持した")]);
const THEIRS = doc("焼結の記録 (forked)", [para("b1", "1050 ℃ で 3 時間保持した")]);

const NOOP_ASYNC = async () => {};

function renderView(props: Record<string, unknown> = {}) {
  return render(
    <LocaleProvider>
      <SharedNoteView
        entry={PROPOSAL}
        currentIdentity={TEACHER}
        sharedRoot="/tmp/shared-root"
        onBack={() => {}}
        onForkNote={NOOP_ASYNC}
        onForkKnowledge={NOOP_ASYNC}
        onUnshare={NOOP_ASYNC}
        entries={[NOTE, PROPOSAL]}
        projection={createEmptySharedProjection()}
        readEntryBody={async () => ({
          body: new TextEncoder().encode(JSON.stringify(THEIRS)),
          verified: true,
        })}
        proposalDiff={{ base: BASE, mine: MINE, theirs: THEIRS }}
        {...props}
      />
    </LocaleProvider>,
  );
}

afterEach(() => {
  cleanup();
  localStorage.clear();
});

describe("全画面表示の差分タブ", () => {
  it("提案は差分タブから始まる", async () => {
    renderView();
    expect(screen.getByTestId("shared-note-rail-diff")).toBeTruthy();
    expect(await screen.findByTestId("proposal-diff-panel")).toBeTruthy();
  });

  it("基準版があるときは「誰が変えたか」を出す（提案者だけの変更＝取り込みの候補）", async () => {
    renderView();
    await screen.findByTestId("proposal-diff-panel");
    expect(screen.getByTestId("proposal-diff-by-theirs")).toBeTruthy();
    expect(screen.getByText(t("proposal.diff.withBase"))).toBeTruthy();
    // 基準版・元のノート・提案の 3 行が並ぶ（基準版と元は同じ値なので 2 件出る）
    expect(screen.getAllByText("1050 ℃ で 2 時間保持した").length).toBe(2);
    expect(screen.getByText("1050 ℃ で 3 時間保持した")).toBeTruthy();
  });

  it("基準版が無いときは 2 者比較だと断り、「誰が変えたか」は出さない", async () => {
    renderView({ proposalDiff: { mine: MINE, theirs: THEIRS } });
    await screen.findByTestId("proposal-diff-panel");
    expect(screen.getByText(t("proposal.diff.noBase"))).toBeTruthy();
    expect(screen.queryByTestId("proposal-diff-by-theirs")).toBeNull();
    expect(screen.queryByTestId("proposal-diff-by-unknown")).toBeNull();
  });

  it("読むだけであることを毎回言う（取り込みは作者のノート側）", async () => {
    renderView();
    await screen.findByTestId("proposal-diff-panel");
    expect(screen.getByText(t("proposal.diff.readOnly"))).toBeTruthy();
  });

  it("違いが無ければ「差分なし」と言う（空の一覧を出さない）", async () => {
    renderView({ proposalDiff: { base: BASE, mine: MINE, theirs: MINE } });
    await screen.findByTestId("proposal-diff-panel");
    expect(screen.getByText(t("proposal.diff.empty"))).toBeTruthy();
  });

  it("提案でないエントリには差分タブを出さない", async () => {
    renderView({ entry: NOTE, proposalDiff: undefined });
    await screen.findByTestId("shared-note-view");
    expect(screen.queryByTestId("shared-note-rail-diff")).toBeNull();
    expect(screen.queryByTestId("proposal-diff-panel")).toBeNull();
  });

  it("提案のメタ（元のノート・状態）は版タブに出る", async () => {
    renderView({ initialRailTab: "version" });
    expect(await screen.findByText(t("library.detail.proposalTarget"))).toBeTruthy();
    // 元の hash と提案が土台にした hash が一致 → 受け付け中
    expect(screen.getByText(t("proposal.status.open"))).toBeTruthy();
  });
});
