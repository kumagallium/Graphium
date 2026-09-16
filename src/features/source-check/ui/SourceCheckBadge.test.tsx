// @vitest-environment jsdom
// SourceCheckBadge のテスト。
//
// 対象の不変条件:
// - 5 verdict それぞれでラベルを出す
// - source-missing は破線の枠で unclear と区別する（色だけに頼らない）
// - stale のときはピル内に短い注記が付く（別ピルを増やさない）
// - dismissed のときは Check アイコンが付く

import { describe, it, expect, afterEach, beforeEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
import { LocaleProvider, syncLocale, t } from "../../../i18n";
import type { SourceCheckEntry, SourceCheckProfile } from "../../../lib/document-types";
import { SourceCheckBadge } from "./SourceCheckBadge";

function entry(overrides: Partial<SourceCheckEntry> = {}): SourceCheckEntry {
  return {
    sourceId: "note-1",
    sourceKind: "note",
    verdict: "supported",
    rationale: "出典の記述と一致する。",
    ...overrides,
  };
}

function profile(
  verdict: SourceCheckProfile["verdict"],
  overrides: Partial<SourceCheckProfile> = {},
): SourceCheckProfile {
  return {
    verdict,
    entries: [entry({ verdict })],
    checkedAt: "2026-09-10T09:00:00Z",
    checkedBy: "claude-haiku-4-5",
    claimHash: "hash-v1",
    ...overrides,
  };
}

function renderBadge(profileValue: SourceCheckProfile, stale = false) {
  return render(
    <LocaleProvider>
      <SourceCheckBadge profile={profileValue} stale={stale} />
    </LocaleProvider>,
  );
}

describe("SourceCheckBadge", () => {
  beforeEach(() => {
    syncLocale("en");
  });
  afterEach(() => {
    cleanup();
  });

  const verdicts: SourceCheckProfile["verdict"][] = [
    "supported",
    "contradicted",
    "not-in-source",
    "unclear",
    "source-missing",
  ];

  for (const verdict of verdicts) {
    it(`${verdict} のラベルを出す`, () => {
      const { container } = renderBadge(profile(verdict));
      expect(container.textContent).toContain(t(`sourceCheck.verdict.${verdict}` as never));
    });
  }

  it("source-missing は破線の枠で表示する", () => {
    const { container } = renderBadge(profile("source-missing"));
    const pill = container.querySelector("span");
    expect(pill).toBeTruthy();
    expect(pill?.getAttribute("style")).toContain("dashed");
  });

  it("supported 等 source-missing 以外は破線にしない", () => {
    const { container } = renderBadge(profile("supported"));
    const pill = container.querySelector("span");
    expect(pill?.getAttribute("style")).toContain("solid");
    expect(pill?.getAttribute("style")).not.toContain("dashed");
  });

  it("stale のときはピル内に注記が付く（別ピルは増やさない）", () => {
    const { container } = renderBadge(profile("supported"), true);
    expect(container.textContent).toContain(t("sourceCheck.staleNote"));
    // トップレベルのピルは 1 つだけ
    const pills = container.querySelectorAll(":scope > span");
    expect(pills.length).toBe(1);
  });

  it("stale でなければ注記は出ない", () => {
    const { container } = renderBadge(profile("supported"), false);
    expect(container.textContent).not.toContain(t("sourceCheck.staleNote"));
  });

  it("dismissed のときは確認済みアイコン込みでラベルを出す（title にも確認済みヒントを含む）", () => {
    const { container } = renderBadge(profile("contradicted", { dismissed: true }));
    expect(container.textContent).toContain(t("sourceCheck.verdict.contradicted"));
    const pill = container.querySelector("span");
    expect(pill?.getAttribute("title")).toContain(t("sourceCheck.dismissedHint"));
    // アイコン込みで svg が複数（FileSearch + Check）
    const icons = container.querySelectorAll("svg");
    expect(icons.length).toBeGreaterThanOrEqual(2);
  });

  it("ツールチップに判定ラベル・件数・モデル・時刻を含む", () => {
    const { container } = renderBadge(
      profile("contradicted", {
        entries: [
          entry({ verdict: "contradicted" }),
          entry({ sourceId: "note-2", verdict: "supported" }),
        ],
      }),
    );
    const pill = container.querySelector("span");
    const title = pill?.getAttribute("title") ?? "";
    expect(title).toContain(t("sourceCheck.verdict.contradicted"));
    expect(title).toContain("claude-haiku-4-5");
    // 出典ごとの内訳（優先順位の順）と照合時刻
    expect(title).toContain(
      `${t("sourceCheck.verdict.contradicted")} 1 / ${t("sourceCheck.verdict.supported")} 1`,
    );
    expect(title).toContain(`${t("sourceCheck.checkedAt")}: `);
  });

  it("contradicted は rose の塗りで最も目立たせる（2026-09-16 決定）", () => {
    const { container } = renderBadge(profile("contradicted"));
    const pill = container.querySelector("span") as HTMLElement;
    expect(pill.style.color).toBe("var(--rose-ink)");
    expect(pill.style.background).toBe("var(--rose-soft)");
  });
});
