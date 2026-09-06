// @vitest-environment jsdom
// 全画面表示から子部品への配線のテスト。
//
// 対象の不変条件:
// - コメントのパネルには「解決済みの一覧」を渡す。生の DI prop（未指定なら undefined）を
//   そのまま渡すと SharedEntryComments の中でもう一度 useSharedLibrary が走り、
//   同じストアを 2 本購読して更新のたびに二重で再計算することになる

import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";

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

// 受け取った props だけを控える偽のコメントパネル（配線そのものを見る）
const commentsProps = vi.hoisted(() => ({ last: null as Record<string, unknown> | null }));
vi.mock("./SharedEntryComments", () => ({
  SharedEntryComments: (props: Record<string, unknown>) => {
    commentsProps.last = props;
    return <div data-testid="comments-mock" />;
  },
}));

import { render, screen, cleanup, waitFor } from "@testing-library/react";
import { LocaleProvider } from "../../i18n";
import { SharedNoteView } from "./SharedNoteView";
import { createEmptySharedProjection } from "./shared-projection";
import {
  __setSharedLibraryLoaderForTest,
  groupSharedEntriesByType,
  refreshSharedLibrary,
} from "./shared-library-store";
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

const COMMENT: SharedEntry = {
  id: "comment-1",
  type: "comment",
  author: TEACHER,
  created_at: "2026-08-21T00:00:00.000Z",
  updated_at: "2026-08-21T00:00:00.000Z",
  hash: "sha256:ccc",
  prov: { derived_from: [] },
  extra: { target: { id: "note-1", hash: "sha256:aaa" } },
} as SharedEntry;

const NOOP_ASYNC = async () => {};

beforeEach(async () => {
  commentsProps.last = null;
  // 共有ストアに一覧を仕込む（DI 未指定のときの解決先）
  __setSharedLibraryLoaderForTest(
    async () => ({ entries: groupSharedEntriesByType([NOTE, COMMENT]), errors: {} }),
    { root: "/tmp/shared-root" },
  );
  await refreshSharedLibrary();
});

afterEach(() => {
  cleanup();
  __setSharedLibraryLoaderForTest(null, { root: null });
  localStorage.clear();
});

describe("SharedNoteView からコメントパネルへの配線", () => {
  it("DI 未指定でも解決済みの一覧を渡す（共有ストアを二重に購読しない）", async () => {
    render(
      <LocaleProvider>
        <SharedNoteView
          entry={NOTE}
          currentIdentity={TEACHER}
          sharedRoot="/tmp/shared-root"
          onBack={() => {}}
          onForkNote={NOOP_ASYNC}
          onForkKnowledge={NOOP_ASYNC}
          onUnshare={NOOP_ASYNC}
          projection={createEmptySharedProjection()}
          readEntryBody={async () => ({
            body: new TextEncoder().encode("{}"),
            verified: true,
          })}
        />
      </LocaleProvider>,
    );
    await screen.findByTestId("comments-mock");

    await waitFor(() => {
      const entries = commentsProps.last?.entries as readonly SharedEntry[] | undefined;
      expect(entries).toBeTruthy();
      // 解決済み ＝ ストアのスナップショット（封筒も含む）が届いている
      expect(entries?.map((e) => e.id).sort()).toEqual(["comment-1", "note-1"]);
    });
  });
});
