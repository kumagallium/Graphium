// 個人テンプレートのストアのテスト（偽 provider = Map で appData を持つ）
import { describe, it, expect, beforeEach } from "vitest";
import {
  USER_TEMPLATE_KEY_PREFIX,
  __setUserTemplateProviderForTest,
  deleteUserTemplate,
  getUserTemplate,
  getUserTemplatesSnapshot,
  isUserTemplateSupported,
  listUserTemplates,
  renameUserTemplate,
  saveUserTemplate,
  type UserTemplateProvider,
} from "./user-template-store";
import type { GraphiumPage } from "../../lib/document-types";

function fakeProvider() {
  const store = new Map<string, unknown>();
  const provider: UserTemplateProvider = {
    readAppData: async (k) => (store.has(k) ? store.get(k)! : null),
    writeAppData: async (k, v) => {
      store.set(k, structuredClone(v));
    },
    listAppDataKeys: async (prefix) => [...store.keys()].filter((k) => k.startsWith(prefix)),
    deleteAppData: async (k) => {
      store.delete(k);
    },
  };
  return { store, provider };
}

const page = (over: Partial<GraphiumPage> = {}): GraphiumPage =>
  ({
    id: "p1",
    title: "焼結ノート",
    blocks: [{ id: "b1", type: "paragraph" }, { id: "b2", type: "paragraph" }],
    labels: { b1: "[手順]" },
    ...over,
  }) as unknown as GraphiumPage;

beforeEach(() => __setUserTemplateProviderForTest(null));

describe("user-template-store", () => {
  it("保存 → 一覧 → 改名 → 削除が通る", async () => {
    const { provider, store } = fakeProvider();
    const rec = await saveUserTemplate({ title: " 手順 ", description: "説明", page: page(), provider });
    expect(rec.title).toBe("手順");
    expect(store.has(`${USER_TEMPLATE_KEY_PREFIX}${rec.id}`)).toBe(true);
    expect((await listUserTemplates(provider)).map((r) => r.id)).toEqual([rec.id]);
    // 保存の直後に購読ストアも更新されている
    expect(getUserTemplatesSnapshot().items.map((r) => r.id)).toEqual([rec.id]);

    expect(await renameUserTemplate(rec.id, "新しい名前", provider)).toBe(true);
    expect((await getUserTemplate(rec.id, provider))?.title).toBe("新しい名前");
    expect(await renameUserTemplate(rec.id, "  ", provider)).toBe(false);

    await deleteUserTemplate(rec.id, provider);
    expect(await listUserTemplates(provider)).toEqual([]);
    expect(getUserTemplatesSnapshot().items).toEqual([]);
  });

  it("一覧は updatedAt の降順で、壊れたレコードは飛ばす", async () => {
    const { provider, store } = fakeProvider();
    const a = await saveUserTemplate({ title: "A", page: page(), provider });
    await new Promise((r) => setTimeout(r, 5));
    const b = await saveUserTemplate({ title: "B", page: page(), provider });
    store.set(`${USER_TEMPLATE_KEY_PREFIX}broken`, { nope: true });
    store.set(`${USER_TEMPLATE_KEY_PREFIX}str`, "text");
    // キーと id が合わないレコードも読めない扱い
    store.set(`${USER_TEMPLATE_KEY_PREFIX}mismatch`, store.get(`${USER_TEMPLATE_KEY_PREFIX}${a.id}`));
    expect((await listUserTemplates(provider)).map((r) => r.id)).toEqual([b.id, a.id]);
  });

  it("attributes はラベル付きブロックのものだけを残し、labels はページのものを使う", async () => {
    const { provider } = fakeProvider();
    const rec = await saveUserTemplate({
      title: "T",
      page: page(),
      attributes: [
        ["b1", { checked: true } as any],
        ["b2", { checked: true } as any],
      ],
      provider,
    });
    expect(rec.template.labels).toEqual([["b1", "[手順]"]]);
    expect(rec.template.attributes.map(([id]) => id)).toEqual(["b1"]);
  });

  it("tableMeta / mediaInlineLabels をテンプレートに入れる", async () => {
    const { provider } = fakeProvider();
    const rec = await saveUserTemplate({
      title: "T",
      page: page({
        tableMeta: { b2: { name: "表" } as any },
        mediaInlineLabels: { b1: { label: "x" } as any },
      }),
      provider,
    });
    expect(rec.template.tableMeta).toBeDefined();
    expect(rec.template.mediaInlineLabels).toBeDefined();
  });

  it("appData の 4 メソッドが無い保存先は非対応", () => {
    const { provider } = fakeProvider();
    expect(isUserTemplateSupported(provider)).toBe(true);
    expect(isUserTemplateSupported({ ...provider, deleteAppData: undefined })).toBe(false);
    expect(isUserTemplateSupported({ ...provider, listAppDataKeys: undefined })).toBe(false);
    expect(isUserTemplateSupported(null)).toBe(false);
  });
});
