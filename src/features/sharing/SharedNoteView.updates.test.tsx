// @vitest-environment jsdom
// 共有ノートの全画面「順番に更新」の画面のテスト。
//
// 対象の不変条件:
// - 作者（かつ note）にだけスイッチが出る。切り替えは setAcceptsUpdates を通り、衝突・失敗は画面内に知らせる
// - 受け付け中の印は誰が見ても出る。作者以外には「写しを作って反映できる」案内を添える
// - 最後に更新した人（extra.updatedBy）が分かる
// - 前の版は受け付け中のときだけ出る。戻す前に確認を出し、確認しなければ書かない
// - 同期の競合コピーが見つかったら、件数・ファイル名・自動では取り込まれていないことを出す

import { describe, it, expect, afterEach, vi } from "vitest";

vi.mock("react-pdf", () => ({
  Document: () => null,
  Page: () => null,
  pdfjs: { GlobalWorkerOptions: {} },
}));
vi.mock("../../lib/pdfjs-config", () => ({}));
vi.mock("../../base/editor", () => ({
  SandboxEditor: () => <div data-testid="sandbox-editor" />,
}));

import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { LocaleProvider, t } from "../../i18n";
import { SharedNoteView } from "./SharedNoteView";
import { createEmptySharedProjection } from "./shared-projection";
import { formatDateTime } from "../../lib/format-datetime";
import { __setConfirmResponderForTest } from "../../ui/confirm-dialog";
import type { SharedNoteUpdateOps } from "./SharedNoteUpdates";
import type { GraphiumDocument } from "../../lib/document-types";
import type { SharedEntry } from "../../lib/storage/shared";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

class NoopResizeObserver {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}
(globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= NoopResizeObserver;

const AUTHOR = { name: "佐藤 学生", email: "sato@example.ac.jp" };
const OTHER = { name: "山田 先生", email: "yamada@example.ac.jp" };

const DOC = {
  version: 6,
  title: "焼結の記録",
  pages: [{ id: "p1", title: "焼結の記録", blocks: [], labels: {}, provLinks: [], knowledgeLinks: [] }],
} as unknown as GraphiumDocument;

function noteEntry(extra: Record<string, unknown> = {}): SharedEntry {
  return {
    id: "note-1",
    type: "note",
    author: AUTHOR,
    created_at: "2026-08-01T00:00:00.000Z",
    updated_at: "2026-08-20T00:00:00.000Z",
    hash: "sha256:aaa",
    prov: { derived_from: [] },
    version: 1,
    extra: { title: "焼結の記録", ...extra },
  } as SharedEntry;
}

// 13 桁の先頭が UTC ミリ秒（2026-11-01T00:00:00Z / 2026-11-02T00:00:00Z）
const V1 = `${Date.UTC(2026, 10, 2)}-aaaa.json`;
const V2 = `${Date.UTC(2026, 10, 1)}-bbbb.json`;

// 版の中身から読む「その版を作った日時と人」。ファイル名の時刻（上書きされた時刻）とは別の値にしてある
const INFO: Record<string, { at: string; by: string }> = {
  [V1]: { at: "2026-10-20T03:00:00.000Z", by: "Editor B" },
  [V2]: { at: "2026-10-10T03:00:00.000Z", by: AUTHOR.name },
};

function makeOps(overrides: Partial<SharedNoteUpdateOps> = {}): SharedNoteUpdateOps {
  return {
    listVersions: vi.fn(async () => [V1, V2]),
    readVersionInfo: vi.fn(async (_root: string, _id: string, name: string) => ({
      name,
      ok: true,
      at: INFO[name].at,
      by: INFO[name].by,
    })),
    conflictCopies: vi.fn(async () => []),
    setAcceptsUpdates: vi.fn(async (_id, value) => ({
      ok: true as const,
      entry: noteEntry({ acceptsUpdates: value }),
    })),
    restoreSharedVersion: vi.fn(async () => ({ ok: true as const, entry: noteEntry() })),
    ...overrides,
  };
}

function renderView(
  entry: SharedEntry,
  identity: { name: string; email: string },
  ops: SharedNoteUpdateOps,
) {
  const view = render(
    <LocaleProvider>
      <SharedNoteView
        entry={entry}
        currentIdentity={identity}
        sharedRoot="/tmp/shared-root"
        onBack={() => {}}
        onForkNote={async () => {}}
        onForkKnowledge={async () => {}}
        onUnshare={async () => {}}
        entries={[]}
        projection={createEmptySharedProjection()}
        readEntryBody={async () => ({
          body: new TextEncoder().encode(JSON.stringify(DOC)),
          verified: true,
        })}
        updateOps={ops}
      />
    </LocaleProvider>,
  );
  return view;
}

function openVersionTab() {
  fireEvent.click(screen.getByTestId("shared-note-rail-version"));
}

afterEach(() => {
  cleanup();
  __setConfirmResponderForTest(null);
  localStorage.clear();
});

describe("SharedNoteView: 他の人の更新", () => {
  it("作者にはスイッチが出て、押すと setAcceptsUpdates(true) を呼ぶ", async () => {
    const ops = makeOps();
    renderView(noteEntry(), AUTHOR, ops);
    openVersionTab();
    const sw = await screen.findByRole("switch", { name: t("sharedNote.updates.toggle") });
    expect(sw.getAttribute("aria-checked")).toBe("false");
    expect(screen.getByText(t("sharedNote.updates.help"))).toBeTruthy();
    fireEvent.click(sw);
    await waitFor(() => expect(ops.setAcceptsUpdates).toHaveBeenCalledTimes(1));
    expect((ops.setAcceptsUpdates as ReturnType<typeof vi.fn>).mock.calls[0].slice(0, 2)).toEqual([
      "note-1",
      true,
    ]);
    await waitFor(() =>
      expect(
        screen.getByRole("switch", { name: t("sharedNote.updates.toggle") }).getAttribute("aria-checked"),
      ).toBe("true"),
    );
  });

  it("切り替えで衝突したら、画面内に知らせてスイッチは戻らない", async () => {
    const ops = makeOps({
      setAcceptsUpdates: vi.fn(async () => ({
        ok: false as const,
        conflict: true as const,
        currentHash: "sha256:new",
      })),
    });
    renderView(noteEntry(), AUTHOR, ops);
    openVersionTab();
    fireEvent.click(await screen.findByRole("switch", { name: t("sharedNote.updates.toggle") }));
    expect((await screen.findByTestId("shared-note-updates-message")).textContent).toContain(
      t("sharedNote.updates.conflict"),
    );
    expect(
      screen.getByRole("switch", { name: t("sharedNote.updates.toggle") }).getAttribute("aria-checked"),
    ).toBe("false");
  });

  it("切り替えに失敗したら理由を画面内に出す", async () => {
    const ops = makeOps({
      setAcceptsUpdates: vi.fn(async () => ({ ok: false as const, error: "disk full" })),
    });
    renderView(noteEntry(), AUTHOR, ops);
    openVersionTab();
    fireEvent.click(await screen.findByRole("switch", { name: t("sharedNote.updates.toggle") }));
    expect((await screen.findByTestId("shared-note-updates-message")).textContent).toContain("disk full");
  });

  it("作者以外にはスイッチが出ない。受け付け中なら印と案内が出る", async () => {
    renderView(noteEntry({ acceptsUpdates: true }), OTHER, makeOps());
    expect(screen.getAllByTestId("shared-note-accepts-badge").length).toBeGreaterThan(0);
    expect(screen.getByTestId("shared-note-fork-hint").textContent).toBe(
      t("sharedNote.updates.forkHint"),
    );
    openVersionTab();
    await screen.findByTestId("shared-note-updates");
    expect(screen.queryByRole("switch")).toBeNull();
  });

  it("受け付けていないノートには印も案内も前の版も出ない", async () => {
    renderView(noteEntry(), OTHER, makeOps());
    expect(screen.queryByTestId("shared-note-accepts-badge")).toBeNull();
    expect(screen.queryByTestId("shared-note-fork-hint")).toBeNull();
    openVersionTab();
    await screen.findByTestId("shared-note-updates");
    expect(screen.queryByTestId("shared-note-versions")).toBeNull();
  });

  it("作者本人が見るときは「写しを作って」の案内を出さない", () => {
    renderView(noteEntry({ acceptsUpdates: true }), AUTHOR, makeOps());
    expect(screen.queryByTestId("shared-note-fork-hint")).toBeNull();
    expect(screen.getAllByTestId("shared-note-accepts-badge").length).toBeGreaterThan(0);
  });

  it("最後に更新した人を出す", async () => {
    renderView(
      noteEntry({ acceptsUpdates: true, updatedBy: { name: OTHER.name, email: OTHER.email } }),
      AUTHOR,
      makeOps(),
    );
    openVersionTab();
    const line = await screen.findByTestId("shared-note-updated-by");
    expect(line.textContent).toContain(t("sharedNote.updates.lastUpdatedBy"));
    expect(line.textContent).toContain(OTHER.name);
  });

  it("updatedBy.name が文字列でない細工したノートでも画面が落ちない", async () => {
    renderView(
      noteEntry({ acceptsUpdates: true, updatedBy: { name: { evil: 1 }, email: ["x"] } }),
      AUTHOR,
      makeOps(),
    );
    openVersionTab();
    await screen.findByTestId("shared-note-versions");
    expect(screen.queryByTestId("shared-note-updated-by")).toBeNull();
  });

  it("受け付けていないノートでは前の版を読みに行かない", async () => {
    const ops = makeOps();
    renderView(noteEntry(), AUTHOR, ops);
    openVersionTab();
    await waitFor(() => expect(ops.conflictCopies).toHaveBeenCalled());
    expect(ops.listVersions).not.toHaveBeenCalled();
  });

  it("前の版は先頭 5 件だけ読む", async () => {
    const names = Array.from({ length: 8 }, (_, i) => `${Date.UTC(2026, 10, 20 - i)}-aaaa.json`);
    const ops = makeOps({
      listVersions: vi.fn(async () => names),
      readVersionInfo: vi.fn(async (_r: string, _i: string, name: string) => ({
        name,
        ok: true,
        at: "2026-10-20T03:00:00.000Z",
        by: "x",
      })),
    });
    renderView(noteEntry({ acceptsUpdates: true }), AUTHOR, ops);
    openVersionTab();
    const list = await screen.findByTestId("shared-note-versions");
    expect(list.querySelectorAll("li").length).toBe(5);
    expect(ops.readVersionInfo).toHaveBeenCalledTimes(5);
  });

  it("前の版を新しい順に並べる", async () => {
    renderView(noteEntry({ acceptsUpdates: true }), OTHER, makeOps());
    openVersionTab();
    const list = await screen.findByTestId("shared-note-versions");
    const rows = list.querySelectorAll("li");
    expect(rows.length).toBe(2);
    expect(rows[0].textContent).toContain(t("sharedNote.versions.restore"));
  });

  it("一覧と確認文には、ファイル名の時刻ではなく、その版を作った日時と人を出す", async () => {
    const confirmSpy = vi.fn(async () => false);
    __setConfirmResponderForTest(confirmSpy);
    renderView(noteEntry({ acceptsUpdates: true }), OTHER, makeOps());
    openVersionTab();
    const list = await screen.findByTestId("shared-note-versions");
    const rows = list.querySelectorAll("li");
    expect(rows[0].textContent).toContain("Editor B");
    expect(rows[1].textContent).toContain(AUTHOR.name);
    // ファイル名の時刻（2026-11-02 / 11-01）は出さない
    expect(rows[0].textContent).not.toContain("2026-11");
    fireEvent.click(rows[0].querySelector("button")!);
    await waitFor(() => expect(confirmSpy).toHaveBeenCalled());
    const message = (confirmSpy.mock.calls as unknown as string[][])[0][0];
    expect(message).toContain(formatDateTime(INFO[V1].at));
  });

  it("読めない版は「読めない版」と出し、戻すボタンを出さない", async () => {
    renderView(
      noteEntry({ acceptsUpdates: true }),
      OTHER,
      makeOps({
        readVersionInfo: vi.fn(async (_r: string, _i: string, name: string) => ({
          name,
          ok: false,
          at: null,
          by: null,
        })),
      }),
    );
    openVersionTab();
    const list = await screen.findByTestId("shared-note-versions");
    expect(list.querySelectorAll("[data-testid=shared-note-version-unreadable]").length).toBe(2);
    expect(list.querySelectorAll("button").length).toBe(0);
  });

  it("前の版が無ければ、その旨を出す", async () => {
    renderView(
      noteEntry({ acceptsUpdates: true }),
      OTHER,
      makeOps({ listVersions: vi.fn(async () => []) }),
    );
    openVersionTab();
    expect(await screen.findByText(t("sharedNote.versions.empty"))).toBeTruthy();
  });

  it("「この版に戻す」は確認してから書く。確認文に、今の版も残ることを書く", async () => {
    const ops = makeOps();
    const confirmSpy = vi.fn(async () => true);
    __setConfirmResponderForTest(confirmSpy);
    renderView(noteEntry({ acceptsUpdates: true }), OTHER, ops);
    openVersionTab();
    const list = await screen.findByTestId("shared-note-versions");
    fireEvent.click(list.querySelectorAll("button")[1]);
    await waitFor(() => expect(ops.restoreSharedVersion).toHaveBeenCalledTimes(1));
    // 戻したあとは、共有ライブラリを読み直す通知を出し、前の版の一覧も読み直す
    await waitFor(() => expect(ops.listVersions).toHaveBeenCalledTimes(2));
    expect((ops.restoreSharedVersion as ReturnType<typeof vi.fn>).mock.calls[0].slice(0, 2)).toEqual([
      "note-1",
      V2,
    ]);
    const message = (confirmSpy.mock.calls as unknown as string[][])[0][0];
    expect(message).toContain("焼結の記録");
    // 今の版も前の版として残ることを確認文に書く（言語に依存しないよう辞書の文で比べる）
    const keepLine = t("sharedNote.versions.restoreConfirm", { title: "", date: "" }).split("\n\n")[1];
    expect(message).toContain(keepLine);
  });

  it("確認で取り消したら書かない", async () => {
    const ops = makeOps();
    __setConfirmResponderForTest(async () => false);
    renderView(noteEntry({ acceptsUpdates: true }), OTHER, ops);
    openVersionTab();
    const list = await screen.findByTestId("shared-note-versions");
    fireEvent.click(list.querySelectorAll("button")[0]);
    await new Promise((r) => setTimeout(r, 20));
    expect(ops.restoreSharedVersion).not.toHaveBeenCalled();
  });

  it("戻す間に先に更新されていたら、画面内に知らせる", async () => {
    const ops = makeOps({
      restoreSharedVersion: vi.fn(async () => ({
        ok: false as const,
        conflict: true as const,
        currentHash: "sha256:new",
      })),
    });
    __setConfirmResponderForTest(async () => true);
    renderView(noteEntry({ acceptsUpdates: true }), OTHER, ops);
    openVersionTab();
    const list = await screen.findByTestId("shared-note-versions");
    fireEvent.click(list.querySelectorAll("button")[0]);
    expect((await screen.findByTestId("shared-note-updates-message")).textContent).toContain(
      t("sharedNote.versions.restoreConflict"),
    );
  });

  it("競合コピーが見つかったら、件数・ファイル名・自動では取り込まれていないことを出す", async () => {
    renderView(
      noteEntry(),
      OTHER,
      makeOps({
        conflictCopies: vi.fn(async () => ["note-1 (conflicted copy 2026-11-01).json", "note-1 2.json"]),
      }),
    );
    const notice = await screen.findByTestId("shared-note-conflict-copies");
    expect(notice.textContent).toContain(t("sharedNote.conflictCopies.title"));
    expect(notice.textContent).toContain(t("sharedNote.conflictCopies.body", { count: "2" }));
    expect(notice.textContent).toContain("note-1 (conflicted copy 2026-11-01).json");
  });

  it("競合コピーが無ければ注意は出ない", async () => {
    const ops = makeOps();
    renderView(noteEntry(), OTHER, ops);
    await waitFor(() => expect(ops.conflictCopies).toHaveBeenCalled());
    expect(screen.queryByTestId("shared-note-conflict-copies")).toBeNull();
  });
});
