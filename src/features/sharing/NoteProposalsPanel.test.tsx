// @vitest-environment jsdom
// ノート編集画面（元の作者側）の「提案」タブのテスト。
//
// 対象の不変条件:
// - 一覧には対象（sharedRef.id）に来ている提案だけが並ぶ
// - 比べる相手は共有コピーではなく **いま開いているノートの最新本文**（resolveMine）
// - 既定で選ばれるのは「提案者だけが変えた」項目。元の作者が変えた項目には
//   チェックボックスを出さない（取り込む相手がいない）
// - 「選んだ変更を取り込む」は選択をそのまま呼び出し側へ渡す（適用は note-app の仕事）
// - タブを開いたら既読の控え（graphium-shared-seen）に提案の件数を書く

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import { LocaleProvider, t } from "../../i18n";
import type { GraphiumDocument } from "../../lib/document-types";
import type { BlobRef, SharedEntry } from "../../lib/storage/shared";
import { NoteProposalsPanel, type AdoptProposalRequest } from "./NoteProposalsPanel";
import { SHARED_SEEN_KEY } from "./shared-seen";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const TARGET_ID = "note-1";
const TARGET_HASH = "sha256:v2";
const AUTHOR = { name: "Tanaka", email: "tanaka@lab.jp" };

const BASE_REF: BlobRef = {
  provider: "local-folder",
  uri: "file:///blobs/base.json",
  hash: "sha256:base",
  size: 10,
  filename: "base.json",
};

function doc(blocks: any[], title = "焼結の記録"): GraphiumDocument {
  return {
    version: 5,
    title,
    pages: [{ id: "main", title, blocks, labels: {}, provLinks: [], knowledgeLinks: [] }],
    createdAt: "2026-09-01T00:00:00Z",
    modifiedAt: "2026-09-01T00:00:00Z",
  } as GraphiumDocument;
}

function paragraph(id: string, text: string) {
  return { id, type: "paragraph", props: {}, content: [{ type: "text", text, styles: {} }], children: [] };
}

/** 基準版: b1 だけ */
const BASE_DOC = doc([paragraph("b1", "600 度")]);
/** 提案: b1 を書き換えた（＝提案者だけが変えた） */
const THEIRS_DOC = doc([paragraph("b1", "650 度")]);
/** 手元: b1 は基準版のまま、b2 を自分で足した（＝元の作者だけが変えた） */
const MINE_DOC = doc([paragraph("b1", "600 度"), paragraph("b2", "炉は A 号機")]);

const TARGET: SharedEntry = {
  id: TARGET_ID,
  type: "note",
  author: { name: "Sato", email: "sato@lab.jp" },
  created_at: "2026-09-01T00:00:00Z",
  updated_at: "2026-09-01T00:00:00Z",
  hash: TARGET_HASH,
  prov: { derived_from: [] },
  extra: { title: "焼結の記録" },
} as SharedEntry;

function proposalEntry(id: string, over: Record<string, unknown> = {}): SharedEntry {
  return {
    id,
    type: "proposal",
    author: AUTHOR,
    created_at: "2026-09-02T09:00:00Z",
    updated_at: "2026-09-02T09:00:00Z",
    hash: `sha256:${id}`,
    prov: { derived_from: [TARGET_ID] },
    extra: {
      title: "温度の訂正",
      target: TARGET_ID,
      targetHash: TARGET_HASH,
      targetTitle: "焼結の記録",
      message: "実際は 650 度でした",
      baseRef: BASE_REF,
      ...over,
    },
  } as SharedEntry;
}

const ENTRIES = [TARGET, proposalEntry("prop-1")];

function readBody(entry: SharedEntry) {
  return Promise.resolve({
    body: new TextEncoder().encode(JSON.stringify(THEIRS_DOC)),
    verified: true,
  });
}

function readBlob(_ref: BlobRef) {
  return Promise.resolve(new TextEncoder().encode(JSON.stringify(BASE_DOC)));
}

function renderPanel(
  over: Partial<React.ComponentProps<typeof NoteProposalsPanel>> = {},
) {
  return render(
    <LocaleProvider>
      <NoteProposalsPanel
        targetId={TARGET_ID}
        targetHash={TARGET_HASH}
        entries={ENTRIES}
        resolveMine={async () => MINE_DOC}
        readBody={readBody}
        readBlob={readBlob}
        {...over}
      />
    </LocaleProvider>,
  );
}

beforeEach(() => {
  localStorage.clear();
});
afterEach(cleanup);

describe("NoteProposalsPanel — 一覧", () => {
  it("対象に来ている提案が作者・説明つきで並ぶ", () => {
    renderPanel();
    expect(screen.getByTestId("note-proposal-row-prop-1")).toBeTruthy();
    expect(screen.getByText("温度の訂正")).toBeTruthy();
    expect(screen.getByText("実際は 650 度でした")).toBeTruthy();
    expect(screen.getByText(t("proposal.status.open"))).toBeTruthy();
  });

  it("別のノートへの提案は出さない", () => {
    renderPanel({
      entries: [TARGET, proposalEntry("prop-other", { target: "someone-else" })],
    });
    expect(screen.queryByTestId("note-proposal-row-prop-other")).toBeNull();
    expect(screen.getByText(t("proposal.adopt.empty"))).toBeTruthy();
  });

  it("タブを開いた時点で既読の控えに件数を書く", () => {
    renderPanel();
    const store = JSON.parse(localStorage.getItem(SHARED_SEEN_KEY) ?? "{}");
    expect(store[TARGET_ID]?.proposals).toBe(1);
    expect(store[TARGET_ID]?.hash).toBe(TARGET_HASH);
  });
});

describe("NoteProposalsPanel — 差分と選択", () => {
  it("提案者だけが変えた項目は既定でチェックが入る", async () => {
    renderPanel({ onAdopt: async () => ({ applied: 1, skipped: [] }) });
    fireEvent.click(screen.getByTestId("note-proposal-row-prop-1"));
    // findByTestId は「出てきたこと」しか待たない。checked は本文と差分が
    // 揃ってから決まるので、値そのものが決まるまで待つ
    await waitFor(() => {
      const box = screen.getByTestId("proposal-select-block:b1") as HTMLInputElement;
      expect(box.checked).toBe(true);
    });
  });

  it("チェックは描かれた最初の瞬間から入っている（一瞬だけ外れて見えない）", async () => {
    // 既定の選択をコミット後（useEffect）に入れると、チェックボックスが
    // 「全部外れた状態」で一度描かれてから入る。その一瞬を拾うと CI で落ちる。
    // DOM に現れた最初のコミットの checked を記録して、待ち方に頼らず押さえる
    let firstChecked: boolean | null = null;
    const observer = new MutationObserver(() => {
      if (firstChecked !== null) return;
      const el = document.querySelector('[data-testid="proposal-select-block:b1"]');
      if (el) firstChecked = (el as HTMLInputElement).checked;
    });
    observer.observe(document.body, { childList: true, subtree: true, attributes: true });
    try {
      renderPanel({ onAdopt: async () => ({ applied: 1, skipped: [] }) });
      fireEvent.click(screen.getByTestId("note-proposal-row-prop-1"));
      await screen.findByTestId("proposal-select-block:b1");
    } finally {
      observer.disconnect();
    }
    expect(firstChecked).toBe(true);
  });

  it("元の作者だけが変えた項目にはチェックボックスを出さない", async () => {
    renderPanel({ onAdopt: async () => ({ applied: 1, skipped: [] }) });
    fireEvent.click(screen.getByTestId("note-proposal-row-prop-1"));
    await screen.findByTestId("proposal-select-block:b1");
    // b2 は手元だけにあるブロック（差分では removed / by: mine）
    expect(screen.queryByTestId("proposal-select-block:@m1")).toBeNull();
    expect(screen.queryByTestId("proposal-select-block:b2")).toBeNull();
  });

  it("元の作者側の項目は作者から見た向きの文言で出す（足したものが「削除」と読めない）", async () => {
    renderPanel({ onAdopt: async () => ({ applied: 1, skipped: [] }) });
    fireEvent.click(screen.getByTestId("note-proposal-row-prop-1"));
    await screen.findByTestId("proposal-select-block:b1");
    expect(screen.getByText(t("proposal.diff.kindMine.removed"))).toBeTruthy();
  });

  it("取り込みボタンが選択をそのまま呼び出し側へ渡す", async () => {
    const calls: AdoptProposalRequest[] = [];
    renderPanel({
      onAdopt: async (request) => {
        calls.push(request);
        return { applied: 1, skipped: [] };
      },
    });
    fireEvent.click(screen.getByTestId("note-proposal-row-prop-1"));
    const button = (await screen.findByTestId(
      "note-proposal-adopt",
    )) as HTMLButtonElement;
    // ボタンは本文と差分が揃う前から DOM にあり、その間は disabled。
    // 現れた瞬間に押すと、遅い環境ではクリックが素通りして何も起きない
    // （CI で再現。手元では取得が速く、たまたま通っていた）
    await waitFor(() => expect(button.disabled).toBe(false));
    fireEvent.click(button);
    await waitFor(() => expect(calls.length).toBe(1));
    expect(calls[0].proposalId).toBe("prop-1");
    // 比べた元は共有コピーではなく手元の本文
    expect(calls[0].mine.pages[0].blocks.length).toBe(2);
    expect([...calls[0].selected]).toEqual(["block:b1"]);
  });

  it("取り込みの口が無ければチェックボックスもボタンも出さない（読むだけ）", async () => {
    renderPanel();
    fireEvent.click(screen.getByTestId("note-proposal-row-prop-1"));
    await screen.findByTestId("proposal-diff-panel");
    await waitFor(() =>
      expect(screen.getByText(t("proposal.diff.readOnly"))).toBeTruthy(),
    );
    expect(screen.queryByTestId("note-proposal-adopt")).toBeNull();
    expect(screen.queryByTestId("proposal-select-block:b1")).toBeNull();
  });

  it("一覧へ戻れる", async () => {
    const highlights: (string | null)[] = [];
    renderPanel({ onHighlightBlock: (id) => highlights.push(id) });
    fireEvent.click(screen.getByTestId("note-proposal-row-prop-1"));
    await screen.findByTestId("note-proposal-detail");
    fireEvent.click(screen.getByText(`← ${t("proposal.adopt.back")}`));
    expect(screen.getByTestId("note-proposals-panel")).toBeTruthy();
    // 戻るときにハイライトを残さない
    expect(highlights).toContain(null);
  });
});

describe("NoteProposalsPanel — 指名して開く（§25b B-6）", () => {
  it("initialProposalId を渡すと、その提案を開いた状態で始まる", async () => {
    renderPanel({ initialProposalId: "prop-1" });
    expect(await screen.findByTestId("note-proposal-detail")).toBeTruthy();
    expect(screen.queryByTestId("note-proposals-panel")).toBeNull();
  });

  it("開いたことを知らせる（呼び出し側が指定を落とせる）", async () => {
    const opened: number[] = [];
    renderPanel({ initialProposalId: "prop-1", onInitialProposalOpened: () => opened.push(1) });
    await screen.findByTestId("note-proposal-detail");
    expect(opened.length).toBeGreaterThan(0);
  });

  it("指名が無ければこれまでどおり一覧から始まる", () => {
    renderPanel();
    expect(screen.getByTestId("note-proposals-panel")).toBeTruthy();
  });
});

describe("NoteProposalsPanel — 状態", () => {
  it("取り込み済みの提案は状態バッジで分かる", () => {
    const adoptedTarget = {
      ...TARGET,
      extra: { ...(TARGET.extra as object), adoptedProposals: ["prop-1"] },
    } as SharedEntry;
    renderPanel({ entries: [adoptedTarget, proposalEntry("prop-1")] });
    expect(screen.getByText(t("proposal.status.adopted"))).toBeTruthy();
  });
});
