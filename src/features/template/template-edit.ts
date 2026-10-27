// 個人テンプレートの編集画面（メイン画面に開く）のための下回り。
//
// 設計判断:
// - 編集画面はノートのエディタ（NoteEditor）をそのまま使う。ラベル・表のふるまい・
//   メディアのラベルを、ノートと同じ操作で直せるようにするため。
// - ノートは作らない。テンプレートを GraphiumDocument に包んでエディタへ渡し、
//   保存は appData のレコードへの上書き（updateUserTemplate）だけにする。
//   索引・来歴の記録・版・素材の使用箇所には触れない。
// - 包むときにブロック id を振り直さない（差し込み・新規ノートとは違う）。
//   ラベルや表のふるまいは blockId をキーに持つので、同じ id のまま編集して書き戻す。
// - 一覧（TemplatePickerModal）はノートの中・サイドピークの中・左ナビの 3 か所から開く。
//   「編集」はメイン画面を切り替える操作なので、どこから押されても NoteApp に届くよう、
//   受け口を 1 つだけ持つ（setTemplatePickerCallback と同じ形）。

import type { GraphiumDocument } from "../../lib/document-types";
import { LATEST_DOCUMENT_VERSION } from "../../lib/document-migration";
import type { StepAttributes } from "../context-label/label-attributes";
import type { UserTemplateRecord } from "./user-template-store";

/** 編集画面のエディタの保存キー（ノートの id・wiki:・skill: と衝突しない） */
export function templateEditDocKey(id: string): string {
  return `template:${id}`;
}

/** 個人テンプレートを、編集画面のエディタに渡す文書に包む（純関数・元のレコードは変えない） */
export function userTemplateToEditDocument(record: UserTemplateRecord): GraphiumDocument {
  const tpl = record.template;
  return {
    version: LATEST_DOCUMENT_VERSION,
    title: record.title,
    pages: [
      {
        id: "main",
        title: record.title,
        blocks: structuredClone(tpl.blocks ?? []),
        labels: Object.fromEntries(tpl.labels ?? []),
        provLinks: [],
        knowledgeLinks: [],
        ...(tpl.tableMeta ? { tableMeta: structuredClone(tpl.tableMeta) } : {}),
        ...(tpl.mediaInlineLabels ? { mediaInlineLabels: structuredClone(tpl.mediaInlineLabels) } : {}),
      },
    ],
    createdAt: record.createdAt,
    modifiedAt: record.updatedAt,
  };
}

/** 連動属性（ページに保存されないので、レコードから別に渡してエディタのストアへ戻す） */
export function userTemplateAttributes(record: UserTemplateRecord): [string, StepAttributes][] {
  return structuredClone(record.template.attributes ?? []);
}

/**
 * 編集画面を開いた 1 回分（エディタを作り直すたびに新しくする）。
 * attributesRef: エディタが「いまの連動属性を読む関数」を入れる。保存のたびに読む
 * （連動属性はラベルストアにしか無く、保存される文書に載らないため）。
 * initialTitle: 開いたときの題名。エディタで題名を変えたときだけレコードの題名を書き換える
 * （編集中に一覧で改名されたとき、自動保存が古い題名で書き戻さないように）。
 * discarded: この回の編集を捨てた（「編集前に戻す」・テンプレートが消えた）。後から届く
 * 書き出しを書かずに捨てる目印
 */
export type TemplateEditing = {
  initialTitle: string;
  initialAttributes: [string, StepAttributes][];
  attributesRef: { current: (() => [string, StepAttributes][]) | null };
  discarded: boolean;
};

/** レコードから編集の 1 回分を作る */
export function startTemplateEditing(record: UserTemplateRecord): TemplateEditing {
  return {
    initialTitle: record.title,
    initialAttributes: userTemplateAttributes(record),
    attributesRef: { current: null },
    discarded: false,
  };
}

// ── 一覧の「編集」から編集画面を開く要求の受け口 ──

type EditHandler = (id: string) => void;
let editHandler: EditHandler | null = null;

/** NoteApp が受け口を登録する。戻り値で外す（自分が登録したものだけ外す） */
export function setUserTemplateEditHandler(handler: EditHandler): () => void {
  editHandler = handler;
  return () => {
    if (editHandler === handler) editHandler = null;
  };
}

/** 受け口。未登録（Storybook・テストなど）なら null で、一覧は「編集」を出さない */
export function getUserTemplateEditHandler(): EditHandler | null {
  return editHandler;
}
