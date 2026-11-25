// 「テンプレートから新しいノート」の組み立て（左ナビ「+ ノート」▾ の入口）
//
// 差し込み（insert.ts）は開いているノートへ足すが、こちらはテンプレートの中身で
// 新規ノートを作る。ノートの作成と遷移は呼び出し側（note-app）が持つ関数を deps で
// 受け取り、ここでは「どのテンプレートを、どの由来つきで文書にするか」だけを決める。
// 共有テンプレートは素材の実体化が要るので note-app の既存経路
// （handleSharedCreateNoteFromTemplate）に任せ、ここは組み込み・個人だけを扱う。

import type { GraphiumDocument } from "../../lib/document-types";
import { buildDocumentFromTemplate, buildDocumentFromTemplateDef } from "./from-page-template";
import { getAllTemplates } from "./templates";
import { getUserTemplate } from "./user-template-store";
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
  // ノートの題は、白紙の新規ノートと同じ既定の題（editor.newNote）で始める。
  // 組み込みテンプレートの名前は「計画テンプレート」のような道具の名前で、ノートの題にはならない。
  // 空文字にはしない — エディタは空の題を editor.newNote で表示するので、保存前の一覧だけ
  // 「(無題)」になって食い違う。どのテンプレートから作ったかは templateFrom.title に残す。
  // 個人・共有テンプレートは利用者が付けた名前なので、題に引き継ぐ（下の関数と note-app）
  const doc = buildDocumentFromTemplateDef(
    def,
    {
      title: t("editor.newNote"),
      templateFrom: { officialTemplateId: def.id, title: t(def.titleKey), usedAt: new Date().toISOString() },
    },
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
