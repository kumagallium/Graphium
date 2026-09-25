// スラッシュメニューの「新しいノート」（名前を付けて新規ノートを作成し、ここにリンク）。
//
// `@` メニューは IME の変換確定でメニューが閉じてしまい、日本語名を打ち切れない。
// `/` メニューは矢印キーで選べる（日本語入力が要らない）ので、名前だけを IME 安全な
// ダイアログ（new-note-name-dialog）で入れてもらう、確実な作成入口。
//
// メインエディタと SidePeek の両方に出す。以前はメイン（note-app）にだけ手書きの項目が
// あり、ピークには出ていなかった。組み立てはここ 1 か所にまとめ、何を記録するか
// （reference リンクと派生関係）もここで決める。各エディタが渡すのは記録先だけ
// （自分の linkStore と、開いているノートの noteLinks）。

import type { SlashMenuItem } from "../../base/slash-menu-types";
import type { NoteLink } from "../../lib/document-types";
import { t } from "../../i18n";
import { insertNoteMentionInline } from "./mention-menu";

/** reference リンクの記録口（メイン・ピークどちらの linkStore.addLink でも渡せる最小形） */
export type AddReferenceLink = (params: {
  sourceBlockId: string;
  targetBlockId: string;
  targetNoteId: string;
  type: "reference";
  createdBy: "human";
}) => unknown;

export type NewNoteSlashItemDeps = {
  /** ノート名を尋ねる（IME 安全なダイアログ）。キャンセルは null */
  promptNoteName: (initial: string) => Promise<string | null>;
  /**
   * 空のノートを作って ID を返す。失敗は null。
   * 新しいノートの派生元はここで決まる（SidePeek は表示中のノートを渡す）
   */
  createNote: (title: string) => Promise<string | null>;
  /**
   * @リンクを入れるエディタ。押されたときのエディタでなく、入れる時点のものを返す
   * （メインは名前を入れている間の自動保存でエディタが作り直されることがある）
   */
  getEditor: () => any;
  /** reference リンクの記録先（そのエディタの linkStore） */
  addLink: AddReferenceLink;
  /** 派生関係の記録先（そのエディタで開いているノートの noteLinks） */
  addNoteLink: (link: NoteLink) => void;
};

export function buildNewNoteSlashItem(deps: NewNoteSlashItemDeps): SlashMenuItem {
  return {
    // ラベルは getter で遅延評価する。呼び出し側は生成した項目を useMemo で保持するため、
    // ここで t() を即時評価すると言語を切り替えても古いラベルが残る。
    get title() { return t("slashMenu.newNote.title"); },
    get subtext() { return t("slashMenu.newNote.subtext"); },
    get group() { return t("slashMenu.newNote.group"); },
    aliases: ["note", "newnote", "新しいノート", "新規ノート", "しんきのーと", "あたらしいのーと"],
    onItemClick: (editor: any) => {
      // リンク元は押した時点のカーソルのブロック
      const sourceBlockId: string | undefined = editor?.getTextCursorPosition?.()?.block?.id;
      void (async () => {
        const title = (await deps.promptNoteName(""))?.trim() ?? "";
        if (!title) return; // キャンセル
        const noteId = await deps.createNote(title);
        if (!noteId) return;
        setTimeout(() => {
          const target = deps.getEditor();
          if (!target) return;
          // insertInlineContent の onChange で自動保存が走る
          insertNoteMentionInline(target, noteId, title);
          // 記録は入れた直後に（本文に入らなかったリンクを残さない）
          if (!sourceBlockId) return;
          deps.addLink({
            sourceBlockId,
            targetBlockId: "",
            targetNoteId: noteId,
            type: "reference",
            createdBy: "human",
          });
          deps.addNoteLink({ targetNoteId: noteId, sourceBlockId, type: "derived_from" });
        }, 50);
      })();
    },
  };
}
