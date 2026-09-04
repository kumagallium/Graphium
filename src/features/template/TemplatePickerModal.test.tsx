// @vitest-environment jsdom
// /template ピッカーのテスト。公式とチームを 1 つの表にまとめた構造を守る。
//
// 対象の不変条件:
// - 表は 1 つだけ。チームのテンプレートは公式の後ろに行として続く
//   （別セクションに分けると同じ土俵で比べられなくなる）
// - 共有ルートが無い（未設定 / 非デスクトップ）ときはチーム行も空案内も出さない
//   — 共有を使っていない人に「チーム」という概念を見せない
// - 共有ルートがあれば、まだ 1 件も共有されていなくても空案内の 1 行は出す
// - 行に出すのは type=template だけ。題名・説明・「チーム」バッジ・作者を見せ、
//   選ぶと SharedEntry がそのまま呼び出し側に渡る（本文の読み出しは note-app の責務）

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

const teamRows = (container: HTMLElement) =>
  Array.from(container.querySelectorAll('[data-testid="team-template-row"]'));
const officialRows = (container: HTMLElement) =>
  Array.from(container.querySelectorAll('[data-testid="official-template-row"]'));

beforeEach(() => {
  __setSharedLibraryLoaderForTest(null, { root: null });
});

afterEach(() => {
  cleanup();
  __setSharedLibraryLoaderForTest(null, { root: null });
});

describe("TemplatePickerModal のチームのテンプレート", () => {
  it("共有ルートが無いときはチーム行も空案内も出さず、共有ライブラリも読まない", async () => {
    const { container, load } = await renderPicker({ root: null });
    expect(teamRows(container).length).toBe(0);
    expect(container.querySelector('[data-testid="team-template-placeholder"]')).toBeNull();
    expect(load).not.toHaveBeenCalled();
    // 公式テンプレートの表は従来どおり 1 つだけ
    expect(container.querySelectorAll("table").length).toBe(1);
    expect(officialRows(container).length).toBeGreaterThan(0);
  });

  it("共有ルートがあり 1 件も無ければ、表の末尾に空案内の 1 行を出す", async () => {
    const { container } = await renderPicker({ root: ROOT, entries: [NOTE] });
    const placeholder = container.querySelector('[data-testid="team-template-placeholder"]');
    expect(placeholder).not.toBeNull();
    expect(placeholder?.textContent).toContain(t("template.picker.teamEmpty"));
    // 表は 1 つのまま。note エントリはテンプレートではないので行にならない
    expect(container.querySelectorAll("table").length).toBe(1);
    expect(teamRows(container).length).toBe(0);
    expect(container.textContent).not.toContain("ただのノート");
  });

  it("type=template を公式と同じ表の後ろに並べ、題名・説明・チームバッジ・作者を見せる", async () => {
    const { container } = await renderPicker({ root: ROOT, entries: [...TEMPLATES, NOTE] });
    expect(container.querySelectorAll("table").length).toBe(1);
    const rows = teamRows(container);
    expect(rows.length).toBe(2);
    expect(rows[0].textContent).toContain("焼結の実験手順");
    expect(rows[0].textContent).toContain("電気炉での焼結");
    expect(rows[0].textContent).toContain(t("template.modal.sourceTeam"));
    expect(rows[0].textContent).toContain(AUTHOR.name);
    // 説明が無いエントリは説明行そのものを出さない
    expect(rows[1].textContent).toContain("説明なしテンプレ");
    // 空案内は 1 件でもあれば出さない
    expect(container.querySelector('[data-testid="team-template-placeholder"]')).toBeNull();

    // 列数は公式と揃える（タグは共有側に無いので空セル）
    expect(rows[0].querySelectorAll("td").length).toBe(3);
    // 公式行のあとにチーム行が来る
    const all = Array.from(container.querySelectorAll("tbody tr"));
    const official = officialRows(container);
    expect(all.indexOf(rows[0])).toBeGreaterThan(all.indexOf(official[official.length - 1]));
  });

  it("行を選ぶと SharedEntry がそのまま渡る", async () => {
    const onSelectShared = vi.fn();
    const { container } = await renderPicker({ root: ROOT, entries: TEMPLATES }, onSelectShared);
    fireEvent.click(teamRows(container)[0]);
    expect(onSelectShared).toHaveBeenCalledTimes(1);
    expect(onSelectShared.mock.calls[0][0].id).toBe("t1");
  });

  it("検索は 1 本の入力で公式とチームの両方に効く", async () => {
    const { container } = await renderPicker({ root: ROOT, entries: TEMPLATES });
    const input = container.querySelector("input")!;
    fireEvent.change(input, { target: { value: "電気炉" } });
    const rows = teamRows(container);
    expect(rows.length).toBe(1);
    expect(rows[0].textContent).toContain("焼結の実験手順");
    // 公式テンプレートは一致しないので行が消える（表は 1 つのまま）
    expect(officialRows(container).length).toBe(0);
    expect(container.querySelectorAll("table").length).toBe(1);
  });
});
