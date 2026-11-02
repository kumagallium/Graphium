// @vitest-environment jsdom
// DocumentProvenancePanel の件数の行（「2 versions · 3 revisions」）と「編集 N 回」の畳みの単複。
// 英語は 1 件のときだけ単数形にする（「1 versions」と出ていた。PR #1412 の図で発覚）

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { LocaleProvider, syncLocale } from "../../i18n";
import { DocumentProvenancePanel } from "./DocumentProvenancePanel";
import type { DocumentProvenance, RevisionEntity } from "./types";
import type { SnapshotMeta } from "../version-snapshots/types";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

beforeEach(() => {
  try {
    localStorage.setItem("graphium_locale", "en");
  } catch {
    // jsdom で使えなくても syncLocale だけで足りる
  }
  syncLocale("en");
});
afterEach(() => {
  cleanup();
  syncLocale("en");
});

function rev(n: number): RevisionEntity {
  return {
    id: `rev_${n}`,
    savedAt: `2026-07-10T09:0${n}:00Z`,
    summary: {
      blocksAdded: 1, blocksRemoved: 0, blocksModified: 0, labelsChanged: [],
      provLinksAdded: 0, provLinksRemoved: 0, knowledgeLinksAdded: 0, knowledgeLinksRemoved: 0,
    },
    contentHash: `h${n}`,
    wasGeneratedBy: `ed${n}`,
  };
}

function provenance(revCount: number): DocumentProvenance {
  const revisions = Array.from({ length: revCount }, (_, i) => rev(i + 1));
  return {
    agents: [{ id: "ag", type: "human", label: "user" }],
    activities: revisions.map((r) => ({
      id: r.wasGeneratedBy, type: "human_edit" as const, startedAt: r.savedAt, endedAt: r.savedAt, wasAssociatedWith: "ag",
    })),
    revisions,
  };
}

function snap(n: number, savedAt: string): SnapshotMeta {
  return { id: `s${n}`, noteId: "n", version: n, savedAt, contentHash: `sh${n}` };
}

function renderPanel(revCount: number, snapshots: SnapshotMeta[] = []) {
  return render(
    <LocaleProvider>
      <DocumentProvenancePanel provenance={provenance(revCount)} snapshots={snapshots} />
    </LocaleProvider>,
  );
}

describe("履歴パネルの件数の単複（英語）", () => {
  it("版 1 件・記録 1 件は単数形", () => {
    const { container } = renderPanel(1, [snap(1, "2026-07-10T10:00:00Z")]);
    expect(container.textContent).toContain("1 version · 1 revision");
    expect(container.textContent).not.toMatch(/1 versions|1 revisions/);
  });

  it("2 件以上は複数形", () => {
    const { container } = renderPanel(2, [snap(1, "2026-07-10T10:00:00Z"), snap(2, "2026-07-10T11:00:00Z")]);
    expect(container.textContent).toContain("2 versions · 2 revisions");
  });

  it("版の間に畳んだ編集が 1 回だけなら「1 edit」", () => {
    // 版より前の記録 1 件が「編集 N 回」に畳まれる
    const { container } = renderPanel(1, [snap(1, "2026-07-10T10:00:00Z")]);
    expect(container.textContent).toContain("1 edit");
    expect(container.textContent).not.toContain("1 edits");
  });
});
