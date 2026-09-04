// @vitest-environment jsdom
// /template ピッカーの「チームのテンプレート」欄のテスト。
//
// 対象の不変条件:
// - 共有ルートが無い（未設定 / 非デスクトップ）ときはチーム欄そのものを出さない
//   — 共有を使っていない人に「チーム」という概念を見せない
// - 共有ルートがあれば、まだ 1 件も共有されていなくても欄は出す（空だと分かる）
// - 一覧に出すのは type=template だけ。行は題名・説明・作者を見せ、選ぶと
//   SharedEntry がそのまま呼び出し側に渡る（本文の読み出しは note-app の責務）

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, fireEvent, cleanup, act } from "@testing-library/react";
import { TemplatePickerModal } from "./TemplatePickerModal";
import { LocaleProvider, t } from "../../i18n";
import type { SharedEntry, SharedEntryType } from "../../lib/storage/shared";
import {
  __setSharedLibraryLoaderForTest,
  groupSharedEntriesByType,
} from "../sharing/shared-library-store";
import type { SharedLibraryLoadResult } from "../sharing/shared-library-loader";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const ROOT = "/tmp/shared-root";
const AUTHOR = { name: "Ada", email: "ada@example.com" };

const entry = (
  id: string,
  type: SharedEntryType,
  extra: Record<string, unknown>,
): SharedEntry =>
  ({
    id,
    type,
    author: AUTHOR,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-02T00:00:00Z",
    hash: `sha256:${id}`,
    prov: { derived_from: [] },
    version: 1,
    extra,
  }) as SharedEntry;

const TEMPLATES = [
  entry("t1", "template", { title: "焼結の実験手順", description: "電気炉での焼結", stepCount: 3 }),
  entry("t2", "template", { title: "説明なしテンプレ" }),
];
const NOTE = entry("n1", "note", { title: "ただのノート" });

const result = (entries: SharedEntry[]): SharedLibraryLoadResult => ({
  entries: groupSharedEntriesByType(entries),
  errors: {},
});

/** ローダーを設定してピッカーを描き、開いたときの読み直しを待つ */
async function renderPicker(
  options: { root: string | null; entries?: SharedEntry[] },
  onSelectShared: (e: SharedEntry) => void = () => {},
) {
  const load = vi.fn(async () => result(options.entries ?? []));
  __setSharedLibraryLoaderForTest(load, { root: options.root });
  const view = render(
    <LocaleProvider>
      <TemplatePickerModal
        onSelect={() => {}}
        onSelectShared={onSelectShared}
        onClose={() => {}}
      />
    </LocaleProvider>,
  );
  // 開いた時点の refreshSharedLibrary（非同期）を流し切る
  await act(async () => {
    await Promise.resolve();
  });
  return { ...view, load };
}

beforeEach(() => {
  __setSharedLibraryLoaderForTest(null, { root: null });
});

afterEach(() => {
  cleanup();
  __setSharedLibraryLoaderForTest(null, { root: null });
});

describe("TemplatePickerModal のチーム欄", () => {
  it("共有ルートが無いときはチーム欄を出さず、共有ライブラリも読まない", async () => {
    const { container, load } = await renderPicker({ root: null });
    expect(container.querySelector('[data-testid="team-template-section"]')).toBeNull();
    expect(load).not.toHaveBeenCalled();
    // 公式テンプレートの表は従来どおり出る
    expect(container.querySelectorAll("table").length).toBe(1);
  });

  it("共有ルートがあり 1 件も無ければ、欄は出して空だと伝える", async () => {
    const { container } = await renderPicker({ root: ROOT, entries: [NOTE] });
    const section = container.querySelector('[data-testid="team-template-section"]');
    expect(section).not.toBeNull();
    expect(section?.textContent).toContain(t("template.picker.teamSection"));
    expect(section?.textContent).toContain(t("template.picker.teamEmpty"));
    // note エントリはテンプレートではないので行にならない
    expect(section?.querySelector("tbody")).toBeNull();
  });

  it("type=template の題名・説明・作者を並べる", async () => {
    const { container } = await renderPicker({ root: ROOT, entries: [...TEMPLATES, NOTE] });
    const section = container.querySelector('[data-testid="team-template-section"]')!;
    const rows = Array.from(section.querySelectorAll("tbody tr"));
    expect(rows.length).toBe(2);
    expect(rows[0].textContent).toContain("焼結の実験手順");
    expect(rows[0].textContent).toContain("電気炉での焼結");
    expect(rows[0].textContent).toContain(AUTHOR.name);
    // 説明が無いエントリは説明行そのものを出さない
    expect(rows[1].textContent).toContain("説明なしテンプレ");
    expect(section.textContent).not.toContain("ただのノート");
  });

  it("行を選ぶと SharedEntry がそのまま渡る", async () => {
    const onSelectShared = vi.fn();
    const { container } = await renderPicker({ root: ROOT, entries: TEMPLATES }, onSelectShared);
    const section = container.querySelector('[data-testid="team-template-section"]')!;
    const row = section.querySelectorAll("tbody tr")[0];
    fireEvent.click(row);
    expect(onSelectShared).toHaveBeenCalledTimes(1);
    expect(onSelectShared.mock.calls[0][0].id).toBe("t1");
  });

  it("検索は公式とチームの両方に効く", async () => {
    const { container } = await renderPicker({ root: ROOT, entries: TEMPLATES });
    const input = container.querySelector("input")!;
    fireEvent.change(input, { target: { value: "電気炉" } });
    const section = container.querySelector('[data-testid="team-template-section"]')!;
    const rows = Array.from(section.querySelectorAll("tbody tr"));
    expect(rows.length).toBe(1);
    expect(rows[0].textContent).toContain("焼結の実験手順");
    // 公式テンプレートは一致しないので表ごと消える（残る table はチーム欄の 1 つだけ）
    expect(container.querySelectorAll("table").length).toBe(1);
  });
});
