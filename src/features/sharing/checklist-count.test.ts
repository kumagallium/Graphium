import { describe, expect, it } from "vitest";
import type { SharedEntry } from "../../lib/storage/shared";
import { buildIndexEntry } from "../navigation/index-file";
import type { GraphiumDocument } from "../../lib/document-types";
import {
  buildChecklistMirror,
  checklistCountOfDocument,
  getSharedChecklistCount,
  parseChecklistCount,
  readChecklistMirror,
} from "./checklist-count";

const item = (id: string, text: string, checked: boolean, children: unknown[] = []) => ({
  id,
  type: "checkListItem",
  props: { checked },
  content: text ? [{ type: "text", text }] : [],
  children,
});

function docWith(blocks: unknown[]): GraphiumDocument {
  return {
    version: 5,
    title: "一次発酵",
    pages: [{ id: "p1", title: "一次発酵", blocks, labels: {}, provLinks: [], knowledgeLinks: [] }],
    createdAt: "2026-11-24T00:00:00Z",
    modifiedAt: "2026-11-24T00:00:00Z",
  } as unknown as GraphiumDocument;
}

function note(extra: Record<string, unknown>, over: Partial<SharedEntry> = {}): SharedEntry {
  return {
    id: "rec-1",
    type: "note",
    author: { name: "Sato", email: "sato@example.com" },
    created_at: "2026-11-24T00:00:00Z",
    updated_at: "2026-11-24T00:00:00Z",
    hash: "sha256:entry-1",
    prov: { derived_from: [] },
    extra,
    ...over,
  } as SharedEntry;
}

describe("parseChecklistCount", () => {
  it("整数で、0 ≦ 印 ≦ 全体、全体は 1 以上のものだけ通す", () => {
    expect(parseChecklistCount({ checked: 3, total: 5 })).toEqual({ checked: 3, total: 5 });
    expect(parseChecklistCount({ checked: 0, total: 1 })).toEqual({ checked: 0, total: 1 });
    expect(parseChecklistCount({ checked: 5, total: 5, bodyHash: "x" })).toEqual({ checked: 5, total: 5 });
  });

  it("形が合わないものは null（封筒も控えも、こちらが書いた形とは限らない）", () => {
    for (const raw of [
      null,
      undefined,
      "3/5",
      [3, 5],
      {},
      { checked: 6, total: 5 },
      { checked: -1, total: 5 },
      { checked: 0, total: 0 },
      { checked: 1.5, total: 5 },
      { checked: "3", total: "5" },
      { checked: 1, total: 10000 },
      { checked: Number.NaN, total: 5 },
    ]) {
      expect(parseChecklistCount(raw)).toBeNull();
    }
  });
});

describe("checklistCountOfDocument", () => {
  it("チェックリストが無いノートは null（0 件と出さない）", () => {
    expect(checklistCountOfDocument(docWith([{ id: "b1", type: "paragraph", content: [] }]))).toBeNull();
    expect(checklistCountOfDocument(null)).toBeNull();
    expect(checklistCountOfDocument({})).toBeNull();
  });

  it("入れ子の項目も数え、本文が空の項目は数えない", () => {
    const doc = docWith([
      item("c1", "粉を量る", true, [item("c1-1", "塩も量る", false)]),
      item("c2", "", true),
      { id: "s1", type: "paragraph", content: [], children: [item("c3", "温度を測る", true)] },
    ]);
    expect(checklistCountOfDocument(doc)).toEqual({ checked: 2, total: 3 });
  });

  it("索引の checklist（list_todos の一覧）と同じ件数になる", () => {
    const doc = docWith([item("c1", "粉を量る", true), item("c2", "こねる", false), item("c3", "", false)]);
    const indexed = buildIndexEntry("n1", doc).checklist ?? [];
    expect(checklistCountOfDocument(doc)).toEqual({
      checked: indexed.filter((i) => i.checked).length,
      total: indexed.length,
    });
  });
});

describe("封筒の写し（extra.checklist）", () => {
  const doc = docWith([item("c1", "粉を量る", true), item("c2", "こねる", false)]);

  it("数えた本文の指紋を入れて作る。チェックリストが無ければ作らない", () => {
    expect(buildChecklistMirror(doc, "sha256:body-1")).toEqual({ checked: 1, total: 2, bodyHash: "sha256:body-1" });
    expect(buildChecklistMirror(docWith([]), "sha256:body-1")).toBeUndefined();
    expect(buildChecklistMirror(doc, "")).toBeUndefined();
  });

  it("封筒の bodyHash と合う写しだけ読む", () => {
    const mirror = buildChecklistMirror(doc, "sha256:body-1");
    expect(readChecklistMirror(note({ bodyHash: "sha256:body-1", checklist: mirror }))).toEqual({ checked: 1, total: 2 });
  });

  it("この写しを知らない版が本文を書き換えたあと（bodyHash だけが進んだ封筒）は読まない", () => {
    const mirror = buildChecklistMirror(doc, "sha256:body-1");
    expect(readChecklistMirror(note({ bodyHash: "sha256:body-2", checklist: mirror }))).toBeNull();
    // bodyHash の無い古い封筒に写しだけがある形も読まない
    expect(readChecklistMirror(note({ checklist: mirror }))).toBeNull();
    // 写しに指紋が無い
    expect(readChecklistMirror(note({ bodyHash: "sha256:body-1", checklist: { checked: 1, total: 2 } }))).toBeNull();
  });

  it("ノート以外の封筒からは読まない", () => {
    const mirror = buildChecklistMirror(doc, "sha256:body-1");
    expect(
      readChecklistMirror(note({ bodyHash: "sha256:body-1", checklist: mirror }, { type: "knowledge" })),
    ).toBeNull();
  });
});

describe("getSharedChecklistCount", () => {
  const mirror = { checked: 1, total: 2, bodyHash: "sha256:body-1" };

  it("同じ版の本文を読んで数えた控えが先（写しは申告、控えは確かめた本文から数えた値）", () => {
    const entry = note({ bodyHash: "sha256:body-1", checklist: mirror });
    const derived = { "rec-1": { hash: "sha256:entry-1", checklist: { checked: 2, total: 2 } } };
    expect(getSharedChecklistCount(entry, derived)).toEqual({ checked: 2, total: 2 });
  });

  it("控えが無い・別の版・件数を持たないときは、封筒の写しを使う", () => {
    const entry = note({ bodyHash: "sha256:body-1", checklist: mirror });
    expect(getSharedChecklistCount(entry, undefined)).toEqual({ checked: 1, total: 2 });
    expect(
      getSharedChecklistCount(entry, { "rec-1": { hash: "sha256:old", checklist: { checked: 2, total: 2 } } }),
    ).toEqual({ checked: 1, total: 2 });
    // 件数を拾う前の版が作った控え（hash は同じ・件数なし）
    expect(getSharedChecklistCount(entry, { "rec-1": { hash: "sha256:entry-1" } })).toEqual({ checked: 1, total: 2 });
  });

  it("id が Object の持ち物の名前でも、控えとして拾わない", () => {
    expect(getSharedChecklistCount(note({}, { id: "constructor" }), {})).toBeNull();
    expect(getSharedChecklistCount(note({}, { id: "__proto__" }), {})).toBeNull();
  });

  it("写しが無い・合わないときは、同じ版の本文を読んだ控えで補う", () => {
    const derived = { "rec-1": { hash: "sha256:entry-1", checklist: { checked: 2, total: 4 } } };
    expect(getSharedChecklistCount(note({}), derived)).toEqual({ checked: 2, total: 4 });
    expect(getSharedChecklistCount(note({ bodyHash: "sha256:body-2", checklist: mirror }), derived)).toEqual({
      checked: 2,
      total: 4,
    });
  });

  it("控えが別の版のもの・件数を持たないものなら null", () => {
    expect(
      getSharedChecklistCount(note({}), { "rec-1": { hash: "sha256:old", checklist: { checked: 2, total: 4 } } }),
    ).toBeNull();
    expect(getSharedChecklistCount(note({}), { "rec-1": { hash: "sha256:entry-1" } })).toBeNull();
    expect(getSharedChecklistCount(note({}), undefined)).toBeNull();
  });
});
