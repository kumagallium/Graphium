// @vitest-environment jsdom
// 「元のノートへ変更を提案」ダイアログのテスト（§25 C-3）と、note-app からの配線。
//
// 対象の不変条件:
// - 本文は「提案する」を押した時点で組み立てる（開いたまま編集しても最新が出る）
// - 封筒には元エントリの id / 現在の hash / 題名が載る（何への提案か・どの版を土台に
//   したかが、元が消えたあとでも分かる）
// - 派生元が共有ライブラリに無ければ提案させない（何への提案か分からない封筒を作らない）
// - 元が派生時点から更新されていたら、その旨を先に伝える
// - 提案として共有している間、ノートの ⋯ メニューから通常の「チームと共有」を出さない

import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import { LocaleProvider, t } from "../../i18n";
import { ProposeChangesDialog } from "./ProposeChangesDialog";
import { __setSharedLibraryLoaderForTest } from "./shared-library-store";
import type { GraphiumDocument } from "../../lib/document-types";
import type { SharedEntry } from "../../lib/storage/shared";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const TEACHER = { name: "山田 先生", email: "yamada@example.ac.jp" };
const STUDENT = { name: "佐藤 学生", email: "sato@example.ac.jp" };

const TARGET: SharedEntry = {
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

const DOC: GraphiumDocument = {
  version: 6,
  title: "焼結の記録 (forked)",
  pages: [{ id: "p1", title: "焼結の記録 (forked)", blocks: [], labels: {}, provLinks: [], knowledgeLinks: [] }],
} as any;

function renderDialog(overrides: Record<string, unknown> = {}) {
  const share = vi.fn(async () => ({
    ok: true as const,
    doc: { ...DOC, sharedRef: { id: "proposal-1", type: "proposal" as const, sharedAt: "", hash: "sha256:p" } },
    entry: { ...TARGET, id: "proposal-1", type: "proposal" } as SharedEntry,
    isUpdate: false,
  }));
  const onShared = vi.fn();
  const utils = render(
    <LocaleProvider>
      <ProposeChangesDialog
        open
        targetId="note-1"
        entries={[TARGET]}
        forkedFrom={{
          sharedId: "note-1",
          hash: "sha256:current",
          authorName: TEACHER.name,
          authorEmail: TEACHER.email,
          forkedAt: "2026-09-02T00:00:00.000Z",
        }}
        resolveSource={async () => DOC}
        onClose={() => {}}
        onShared={onShared}
        __share={share as never}
        {...overrides}
      />
    </LocaleProvider>,
  );
  return { ...utils, share, onShared };
}

beforeEach(() => {
  localStorage.setItem("graphium-shared-root", "/tmp/shared-root");
  localStorage.setItem(
    "graphium-author-identity",
    JSON.stringify({ name: STUDENT.name, email: STUDENT.email }),
  );
  // 通知（notifySharedLibraryChanged）が実物の共有フォルダを読みに行かないようにする
  __setSharedLibraryLoaderForTest(
    async () => ({
      entries: {
        note: [TARGET],
        knowledge: [],
        reference: [],
        "data-manifest": [],
        template: [],
        report: [],
        comment: [],
        proposal: [],
      },
      errors: {},
    }),
    { root: "/tmp/shared-root" },
  );
});

afterEach(() => {
  cleanup();
  __setSharedLibraryLoaderForTest(null, { root: null });
  localStorage.clear();
  vi.restoreAllMocks();
});

describe("ProposeChangesDialog", () => {
  it("元のノートの題名と作者を出す", () => {
    renderDialog();
    expect(screen.getByText("焼結の記録")).toBeTruthy();
    expect(screen.getByText(TEACHER.name)).toBeTruthy();
  });

  it("派生した時点の版と一致していればその旨を出す", () => {
    renderDialog();
    expect(screen.getByText(t("share.propose.dialog.baseSame"))).toBeTruthy();
  });

  it("元がその後更新されていたら、現在の版と比べることを先に伝える", () => {
    renderDialog({
      forkedFrom: {
        sharedId: "note-1",
        hash: "sha256:older",
        authorName: TEACHER.name,
        authorEmail: TEACHER.email,
        forkedAt: "2026-09-01T00:00:00.000Z",
      },
    });
    expect(screen.getByText(t("share.propose.dialog.baseStale"))).toBeTruthy();
  });

  it("押した時点の本文・元の id・現在の hash・題名・説明・基準版を封筒に載せる", async () => {
    const { share, onShared } = renderDialog({
      resolveBase: async () => ({ origin: "fork" as const, body: '{"title":"base"}' }),
    });
    fireEvent.change(screen.getByLabelText(t("share.propose.dialog.messageLabel")), {
      target: { value: "測定値を入れました" },
    });
    fireEvent.click(screen.getByText(t("share.propose.dialog.submit")));
    await waitFor(() => expect(share).toHaveBeenCalledTimes(1));
    const [doc, input] = share.mock.calls[0] as unknown as [GraphiumDocument, Record<string, unknown>];
    expect(doc.title).toBe("焼結の記録 (forked)");
    expect(input).toMatchObject({
      target: "note-1",
      targetHash: "sha256:current",
      targetTitle: "焼結の記録",
      message: "測定値を入れました",
      base: '{"title":"base"}',
    });
    await waitFor(() => expect(onShared).toHaveBeenCalledTimes(1));
  });

  it("基準版が解決できなければ base 無しで提案する（2 者比較に落ちるだけ）", async () => {
    const { share } = renderDialog({ resolveBase: async () => ({ origin: "none" as const }) });
    fireEvent.click(screen.getByText(t("share.propose.dialog.submit")));
    await waitFor(() => expect(share).toHaveBeenCalledTimes(1));
    const [, input] = share.mock.calls[0] as unknown as [unknown, Record<string, unknown>];
    expect(input.base).toBeUndefined();
  });

  it("派生元が共有ライブラリに無ければ提案させない", () => {
    renderDialog({ entries: [] });
    expect(screen.getByText(t("share.propose.dialog.noTarget"))).toBeTruthy();
    const submit = screen.getByText(t("share.propose.dialog.submit")) as HTMLButtonElement;
    expect(submit.disabled).toBe(true);
  });

  it("提案済みなら見出しとボタンが「更新」になる", () => {
    renderDialog({ isUpdate: true });
    // 見出しとボタンで同じ文言になるので、位置（最後のボタン＝実行）で確かめる
    const buttons = screen.getAllByRole("button");
    expect(buttons[buttons.length - 1].textContent).toContain(
      t("share.propose.dialog.submitUpdate"),
    );
    expect(screen.getAllByText(t("share.propose.update")).length).toBeGreaterThan(1);
  });

  it("失敗したら理由を出し、閉じない", async () => {
    const share = vi.fn(async () => ({ ok: false as const, error: "disk full" }));
    renderDialog({ __share: share as never });
    fireEvent.click(screen.getByText(t("share.propose.dialog.submit")));
    await screen.findByText(t("share.propose.failed", { error: "disk full" }));
    expect(screen.getByTestId("propose-changes-dialog")).toBeTruthy();
  });

  it("閉じているときは何も描かない", () => {
    renderDialog({ open: false });
    expect(screen.queryByTestId("propose-changes-dialog")).toBeNull();
  });
});

describe("note-app からの配線", () => {
  // ここだけソースを読む: NoteApp 全体を起こさないと描けないので、
  // 「渡しているか」を確かめるのに実レンダリングは割に合わない
  const noteAppSource = readFileSync(
    join(import.meta.dirname, "..", "..", "note-app.tsx"),
    "utf-8",
  );

  it("提案として共有している間は通常の「チームと共有」を出さない", () => {
    expect(noteAppSource).toContain("!isSkillDoc && !isProposalShared ? handleShare : undefined");
  });

  it("提案の項目は派生元があるときだけ渡す", () => {
    expect(noteAppSource).toContain(
      "onProposeToSource={canPropose ? () => setProposeOpen(true) : undefined}",
    );
    // 元の作者が自分のときは出さない（自分のノートには「共有コピーを更新」がある）
    expect(noteAppSource).toContain("forkedFrom.authorEmail !== sharedAuthor.email");
  });

  it("取り下げは提案として共有済みのときだけ渡す", () => {
    expect(noteAppSource).toContain(
      "isProposalShared ? () => void handleWithdrawProposal() : undefined",
    );
  });

  it("ダイアログには派生元の id と基準版の解決を渡す", () => {
    const start = noteAppSource.indexOf("<ProposeChangesDialog");
    expect(start).toBeGreaterThan(-1);
    const jsx = noteAppSource.slice(start, noteAppSource.indexOf("/>", start));
    expect(jsx).toContain("targetId={forkedFrom.sharedId}");
    expect(jsx).toContain("resolveBase={resolveProposalBaseForNote}");
    expect(jsx).toContain("resolveSource={resolveProposalSource}");
  });
});
