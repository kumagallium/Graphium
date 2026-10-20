// 「テンプレートから新しいノート」の組み立てのテスト（組み込み・個人）
import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  createNoteFromOfficialTemplate,
  createNoteFromUserTemplate,
} from "./new-note-from-template";
import { buildDocumentFromTemplateDef } from "./from-page-template";
import {
  __setUserTemplateProviderForTest,
  saveUserTemplate,
  type UserTemplateProvider,
} from "./user-template-store";
import { getAllTemplates } from "./templates";
import type { GraphiumDocument, GraphiumPage } from "../../lib/document-types";

const identity = (key: string) => key;

function fakeProvider(): UserTemplateProvider {
  const store = new Map<string, unknown>();
  return {
    readAppData: async (k) => (store.has(k) ? store.get(k)! : null),
    writeAppData: async (k, v) => {
      store.set(k, structuredClone(v));
    },
    listAppDataKeys: async (prefix) => [...store.keys()].filter((k) => k.startsWith(prefix)),
    deleteAppData: async (k) => {
      store.delete(k);
    },
  };
}

function allIds(blocks: any[], out: string[] = []): string[] {
  for (const b of blocks) {
    out.push(b.id);
    allIds(b.children ?? [], out);
  }
  return out;
}

function deps() {
  const created: GraphiumDocument[] = [];
  return {
    created,
    createNote: vi.fn(async (doc: GraphiumDocument) => {
      created.push(doc);
      return "new-note-1";
    }),
    openNote: vi.fn(),
  };
}

beforeEach(() => __setUserTemplateProviderForTest(null));

describe("個人テンプレートから新規ノート", () => {
  it("ブロック id を振り直し、templateFrom に userTemplateId を入れ、作成してから開く", async () => {
    const provider = fakeProvider();
    __setUserTemplateProviderForTest(provider);
    const page = {
      id: "p1",
      title: "焼結ノート",
      blocks: [
        { id: "orig-1", type: "paragraph", children: [{ id: "orig-2", type: "paragraph" }] },
        { id: "orig-3", type: "paragraph" },
      ],
      labels: { "orig-1": "free.a" },
      provLinks: [],
      knowledgeLinks: [],
    } as unknown as GraphiumPage;
    const rec = await saveUserTemplate({ title: "焼結の手順", page, provider });

    const d = deps();
    const noteId = await createNoteFromUserTemplate(rec.id, d);

    expect(noteId).toBe("new-note-1");
    expect(d.createNote).toHaveBeenCalledTimes(1);
    expect(d.openNote).toHaveBeenCalledWith("new-note-1");
    const doc = d.created[0];
    // タイトルはテンプレート名
    expect(doc.title).toBe("焼結の手順");
    // 元の id が 1 つも残らない
    const ids = allIds(doc.pages[0].blocks);
    expect(ids).toHaveLength(3);
    for (const orig of ["orig-1", "orig-2", "orig-3"]) expect(ids).not.toContain(orig);
    // ラベルは新しい id へ貼り替わっている
    expect(Object.keys(doc.pages[0].labels)).toEqual([doc.pages[0].blocks[0].id]);
    // 由来
    expect(doc.templateFrom).toMatchObject({ userTemplateId: rec.id, title: "焼結の手順" });
    expect(doc.templateFrom?.sharedId).toBeUndefined();
    expect(typeof doc.templateFrom?.usedAt).toBe("string");
  });

  it("消えたテンプレートは作らず null", async () => {
    __setUserTemplateProviderForTest(fakeProvider());
    const d = deps();
    expect(await createNoteFromUserTemplate("missing", d)).toBeNull();
    expect(d.createNote).not.toHaveBeenCalled();
    expect(d.openNote).not.toHaveBeenCalled();
  });
});

describe("組み込みテンプレートから新規ノート", () => {
  it("実施テンプレート: 毎回新しい id・ラベルと前手順リンクが新 id を指す", () => {
    const def = getAllTemplates().find((x) => x.id === "experiment")!;
    const meta = { title: "x", templateFrom: { officialTemplateId: def.id, title: "x", usedAt: "" } };
    const a = buildDocumentFromTemplateDef(def, meta, identity);
    const b = buildDocumentFromTemplateDef(def, meta, identity);
    const idsA = allIds(a.pages[0].blocks);
    const idsB = allIds(b.pages[0].blocks);
    expect(idsA.filter((id) => idsB.includes(id))).toEqual([]);
    // リンクは実在するブロックを指す
    const links = a.pages[0].provLinks;
    expect(links.length).toBeGreaterThan(0);
    for (const l of links) {
      expect(idsA).toContain(l.sourceBlockId);
      expect(idsA).toContain(l.targetBlockId);
    }
    expect(a.templateFrom?.officialTemplateId).toBe("experiment");
  });

  it("計画テンプレート: 表の先頭列が note-link になる", () => {
    const def = getAllTemplates().find((x) => x.id === "plan")!;
    const doc = buildDocumentFromTemplateDef(
      def,
      { title: "p", templateFrom: { officialTemplateId: "plan", title: "p", usedAt: "" } },
      identity,
    );
    const metas = Object.values(doc.pages[0].tableMeta ?? {});
    expect(metas).toHaveLength(1);
    expect(Object.values(metas[0].columns ?? {})[0]).toEqual(["note-link"]);
  });

  it("createNoteFromOfficialTemplate は作成してから開く。未知 id は null", async () => {
    const d = deps();
    expect(await createNoteFromOfficialTemplate("plan", d, identity)).toBe("new-note-1");
    expect(d.created[0].title).toBe("template.plan.title");
    expect(d.created[0].templateFrom?.officialTemplateId).toBe("plan");
    expect(d.openNote).toHaveBeenCalledWith("new-note-1");
    const d2 = deps();
    expect(await createNoteFromOfficialTemplate("nope", d2, identity)).toBeNull();
    expect(d2.createNote).not.toHaveBeenCalled();
  });
});
