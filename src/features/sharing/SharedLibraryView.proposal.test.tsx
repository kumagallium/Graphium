// @vitest-environment jsdom
// Library「提案」タブのテスト（§25 D-1 / D-2 / D-4）。
//
// 対象の不変条件:
// - 提案タブには「元のノート」と「状態」の列が出る（他のタブには出さない）
// - 状態は封筒から導出する。提案が土台にした hash と元の現在の hash が違えば
//   「元のノートがその後更新されました」になる
// - 元のノートの行には「提案 N」が出る（投影ではなく封筒から数えるので、
//   本文をまだ読めていなくても件数が正しい）
// - 提案の詳細パネルには元のノート・基準版・状態が並ぶ
// - 提案が 0 件のときは提案タブ用の言い方で空を出す（素材の文言を出さない）

import { describe, it, expect, afterEach, vi } from "vitest";

// 詳細パネルはブロック registry を読み込む。pdf ビューアは jsdom に無い API を
// 要求するので、他のテストと同じく差し替える
vi.mock("react-pdf", () => ({
  Document: () => null,
  Page: () => null,
  pdfjs: { GlobalWorkerOptions: {} },
}));
vi.mock("../../lib/pdfjs-config", () => ({}));
vi.mock("../../base/editor", () => ({
  SandboxEditor: () => <div data-testid="sandbox-editor" />,
}));

import { render, screen, fireEvent, cleanup, within } from "@testing-library/react";
import { LocaleProvider, t } from "../../i18n";
import { SharedLibraryView } from "./SharedLibraryView";
import { __resetSharedProjectionForTest } from "./shared-projection";
import type { SharedLibraryLoadResult } from "./shared-library-loader";
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
  hash: "sha256:current",
  prov: { derived_from: [] },
  version: 1,
  extra: { title: "焼結の記録" },
} as SharedEntry;

/** 元の現在の版を土台にした提案 → 受け付け中 */
const PROPOSAL_OPEN: SharedEntry = {
  id: "proposal-1",
  type: "proposal",
  author: STUDENT,
  created_at: "2026-09-03T00:00:00.000Z",
  updated_at: "2026-09-03T00:00:00.000Z",
  hash: "sha256:p1",
  prov: { derived_from: ["note-1"] },
  version: 1,
  extra: {
    title: "焼結の記録（測定値入り）",
    target: "note-1",
    targetHash: "sha256:current",
    targetTitle: "焼結の記録",
    message: "保持時間を実測に直しました",
  },
} as SharedEntry;

/** 出したあとに元が更新された提案 → 元のノートがその後更新されました */
const PROPOSAL_STALE: SharedEntry = {
  ...PROPOSAL_OPEN,
  id: "proposal-2",
  hash: "sha256:p2",
  extra: {
    ...(PROPOSAL_OPEN.extra as Record<string, unknown>),
    title: "焼結の記録（昇温速度を追記）",
    targetHash: "sha256:older",
  },
} as SharedEntry;

const load = (proposals: SharedEntry[]): (() => Promise<SharedLibraryLoadResult>) =>
  async () => ({
    entries: {
      note: [NOTE],
      knowledge: [],
      reference: [],
      "data-manifest": [],
      template: [],
      report: [],
      comment: [],
      proposal: proposals,
    },
    errors: {},
  });

function renderLibrary(
  proposals: SharedEntry[] = [PROPOSAL_OPEN, PROPOSAL_STALE],
  props: Record<string, unknown> = {},
) {
  __resetSharedProjectionForTest();
  return render(
    <LocaleProvider>
      <SharedLibraryView
        sharedRoot="/tmp/shared-root"
        currentIdentity={TEACHER}
        onForkNote={async () => {}}
        onForkKnowledge={async () => {}}
        onUnshare={async () => {}}
        onBack={() => {}}
        initialTab="proposal"
        loadEntries={load(proposals)}
        readEntryBody={async () => ({
          body: new TextEncoder().encode("{}"),
          verified: true,
        })}
        {...props}
      />
    </LocaleProvider>,
  );
}

afterEach(() => {
  cleanup();
  __resetSharedProjectionForTest();
  localStorage.clear();
});

describe("Library の提案タブ", () => {
  it("「元のノート」と「状態」の列が出る", async () => {
    renderLibrary();
    expect(await screen.findByText(t("library.col.target"))).toBeTruthy();
    expect(screen.getByText(t("library.col.status"))).toBeTruthy();
    // フォルダ・種別は提案の属性ではないので出さない
    expect(screen.queryByText(t("library.col.kind"))).toBeNull();
  });

  it("元のノートの題名を各行に出す（元が消えても何への提案か分かる）", async () => {
    renderLibrary();
    const cells = await screen.findAllByText("焼結の記録");
    expect(cells.length).toBe(2);
  });

  it("状態は封筒から導く（土台にした版が古ければ「その後更新されました」）", async () => {
    renderLibrary();
    expect(await screen.findByTestId("proposal-status-open")).toBeTruthy();
    expect(screen.getByTestId("proposal-status-stale")).toBeTruthy();
  });

  it("「元のノート」を押すと元のエントリを開く", async () => {
    renderLibrary();
    const targets = await screen.findAllByTitle("焼結の記録");
    fireEvent.click(targets[0]);
    // 詳細パネルが元のノートの題名で開く（見出しは h2）
    expect(await screen.findByRole("heading", { name: "焼結の記録" })).toBeTruthy();
  });

  it("提案が 0 件なら提案タブ用の空表示を出す", async () => {
    renderLibrary([]);
    expect(await screen.findByText(t("library.empty.proposal"))).toBeTruthy();
  });

  it("元のノートの行には「提案 N」が出る", async () => {
    renderLibrary([PROPOSAL_OPEN, PROPOSAL_STALE], { initialTab: "note" });
    expect(await screen.findByText(t("library.proposalCount", { count: "2" }))).toBeTruthy();
  });

  it("詳細パネルに元のノート・基準版・状態・説明が並ぶ", async () => {
    renderLibrary();
    fireEvent.click(await screen.findByText("焼結の記録（測定値入り）"));
    const panel = await screen.findByRole("heading", { name: "焼結の記録（測定値入り）" });
    const detail = panel.closest("div.relative") as HTMLElement;
    expect(within(detail).getByText(t("library.detail.proposalTarget"))).toBeTruthy();
    expect(within(detail).getByText(t("library.detail.proposalStatus"))).toBeTruthy();
    // 基準版の blob を持たない提案なので「控えなし」
    expect(within(detail).getByText(t("library.detail.proposalBaseNone"))).toBeTruthy();
    expect(within(detail).getByText("保持時間を実測に直しました")).toBeTruthy();
  });

  it("元のノートの詳細パネルには逆引きの「提案 N」が並ぶ", async () => {
    renderLibrary([PROPOSAL_OPEN, PROPOSAL_STALE], { initialTab: "note" });
    fireEvent.click(await screen.findByText("焼結の記録"));
    expect(
      await screen.findByText(t("library.detail.proposals", { count: "2" })),
    ).toBeTruthy();
  });
});
