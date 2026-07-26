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
import { BlockNoteSchema, createCodeBlockSpec, defaultBlockSpecs, defaultStyleSpecs } from "@blocknote/core";
import { codeBlockOptions } from "@blocknote/code-block";

/**
 * シンタックスハイライトのテーマ:
 * @blocknote/code-block の codeBlockOptions は github-dark/github-light を内蔵するが、
 * github-light は彩度高め（赤・紫）で Crucible の落ち着いた自然色パレットに馴染まない。
 * design.md の「高彩度の Tailwind デフォルト色を避け、森・大地・空をイメージした自然色で統一」
 * 方針に合わせ、低彩度の `min-light` をロードして先頭に置く。
 *
 * prosemirror-highlight の shiki パーサは getLoadedThemes()[0] を採用するため、
 * ロード後に min-light を先頭に並べ替える。
 */
const lightCodeBlock = createCodeBlockSpec({
  ...codeBlockOptions,
  createHighlighter: async () => {
    const h = await codeBlockOptions.createHighlighter!();
    const minLight = await import("@shikijs/themes/min-light");
    await h.loadTheme(minLight.default);
    const original = h.getLoadedThemes.bind(h);
    h.getLoadedThemes = () => {
      const all = original();
      const preferred = all.filter((t) => t === "min-light");
      const others = all.filter((t) => t !== "min-light");
      return [...preferred, ...others];
    };
    return h;
  },
});
import { inlineLabelStyleSpecs } from "@features/inline-label/styles";
import { filterSuggestionItems as _filterSuggestionItems } from "@blocknote/core/extensions";
import { FC, useCallback, useEffect, useMemo } from "react";
import type { CustomBlockEntry } from "./schema";
import type { SlashMenuItem } from "./slash-menu-types";
import type { SideMenuProps, FormattingToolbarProps } from "@blocknote/react";
import { buildSuggestionList, getDisplayName, filterSuggestionsForBlock } from "@features/context-label/hashtag-menu";
import { useProvLabelsEnabled } from "@features/context-label/store";
import { MentionSuggestionMenu } from "./mention-suggestion-menu";
import { BlockSelectionManager } from "@features/block-selection";
import { InlineAnchorController } from "../features/inline-label/inline-anchor-controller";
import { preserveChildIndentOnBackspaceExtension } from "./preserve-child-indent-on-backspace";
import { imeConfirmEnterGuardExtension } from "./ime-confirm-enter-guard";
import { imeCompositionHealExtension } from "./ime-composition-heal";
import { documentSearchExtension } from "@/features/document-search/search-plugin";
import { openLinkInSidePeekExtension } from "./open-link-in-side-peek";
import { t as tStatic } from "../i18n";

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
  /** @ 参照リンクの候補を取得する関数（外部から注入）。query は @ の後に入力中の文字列 */
  getMentionSuggestions?: (query: string) => import("@features/block-link/mention-menu").ReferenceSuggestion[];
  /** 読み取り専用モード（アーカイブ済みノートの閲覧などで使う） */
  editable?: boolean;
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
  editable = true,
}: SandboxEditorProps) {
  const provLabelsEnabled = useProvLabelsEnabled();
  const customSpecs = Object.fromEntries(
    blocks.map((b) => [b.type, typeof b.spec === "function" ? b.spec() : b.spec])
  );

  const schema = BlockNoteSchema.create({
    blockSpecs: {
      ...defaultBlockSpecs,
      codeBlock: lightCodeBlock,
      ...customSpecs,
    } as any,
    styleSpecs: {
      ...defaultStyleSpecs,
      ...inlineLabelStyleSpecs,
    } as any,
  });

  const editor = useCreateBlockNote({
    schema,
    initialContent: initialContent?.length ? (initialContent as any) : undefined,
    uploadFile,
    resolveFileUrl,
    // Tab / Shift-Tab を常にインデント操作に振る。
    // デフォルトの "prefer-navigate-ui" は FormattingToolbar / FilePanel が
    // 開いている時に Tab/Shift-Tab を非処理にして UI 側にフォーカスを移すが、
    // 箇条書きの最中にうっかり Toolbar が残っていると Shift+Tab だけが
    // 反応しなくなり「左に戻れない」体験になる。執筆中は常にインデント
    // が効くほうが直感的。
    tabBehavior: "prefer-indent",
    // 「子持ちの空 list item を Backspace」した時に、子のインデントを保つ。
    // imeConfirmEnterGuardExtension: WKWebView の IME 確定 Enter を本文でも無害化。
    // imeCompositionHealExtension: WKWebView の変換確定でネスト箇条書きが複製/空行に
    //   壊れるのを、確定の正しい結果に自己修復する。
    // documentSearchExtension: Cmd+F のドキュメント内検索ハイライト（decoration）。
    extensions: [
      imeConfirmEnterGuardExtension,
      imeCompositionHealExtension,
      preserveChildIndentOnBackspaceExtension,
      documentSearchExtension,
      openLinkInSidePeekExtension,
    ],
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
      // `#` から付けられるのは free ラベルだけ（PROV ラベルは工程 = step ブロックと
      // ドラッグハンドルのメニューに集約した）。
      const currentBlock = (editor as any).getTextCursorPosition?.()?.block;
      const scoped = filterSuggestionsForBlock(visible, currentBlock?.type);
      const items = scoped.map((s) => ({
        title: s.displayName,
        group: tStatic(
          s.group === "core"
            ? "labelUi.coreLabels"
            : s.group === "alias"
              ? "labelUi.aliasLabels"
              : "labelUi.freeLabels",
        ),
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
      const suggestions = getMentionSuggestions?.(query) ?? [];
      const toItem = (s: any) => ({
        title: s.label,
        group: s.group,
        // 同名ノート区別用の 2 行目（shadcn の SuggestionMenu.Item が描画する）
        subtext: s.subtext,
        onItemClick: () => {
          const block = (editor as any).getTextCursorPosition?.()?.block;
          if (block && onMentionSelect) {
            onMentionSelect(block.id, s);
          }
        },
      });
      // createTitle を持つ候補（「新規ノートを作成」）は _filterSuggestionItems を通さず
      // 常に付与する。query に IME 変換中のスペース等が紛れても脱落させないため。
      const createSuggestions = suggestions.filter((s) => s.createTitle !== undefined);
      const normalSuggestions = suggestions.filter((s) => s.createTitle === undefined);
      const filtered = _filterSuggestionItems(normalSuggestions.map(toItem) as any, query);
      const createItems = createSuggestions.map(toItem);
      // `@` 直後（空クエリ）は「新しいノートを作成」を先頭＝ハイライトに出す。
      // 名前を打つ前に Enter/クリックで確定入力ダイアログへ入れるので、IME で最も確実。
      // クエリがあるときは既存ノートの一致を優先し、新規作成は末尾に置く。
      return (query.trim().length === 0
        ? [...createItems, ...(filtered as any[])]
        : [...(filtered as any[]), ...createItems]) as any;
    },
    [editor, getMentionSuggestions, onMentionSelect],
  );

  return (
    <BlockNoteView
      editor={editor as any}
      theme="light"
      editable={editable}
      sideMenu={sideMenu === false ? false : usesCustomSideMenu ? false : undefined}
      // 内蔵ツールバーは常に無効化し、下で strategy:"fixed" 付きの Controller を描画する。
      // これをしないと、選択時のフォーマットツールバーが overflow:auto/hidden の
      // スクロール領域でクリップされ、サイドピーク横の右パネル等に隠れる。
      formattingToolbar={false}
      slashMenu={hasExtraSlash ? false : undefined}
      onChange={onChange}
    >
      {/* 複数ブロック選択: ハイライト + フローティングツールバー */}
      <BlockSelectionManager />
      {/* インラインハイライトのクリック導線（merge / parameter binding） */}
      <InlineAnchorController />
      {usesCustomSideMenu && (
        <SideMenuController sideMenu={sideMenu as FC<SideMenuProps>} />
      )}
      {/* strategy:"fixed" でツールバーをビューポート基準に配置し、エディタの
          overflow スクロール領域でクリップされて隠れるのを防ぐ。
          formattingToolbar 未指定時は BlockNote 既定のツールバーが描画される。 */}
      <FormattingToolbarController
        formattingToolbar={formattingToolbar}
        floatingUIOptions={{ useFloatingOptions: { strategy: "fixed" } }}
      />
      {hasExtraSlash && (
        <SuggestionMenuController
          triggerCharacter="/"
          getItems={getSlashItems as any}
          {...({} as any)}
        />
      )}
      {onHashtagSelect && provLabelsEnabled && (
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
          // 同名ノートが並んでも React の duplicate key 警告でメニューが壊れないよう、
          // key を title ではなくインデックスにするカスタムメニューを使う。
          // 同時に item.subtext（更新日時）も描画して同名ノートを見分けられる。
          suggestionMenuComponent={MentionSuggestionMenu as any}
          {...({} as any)}
        />
      )}
    </BlockNoteView>
  );
}
