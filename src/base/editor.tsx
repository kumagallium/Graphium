import "@blocknote/core/fonts/inter.css";
import "@blocknote/shadcn/style.css";

import {
  useCreateBlockNote,
  SideMenuController,
  SuggestionMenuController,
  FormattingToolbarController,
  TableHandlesController,
  getDefaultReactSlashMenuItems,
} from "@blocknote/react";
import { BlockNoteView } from "@blocknote/shadcn";
import { blockNoteShadCNComponents } from "./blocknote-shadcn-overrides";
import { SortableTableHandle } from "@features/table-meta/sort-handle";
import { BlockNoteSchema, createCodeBlockSpec, createHeadingBlockSpec, defaultBlockSpecs, defaultStyleSpecs, defaultInlineContentSpecs } from "@blocknote/core";
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
// 見出しブロック。BlockNote 標準の「トグル見出し」(isToggleable) は使わない。
// 折りたたみは collapsible-heading に一本化してあり、そちらは全部の見出しが対象で、
// 状態をノートに書かない。2 つの折りたたみが並ぶとユーザーが使い分けを
// 意識することになるので、標準側を切って導線を 1 本にする。
//
// prop をスキーマから外す形になるが、既存ノートに残る isToggleable: true は
// BlockNote 側が黙って捨てるだけで、本文も children も失われない
// （features/collapsible-heading/legacy-toggle-compat.test.ts で固定）。
const plainHeading = createHeadingBlockSpec({ allowToggleHeadings: false });

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
import { inlineMathSpecs } from "@features/inline-math/spec";
import { inlineImageSpecs } from "@features/inline-image/spec";
import { getCellSlashMenuItems } from "@features/asset-browser/slash-menu-items";
import { getActiveProvider } from "../lib/storage/registry";
import { filterSuggestionItems as _filterSuggestionItems } from "@blocknote/core/extensions";
import { FC, useCallback, useEffect, useMemo, useRef } from "react";
import type { CustomBlockEntry } from "./schema";
import type { SlashMenuItem } from "./slash-menu-types";
import type { SideMenuProps, FormattingToolbarProps } from "@blocknote/react";
import { MentionSuggestionMenu } from "./mention-suggestion-menu";
import { BlockSelectionManager } from "@features/block-selection";
import { DuplicateShortcut } from "@features/block-duplicate";
import { InlineAnchorController } from "../features/inline-label/inline-anchor-controller";
import { preserveChildIndentOnBackspaceExtension } from "./preserve-child-indent-on-backspace";
import { imeConfirmEnterGuardExtension } from "./ime-confirm-enter-guard";
import { imeCompositionHealExtension } from "./ime-composition-heal";
import { documentSearchExtension } from "@/features/document-search/search-plugin";
import { collapsibleHeadingExtension } from "@/features/collapsible-heading/collapse-plugin";
import { t, useLocaleSubscription } from "../i18n";
import { getBlockNoteDictionary } from "./blocknote-dictionary";
import { openLinkInSidePeekExtension } from "./open-link-in-side-peek";
import { stepTitleAutoformatGuardExtension } from "../blocks/step/step-title-autoformat-guard";
import { stepTitleEnterExtension } from "../blocks/step/step-title-enter";
import { columnResizeExtension } from "../blocks/multi-column/column-resize";
import { dropToColumnsExtension, columnDropCursorPosition } from "../blocks/multi-column/drop-to-columns";
import { handleInlineLabelShortcut } from "@features/inline-label/shortcuts";

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
  /**
   * デフォルトスラッシュメニューから除外するアイテムの辞書キー（"image" 等）。
   * タイトルは表示言語で変わるため、言語に依存しないキーで指定する。
   */
  excludeDefaultSlashKeys?: string[];
  /** エディタインスタンスを外部に公開するコールバック */
  onEditorReady?: (editor: any) => void;
  /** エディタの内容が変更されたときのコールバック */
  onChange?: () => void;
  /** メディアファイルアップロードハンドラ（File → URL を返す） */
  uploadFile?: (file: File) => Promise<string>;
  /** 保存された URL を表示用 URL に変換する（local-media:// → blob: 等） */
  resolveFileUrl?: (url: string) => Promise<string>;
  /** @ 参照リンクで選択されたときのコールバック */
  onMentionSelect?: (sourceBlockId: string, suggestion: import("@features/block-link/mention-menu").ReferenceSuggestion) => void;
  /** @ 参照リンクの候補を取得する関数（外部から注入）。query は @ の後に入力中の文字列 */
  getMentionSuggestions?: (query: string) => import("@features/block-link/mention-menu").ReferenceSuggestion[];
  /** 読み取り専用モード（アーカイブ済みノートの閲覧などで使う） */
  editable?: boolean;
};

// サンドボックス共通エディタ
// blocks を渡すだけでカスタムブロック入りエディタが立ち上がる
/**
 * セルへの画像ファイル drop / paste をインライン画像（inlineImage）として受ける。
 * セルはブロックを持てないため、既定処理に任せると画像ブロックがテーブルの外に
 * 落ちてしまう。セル内のときだけ「素材として登録 → inlineImage を挿入」に差し替え、
 * セル外は false を返して既定の画像ブロック挿入に任せる。
 */
function insertCellImagesFromFiles(
  view: any,
  fileList: FileList | null | undefined,
  dropEvent: DragEvent | null,
  uploadFile: ((file: File) => Promise<string>) | undefined,
): boolean {
  if (!uploadFile || !fileList?.length) return false;
  const images = [...fileList].filter((f) => f.type.startsWith("image/"));
  if (!images.length) return false;
  // 位置: drop は座標から、paste は現在のキャレット
  let pos = view.state.selection.from;
  if (dropEvent) {
    const at = view.posAtCoords({ left: dropEvent.clientX, top: dropEvent.clientY });
    if (!at) return false;
    pos = at.pos;
  }
  const $pos = view.state.doc.resolve(pos);
  let inCell = false;
  for (let d = $pos.depth; d > 0; d--) {
    const name = $pos.node(d).type.name;
    if (name === "tableCell" || name === "tableHeader") {
      inCell = true;
      break;
    }
  }
  if (!inCell) return false;
  dropEvent?.preventDefault();
  void (async () => {
    let insertAt = pos;
    for (const file of images) {
      try {
        const url = await uploadFile(file);
        const fileId = getActiveProvider().extractFileId(url);
        const nodeType = view.state.schema.nodes.inlineImage;
        if (!fileId || !nodeType || view.isDestroyed) continue;
        // アップロード中に文書が縮んでいても範囲内に収める
        const at = Math.min(insertAt, view.state.doc.content.size);
        const node = nodeType.create({ fileId, name: file.name });
        view.dispatch(view.state.tr.insert(at, node));
        insertAt = at + node.nodeSize;
      } catch {
        // 失敗した画像だけ諦めて残りは続ける（素材未登録のまま挿さない）
      }
    }
  })();
  return true;
}

export function SandboxEditor({
  blocks = [],
  initialContent,
  sideMenu,
  formattingToolbar,
  extraSlashMenuItems,
  excludeDefaultSlashKeys,
  onEditorReady,
  onChange,
  uploadFile,
  resolveFileUrl,
  onMentionSelect,
  getMentionSuggestions,
  editable = true,
}: SandboxEditorProps) {
  const customSpecs = Object.fromEntries(
    blocks.map((b) => [b.type, typeof b.spec === "function" ? b.spec() : b.spec])
  );

  const schema = BlockNoteSchema.create({
    blockSpecs: {
      ...defaultBlockSpecs,
      codeBlock: lightCodeBlock,
      heading: plainHeading,
      ...customSpecs,
    } as any,
    // インライン数式（$...$）を本文中の要素として持てるようにする。
    // 未登録のまま保存済みノートを開くと BlockNote が未知 inline で throw するため、
    // エディタを作る全経路でこの spec を混ぜること。
    inlineContentSpecs: {
      ...defaultInlineContentSpecs,
      ...inlineMathSpecs,
      ...inlineImageSpecs,
    } as any,
    styleSpecs: {
      ...defaultStyleSpecs,
      ...inlineLabelStyleSpecs,
    } as any,
  });

  // BlockNote 内蔵 UI の文言をアプリの言語設定に連動させる。
  // プレースホルダはエディタ生成時に CSS ルールとして固定されるため、辞書の
  // 差し替えにはエディタの作り直しが必要。deps の locale 変更で再生成し、
  // そのとき編集中の内容は editorRef 経由で新しいエディタに引き継ぐ。
  const locale = useLocaleSubscription();
  const editorRef = useRef<any>(null);

  const editor = useCreateBlockNote({
    schema,
    initialContent: editorRef.current
      ? (editorRef.current.document as any)
      : initialContent?.length ? (initialContent as any) : undefined,
    dictionary: getBlockNoteDictionary(locale),
    uploadFile,
    // セル内への画像 drop / paste はインライン画像として受ける（セル外は既定処理）。
    // handleDrop/handlePaste では届かない — BlockNote 自身のファイル処理が
    // handleDOMEvents 段で先にイベントを消費する。直接 props の handleDOMEvents は
    // プラグイン（BlockNote）より優先されるので、ここで先取りして true を返す
    _tiptapOptions: {
      editorProps: {
        handleDOMEvents: {
          drop: (view: any, event: any) =>
            insertCellImagesFromFiles(view, event?.dataTransfer?.files, event, uploadFile),
          paste: (view: any, event: any) => {
            const handled = insertCellImagesFromFiles(
              view,
              event?.clipboardData?.files,
              null,
              uploadFile
            );
            // true でも PM は既定動作を止めないので、ブラウザの貼り付けを自前で止める
            if (handled) event?.preventDefault?.();
            return handled;
          },
        },
      },
    } as any,
    resolveFileUrl,
    // ブロック左右端へのドラッグで縦のドロップカーソルを出す
    // （カラム化ゾーンの判定は multi-column/drop-to-columns.ts）
    dropCursor: { hooks: { computeDropPosition: columnDropCursorPosition } },
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
      // 見出しの折りたたみ。ラベルは getter で遅らせる（拡張はエディタ生成時に
      // 1 度しか作られないので、即時評価すると言語切り替えに追従しない）。
      collapsibleHeadingExtension({
        get collapse() { return t("editor.collapseHeading"); },
        get expand() { return t("editor.expandHeading"); },
      }),
      openLinkInSidePeekExtension,
      // step タイトルで「1. 」等がリスト等へのブロック変換を起こし、カードが
      // 消えるのを防ぐ（step-title-autoformat-guard.ts 参照）
      stepTitleAutoformatGuardExtension,
      // step タイトルでの Enter を「カードの外に兄弟を作る」でなく
      // 「先頭の子ブロックへ入る」にする（step-title-enter.ts 参照）
      stepTitleEnterExtension,
      // カラム境界ドラッグでの幅リサイズ（multi-column/column-resize.ts 参照）
      columnResizeExtension,
      // ブロックの左右端へのドロップでカラム生成（multi-column/drop-to-columns.ts 参照）
      dropToColumnsExtension(),
    ],
  }, [locale]);

  // 言語切替での再生成時に内容を引き継げるよう、最新のエディタを保持する
  useEffect(() => {
    editorRef.current = editor;
  }, [editor]);

  // エディタインスタンスを外部に公開
  useEffect(() => {
    onEditorReady?.(editor);
  }, [editor, onEditorReady]);

  // インラインラベルのキーボードショートカット（⌘⇧I/E/P/O）。
  // メイン・SidePeek どちらのエディタでも効くよう SandboxEditor で束ねる。
  // capture でブラウザ既定（Win の DevTools 等）より先に処理する。
  useEffect(() => {
    const dom: HTMLElement | undefined = (editor as any)?._tiptapEditor?.view?.dom;
    if (!dom) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (handleInlineLabelShortcut(editor, e)) {
        e.preventDefault();
        e.stopPropagation();
      }
    };
    dom.addEventListener("keydown", onKeyDown, true);
    return () => dom.removeEventListener("keydown", onKeyDown, true);
  }, [editor]);

  // カスタムSideMenuを渡した場合: デフォルトを無効にして手動レンダリング
  const usesCustomSideMenu = sideMenu !== undefined && sideMenu !== false;
  const hasExtraSlash = extraSlashMenuItems && extraSlashMenuItems.length > 0;

  // スラッシュメニューのカスタム getItems
  const excludeSet = useMemo(
    () => new Set(excludeDefaultSlashKeys ?? []),
    [excludeDefaultSlashKeys],
  );
  // デフォルトアイテムを1回だけ取得（毎回呼ぶと蓄積する問題を防ぐ）
  const defaultSlashItems = useMemo(() => {
    let items = getDefaultReactSlashMenuItems(editor as any);
    if (excludeSet.size > 0) {
      // 既定アイテムは辞書キー（"image" 等）を持つ。タイトルは言語で変わるので
      // キーで除外する
      items = items.filter((item: any) => !excludeSet.has(item.key));
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
      // テーブルのセル内: ブロックを挿入する項目は出せない（セルはインライン専用）。
      // インラインで完結する項目（画像 → inlineImage）だけの短いメニューにする
      const inCell = (editor as any).getTextCursorPosition?.()?.block?.type === "table";
      const items = inCell ? getCellSlashMenuItems() : allSlashItems;
      if (!query) return items as any;
      // カスタムフィルタ: title と aliases のみでマッチ（group 名でのマッチを防ぐ）
      const q = query.toLowerCase();
      return items.filter((item: any) => {
        if (item.title?.toLowerCase().includes(q)) return true;
        if (item.aliases?.some((a: string) => a.toLowerCase().includes(q))) return true;
        return false;
      }) as any;
    };
  }, [hasExtraSlash, allSlashItems, editor]);

  // `#` のラベルオートコンプリートは廃止した。
  // 工程は step ブロック、テーブル / メディアのラベルはドラッグハンドルのメニューに
  // 集約し、PROV に乗らない自由タグも畳んだので、`#` から付けるものが無くなった。
  // 既存ノートに付いているラベルはデータとして残り、表示・PROV 生成・解除は従来どおり。

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
      // 同梱の shadcn Button は React 19 前提で ref を受け取れず、
      // テーブルハンドル / ドラッグハンドルのメニューが Radix の anchor を
      // 掴めないまま「未配置」で描画される（blocknote-shadcn-overrides.tsx 参照）。
      shadCNComponents={blockNoteShadCNComponents}
      sideMenu={sideMenu === false ? false : usesCustomSideMenu ? false : undefined}
      // 内蔵ツールバーは常に無効化し、下で strategy:"fixed" 付きの Controller を描画する。
      // これをしないと、選択時のフォーマットツールバーが overflow:auto/hidden の
      // スクロール領域でクリップされ、サイドピーク横の右パネル等に隠れる。
      formattingToolbar={false}
      slashMenu={hasExtraSlash ? false : undefined}
      // 内蔵のテーブルハンドルを無効化し、下で並べ替え付きのカスタムハンドルを描画する
      tableHandles={false}
      onChange={onChange}
    >
      {/* 列ハンドルメニューに 昇順 / 降順 の並べ替えを足したテーブルハンドル */}
      <TableHandlesController tableHandle={SortableTableHandle} />
      {/* 複数ブロック選択: ハイライト + フローティングツールバー */}
      <BlockSelectionManager />
      {/* ⌘D / Ctrl+D: カーソル位置のブロックを直下に複製 */}
      <DuplicateShortcut />
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
