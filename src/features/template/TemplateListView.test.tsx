// @vitest-environment jsdom
// テンプレートの一覧画面のテスト。公式・自分・共有を 1 つの表に並べ、元のノートと
// 使ったノートの出し分け、削除・共有解除の確認を押さえる。

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, fireEvent, cleanup, act, within } from "@testing-library/react";
import { TemplateListView, type TemplateListNote, type TemplateListViewProps } from "./TemplateListView";
import { LocaleProvider, t } from "../../i18n";
import type { SharedEntry, SharedEntryType } from "../../lib/storage/shared";
import { __setSharedLibraryLoaderForTest, groupSharedEntriesByType } from "../sharing/shared-library-store";
import type { SharedLibraryLoadResult } from "../sharing/shared-library-loader";
import { __setConfirmResponderForTest } from "../../ui/confirm-dialog";
import {
  __setUserTemplateProviderForTest,
  saveUserTemplate,
  USER_TEMPLATE_KEY_PREFIX,
  type UserTemplateProvider,
} from "./user-template-store";
import type { GraphiumPage } from "../../lib/document-types";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const ROOT = "/tmp/shared-root";
const ME = { name: "Ada", email: "ada@example.com" };
const OTHER = { name: "Bob", email: "bob@example.com" };

const entry = (id: string, author: typeof ME, extra: Record<string, unknown>): SharedEntry =>
  ({
    id,
    type: "template" as SharedEntryType,
    author,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-02T00:00:00Z",
    hash: `sha256:${id}`,
    prov: { derived_from: [] },
    version: 1,
    extra,
  }) as SharedEntry;

function fakeProvider() {
  const store = new Map<string, unknown>();
  const provider: UserTemplateProvider = {
    readAppData: async (k) => (store.has(k) ? store.get(k)! : null),
    writeAppData: async (k, v) => {
      store.set(k, structuredClone(v));
    },
    listAppDataKeys: async (p) => [...store.keys()].filter((k) => k.startsWith(p)),
    deleteAppData: async (k) => {
      store.delete(k);
    },
  };
  return { store, provider };
}

const page = (): GraphiumPage =>
  ({ id: "p", title: "Feeding", blocks: [{ id: "b1", type: "paragraph" }], labels: {} }) as unknown as GraphiumPage;

const NOTES: TemplateListNote[] = [
  { noteId: "n-src", title: "Starter day 1" },
  { noteId: "n-used1", title: "Bake 1", templateFrom: { kind: "official", id: "plan" } },
  { noteId: "n-used2", title: "Bake 2", templateFrom: { kind: "official", id: "plan" } },
];

async function setup(
  opts: {
    entries?: SharedEntry[];
    notes?: TemplateListNote[];
    props?: Partial<TemplateListViewProps>;
    seed?: (provider: UserTemplateProvider, store: Map<string, unknown>) => Promise<void>;
  } = {},
) {
  const { provider, store } = fakeProvider();
  __setUserTemplateProviderForTest(provider);
  await opts.seed?.(provider, store);
  const load = async (): Promise<SharedLibraryLoadResult> => ({
    entries: groupSharedEntriesByType(opts.entries ?? []),
    errors: {},
  });
  __setSharedLibraryLoaderForTest(load, { root: ROOT });
  const props: TemplateListViewProps = {
    onBack: () => {},
    notes: opts.notes ?? NOTES,
    onOpenNote: vi.fn(),
    onCreateFromOfficial: vi.fn(),
    onCreateFromUser: vi.fn(),
    onCreateFromShared: vi.fn(),
    onUnshare: vi.fn(),
    onUploadMedia: vi.fn(async () => "x"),
    currentEmail: ME.email,
    ...opts.props,
  };
  const view = render(
    <LocaleProvider>
      <TemplateListView {...props} />
    </LocaleProvider>,
  );
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
  return { ...view, props, store, provider };
}

const rowOf = (container: HTMLElement, title: string) => {
  const row = Array.from(container.querySelectorAll('[data-testid="template-row"]')).find((r) =>
    r.textContent?.includes(title),
  );
  if (!row) throw new Error(`row not found: ${title}`);
  return row as HTMLElement;
};

async function clickMenuItem(row: HTMLElement, label: string) {
  fireEvent.click(within(row).getByTestId("template-row-menu"));
  const item = Array.from(document.body.querySelectorAll("button")).find((b) => b.textContent === label);
  if (!item) throw new Error(`menu item not found: ${label}`);
  await act(async () => {
    fireEvent.click(item);
    await new Promise((r) => setTimeout(r, 0));
  });
}

beforeEach(() => {
  __setSharedLibraryLoaderForTest(null, { root: null });
});

afterEach(() => {
  cleanup();
  __setConfirmResponderForTest(null);
  __setUserTemplateProviderForTest(null);
  __setSharedLibraryLoaderForTest(null, { root: null });
});

describe("TemplateListView", () => {
  it("公式・自分・共有の 3 種類を 1 つの表に並べる", async () => {
    const { container } = await setup({
      entries: [entry("s1", ME, { title: "Shared log" })],
      seed: async (p) => {
        await saveUserTemplate({ title: "My starter log", page: page(), provider: p });
      },
    });
    expect(container.querySelectorAll("table").length).toBe(1);
    const kinds = Array.from(container.querySelectorAll('[data-testid="template-row"]')).map((r) => r.getAttribute("data-kind"));
    expect(kinds).toContain("official");
    expect(kinds).toContain("user");
    expect(kinds).toContain("shared");
    expect(rowOf(container, "My starter log").textContent).toContain(t("templateList.place.thisPc"));
    expect(rowOf(container, "Shared log").textContent).toContain(t("templateList.kind.shared"));
    // 自分・共有があるときは空の案内を出さない
    expect(container.querySelector('[data-testid="template-list-empty"]')).toBeNull();
  });

  it("自分・共有が 1 件も無いときは案内を出す", async () => {
    const { container } = await setup();
    expect(container.querySelector('[data-testid="template-list-empty"]')?.textContent).toBe(t("templateList.empty"));
  });

  it("種類の絞り込みと名前の検索が効く", async () => {
    const { container, getByText } = await setup({
      entries: [entry("s1", ME, { title: "Shared log" })],
      seed: async (p) => {
        await saveUserTemplate({ title: "My starter log", page: page(), provider: p });
      },
    });
    fireEvent.click(getByText(t("templateList.kind.shared"), { selector: "button" }));
    expect(container.querySelectorAll('[data-testid="template-row"]').length).toBe(1);
    fireEvent.click(getByText(t("templateList.filter.all")));
    fireEvent.change(container.querySelector("input[type=text], input:not([type])")!, { target: { value: "starter" } });
    const rows = container.querySelectorAll('[data-testid="template-row"]');
    expect(rows.length).toBe(1);
    expect(rows[0].textContent).toContain("My starter log");
  });

  describe("元のノート", () => {
    it("自分のテンプレート: 見つかれば開ける・消えていれば押せない・記録なしは「記録なし」", async () => {
      const { container, props } = await setup({
        seed: async (p, store) => {
          await saveUserTemplate({ title: "Has source", page: page(), sourceNote: { id: "n-src", title: "Starter day 1" }, provider: p });
          await saveUserTemplate({ title: "Lost source", page: page(), sourceNote: { id: "gone", title: "Deleted note" }, provider: p });
          // 古い記録（sourceNote のフィールド自体が無い）も読める
          const legacy = await saveUserTemplate({ title: "Legacy", page: page(), provider: p });
          const raw = store.get(`${USER_TEMPLATE_KEY_PREFIX}${legacy.id}`) as Record<string, unknown>;
          delete raw.sourceNote;
        },
      });
      const link = within(rowOf(container, "Has source")).getByTestId("template-source-link");
      expect(link.textContent).toBe("Starter day 1");
      fireEvent.click(link);
      expect(props.onOpenNote).toHaveBeenCalledWith("n-src");

      const lost = rowOf(container, "Lost source");
      expect(within(lost).getByTestId("template-source-missing").textContent).toBe(t("templateList.source.missing"));
      expect(within(lost).queryByTestId("template-source-link")).toBeNull();

      expect(rowOf(container, "Legacy").textContent).toContain(t("templateList.source.none"));
    });

    it("共有テンプレート: 自分のものは開ける・他人のものは題名だけ", async () => {
      const { container } = await setup({
        entries: [
          entry("mine", ME, { title: "Mine shared", sourceNote: { id: "n-src", title: "Starter day 1" } }),
          entry("theirs", OTHER, { title: "Theirs shared", sourceNote: { id: "n-src", title: "Bob's note" } }),
          entry("old", ME, { title: "No record" }),
        ],
      });
      expect(within(rowOf(container, "Mine shared")).getByTestId("template-source-link")).toBeTruthy();
      const theirs = rowOf(container, "Theirs shared");
      expect(within(theirs).queryByTestId("template-source-link")).toBeNull();
      expect(within(theirs).getByTestId("template-source-title").textContent).toBe("Bob's note");
      expect(rowOf(container, "No record").textContent).toContain(t("templateList.source.none"));
    });

    it("ファイルから読み込んだ分（id なし）は題名だけ見せる", async () => {
      const { container } = await setup({
        seed: async (p) => {
          await saveUserTemplate({ title: "Imported", page: page(), provider: p });
          const [rec] = await (await import("./user-template-store")).listUserTemplates(p);
          await p.writeAppData!(`${USER_TEMPLATE_KEY_PREFIX}${rec.id}`, { ...rec, sourceNote: { title: "Sender's note" } });
        },
      });
      const row = rowOf(container, "Imported");
      expect(within(row).getByTestId("template-source-title").textContent).toBe("Sender's note");
    });
  });

  it("使ったノートの件数は索引の templateFrom から数え、開くと題名のリストから開ける", async () => {
    const { container, props } = await setup();
    // 公式の「計画」テンプレートは 2 件のノートに使われている
    const plan = Array.from(container.querySelectorAll('[data-testid="template-row"][data-kind="official"]')).find(
      (r) => within(r as HTMLElement).getByTestId("template-used-toggle").textContent === t("templateList.used.count", { count: "2" }),
    ) as HTMLElement;
    expect(plan).toBeTruthy();
    fireEvent.click(within(plan).getByTestId("template-used-toggle"));
    const notes = container.querySelectorAll('[data-testid="template-used-note"]');
    expect(Array.from(notes).map((n) => n.textContent)).toEqual(["Bake 1", "Bake 2"]);
    fireEvent.click(notes[0]);
    expect(props.onOpenNote).toHaveBeenCalledWith("n-used1");
  });

  it("⋯ の「このテンプレートで新しいノート」は種類ごとの作成関数を呼ぶ", async () => {
    const { container, props } = await setup({
      entries: [entry("s1", OTHER, { title: "Shared log" })],
      seed: async (p) => {
        await saveUserTemplate({ title: "My log", page: page(), provider: p });
      },
    });
    await clickMenuItem(rowOf(container, "Shared log"), t("templateList.menu.newNote"));
    expect(props.onCreateFromShared).toHaveBeenCalledWith("s1");
    await clickMenuItem(rowOf(container, "My log"), t("templateList.menu.newNote"));
    expect(props.onCreateFromUser).toHaveBeenCalledTimes(1);
    const official = container.querySelector('[data-testid="template-row"][data-kind="official"]') as HTMLElement;
    await clickMenuItem(official, t("templateList.menu.newNote"));
    expect(props.onCreateFromOfficial).toHaveBeenCalledTimes(1);
  });

  it("削除は確認を経る（断れば残り、了承すれば消える）", async () => {
    const { container, provider } = await setup({
      seed: async (p) => {
        await saveUserTemplate({ title: "To delete", page: page(), provider: p });
      },
    });
    const confirm = vi.fn(async () => false);
    __setConfirmResponderForTest(confirm);
    await clickMenuItem(rowOf(container, "To delete"), t("template.user.delete"));
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(rowOf(container, "To delete")).toBeTruthy();

    confirm.mockResolvedValue(true);
    await clickMenuItem(rowOf(container, "To delete"), t("template.user.delete"));
    expect(confirm).toHaveBeenCalledTimes(2);
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(Array.from(container.querySelectorAll('[data-testid="template-row"]')).some((r) => r.textContent?.includes("To delete"))).toBe(false);
    void provider;
  });

  it("共有解除は自分の共有テンプレートだけに出て、確認を経る", async () => {
    const mine = entry("mine", ME, { title: "Mine shared" });
    const { container, props } = await setup({
      entries: [mine, entry("theirs", OTHER, { title: "Theirs shared" })],
    });
    // 他人のものには出ない
    fireEvent.click(within(rowOf(container, "Theirs shared")).getByTestId("template-row-menu"));
    expect(Array.from(document.body.querySelectorAll("button")).some((b) => b.textContent === t("library.unshare"))).toBe(false);
    cleanup();

    const again = await setup({ entries: [mine] });
    const confirm = vi.fn(async () => false);
    __setConfirmResponderForTest(confirm);
    await clickMenuItem(rowOf(again.container, "Mine shared"), t("library.unshare"));
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(again.props.onUnshare).not.toHaveBeenCalled();
    confirm.mockResolvedValue(true);
    await clickMenuItem(rowOf(again.container, "Mine shared"), t("library.unshare"));
    expect(again.props.onUnshare).toHaveBeenCalledTimes(1);
    void props;
  });

  it("共有フォルダが未設定なら「共有する」は押せない", async () => {
    const { container } = await setup({
      seed: async (p) => {
        await saveUserTemplate({ title: "My log", page: page(), provider: p });
      },
    });
    fireEvent.click(within(rowOf(container, "My log")).getByTestId("template-row-menu"));
    const share = Array.from(document.body.querySelectorAll("button")).find((b) => b.textContent === t("templateList.menu.share"));
    expect(share?.hasAttribute("disabled")).toBe(true);
  });
});
