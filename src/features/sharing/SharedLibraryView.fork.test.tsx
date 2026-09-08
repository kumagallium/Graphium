// @vitest-environment jsdom
// Library「プロセス」タブの派生（fork）の成否表示のテスト。
//
// 対象の不変条件:
// - onForkNote が失敗（reject）したら、プロセスタブに失敗表示が出る。
//   共有ノートの fork は新ノート id を返さないので、成否は例外でしか伝わらない。
//   呼び出し側（note-app）が黙って return すると「何も起きていないのに成功に見える」
// - 成功したときは失敗表示を出さない

import { describe, it, expect, afterEach, vi } from "vitest";

// SharedLibraryView は詳細パネル経由でブロック registry を読み込む。
// pdf ビューアは jsdom に無い API（DOMMatrix）を要求するので、他のテストと同じく差し替える
vi.mock("react-pdf", () => ({
  Document: () => null,
  Page: () => null,
  pdfjs: { GlobalWorkerOptions: {} },
}));
vi.mock("../../lib/pdfjs-config", () => ({}));
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { LocaleProvider, t } from "../../i18n";
import { SharedLibraryView } from "./SharedLibraryView";
import {
  __resetSharedProjectionForTest,
  recordSharedProjectionFromBody,
} from "./shared-projection";
import type { SharedLibraryLoadResult } from "./shared-library-loader";
import type { GraphiumDocument } from "../../lib/document-types";
import type { SharedEntry } from "../../lib/storage/shared";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// 手順フロー（@xyflow/react）が大きさを測るのに使う。jsdom には無いので何もしない実装を置く
class NoopResizeObserver {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}
(globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= NoopResizeObserver;

const NOTE: SharedEntry = {
  id: "shared-1",
  type: "note",
  author: { name: "Ada", email: "a@b.co" },
  created_at: "2026-08-01T00:00:00.000Z",
  updated_at: "2026-08-20T00:00:00.000Z",
  hash: "sha256:aaa",
  prov: { derived_from: [] },
  version: 1,
  extra: { title: "焼成の記録" },
} as SharedEntry;

const PROCEDURE_DOC: GraphiumDocument = {
  version: 6,
  title: "焼成の記録",
  pages: [
    {
      id: "p1",
      title: "焼成の記録",
      blocks: [
        {
          id: "s1",
          type: "step",
          content: [{ type: "text", text: "焼成", styles: {} }],
          children: [
            {
              id: "b1",
              type: "paragraph",
              content: [{ type: "text", text: "前駆体粉末", styles: { inlineMaterial: "m1" } }],
              children: [],
            },
          ],
        },
      ],
      labels: {},
      provLinks: [],
      knowledgeLinks: [],
    },
  ],
} as any;

const loadEntries = async (): Promise<SharedLibraryLoadResult> => ({
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
});

function renderProcessTab(onForkNote: (sharedId: string) => Promise<void>) {
  __resetSharedProjectionForTest();
  recordSharedProjectionFromBody(NOTE, new TextEncoder().encode(JSON.stringify(PROCEDURE_DOC)), true);
  return render(
    <LocaleProvider>
      <SharedLibraryView
        sharedRoot="/tmp/shared-root"
        currentIdentity={null}
        onForkNote={onForkNote}
        onForkKnowledge={async () => {}}
        onUnshare={async () => {}}
        onBack={() => {}}
        initialTab="process"
        loadEntries={loadEntries}
      />
    </LocaleProvider>,
  );
}

afterEach(() => {
  cleanup();
  __resetSharedProjectionForTest();
});

describe("プロセスタブの派生", () => {
  it("fork が失敗したら失敗表示を出す（成功したように見せない）", async () => {
    renderProcessTab(async () => {
      throw new Error("shared root is not configured");
    });

    fireEvent.click(await screen.findByText(t("library.forkToNotes")));

    expect(await screen.findByText(t("process.forkFailed"))).toBeTruthy();
  });

  it("fork が成功したら失敗表示は出ない", async () => {
    renderProcessTab(async () => {});

    fireEvent.click(await screen.findByText(t("library.forkToNotes")));
    // 派生中の表示が消える ＝ 一連の処理が終わったところまで待つ
    await screen.findByText(t("library.forkToNotes"));

    expect(screen.queryByText(t("process.forkFailed"))).toBeNull();
  });
});
