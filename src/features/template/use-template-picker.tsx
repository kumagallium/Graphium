// スラッシュメニューの「テンプレート」から開くピッカー（メインエディタと SidePeek の共通部品）
//
// ピッカーの開閉・受け口の登録・選んだテンプレートの挿入をまとめる。ホストは自分の
// エディタと、そのエディタで開いているノートのストアを渡し、返ってきた dialog を描く。
// SidePeek はメインの並行実装で、同じ処理を別々に書くと片方だけ直って片方が取り残される
// 漏れが繰り返し起きてきたので、ここ 1 か所にまとめてある。

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import type { SharedEntry } from "../../lib/storage/shared";
import { TemplatePickerModal } from "./TemplatePickerModal";
import {
  insertPageTemplate,
  insertTemplateDef,
  loadSharedTemplate,
  type TemplateTargetStores,
} from "./insert";
import { setTemplatePickerCallback } from "./slash-menu-item";
import { getAllTemplates } from "./templates";

type Options = {
  /**
   * 挿入先のエディタで開いているノートのストア。毎レンダリング作り直してよい
   * （選んだ時点の最新を使う）。
   */
  stores: TemplateTargetStores;
  /** 共有テンプレート内の画像・ファイルを自分の素材へ取り込む経路 */
  uploadFile?: (file: File) => Promise<string>;
};

/**
 * editor のスラッシュメニュー「テンプレート」にピッカーを繋ぐ。
 * open はピッカーを出している間 true（ピークはモーダル用の層のクリック受けに使う）。
 */
export function useTemplatePicker(
  editor: any | null,
  { stores, uploadFile }: Options,
): { open: boolean; dialog: ReactNode } {
  const [open, setOpen] = useState(false);
  // スラッシュを打ったブロック（挿入位置）。ピッカーを出している間にカーソルが
  // 動いても、開いた時点の位置に挿す
  const triggerBlockRef = useRef<any>(null);
  const storesRef = useRef(stores);
  storesRef.current = stores;
  const uploadFileRef = useRef(uploadFile);
  uploadFileRef.current = uploadFile;

  useEffect(() => {
    if (!editor) return;
    setTemplatePickerCallback(editor, (triggerBlock) => {
      triggerBlockRef.current = triggerBlock;
      setOpen(true);
    });
    return () => setTemplatePickerCallback(editor, null);
  }, [editor]);

  /** 挿入位置を取り出す（次の選択に備えて空に戻す） */
  const takeTriggerBlock = useCallback((): any => {
    const block = triggerBlockRef.current ?? editor?.getTextCursorPosition?.()?.block ?? null;
    triggerBlockRef.current = null;
    return block;
  }, [editor]);

  const onSelect = useCallback(
    (templateId: string) => {
      setOpen(false);
      const triggerBlock = takeTriggerBlock();
      const template = getAllTemplates().find((x) => x.id === templateId);
      if (!editor || !triggerBlock || !template) return;
      insertTemplateDef(editor, triggerBlock, template, storesRef.current);
    },
    [editor, takeTriggerBlock],
  );

  const onSelectShared = useCallback(
    async (entry: SharedEntry) => {
      setOpen(false);
      // 挿入位置は本文の読み出し（非同期）を跨ぐので先に確保する
      const triggerBlock = takeTriggerBlock();
      if (!editor || !triggerBlock) return;
      const template = await loadSharedTemplate(entry, uploadFileRef.current);
      if (!template) return;
      // 読み出しを待つ間にピークを閉じた・ノートを切り替えたときは挿さない。
      // 画面から外れたエディタに挿しても何も出ず、注釈だけが（いま開いている
      // 別のノートの）ストアに残る
      if (!editor.domElement?.isConnected) return;
      insertPageTemplate(editor, triggerBlock, template, storesRef.current);
    },
    [editor, takeTriggerBlock],
  );

  const onClose = useCallback(() => setOpen(false), []);

  const dialog = open ? (
    <TemplatePickerModal onSelect={onSelect} onSelectShared={onSelectShared} onClose={onClose} />
  ) : null;
  return { open, dialog };
}
