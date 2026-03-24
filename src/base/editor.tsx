import "@blocknote/core/fonts/inter.css";
import "@blocknote/shadcn/style.css";

import {
  useCreateBlockNote,
  SideMenuController,
  SuggestionMenuController,
  getDefaultReactSlashMenuItems,
} from "@blocknote/react";
import { BlockNoteView } from "@blocknote/shadcn";
import { BlockNoteSchema, defaultBlockSpecs } from "@blocknote/core";
import { filterSuggestionItems } from "@blocknote/core/extensions";
import { FC, useEffect, useMemo } from "react";
import type { CustomBlockEntry } from "./schema";
import type { SideMenuProps } from "@blocknote/react";

type SlashMenuItem = {
  title: string;
  subtext?: string;
  group: string;
  aliases?: string[];
  onItemClick: (editor: any) => void;
};

type SandboxEditorProps = {
  blocks?: CustomBlockEntry[];
  initialContent?: any[];
  /**
   * カスタムSideMenuコンポーネントを渡す。
   * - undefined: デフォルトのSideMenu
   * - false: SideMenuを非表示
   * - FC: カスタムSideMenuコンポーネント
   */
  sideMenu?: FC<SideMenuProps> | false;
  /** 追加のスラッシュメニューアイテム */
  extraSlashMenuItems?: SlashMenuItem[];
  /** エディタインスタンスを外部に公開するコールバック */
  onEditorReady?: (editor: any) => void;
  /** エディタの内容が変更されたときのコールバック */
  onChange?: () => void;
};

// サンドボックス共通エディタ
// blocks を渡すだけでカスタムブロック入りエディタが立ち上がる
export function SandboxEditor({
  blocks = [],
  initialContent,
  sideMenu,
  extraSlashMenuItems,
  onEditorReady,
  onChange,
}: SandboxEditorProps) {
  const customSpecs = Object.fromEntries(
    blocks.map((b) => [b.type, typeof b.spec === "function" ? b.spec() : b.spec])
  );

  const schema = BlockNoteSchema.create({
    blockSpecs: {
      ...defaultBlockSpecs,
      ...customSpecs,
    } as any,
  });

  const editor = useCreateBlockNote({
    schema,
    initialContent: initialContent?.length ? (initialContent as any) : undefined,
  });

  // エディタインスタンスを外部に公開
  useEffect(() => {
    onEditorReady?.(editor);
  }, [editor, onEditorReady]);

  // カスタムSideMenuを渡した場合: デフォルトを無効にして手動レンダリング
  const usesCustomSideMenu = sideMenu !== undefined && sideMenu !== false;
  const hasExtraSlash = extraSlashMenuItems && extraSlashMenuItems.length > 0;

  // スラッシュメニューのカスタム getItems
  const getSlashItems = useMemo(() => {
    if (!hasExtraSlash) return undefined;
    return async (query: string) => {
      const defaultItems = getDefaultReactSlashMenuItems(editor as any);
      const allItems = [...defaultItems, ...extraSlashMenuItems];
      return filterSuggestionItems(allItems as any, query) as any;
    };
  }, [editor, hasExtraSlash, extraSlashMenuItems]);

  return (
    <BlockNoteView
      editor={editor as any}
      theme="light"
      sideMenu={sideMenu === false ? false : usesCustomSideMenu ? false : undefined}
      slashMenu={hasExtraSlash ? false : undefined}
      onChange={onChange}
    >
      {usesCustomSideMenu && (
        <SideMenuController sideMenu={sideMenu as FC<SideMenuProps>} />
      )}
      {hasExtraSlash && (
        <SuggestionMenuController
          triggerCharacter="/"
          getItems={getSlashItems as any}
          {...({} as any)}
        />
      )}
    </BlockNoteView>
  );
}
