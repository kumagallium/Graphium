// @vitest-environment jsdom
// 共有コメントのスレッド UI（表示専用部品）のテスト。
//
// 対象の不変条件:
// - 埋め込み先が 2 か所（Library の詳細パネル / ノートのコメントタブ）なので、
//   スレッド全体に「コメント」の見出しを持つ（読み上げ用）
// - 「古い版へのコメント」は畳んだまま本文を画面に出さない（直したはずの指摘を
//   ずっと見せない）。中身の見当はポインタを載せたときだけ（1 行要約と返信数）

import { describe, it, expect, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { LocaleProvider, t } from "../../i18n";
import { SharedCommentsThread } from "./SharedCommentsThread";
import type { CommentThread, SharedComment } from "./shared-comments";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const TEACHER = { name: "山田 先生", email: "yamada@example.ac.jp" };
const STUDENT = { name: "佐藤 学生", email: "sato@example.ac.jp" };

const CURRENT_HASH = "sha256:current";
const OLD_HASH = "sha256:old";

const comment = (over: Partial<SharedComment> & { id: string }): SharedComment => ({
  author: TEACHER,
  createdAt: "2026-09-01T00:00:00.000Z",
  updatedAt: "2026-09-01T00:00:00.000Z",
  text: "",
  target: "note-1",
  targetHash: CURRENT_HASH,
  ...over,
});

const threads: CommentThread[] = [
  { root: comment({ id: "c1", text: "この条件の根拠は？" }), replies: [] },
  {
    root: comment({
      id: "c-old",
      targetHash: OLD_HASH,
      createdAt: "2026-08-01T00:00:00.000Z",
      // 1 行目だけが要約に出る（2 行目以降は畳んだ状態では見せない）
      text: "図 2 の軸ラベルが読めません\n作り直して差し替えてください",
    }),
    replies: [
      comment({
        id: "c-old-r",
        author: STUDENT,
        targetHash: OLD_HASH,
        createdAt: "2026-08-02T00:00:00.000Z",
        text: "差し替えました",
      }),
    ],
  },
];

const noop = async () => {};

function renderThread(over: Partial<React.ComponentProps<typeof SharedCommentsThread>> = {}) {
  return render(
    <LocaleProvider>
      <SharedCommentsThread
        threads={threads}
        currentHash={CURRENT_HASH}
        currentIdentity={TEACHER}
        onReply={noop}
        onEdit={noop}
        onDelete={noop}
        onCreate={noop}
        {...over}
      />
    </LocaleProvider>,
  );
}

afterEach(() => cleanup());

/** 「古い版へのコメント（N）」の畳み行 */
const olderToggle = (): HTMLElement =>
  screen.getByRole("button", {
    name: new RegExp(t("comment.olderVersions", { count: "1" }).replace(/[()（）]/g, ".")),
  });

describe("SharedCommentsThread", () => {
  it("スレッド全体に「コメント」の見出しを持つ（2 か所に埋め込まれるため）", () => {
    renderThread();
    expect(screen.getByRole("region", { name: t("comment.title") })).toBeTruthy();
  });

  it("畳んだ行のヒントに、いちばん新しい指摘の 1 行要約と返信数を持つ", () => {
    renderThread();
    const toggle = olderToggle();
    // 画面には本文を出さない（畳んだ意味が無くなる）
    expect(toggle.textContent).not.toContain("図 2 の軸ラベルが読めません");
    const hint = toggle.getAttribute("title") ?? "";
    expect(hint).toContain("図 2 の軸ラベルが読めません");
    // 2 行目は要約に含めない
    expect(hint).not.toContain("作り直して差し替えてください");
    expect(hint).toContain(t("comment.replyCount", { count: "1" }));

    // 開けば本文が出るので、ヒントは外す
    fireEvent.click(toggle);
    expect(toggle.getAttribute("title")).toBeNull();
    expect(screen.getByText("差し替えました")).toBeTruthy();
  });

  it("本文をまだ読めていない古い版のスレッドではヒントを付けない", () => {
    renderThread({
      threads: [
        threads[0],
        { root: comment({ id: "c-old", targetHash: OLD_HASH, text: "" }), replies: [] },
      ],
    });
    expect(olderToggle().getAttribute("title")).toBeNull();
  });
});
