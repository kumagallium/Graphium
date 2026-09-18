// @vitest-environment jsdom
// SourceCheckDetailSection のテスト。
//
// 対象の不変条件:
// - 渡した onRecheck / onDismiss / onClear のボタンだけが出る
// - source-missing の行は missingReason を i18n ラベルで出す（保存済み rationale より優先）
// - stale のときは先頭に注意書きが出る

import { describe, it, expect, afterEach, beforeEach } from "vitest";
import { render, cleanup, fireEvent } from "@testing-library/react";
import { LocaleProvider, syncLocale, t } from "../../../i18n";
import type { SourceCheckEntry, SourceCheckProfile } from "../../../lib/document-types";
import { SourceCheckDetailSection } from "./SourceCheckDetailSection";

function entry(overrides: Partial<SourceCheckEntry> = {}): SourceCheckEntry {
  return {
    sourceId: "note-1",
    sourceKind: "note",
    verdict: "supported",
    rationale: "出典の記述と一致する。",
    ...overrides,
  };
}

function profile(entries: SourceCheckEntry[], overrides: Partial<SourceCheckProfile> = {}): SourceCheckProfile {
  return {
    verdict: entries[0]?.verdict ?? "unclear",
    entries,
    checkedAt: "2026-09-10T09:00:00Z",
    checkedBy: "claude-haiku-4-5",
    claimHash: "hash-v1",
    ...overrides,
  };
}

/** デフォルト閉なので、テストごとにヘッダーを開く */
function openDetail(container: HTMLElement) {
  const toggle = container.querySelector("button");
  if (!toggle) throw new Error("開閉ボタンが見つかりません");
  fireEvent.click(toggle);
}

describe("SourceCheckDetailSection", () => {
  beforeEach(() => {
    syncLocale("en");
  });
  afterEach(() => {
    cleanup();
  });

  it("既定は閉じている", () => {
    const { container } = render(
      <LocaleProvider>
        <SourceCheckDetailSection profile={profile([entry()])} />
      </LocaleProvider>,
    );
    expect(container.textContent).not.toContain("出典の記述と一致する。");
  });

  it("渡したボタンだけが出る（onDismiss のみ）", () => {
    const { container, getByText } = render(
      <LocaleProvider>
        <SourceCheckDetailSection profile={profile([entry()])} onDismiss={() => {}} />
      </LocaleProvider>,
    );
    openDetail(container);
    expect(() => getByText(t("sourceCheck.dismiss"))).not.toThrow();
    expect(container.textContent).not.toContain(t("sourceCheck.recheck"));
    expect(container.textContent).not.toContain(t("sourceCheck.clear"));
  });

  it("渡したボタンだけが出る（3 つとも渡す）", () => {
    const { container, getByText } = render(
      <LocaleProvider>
        <SourceCheckDetailSection
          profile={profile([entry()])}
          onRecheck={() => {}}
          onDismiss={() => {}}
          onClear={() => {}}
        />
      </LocaleProvider>,
    );
    openDetail(container);
    expect(() => getByText(t("sourceCheck.recheck"))).not.toThrow();
    expect(() => getByText(t("sourceCheck.dismiss"))).not.toThrow();
    expect(() => getByText(t("sourceCheck.clear"))).not.toThrow();
  });

  it("dismissed のときは「確認を取り消す」に変わる", () => {
    const { container, getByText } = render(
      <LocaleProvider>
        <SourceCheckDetailSection
          profile={profile([entry()], { dismissed: true })}
          onDismiss={() => {}}
        />
      </LocaleProvider>,
    );
    openDetail(container);
    expect(() => getByText(t("sourceCheck.undismiss"))).not.toThrow();
    expect(container.textContent).not.toContain(t("sourceCheck.dismiss"));
  });

  it("ボタンを何も渡さなければフッターにボタンが 1 つも出ない", () => {
    const { container } = render(
      <LocaleProvider>
        <SourceCheckDetailSection profile={profile([entry()])} />
      </LocaleProvider>,
    );
    openDetail(container);
    expect(container.querySelectorAll("button").length).toBe(1); // 開閉トグルのみ
  });

  it("source-missing は missingReason を i18n ラベルで出す（保存済み rationale より優先）", () => {
    const { container } = render(
      <LocaleProvider>
        <SourceCheckDetailSection
          profile={profile([
            entry({
              verdict: "source-missing",
              rationale: "(stale rationale saved in another language)",
              missingReason: "no-reference",
            }),
          ])}
        />
      </LocaleProvider>,
    );
    openDetail(container);
    expect(container.textContent).toContain(t("sourceCheck.missingReason.no-reference"));
    expect(container.textContent).not.toContain("stale rationale saved in another language");
  });

  it("missingReason が無い source-missing は rationale をそのまま出す", () => {
    const { container } = render(
      <LocaleProvider>
        <SourceCheckDetailSection
          profile={profile([
            entry({ verdict: "source-missing", rationale: "fallback rationale text" }),
          ])}
        />
      </LocaleProvider>,
    );
    openDetail(container);
    expect(container.textContent).toContain("fallback rationale text");
  });

  it("stale のときは先頭に注意書きが出る", () => {
    const { container } = render(
      <LocaleProvider>
        <SourceCheckDetailSection profile={profile([entry()])} stale />
      </LocaleProvider>,
    );
    openDetail(container);
    expect(container.textContent).toContain(t("sourceCheck.staleHint"));
  });

  it("stale でなければ注意書きは出ない", () => {
    const { container } = render(
      <LocaleProvider>
        <SourceCheckDetailSection profile={profile([entry()])} />
      </LocaleProvider>,
    );
    openDetail(container);
    expect(container.textContent).not.toContain(t("sourceCheck.staleHint"));
  });

  it("quote があれば引用として表示する", () => {
    const { container } = render(
      <LocaleProvider>
        <SourceCheckDetailSection
          profile={profile([entry({ quote: "測定された値は 3.2 Wm^-1K^-1 だった。" })])}
        />
      </LocaleProvider>,
    );
    openDetail(container);
    const blockquote = container.querySelector("blockquote");
    expect(blockquote?.textContent).toContain("測定された値は 3.2 Wm^-1K^-1 だった。");
  });

  it("sourceTitles があれば出典名をそのラベルで出す", () => {
    const { container } = render(
      <LocaleProvider>
        <SourceCheckDetailSection
          profile={profile([entry({ sourceId: "note-abc123" })])}
          sourceTitles={{ "note-abc123": "実験ノート 03" }}
        />
      </LocaleProvider>,
    );
    openDetail(container);
    expect(container.textContent).toContain("実験ノート 03");
  });

  // 開けない出典に「開く」導線を出さない（レビュー指摘）。
  it.each(["not-recorded", "ai-answer", "no-reference"] as const)(
    "missingReason が %s の行は出典名をリンクにしない",
    (reason) => {
      const { container, getByText } = render(
        <LocaleProvider>
          <SourceCheckDetailSection
            profile={profile([entry({ verdict: "source-missing", missingReason: reason })])}
            onOpenSource={() => {}}
          />
        </LocaleProvider>,
      );
      openDetail(container);
      // 出典名がボタン（リンク）ではなく、ただの span で出る
      const sourceLabelEl = getByText(entry().sourceId);
      expect(sourceLabelEl.tagName).not.toBe("BUTTON");
      // 開閉トグル以外にボタンが無い（下部の「該当箇所へ」も blockId が無いため出ない）
      expect(container.querySelectorAll("button").length).toBe(1);
    },
  );

  it("開ける出典（missingReason 以外）は onOpenSource があればリンクにする", () => {
    const { container, getByText } = render(
      <LocaleProvider>
        <SourceCheckDetailSection profile={profile([entry()])} onOpenSource={() => {}} />
      </LocaleProvider>,
    );
    openDetail(container);
    const button = getByText("note-1").closest("button");
    expect(button).toBeTruthy();
  });

  it("quoteLocation（PDF ページのみ）があれば注記を出す", () => {
    const { container } = render(
      <LocaleProvider>
        <SourceCheckDetailSection
          profile={profile([entry({ quote: "抜粋", quoteLocation: { page: 4 } })])}
        />
      </LocaleProvider>,
    );
    openDetail(container);
    expect(container.textContent).toContain(t("sourceCheck.quoteLocation.page", { page: "4" }));
    // 読み上げで「何の位置か」が伝わるよう、注記の直前に読み上げ専用の前置きがある
    const prefix = container.querySelector(".sr-only");
    expect(prefix?.textContent?.trim()).toBe(t("sourceCheck.quoteLocation.srPrefix"));
    expect(prefix?.parentElement?.textContent).toContain(t("sourceCheck.quoteLocation.page", { page: "4" }));
  });

  it("quoteLocation（PDF ページまたぎ）は範囲表記になる", () => {
    const { container } = render(
      <LocaleProvider>
        <SourceCheckDetailSection
          profile={profile([entry({ quote: "抜粋", quoteLocation: { page: 7, pageEnd: 8 } })])}
        />
      </LocaleProvider>,
    );
    openDetail(container);
    expect(container.textContent).toContain(
      t("sourceCheck.quoteLocation.pageRange", { page: "7", pageEnd: "8" }),
    );
  });

  it("quoteLocation（Word 段落）があれば段落番号を出す", () => {
    const { container } = render(
      <LocaleProvider>
        <SourceCheckDetailSection
          profile={profile([entry({ quote: "抜粋", quoteLocation: { paragraph: 12 } })])}
        />
      </LocaleProvider>,
    );
    openDetail(container);
    expect(container.textContent).toContain(
      t("sourceCheck.quoteLocation.paragraph", { paragraph: "12" }),
    );
  });

  it("quoteLocation が無ければ位置の注記は出ない", () => {
    const { container } = render(
      <LocaleProvider>
        <SourceCheckDetailSection profile={profile([entry({ quote: "抜粋" })])} />
      </LocaleProvider>,
    );
    openDetail(container);
    for (const n of [1, 2, 3, 4, 5, 6, 7, 8, 9]) {
      expect(container.textContent).not.toContain(t("sourceCheck.quoteLocation.page", { page: String(n) }));
      expect(container.textContent).not.toContain(t("sourceCheck.quoteLocation.paragraph", { paragraph: String(n) }));
    }
  });

  it("quote が無くても quoteLocation だけあれば壊れず注記が出る", () => {
    const { container } = render(
      <LocaleProvider>
        <SourceCheckDetailSection
          profile={profile([entry({ quoteLocation: { page: 2 } })])}
        />
      </LocaleProvider>,
    );
    openDetail(container);
    expect(container.textContent).toContain(t("sourceCheck.quoteLocation.page", { page: "2" }));
    expect(container.querySelector("blockquote")).toBeNull();
  });

  it("running のときは「もう一度照合」を無効化する", () => {
    const { container, getByText } = render(
      <LocaleProvider>
        <SourceCheckDetailSection profile={profile([entry()])} onRecheck={() => {}} running />
      </LocaleProvider>,
    );
    openDetail(container);
    const button = getByText(t("sourceCheck.recheck")).closest("button") as HTMLButtonElement;
    expect(button.disabled).toBe(true);
  });
});
