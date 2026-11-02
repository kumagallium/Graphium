// 個人テンプレートのストアのテスト（偽 provider = Map で appData を持つ）
import { describe, it, expect, beforeEach } from "vitest";
import {
  USER_TEMPLATE_KEY_PREFIX,
  countUserTemplatesReferencingAsset,
  __setUserTemplateProviderForTest,
  deleteUserTemplate,
  getUserTemplate,
  getUserTemplatesSnapshot,
  isUserTemplateSupported,
  listUserTemplates,
  renameUserTemplate,
  revertUserTemplate,
  saveUserTemplate,
  updateUserTemplate,
  updateUserTemplateAttributes,
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

  it("素材の URL を本文（入れ子・インラインリンク含む）に持つテンプレートだけを数える", async () => {
    const { provider } = fakeProvider();
    const img = "graphium-media://img-1";
    await saveUserTemplate({
      title: "画像入り",
      page: page({ blocks: [{ id: "c1", type: "image", props: { url: img } }] } as Partial<GraphiumPage>),
      provider,
    });
    await saveUserTemplate({
      title: "入れ子",
      page: page({
        blocks: [{ id: "c2", type: "paragraph", children: [{ id: "c3", type: "image", props: { url: img } }] }],
      } as Partial<GraphiumPage>),
      provider,
    });
    await saveUserTemplate({
      title: "リンク",
      page: page({
        blocks: [{ id: "c4", type: "paragraph", content: [{ type: "link", href: "https://example.com/a", content: [] }] }],
      } as Partial<GraphiumPage>),
      provider,
    });
    await saveUserTemplate({ title: "無関係", page: page(), provider });

    expect(await countUserTemplatesReferencingAsset({ url: img }, provider)).toBe(2);
    expect(await countUserTemplatesReferencingAsset({ url: "https://example.com/a" }, provider)).toBe(1);
    expect(await countUserTemplatesReferencingAsset({ url: "graphium-media://other" }, provider)).toBe(0);
    // 非対応の保存先・URL の無い素材は 0（ダイアログを止めない）
    expect(await countUserTemplatesReferencingAsset({ url: img }, null)).toBe(0);
    expect(await countUserTemplatesReferencingAsset({ url: "" }, provider)).toBe(0);
  });

  it("編集の上書き: id・作成日時・説明を残し、題名・本文・属性を差し替える。消えたものは生き返らせない", async () => {
    const { provider, store } = fakeProvider();
    const rec = await saveUserTemplate({ title: "元", description: "説明", page: page(), provider });
    await new Promise((r) => setTimeout(r, 5));
    const edited = page({
      blocks: [{ id: "b1", type: "paragraph" }, { id: "b3", type: "paragraph" }],
      labels: { b1: "[手順]", b3: "[材料]" },
    });
    expect(
      await updateUserTemplate(rec.id, {
        title: " 直した ",
        page: edited,
        attributes: [["b1", { checked: false, executor: "machine", status: "planned" }], ["zz", { checked: true } as any]],
        provider,
      }),
    ).toBe(true);
    const after = (await getUserTemplate(rec.id, provider))!;
    expect(after.id).toBe(rec.id);
    expect(after.createdAt).toBe(rec.createdAt);
    expect(after.description).toBe("説明");
    expect(after.title).toBe("直した");
    expect(after.template.name).toBe("直した");
    expect(after.updatedAt > rec.updatedAt).toBe(true);
    expect(after.template.blocks.map((b: any) => b.id)).toEqual(["b1", "b3"]);
    expect(after.template.labels).toEqual([["b1", "[手順]"], ["b3", "[材料]"]]);
    // ラベルの無いブロックの属性は落とす
    expect(after.template.attributes.map(([id]) => id)).toEqual(["b1"]);
    // 空の題名は今の題名のまま
    expect(await updateUserTemplate(rec.id, { title: "  ", page: edited, provider })).toBe(true);
    expect((await getUserTemplate(rec.id, provider))!.title).toBe("直した");

    await deleteUserTemplate(rec.id, provider);
    expect(await updateUserTemplate(rec.id, { title: "x", page: edited, provider })).toBe(false);
    expect(store.size).toBe(0);
  });

  it("属性だけの書き換え: 中身が同じなら書かない・ラベルの無いブロックの分は落とす", async () => {
    const { provider } = fakeProvider();
    const rec = await saveUserTemplate({
      title: "T",
      page: page(),
      attributes: [["b1", { checked: false, executor: "human", status: "planned" }]],
      provider,
    });
    let writes = 0;
    const counting: typeof provider = {
      ...provider,
      writeAppData: async (k, v) => {
        writes++;
        await provider.writeAppData!(k, v);
      },
    };
    expect(await updateUserTemplateAttributes(rec.id, rec.template.attributes, counting)).toBe(true);
    expect(writes).toBe(0);
    expect(
      await updateUserTemplateAttributes(
        rec.id,
        [["b1", { checked: false, executor: "machine", status: "planned" }], ["b2", { checked: true } as any]],
        counting,
      ),
    ).toBe(true);
    expect(writes).toBe(1);
    const after = (await getUserTemplate(rec.id, provider))!;
    expect(after.template.attributes).toEqual([["b1", { checked: false, executor: "machine", status: "planned" }]]);
    // 本文はそのまま
    expect(after.template.blocks).toEqual(rec.template.blocks);
    expect(await updateUserTemplateAttributes("missing", [], provider)).toBe(false);
  });

  it("編集前に戻す: 題名と本文を開いた時点のものへ。説明は今のまま", async () => {
    const { provider } = fakeProvider();
    const original = await saveUserTemplate({ title: "元", description: "説明", page: page(), provider });
    await updateUserTemplate(original.id, { title: "直した", page: page({ blocks: [] }), provider });
    expect(await revertUserTemplate(original, provider)).toBe(true);
    const after = (await getUserTemplate(original.id, provider))!;
    expect(after.title).toBe("元");
    expect(after.template).toEqual(original.template);
    expect(after.description).toBe("説明");
    await deleteUserTemplate(original.id, provider);
    expect(await revertUserTemplate(original, provider)).toBe(false);
  });
});
