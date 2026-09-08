// @vitest-environment jsdom
// 全画面表示の「このノートに取り込む」のテスト（§25b B-6）。
//
// 対象の不変条件:
// - 出るのは「変更の提案 かつ 宛先のノートの作者が自分」のときだけ。
//   他人の提案を横から取り込む導線は作らない
// - 宛先が共有ライブラリに無い（未読込・共有解除）ときは出さない
//   —— 作者が分からない相手に押せるボタンを出さない
// - 押しても共有フォルダには触らない。呼び出し側へ提案 id と宛先 id を渡すだけ
// - ボタンがあるときは「ここは読むだけです」で終わらせず、取り込みの場所を言う

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

import { render, screen, cleanup, fireEvent } from "@testing-library/react";
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

/** 宛先のノート（作者は先生）。取り込めるのはこの人だけ */
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

/** 学生から先生のノートへ来ている提案 */
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
    title: "焼結の記録（測定値入り）",
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

const MINE = doc("焼結の記録", [para("b1", "1050 ℃ で 2 時間保持した")]);
const THEIRS = doc("焼結の記録（測定値入り）", [para("b1", "1050 ℃ で 3 時間保持した")]);

const NOOP_ASYNC = async () => {};

function renderView(props: Record<string, unknown> = {}) {
  return render(
    <LocaleProvider>
      <SharedNoteView
        entry={PROPOSAL}
        // 既定は「宛先のノートの作者＝自分」の場面
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
        proposalDiff={{ mine: MINE, theirs: THEIRS }}
        {...props}
      />
    </LocaleProvider>,
  );
}

afterEach(() => {
  cleanup();
  localStorage.clear();
});

describe("全画面表示の「このノートに取り込む」", () => {
  it("宛先のノートの作者が自分なら出る", async () => {
    renderView({ onAdoptInNote: () => {} });
    await screen.findByTestId("shared-note-view");
    expect(screen.getByTestId("shared-entry-adopt-in-note")).toBeTruthy();
    expect(screen.getByText(t("proposal.adopt.openInNote"))).toBeTruthy();
  });

  it("押すと提案 id と宛先 id を呼び出し側へ渡す（ここでは取り込まない）", async () => {
    const calls: { proposalId: string; targetId: string }[] = [];
    renderView({ onAdoptInNote: (input: { proposalId: string; targetId: string }) => calls.push(input) });
    await screen.findByTestId("shared-note-view");
    fireEvent.click(screen.getByTestId("shared-entry-adopt-in-note"));
    expect(calls).toEqual([{ proposalId: "proposal-1", targetId: "note-1" }]);
  });

  it("宛先のノートの作者が自分でなければ出さない", async () => {
    renderView({ currentIdentity: STUDENT, onAdoptInNote: () => {} });
    await screen.findByTestId("shared-note-view");
    expect(screen.queryByTestId("shared-entry-adopt-in-note")).toBeNull();
  });

  it("宛先が共有ライブラリに無ければ出さない（作者が分からない）", async () => {
    renderView({ entries: [PROPOSAL], onAdoptInNote: () => {} });
    await screen.findByTestId("shared-note-view");
    expect(screen.queryByTestId("shared-entry-adopt-in-note")).toBeNull();
  });

  it("提案でないエントリには出さない", async () => {
    renderView({ entry: NOTE, proposalDiff: undefined, onAdoptInNote: () => {} });
    await screen.findByTestId("shared-note-view");
    expect(screen.queryByTestId("shared-entry-adopt-in-note")).toBeNull();
  });

  it("受け口が無ければ出さない（読むだけの画面のまま）", async () => {
    renderView();
    await screen.findByTestId("shared-note-view");
    expect(screen.queryByTestId("shared-entry-adopt-in-note")).toBeNull();
    expect(await screen.findByText(t("proposal.diff.readOnly"))).toBeTruthy();
  });

  it("ボタンがあるときは「読むだけ」ではなく取り込みの場所を言う", async () => {
    renderView({ onAdoptInNote: () => {} });
    await screen.findByTestId("proposal-diff-panel");
    expect(screen.getByText(t("proposal.diff.adoptFromHere"))).toBeTruthy();
    expect(screen.queryByText(t("proposal.diff.readOnly"))).toBeNull();
  });
});
