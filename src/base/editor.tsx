import "@blocknote/core/fonts/inter.css";
import "@blocknote/shadcn/style.css";

import {
  useCreateBlockNote,
  SideMenuController,
  SuggestionMenuController,
  FormattingToolbarController,
  getDefaultReactSlashMenuItems,
} from "@blocknote/react";
import { BlockNoteView } from "@blocknote/shadcn";
import { BlockNoteSchema, defaultBlockSpecs } from "@blocknote/core";
import { filterSuggestionItems } from "@blocknote/core/extensions";
import { FC, useCallback, useEffect, useMemo } from "react";
import type { CustomBlockEntry } from "./schema";
import type { SideMenuProps, FormattingToolbarProps } from "@blocknote/react";
import { buildSuggestionList, getDisplayName } from "@features/context-label/hashtag-menu";

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
  /**
   * カスタムFormattingToolbarコンポーネントを渡す。
   * - undefined: デフォルトのFormattingToolbar
   * - FC: カスタムFormattingToolbar
   */
  formattingToolbar?: FC<FormattingToolbarProps>;
  /** 追加のスラッシュメニューアイテム */
  extraSlashMenuItems?: SlashMenuItem[];
  /** エディタインスタンスを外部に公開するコールバック */
  onEditorReady?: (editor: any) => void;
  /** エディタの内容が変更されたときのコールバック */
  onChange?: () => void;
  /** メディアファイルアップロードハンドラ（File → URL を返す） */
  uploadFile?: (file: File) => Promise<string>;
  /** # ラベルオートコンプリートで選択されたときのコールバック */
  onHashtagSelect?: (blockId: string, label: string) => void;
  /** @ 参照リンクで選択されたときのコールバック */
  onMentionSelect?: (sourceBlockId: string, suggestion: import("@features/block-link/mention-menu").ReferenceSuggestion) => void;
  /** @ 参照リンクの候補を取得する関数（外部から注入） */
  getMentionSuggestions?: () => import("@features/block-link/mention-menu").ReferenceSuggestion[];
};

// サンドボックス共通エディタ
// blocks を渡すだけでカスタムブロック入りエディタが立ち上がる
export function SandboxEditor({
  blocks = [],
  initialContent,
  sideMenu,
  formattingToolbar,
  extraSlashMenuItems,
  onEditorReady,
  onChange,
  uploadFile,
  onHashtagSelect,
  onMentionSelect,
  getMentionSuggestions,
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
    uploadFile,
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

  // # ラベルオートコンプリート
  const labelSuggestions = useMemo(() => buildSuggestionList(), []);
  const getHashtagItems = useCallback(
    async (query: string) => {
      const items = labelSuggestions.map((s) => ({
        title: s.displayName,
        group: s.group === "core" ? "コアラベル" : s.group === "alias" ? "エイリアス" : "フリーラベル",
        onItemClick: () => {
          const block = (editor as any).getTextCursorPosition?.()?.block;
          if (block && onHashtagSelect) {
            onHashtagSelect(block.id, s.label);
          }
        },
      }));
      return filterSuggestionItems(items as any, query) as any;
    },
    [editor, labelSuggestions, onHashtagSelect],
  );

  // @ 参照リンクオートコンプリート
  const getMentionItems = useCallback(
    async (query: string) => {
      const suggestions = getMentionSuggestions?.() ?? [];
      const items = suggestions.map((s) => ({
        title: s.label,
        group: s.group,
        onItemClick: () => {
          const block = (editor as any).getTextCursorPosition?.()?.block;
          if (block && onMentionSelect) {
            onMentionSelect(block.id, s);
          }
        },
      }));
      return filterSuggestionItems(items as any, query) as any;
    },
    [editor, getMentionSuggestions, onMentionSelect],
  );

  return (
    <BlockNoteView
      editor={editor as any}
      theme="light"
      sideMenu={sideMenu === false ? false : usesCustomSideMenu ? false : undefined}
      formattingToolbar={formattingToolbar ? false : undefined}
      slashMenu={hasExtraSlash ? false : undefined}
      onChange={onChange}
    >
      {usesCustomSideMenu && (
        <SideMenuController sideMenu={sideMenu as FC<SideMenuProps>} />
      )}
      {formattingToolbar && (
        <FormattingToolbarController formattingToolbar={formattingToolbar} />
      )}
      {hasExtraSlash && (
        <SuggestionMenuController
          triggerCharacter="/"
          getItems={getSlashItems as any}
          {...({} as any)}
        />
      )}
      {onHashtagSelect && (
        <SuggestionMenuController
          triggerCharacter="#"
          getItems={getHashtagItems as any}
          {...({} as any)}
        />
      )}
      {onMentionSelect && (
        <SuggestionMenuController
          triggerCharacter="@"
          getItems={getMentionItems as any}
          {...({} as any)}
        />
      )}
    </BlockNoteView>
  );
}
