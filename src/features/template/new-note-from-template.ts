// 「テンプレートから新しいノート」の組み立て（左ナビ「+ ノート」▾ の入口）
//
// 差し込み（insert.ts）は開いているノートへ足すが、こちらはテンプレートの中身で
// 新規ノートを作る。ノートの作成と遷移は呼び出し側（note-app）が持つ関数を deps で
// 受け取り、ここでは「どのテンプレートを、どの由来つきで文書にするか」だけを決める。
// 共有テンプレートは素材の実体化が要るので note-app の既存経路
// （handleSharedCreateNoteFromTemplate）に任せ、ここは組み込み・個人だけを扱う。

import { useMemo } from "react";
import type { GraphiumDocument } from "../../lib/document-types";
import { useSharedLibrary } from "../sharing/shared-library-store";
import { buildDocumentFromTemplate, buildDocumentFromTemplateDef } from "./from-page-template";
import { getAllTemplates } from "./templates";
import { getUserTemplate, useUserTemplates } from "./user-template-store";
import { t as tStatic } from "../../i18n";

export type NewNoteFromTemplateDeps = {
  /** 文書からノートを作って id を返す（fm.handleCreateNoteFromImport 相当） */
  createNote: (doc: GraphiumDocument) => Promise<string>;
  /** 作ったノートを開く */
  openNote: (noteId: string) => void;
};

/** 組み込みテンプレートから新規ノート。見つからなければ null */
export async function createNoteFromOfficialTemplate(
  templateId: string,
  deps: NewNoteFromTemplateDeps,
  t: (key: string) => string = tStatic,
): Promise<string | null> {
  const def = getAllTemplates().find((x) => x.id === templateId);
  if (!def) return null;
  const title = t(def.titleKey);
  const doc = buildDocumentFromTemplateDef(
    def,
    { title, templateFrom: { officialTemplateId: def.id, title, usedAt: new Date().toISOString() } },
    t,
  );
  const noteId = await deps.createNote(doc);
  deps.openNote(noteId);
  return noteId;
}

/** 個人テンプレートから新規ノート。読めない（消された・壊れた）ときは null */
export async function createNoteFromUserTemplate(
  id: string,
  deps: NewNoteFromTemplateDeps,
): Promise<string | null> {
  const record = await getUserTemplate(id);
  if (!record) return null;
  const doc = buildDocumentFromTemplate(record.template, {
    title: record.title,
    templateFrom: { userTemplateId: record.id, title: record.title, usedAt: new Date().toISOString() },
  });
  const noteId = await deps.createNote(doc);
  deps.openNote(noteId);
  return noteId;
}

/**
 * 「テンプレートから…」で選べるものが 1 件でもあるか。
 * 組み込み・個人・チーム（共有ライブラリの type=template）のどれかがあれば true。
 */
export function useHasTemplates(): boolean {
  const user = useUserTemplates();
  const shared = useSharedLibrary();
  return useMemo(
    () =>
      getAllTemplates().length > 0 ||
      user.items.length > 0 ||
      shared.entries.some((e) => e.type === "template"),
    [user.items, shared.entries],
  );
}
