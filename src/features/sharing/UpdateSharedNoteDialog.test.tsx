// @vitest-environment jsdom
// 「共有に反映」のダイアログのテスト。
//
// 対象の不変条件:
// - 反映先の題と、更新者として残る名前を出す
// - 押した時点の本文・手元のノート id を updateSharedNoteFromCopy へ渡す
// - 成功したら返った結果を渡して閉じる。先に更新されていたら何も書かれていないと伝える
// - 失敗は理由を画面内に出す（閉じない）
// - 先に更新されていたときの選択肢（最新から写しを作る / 提案として出す / 閉じる）

import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import { LocaleProvider, t } from "../../i18n";
import { UpdateConflictDialog, UpdateSharedNoteDialog } from "./UpdateSharedNoteDialog";
import { __setSharedLibraryLoaderForTest } from "./shared-library-store";
import type { GraphiumDocument } from "../../lib/document-types";
import type { SharedEntry } from "../../lib/storage/shared";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const TEACHER = { name: "山田 先生", email: "yamada@example.ac.jp" };
const STUDENT = { name: "佐藤 学生", email: "sato@example.ac.jp" };

const TARGET = {
  id: "note-1",
  type: "note",
  author: TEACHER,
  created_at: "2026-09-01T00:00:00.000Z",
  updated_at: "2026-09-02T00:00:00.000Z",
  hash: "sha256:current",
  prov: { derived_from: [] },
  version: 1,
  extra: { title: "焼結の記録", acceptsUpdates: true },
} as SharedEntry;

const DOC = {
  version: 6,
  title: "焼結の記録 (forked)",
  pages: [{ id: "p1", title: "焼結の記録 (forked)", blocks: [], labels: {}, provLinks: [], knowledgeLinks: [] }],
  forkedFrom: { sharedId: "note-1", hash: "sha256:current", authorName: "", authorEmail: "", forkedAt: "" },
} as unknown as GraphiumDocument;

function renderDialog(overrides: Record<string, unknown> = {}) {
  const update = vi.fn(async (doc: GraphiumDocument) => ({
    ok: true as const,
    doc: { ...doc, forkedFrom: { ...doc.forkedFrom!, hash: "sha256:next" } },
    entry: { ...TARGET, hash: "sha256:next" } as SharedEntry,
  }));
  const onUpdated = vi.fn();
  const onClose = vi.fn();
  const onConflict = vi.fn();
  const utils = render(
    <LocaleProvider>
      <UpdateSharedNoteDialog
        open
        targetId="note-1"
        entries={[TARGET]}
        noteId="local-1"
        resolveSource={async () => DOC}
        onClose={onClose}
        onUpdated={onUpdated}
        onConflict={onConflict}
        __update={update as never}
        {...overrides}
      />
    </LocaleProvider>,
  );
  return { ...utils, update, onUpdated, onClose, onConflict };
}

beforeEach(() => {
  localStorage.setItem("graphium-shared-root", "/tmp/shared-root");
  localStorage.setItem(
    "graphium-author-identity",
    JSON.stringify({ name: STUDENT.name, email: STUDENT.email }),
  );
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

describe("UpdateSharedNoteDialog", () => {
  it("反映先の題と、更新者として残る名前を出す", () => {
    renderDialog();
    expect(screen.getByText("焼結の記録")).toBeTruthy();
    expect(screen.getByText(STUDENT.name)).toBeTruthy();
    expect(screen.getByText(t("share.update.dialog.byHelp"))).toBeTruthy();
  });

  it("閉じているときは何も描かない", () => {
    renderDialog({ open: false });
    expect(screen.queryByTestId("update-shared-note-dialog")).toBeNull();
  });

  it("押した時点の本文と手元のノート id を渡し、成功したら結果を返して閉じる", async () => {
    const { update, onUpdated, onClose } = renderDialog();
    fireEvent.click(screen.getByText(t("share.update.dialog.submit")));
    await waitFor(() => expect(onUpdated).toHaveBeenCalledTimes(1));
    const [doc, options] = update.mock.calls[0] as unknown as [GraphiumDocument, Record<string, unknown>];
    expect(doc.title).toBe("焼結の記録 (forked)");
    expect(options.noteId).toBe("local-1");
    expect((options.author as { email: string }).email).toBe(STUDENT.email);
    expect(onUpdated.mock.calls[0][0].doc.forkedFrom.hash).toBe("sha256:next");
    expect(onClose).toHaveBeenCalled();
  });

  it("先に更新されていたら、閉じて onConflict を呼ぶ（保存はしない）", async () => {
    const update = vi.fn(async () => ({
      ok: false as const,
      conflict: true as const,
      currentHash: "sha256:other",
    }));
    const { onUpdated, onClose, onConflict } = renderDialog({ __update: update });
    fireEvent.click(screen.getByText(t("share.update.dialog.submit")));
    await waitFor(() => expect(onConflict).toHaveBeenCalledTimes(1));
    expect(onClose).toHaveBeenCalled();
    expect(onUpdated).not.toHaveBeenCalled();
  });

  it("失敗したら理由を出して、閉じない", async () => {
    const update = vi.fn(async () => ({ ok: false as const, error: "boom" }));
    const { onClose } = renderDialog({ __update: update });
    fireEvent.click(screen.getByText(t("share.update.dialog.submit")));
    expect(await screen.findByText(t("share.update.failed", { error: "boom" }))).toBeTruthy();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("反映先が共有ライブラリに無ければ反映させない", () => {
    renderDialog({ entries: [] });
    expect(screen.getByText(t("share.update.dialog.noTarget"))).toBeTruthy();
    const submit = screen.getByText(t("share.update.dialog.submit")) as HTMLButtonElement;
    expect(submit.disabled).toBe(true);
  });
});

describe("UpdateConflictDialog", () => {
  it("何も書いていないことと、手元の写しが残ることを伝える", () => {
    render(
      <LocaleProvider>
        <UpdateConflictDialog open onFork={() => {}} onPropose={() => {}} onClose={() => {}} />
      </LocaleProvider>,
    );
    expect(screen.getByText(t("share.update.conflict.title"))).toBeTruthy();
    expect(screen.getByText(t("share.update.conflict.body"))).toBeTruthy();
  });

  it("3 つの選択肢がそれぞれ別の処理を呼ぶ", () => {
    const onFork = vi.fn();
    const onPropose = vi.fn();
    const onClose = vi.fn();
    render(
      <LocaleProvider>
        <UpdateConflictDialog open onFork={onFork} onPropose={onPropose} onClose={onClose} />
      </LocaleProvider>,
    );
    fireEvent.click(screen.getByText(t("share.update.conflict.fork")));
    fireEvent.click(screen.getByText(t("share.update.conflict.propose")));
    fireEvent.click(screen.getByText(t("common.close")));
    expect(onFork).toHaveBeenCalledTimes(1);
    expect(onPropose).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("提案の口が無ければ「提案として出す」を出さない", () => {
    render(
      <LocaleProvider>
        <UpdateConflictDialog open onFork={() => {}} onClose={() => {}} />
      </LocaleProvider>,
    );
    expect(screen.queryByText(t("share.update.conflict.propose"))).toBeNull();
  });
});
