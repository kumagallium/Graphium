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
import { filterSuggestionItems as _filterSuggestionItems } from "@blocknote/core/extensions";
import { FC, useCallback, useEffect, useMemo } from "react";
import type { CustomBlockEntry } from "./schema";
import type { SideMenuProps, FormattingToolbarProps } from "@blocknote/react";
import { buildSuggestionList, getDisplayName } from "@features/context-label/hashtag-menu";
import { BlockSelectionManager } from "@features/block-selection";

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
  /** デフォルトスラッシュメニューから除外するアイテムの title */
  excludeDefaultSlashTitles?: string[];
  /** エディタインスタンスを外部に公開するコールバック */
  onEditorReady?: (editor: any) => void;
  /** エディタの内容が変更されたときのコールバック */
  onChange?: () => void;
  /** メディアファイルアップロードハンドラ（File → URL を返す） */
  uploadFile?: (file: File) => Promise<string>;
  /** 保存された URL を表示用 URL に変換する（local-media:// → blob: 等） */
  resolveFileUrl?: (url: string) => Promise<string>;
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
  excludeDefaultSlashTitles,
  onEditorReady,
  onChange,
  uploadFile,
  resolveFileUrl,
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
    resolveFileUrl,
  });

  // エディタインスタンスを外部に公開
  useEffect(() => {
    onEditorReady?.(editor);
  }, [editor, onEditorReady]);

  // カスタムSideMenuを渡した場合: デフォルトを無効にして手動レンダリング
  const usesCustomSideMenu = sideMenu !== undefined && sideMenu !== false;
  const hasExtraSlash = extraSlashMenuItems && extraSlashMenuItems.length > 0;

  // スラッシュメニューのカスタム getItems
  const excludeSet = useMemo(
    () => new Set(excludeDefaultSlashTitles ?? []),
    [excludeDefaultSlashTitles],
  );
  // デフォルトアイテムを1回だけ取得（毎回呼ぶと蓄積する問題を防ぐ）
  const defaultSlashItems = useMemo(() => {
    let items = getDefaultReactSlashMenuItems(editor as any);
    if (excludeSet.size > 0) {
      items = items.filter((item: any) => !excludeSet.has(item.title));
    }
    return items;
  }, [editor, excludeSet]);
  // extra + default を結合（title + group で重複除去 + グループ順にソート）
  const allSlashItems = useMemo(() => {
    if (!hasExtraSlash) return defaultSlashItems;
    const combined = [...defaultSlashItems, ...extraSlashMenuItems];
    // 重複除去
    const seen = new Set<string>();
    const unique = combined.filter((item: any) => {
      const key = `${item.title}|${item.group ?? ""}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    // 同じグループのアイテムを隣接させる（BlockNote がグループヘッダーを重複レンダーするのを防ぐ）
    const groupOrder: string[] = [];
    for (const item of unique) {
      const g = (item as any).group ?? "";
      if (!groupOrder.includes(g)) groupOrder.push(g);
    }
    unique.sort((a: any, b: any) => {
      const ga = groupOrder.indexOf(a.group ?? "");
      const gb = groupOrder.indexOf(b.group ?? "");
      return ga - gb;
    });
    return unique;
  }, [defaultSlashItems, hasExtraSlash, extraSlashMenuItems]);
  const getSlashItems = useMemo(() => {
    if (!hasExtraSlash) return undefined;
    return async (query: string) => {
      if (!query) return allSlashItems as any;
      // カスタムフィルタ: title と aliases のみでマッチ（group 名でのマッチを防ぐ）
      const q = query.toLowerCase();
      return allSlashItems.filter((item: any) => {
        if (item.title?.toLowerCase().includes(q)) return true;
        if (item.aliases?.some((a: string) => a.toLowerCase().includes(q))) return true;
        return false;
      }) as any;
    };
  }, [hasExtraSlash, allSlashItems]);

  // # ラベルオートコンプリート
  const labelSuggestions = useMemo(() => buildSuggestionList(), []);
  const getHashtagItems = useCallback(
    async (query: string) => {
      // クエリが空のときはコアラベル + フリーラベルだけ。
      // alias は v2 以前の旧ブラケット入力を救うための裏導線なので、
      // 何かタイプされてマッチした時にだけ姿を現す方がメニューが整理される。
      const trimmed = query.trim();
      const visible = trimmed.length === 0
        ? labelSuggestions.filter((s) => s.group !== "alias")
        : labelSuggestions;
      const items = visible.map((s) => ({
        title: s.displayName,
        group: s.group === "core" ? "コアラベル" : s.group === "alias" ? "エイリアス" : "フリーラベル",
        onItemClick: () => {
          const block = (editor as any).getTextCursorPosition?.()?.block;
          if (block && onHashtagSelect) {
            onHashtagSelect(block.id, s.label);
          }
        },
      }));
      return _filterSuggestionItems(items as any, trimmed) as any;
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
      return _filterSuggestionItems(items as any, query) as any;
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
      {/* 複数ブロック選択: ハイライト + フローティングツールバー */}
      <BlockSelectionManager />
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
