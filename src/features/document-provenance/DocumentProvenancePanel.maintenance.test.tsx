// @vitest-environment jsdom
// DocumentProvenancePanel の「保守の操作」の節（ナレッジのページを開いているときだけ）のテスト

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { LocaleProvider, syncLocale, t } from "../../i18n";
import type { MaintenanceListBinding } from "../knowledge-maintenance/MaintenanceRunList";
import { makeOp, makeRun } from "../knowledge-maintenance/test-helpers";
import { DocumentProvenancePanel } from "./DocumentProvenancePanel";
import type { DocumentProvenance } from "./types";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

beforeEach(() => syncLocale("ja"));
afterEach(() => {
  cleanup();
  syncLocale("en");
});

const provenance: DocumentProvenance = {
  agents: [{ id: "ag", type: "human", label: "user" }],
  activities: [
    { id: "ed1", type: "human_edit", startedAt: "2026-07-10T09:00:00Z", endedAt: "2026-07-10T09:00:00Z", wasAssociatedWith: "ag" },
  ],
  revisions: [
    {
      id: "rev_001",
      savedAt: "2026-07-10T09:00:00Z",
      summary: {
        blocksAdded: 1, blocksRemoved: 0, blocksModified: 0, labelsChanged: [],
        provLinksAdded: 0, provLinksRemoved: 0, knowledgeLinksAdded: 0, knowledgeLinksRemoved: 0,
      },
      contentHash: "h",
      wasGeneratedBy: "ed1",
    },
  ],
};

const mine = makeOp({ id: "mine", subject: { wikiId: "w-here", title: "このページの統合" } });
const other = makeOp({ id: "other", kind: "regenerate", subject: { wikiId: "w-else", title: "別のページの作り直し" } });

function binding(over: Partial<MaintenanceListBinding> = {}): MaintenanceListBinding {
  return {
    runs: [makeRun("r1", [mine]), makeRun("r2", [other])],
    states: new Map(),
    blockersOf: () => [],
    onUndo: vi.fn(),
    undoingKey: null,
    loading: false,
    hasMore: false,
    unreadableCount: 0,
    onLoadMore: vi.fn(),
    ensureLoaded: vi.fn(),
    ...over,
  };
}

function renderPanel(maintenance?: { binding: MaintenanceListBinding; wikiId: string }) {
  render(
    <LocaleProvider>
      <DocumentProvenancePanel provenance={provenance} maintenance={maintenance} />
    </LocaleProvider>,
  );
}

describe("履歴パネルの手入れの操作の節", () => {
  it("マウント時に ensureLoaded を呼び、そのページが関わった操作だけを出す", async () => {
    const b = binding();
    renderPanel({ binding: b, wikiId: "w-here" });
    await waitFor(() => expect(screen.getByText(t("maintenance.section.title"))).toBeTruthy());
    expect(b.ensureLoaded).toHaveBeenCalledTimes(1);
    expect(screen.getByText(/このページの統合/)).toBeTruthy();
    expect(screen.queryByText(/別のページの作り直し/)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /^取り消す.*このページの統合/ }));
    expect(b.onUndo).toHaveBeenCalledWith({ runId: "r1", operationId: "mine" });
  });

  it("該当が 1 件も無く、続きも無いときは節ごと出さない", async () => {
    const b = binding({ runs: [makeRun("r2", [other])] });
    renderPanel({ binding: b, wikiId: "w-here" });
    await waitFor(() => expect(b.ensureLoaded).toHaveBeenCalled());
    expect(screen.queryByText(t("maintenance.section.title"))).toBeNull();
    // 履歴そのものは出る
    expect(screen.getByText(/rev_001/)).toBeTruthy();
  });

  it("該当が無くても続きがあるときは、読み込み済みの範囲に無い旨と「さらに読み込む」を出す", async () => {
    const b = binding({ runs: [makeRun("r2", [other])], hasMore: true });
    renderPanel({ binding: b, wikiId: "w-here" });
    await waitFor(() => expect(screen.getByText(t("maintenance.list.emptyForPageSoFar"))).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: t("maintenance.list.loadMore") }));
    expect(b.onLoadMore).toHaveBeenCalled();
  });

  it("maintenance を渡さなければ節は出ない（ノートの履歴）", async () => {
    renderPanel(undefined);
    expect(screen.getByText(/rev_001/)).toBeTruthy();
    expect(screen.queryByText(t("maintenance.section.title"))).toBeNull();
  });
});
