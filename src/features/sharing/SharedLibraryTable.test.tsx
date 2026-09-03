// @vitest-environment jsdom
// 共有ライブラリの表「フォルダ列」が、ノート一覧のフォルダ列と同じ見せ方になっているかのテスト。
//
// 対象の不変条件（鏡の原則 — 同じ意味のものは同じ見た目で出す）:
// - 列ヘッダにノート一覧と同じ説明ツールチップ（nav.noteContextsTooltip）が付く
// - フォルダ無しの行のダッシュは、ノート一覧と同じ薄さ（text-muted-foreground/30）
// - 絞り込みポップアップの選択肢に、表のピル（ContextBadge）と同じ色のドットが付く
//   （未分類は実在するフォルダではないので色を持たない = 中空のドット）

import { describe, it, expect, afterEach } from "vitest";
import { render, fireEvent, cleanup } from "@testing-library/react";
import { SharedLibraryTable } from "./SharedLibraryTable";
import { LocaleProvider, t } from "../../i18n";
import { ContextBadge } from "../note-context/ContextBadge";
import type { SharedEntry } from "../../lib/storage/shared";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const AUTHOR = { name: "Ada", email: "ada@example.com" };

const entry = (id: string, title: string, noteContexts?: string[]): SharedEntry => ({
  id,
  type: "note",
  author: AUTHOR,
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-02T00:00:00Z",
  hash: `sha256:${id}`,
  prov: { derived_from: [] },
  version: 1,
  extra: noteContexts ? { title, noteContexts } : { title },
});

const ENTRIES = [
  entry("n1", "焼結の記録", ["卒論/焼結"]),
  entry("n2", "装置メモ", ["共通/装置"]),
  entry("n3", "フォルダ無し"),
];

function renderTable() {
  return render(
    <LocaleProvider>
      <SharedLibraryTable
        tab="note"
        entries={ENTRIES}
        currentIdentity={AUTHOR}
        hashStatus={{}}
        selectedId={null}
        busyId={null}
        copiedId={null}
        onSelect={() => {}}
        onVerifyHash={() => {}}
        onCopyCitation={() => {}}
        onUnshare={() => {}}
      />
    </LocaleProvider>,
  );
}

/**
 * 表のピル（ContextBadge）が使う色。jsdom は inline style の hsl() を rgb() に
 * 変換するので、期待値も同じ経路（実際の ContextBadge を描画）から取って比べる。
 */
function badgeColor(value: string): string {
  const { container, unmount } = render(
    <LocaleProvider>
      <ContextBadge value={value} />
    </LocaleProvider>,
  );
  const color = (container.firstElementChild as HTMLElement).style.color;
  unmount();
  return color;
}

afterEach(() => cleanup());

describe("SharedLibraryTable のフォルダ列", () => {
  it("列ヘッダにノート一覧と同じ説明ツールチップが付く", () => {
    const { container } = renderTable();
    const headers = Array.from(container.querySelectorAll("th"));
    const folderTh = headers.find((th) => th.textContent?.includes(t("nav.noteContexts")));
    expect(folderTh?.getAttribute("title")).toBe(t("nav.noteContextsTooltip"));
  });

  it("フォルダ無しの行のダッシュはノート一覧と同じ薄さで出る", () => {
    const { container } = renderTable();
    const dash = Array.from(container.querySelectorAll("span")).find(
      (el) => el.textContent === "—",
    );
    expect(dash?.className).toContain("text-muted-foreground/30");
  });

  it("絞り込みの選択肢に表のピルと同じ色のドットが付く（未分類は色無し）", () => {
    const { container } = renderTable();
    const filterBtn = container.querySelector(
      `button[aria-label="${t("library.filterFolder")}"]`,
    ) as HTMLButtonElement;
    fireEvent.click(filterBtn);

    // ポップアップは portal 経由で body 直下に出る
    const options = Array.from(
      document.body.querySelectorAll('button[role="menuitemcheckbox"]'),
    ) as HTMLElement[];
    for (const folder of ["卒論/焼結", "共通/装置"]) {
      const opt = options.find((o) => o.textContent?.includes(folder));
      const dot = opt?.querySelector("span.rounded-full") as HTMLElement | null;
      expect(dot, `${folder} のドット`).toBeTruthy();
      expect(dot?.style.backgroundColor).toBe(badgeColor(folder));
    }

    // 未分類の選択肢は色を持たず、境界線だけのドットになる
    const unfiled = options.find((o) => o.textContent?.includes(t("nav.unfiled")));
    expect(unfiled, "未分類の選択肢").toBeTruthy();
    const unfiledDot = unfiled?.querySelector("span.rounded-full") as HTMLElement | null;
    expect(unfiledDot?.style.backgroundColor).toBe("");
    expect(unfiledDot?.className).toContain("border-border");
  });
});
