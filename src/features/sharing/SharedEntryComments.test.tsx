// @vitest-environment jsdom
// 共有エントリのコメント節（Library の詳細パネル / ノートのコメントタブの中身）のテスト。
//
// 対象の不変条件:
// - 封筒だけでは本文が出ない。本文は取り寄せた分がスレッドに出る
// - 対象の版が変わったコメントは「古い版へのコメント」に畳まれる（解決フラグを持たない代わり）
// - 投稿は共有ルートと自分の identity で書かれ、段落の指定（¶）が封筒に載る
// - identity 未登録では入力欄を出さず、理由を出す（黙って失敗させない）
// - 節を見たら既読の控え（graphium-shared-seen）に「その時点の件数」が残る

import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import { LocaleProvider, t } from "../../i18n";
import { SharedEntryComments } from "./SharedEntryComments";
import { SHARED_SEEN_KEY, parseSeenStore } from "./shared-seen";
import type { SharedCommentProvider } from "./shared-comments";
import type { SharedEntry } from "../../lib/storage/shared";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const TEACHER = { name: "山田 先生", email: "yamada@example.ac.jp" };
const STUDENT = { name: "佐藤 学生", email: "sato@example.ac.jp" };

const TARGET_ID = "note-1";
const CURRENT_HASH = "sha256:current";
const OLD_HASH = "sha256:old";

function comment(
  id: string,
  extra: Record<string, unknown>,
  author = TEACHER,
  createdAt = "2026-09-01T00:00:00.000Z",
): SharedEntry {
  return {
    id,
    type: "comment",
    author,
    created_at: createdAt,
    updated_at: createdAt,
    hash: `sha256:${id}`,
    prov: { derived_from: [TARGET_ID] },
    extra,
  };
}

const ENTRIES: SharedEntry[] = [
  comment("c1", { target: TARGET_ID, targetHash: CURRENT_HASH }),
  comment("c2", { target: TARGET_ID, targetHash: CURRENT_HASH, parentId: "c1" }, STUDENT, "2026-09-02T00:00:00.000Z"),
  comment("c3", {
    target: TARGET_ID,
    targetHash: OLD_HASH,
    blockId: "b1",
    blockText: "焼結温度は 900 ℃",
  }),
  // 別の対象に付いたコメント（混ざってはいけない）
  comment("c4", { target: "note-2", targetHash: CURRENT_HASH }),
];

const TEXTS: Record<string, string> = {
  c1: "この条件の根拠は？",
  c2: "参考文献を足しました",
  c3: "温度の単位が抜けています",
  c4: "別のノートへの指摘",
};

const readBody = async (entry: SharedEntry) => ({
  body: new TextEncoder().encode(TEXTS[entry.id] ?? ""),
  verified: true,
});

/** 書き込みを記録するだけの Provider（共有フォルダには触らない） */
function fakeProvider() {
  const writes: { entry: SharedEntry; text: string }[] = [];
  const deletes: string[] = [];
  const provider: SharedCommentProvider = {
    read: async (id: string) => {
      const hit = ENTRIES.find((e) => e.id === id);
      if (!hit) throw new Error(`not found: ${id}`);
      return { entry: hit, body: new TextEncoder().encode(TEXTS[id] ?? "") };
    },
    write: async (entry, content) => {
      writes.push({ entry, text: new TextDecoder().decode(content) });
    },
    delete: async (id) => {
      deletes.push(id);
    },
  };
  return { provider, writes, deletes };
}

function renderComments(
  overrides: Partial<React.ComponentProps<typeof SharedEntryComments>> = {},
) {
  return render(
    <LocaleProvider>
      <SharedEntryComments
        targetId={TARGET_ID}
        targetHash={CURRENT_HASH}
        sharedRoot="/tmp/shared-root"
        currentIdentity={TEACHER}
        entries={ENTRIES}
        readBody={readBody}
        {...overrides}
      />
    </LocaleProvider>,
  );
}

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("SharedEntryComments", () => {
  it("対象に付いたコメントだけを本文つきで出す", async () => {
    renderComments();

    expect(await screen.findByText("この条件の根拠は？")).toBeTruthy();
    expect(screen.getByText("参考文献を足しました")).toBeTruthy();
    // 別の対象のコメントは出さない
    expect(screen.queryByText("別のノートへの指摘")).toBeNull();
  });

  it("見出しに返信を含む通し数を出す", async () => {
    renderComments();
    // c1 / c2 / c3（c4 は別対象）
    expect(await screen.findByText(t("comment.countLabel", { count: "3" }))).toBeTruthy();
  });

  it("古い版に付いたコメントは畳まれ、開くと出る", async () => {
    renderComments();

    await screen.findByText("この条件の根拠は？");
    expect(screen.queryByText("温度の単位が抜けています")).toBeNull();

    fireEvent.click(screen.getByText(t("comment.olderVersions", { count: "1" }), { exact: false }));
    expect(screen.getByText("温度の単位が抜けています")).toBeTruthy();
  });

  it("投稿すると共有ルート・自分の identity・段落の指定が封筒に載る", async () => {
    const { provider, writes } = fakeProvider();
    renderComments({
      provider,
      pendingAnchor: { blockId: "b9", blockText: "測定条件" },
    });

    const textarea = (await screen.findAllByPlaceholderText(t("comment.composerPlaceholder")))[0];
    fireEvent.change(textarea, { target: { value: "ここに単位を足してください" } });
    fireEvent.keyDown(textarea, { key: "Enter" });

    await waitFor(() => expect(writes.length).toBe(1));
    expect(writes[0].text).toBe("ここに単位を足してください");
    expect(writes[0].entry.type).toBe("comment");
    expect(writes[0].entry.author.email).toBe(TEACHER.email);
    expect(writes[0].entry.extra).toMatchObject({
      target: TARGET_ID,
      targetHash: CURRENT_HASH,
      blockId: "b9",
      blockText: "測定条件",
    });
  });

  it("投稿に成功したら段落の指定を使い切る（次のコメントに引きずらない）", async () => {
    const { provider } = fakeProvider();
    const onClearAnchor = vi.fn();
    renderComments({
      provider,
      pendingAnchor: { blockId: "b9", blockText: "測定条件" },
      onClearAnchor,
    });

    const textarea = (await screen.findAllByPlaceholderText(t("comment.composerPlaceholder")))[0];
    fireEvent.change(textarea, { target: { value: "単位を足してください" } });
    fireEvent.keyDown(textarea, { key: "Enter" });

    await waitFor(() => expect(onClearAnchor).toHaveBeenCalled());
  });

  it("identity 未登録では入力欄を出さず理由を出す", async () => {
    renderComments({ currentIdentity: null });

    expect(await screen.findByText(t("comment.identityRequired"))).toBeTruthy();
    expect(screen.queryByPlaceholderText(t("comment.composerPlaceholder"))).toBeNull();
  });

  it("書けなかったときは黙らず理由を出す", async () => {
    const { provider } = fakeProvider();
    const failing: SharedCommentProvider = {
      ...provider,
      write: async () => {
        throw new Error("permission denied");
      },
    };
    renderComments({ provider: failing });

    const textarea = (await screen.findAllByPlaceholderText(t("comment.composerPlaceholder")))[0];
    fireEvent.change(textarea, { target: { value: "書けないコメント" } });
    fireEvent.keyDown(textarea, { key: "Enter" });

    expect(
      await screen.findByText(t("comment.actionFailed", { error: "permission denied" })),
    ).toBeTruthy();
  });

  it("見たら既読の控えに版と件数が残る", async () => {
    renderComments();
    await screen.findByText("この条件の根拠は？");

    await waitFor(() => {
      const store = parseSeenStore(localStorage.getItem(SHARED_SEEN_KEY));
      expect(store[TARGET_ID]).toMatchObject({ hash: CURRENT_HASH, comments: 3 });
    });
  });
});
