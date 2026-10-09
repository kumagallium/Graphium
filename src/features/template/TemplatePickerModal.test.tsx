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
//   選ぶと SharedEntry がそのまま呼び出し側に渡る（本文の読み出しは useTemplatePicker の責務）

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
import {
  __setUserTemplateProviderForTest,
  refreshUserTemplates,
  saveUserTemplate,
  type UserTemplateProvider,
} from "./user-template-store";
import type { GraphiumPage } from "../../lib/document-types";

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

// ── 自分のテンプレート ──

const userRows = (container: HTMLElement) =>
  Array.from(container.querySelectorAll('[data-testid="user-template-row"]'));

function fakeUserProvider(): UserTemplateProvider {
  const store = new Map<string, unknown>();
  return {
    readAppData: async (k) => (store.has(k) ? store.get(k)! : null),
    writeAppData: async (k, v) => {
      store.set(k, structuredClone(v));
    },
    listAppDataKeys: async (p) => [...store.keys()].filter((k) => k.startsWith(p)),
    deleteAppData: async (k) => {
      store.delete(k);
    },
  };
}

const userPage = (title: string) =>
  ({ id: "p", title, blocks: [{ id: "b", type: "paragraph" }], labels: {} }) as unknown as GraphiumPage;

describe("TemplatePickerModal の自分のテンプレート", () => {
  afterEach(() => __setUserTemplateProviderForTest(null));

  async function renderWithUser(onSelectUser: (id: string) => void = () => {}) {
    const provider = fakeUserProvider();
    __setUserTemplateProviderForTest(provider);
    const a = await saveUserTemplate({ title: "自分の手順", description: "電気炉用", page: userPage("a"), provider });
    await saveUserTemplate({ title: "別の雛形", page: userPage("b"), provider });
    __setSharedLibraryLoaderForTest(async () => result([...TEMPLATES]), { root: ROOT });
    const view = render(
      <LocaleProvider>
        <TemplatePickerModal onSelect={() => {}} onSelectUser={onSelectUser} onClose={() => {}} />
      </LocaleProvider>,
    );
    await act(async () => {
      await refreshUserTemplates(provider);
    });
    return { ...view, a };
  }

  it("公式の後・チームの前に、自分のバッジ付きで並ぶ", async () => {
    const { container } = await renderWithUser();
    const rows = userRows(container);
    expect(rows.length).toBe(2);
    expect(rows[0].textContent).toContain(t("template.source.user"));
    const all = Array.from(container.querySelectorAll("tbody tr"));
    const official = officialRows(container);
    const team = teamRows(container);
    expect(all.indexOf(rows[0])).toBeGreaterThan(all.indexOf(official[official.length - 1]));
    expect(all.indexOf(rows[rows.length - 1])).toBeLessThan(all.indexOf(team[0]));
  });

  it("行を選ぶと onSelectUser に id が渡る", async () => {
    const onSelectUser = vi.fn();
    const { container } = await renderWithUser(onSelectUser);
    const row = userRows(container).find((r) => r.textContent?.includes("自分の手順"))!;
    fireEvent.click(row);
    expect(onSelectUser).toHaveBeenCalledTimes(1);
    expect(typeof onSelectUser.mock.calls[0][0]).toBe("string");
  });

  it("検索は題名・説明に効く", async () => {
    const { container } = await renderWithUser();
    fireEvent.change(container.querySelector("input")!, { target: { value: "電気炉用" } });
    const rows = userRows(container);
    expect(rows.length).toBe(1);
    expect(rows[0].textContent).toContain("自分の手順");
  });

  it("操作ボタンのクリックは行の選択にならず、削除は確認後に行われる", async () => {
    const onSelectUser = vi.fn();
    const { container } = await renderWithUser(onSelectUser);
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    const row = userRows(container).find((r) => r.textContent?.includes("別の雛形"))!;
    const del = row.querySelector(`button[aria-label="${t("template.user.delete")}"]`)!;
    await act(async () => {
      fireEvent.click(del);
    });
    expect(confirm).toHaveBeenCalled();
    expect(onSelectUser).not.toHaveBeenCalled();
    expect(userRows(container).length).toBe(1);
    confirm.mockRestore();
  });

  it("保存先が非対応なら自分の行を出さない", async () => {
    __setUserTemplateProviderForTest(null);
    const { container } = await renderPicker({ root: null });
    expect(userRows(container).length).toBe(0);
  });
});
