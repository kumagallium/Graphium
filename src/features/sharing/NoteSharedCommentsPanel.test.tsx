// @vitest-environment jsdom
// ノート編集画面（学生側）のコメントタブのテスト。
//
// 対象の不変条件:
// - 共有ストアのスナップショットから、対象（sharedRef.id）に付いたコメントだけを
//   本文つきで組み立てる
// - 返信は必ず root の id に付く（返信への返信を作らない）
// - タブを開いたら既読の控え（graphium-shared-seen）に「その版で何件見たか」を書く
// - 対象の hash と違う版に付いたコメントは畳まれる（直したあとに蒸し返さない）
// - identity 未登録なら入力欄を出さず案内文だけ出す
// - カードのクリックは親にブロック id を渡すだけ（エディタに常時の印は出さない）

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, act } from "@testing-library/react";
import { LocaleProvider, t } from "../../i18n";
import type { SharedEntry } from "../../lib/storage/shared";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// vi.mock のファクトリは巻き上げられるため、共有する箱を hoisted で作る
const h = vi.hoisted(() => ({
  entries: [] as unknown[],
  bodies: {} as Record<string, string>,
  notified: 0,
  createCalls: [] as unknown[],
  deleteCalls: [] as unknown[],
}));

vi.mock("./shared-library-store", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./shared-library-store")>();
  return {
    ...actual,
    useSharedLibrary: () => ({
      root: "/shared",
      entries: h.entries,
      errors: {},
      loadedAt: "2026-09-05T00:00:00Z",
      loading: false,
      mismatched: [],
      derived: {},
    }),
    readSharedEntryBody: async (entry: SharedEntry) => ({
      body: new TextEncoder().encode(h.bodies[entry.id] ?? ""),
      verified: true,
    }),
    notifySharedLibraryChanged: () => {
      h.notified += 1;
    },
  };
});

vi.mock("./shared-comments", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./shared-comments")>();
  return {
    ...actual,
    // 書き込みだけ差し替える（読み出し・スレッド組み立ては本物を通す）
    createComment: async (options: unknown) => {
      h.createCalls.push(options);
      return { ok: true as const, entry: {} as SharedEntry };
    },
    deleteComment: async (options: unknown) => {
      h.deleteCalls.push(options);
      return { ok: true as const };
    },
  };
});

const { NoteSharedCommentsPanel } = await import("./NoteSharedCommentsPanel");
const { SHARED_SEEN_KEY } = await import("./shared-seen");

const TEACHER = { name: "Sato", email: "sato@lab.jp" };
const STUDENT = { name: "Tanaka", email: "tanaka@lab.jp" };

const TARGET_ID = "note-1";
const CURRENT_HASH = "sha256:v2";

function commentEntry(
  id: string,
  extra: Record<string, unknown>,
  author = TEACHER,
): SharedEntry {
  return {
    id,
    type: "comment",
    author,
    created_at: "2026-09-01T10:00:00Z",
    updated_at: "2026-09-01T10:00:00Z",
    hash: `sha256:${id}`,
    prov: { derived_from: [TARGET_ID] },
    extra: { target: TARGET_ID, targetHash: CURRENT_HASH, ...extra },
  } as SharedEntry;
}

function renderPanel(overrides: { author?: typeof STUDENT | null; onHighlightBlock?: (b: string | null) => void } = {}) {
  return render(
    <LocaleProvider>
      <NoteSharedCommentsPanel
        targetId={TARGET_ID}
        targetHash={CURRENT_HASH}
        root="/shared"
        author={overrides.author === undefined ? STUDENT : overrides.author}
        onHighlightBlock={overrides.onHighlightBlock}
      />
    </LocaleProvider>,
  );
}

/** 本文の取り寄せ（Promise）が解決するまで待つ */
async function settle() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

beforeEach(() => {
  h.entries = [];
  h.bodies = {};
  h.notified = 0;
  h.createCalls = [];
  h.deleteCalls = [];
  localStorage.clear();
});

afterEach(() => {
  cleanup();
});

describe("NoteSharedCommentsPanel", () => {
  it("対象に付いたコメントを本文つきで出し、他の対象のコメントは出さない", async () => {
    h.entries = [
      commentEntry("c1", {}),
      commentEntry("c9", { target: "other-note" }),
    ];
    h.bodies = { c1: "温度の根拠を足してください。", c9: "別のノートへの指摘" };
    renderPanel();
    await settle();

    expect(screen.getByText("温度の根拠を足してください。")).toBeTruthy();
    expect(screen.queryByText("別のノートへの指摘")).toBeNull();
  });

  it("返信は root の id に付く（返信への返信を作らない）", async () => {
    h.entries = [
      commentEntry("c1", {}),
      commentEntry("c1r1", { parentId: "c1" }, STUDENT),
    ];
    h.bodies = { c1: "根拠が要ります", c1r1: "直しました" };
    renderPanel();
    await settle();

    // 返信ボタンは root にだけ出る
    const replyButtons = screen.getAllByText(t("comment.reply"));
    expect(replyButtons.length).toBe(1);
    fireEvent.click(replyButtons[0]);

    const textareas = screen.getAllByPlaceholderText(t("comment.replyPlaceholder"));
    fireEvent.change(textareas[0], { target: { value: "もう一度直しました" } });
    fireEvent.keyDown(textareas[0], { key: "Enter" });
    await settle();

    expect(h.createCalls.length).toBe(1);
    const call = h.createCalls[0] as { parentId?: string; target: string; targetHash: string; text: string };
    expect(call.parentId).toBe("c1");
    expect(call.target).toBe(TARGET_ID);
    expect(call.targetHash).toBe(CURRENT_HASH);
    expect(call.text).toBe("もう一度直しました");
    expect(h.notified).toBe(1);
  });

  it("開いたときに既読の控えを書く（その版で何件見たか）", async () => {
    h.entries = [commentEntry("c1", {}), commentEntry("c2", {})];
    renderPanel();
    await settle();

    const store = JSON.parse(localStorage.getItem(SHARED_SEEN_KEY) ?? "{}");
    expect(store[TARGET_ID].hash).toBe(CURRENT_HASH);
    expect(store[TARGET_ID].comments).toBe(2);
  });

  it("古い版に付いたコメントは畳んで出す", async () => {
    h.entries = [commentEntry("c-old", { targetHash: "sha256:v1" })];
    h.bodies = { "c-old": "図の軸が読めません" };
    renderPanel();
    await settle();

    expect(screen.queryByText("図の軸が読めません")).toBeNull();
    fireEvent.click(screen.getByText(t("comment.olderVersions", { count: "1" }), { exact: false }));
    expect(screen.getByText("図の軸が読めません")).toBeTruthy();
  });

  it("identity 未登録なら入力欄を出さず案内文を出す", async () => {
    h.entries = [commentEntry("c1", {})];
    h.bodies = { c1: "指摘" };
    renderPanel({ author: null });
    await settle();

    expect(screen.queryByPlaceholderText(t("comment.composerPlaceholder"))).toBeNull();
    expect(screen.getByText(t("comment.identityRequired"))).toBeTruthy();
  });

  it("段落に付いたコメントのクリックで親にブロック id を渡す（再クリックで解除）", async () => {
    h.entries = [commentEntry("c1", { blockId: "b-42", blockText: "800 度で保持" })];
    h.bodies = { c1: "単位が抜けています" };
    const calls: (string | null)[] = [];
    renderPanel({ onHighlightBlock: (b) => calls.push(b) });
    await settle();

    fireEvent.click(screen.getByText("単位が抜けています"));
    expect(calls).toEqual(["b-42"]);
    fireEvent.click(screen.getByText("単位が抜けています"));
    expect(calls).toEqual(["b-42", null]);
  });
});
