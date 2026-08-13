// テキスト選択時の FormattingToolbar に AI ボタン + インラインラベル群を追加
// メディアブロック (image/video/audio/file/pdf) の NodeSelection 時も同じツールバーで
// インラインラベルを付与する（Phase D-3-β: データ保存先のみサイドストアに分岐）

import {
  FormattingToolbar,
  getFormattingToolbarItems,
  useBlockNoteEditor,
} from "@blocknote/react";
import { useEffect, useState } from "react";
import { Bot } from "lucide-react";
import { useAiAssistant } from "../features/ai-assistant";
import { useT, getDisplayLabelName } from "../i18n";
import type { FormattingToolbarProps } from "@blocknote/react";
import { LABEL_TO_STYLE } from "../features/inline-label/styles";
import {
  isSelectionInTableCell,
  toggleInlineLabelForSelection,
  getInlineLabelShortcutHint,
  getInlineLabelShortcutKeys,
} from "../features/inline-label/shortcuts";
import { isBlockInsideStep, isSelectionInsideStep, isSelectionInStepTitle } from "../blocks/step/view";
import { useProvLabelsEnabled } from "../features/context-label";
import {
  useMediaInlineLabelStoreOptional,
  makeMediaEntityId,
  type MediaInlineLabelType,
} from "../features/inline-label/media-store";
import { useMediaOcrStoreOptional, ImageOcrToolbarButton } from "../features/media-ocr";

type InlineLabelKey = keyof typeof LABEL_TO_STYLE;

const INLINE_LABEL_ORDER: InlineLabelKey[] = ["material", "tool", "attribute", "output"];

const INLINE_LABEL_COLOR_CLASS: Record<InlineLabelKey, string> = {
  material: "text-[#4B7A52] hover:bg-[rgba(75,122,82,0.12)]",
  tool: "text-[#c08b3e] hover:bg-[rgba(192,139,62,0.12)]",
  attribute: "text-[#8a8a8a] hover:bg-[rgba(160,160,160,0.12)]",
  output: "text-[#c26356] hover:bg-[rgba(194,99,86,0.12)]",
};


const MEDIA_BLOCK_TYPES = new Set(["image", "video", "audio", "file", "pdf"]);

/**
 * tiptap の現在の選択が NodeSelection なら、その BlockNote ブロック型を返す。
 * TextSelection（通常の文字選択）や選択なしのときは null。
 */
export function getNodeSelectionBlockType(editor: any): string | null {
  const tiptap = editor?._tiptapEditor;
  const sel = tiptap?.state?.selection;
  const node = sel?.node;
  if (!node) return null;

  // 実測では blockContainer ごと選ばれる（数式・チャート等）。
  // ノード自身がブロック本体になるケースもあるので祖先も辿る。
  if (node.type?.name === "blockContainer" && node.attrs?.id) {
    return (editor.getBlock?.(node.attrs.id)?.type as string) ?? null;
  }
  const $pos = sel.$from;
  for (let depth = $pos.depth; depth >= 0; depth--) {
    const ancestor = $pos.node(depth);
    if (ancestor?.type?.name === "blockContainer" && ancestor.attrs?.id) {
      return (editor.getBlock?.(ancestor.attrs.id)?.type as string) ?? null;
    }
  }
  return null;
}

/**
 * 選択されているのが「ツールバーに出せる操作が何も無いブロック」かどうか。
 *
 * 数式・計算・チャート・区切り線のような content: "none" のブロックは本文テキストを
 * 持たないため、書式もインラインラベルも適用対象が無く標準アイテムは全部消える。
 * 残るのは AI ボタン 1 個だが、これも選択テキストが空なので押しても無反応になる
 * （handleAiClick が即 return する）。結果として「押せないボタンがブロックに
 * 被さるだけ」になるので、ツールバーごと出さない。ブロック固有の操作は各ブロックが
 * 自前の UI に持っている（チャートは右上の「設定」、数式はクリックで編集モード）。
 *
 * ブロック型のハードコードではなくスキーマの content を見るのは、カスタムブロックが
 * 増えるたびにここへ追記する必要を無くすため（チャート専用判定だったときに数式・
 * 計算ブロックを取りこぼした）。
 *
 * メディア（image / video / audio / file / pdf）は content: "none" だが、
 * インラインラベルと画像 OCR の導線をこのツールバーに載せているので対象外。
 */
export function isToolbarlessBlockSelection(editor: any): boolean {
  const blockType = getNodeSelectionBlockType(editor);
  if (!blockType || MEDIA_BLOCK_TYPES.has(blockType)) return false;
  return editor?.schema?.blockSchema?.[blockType]?.content === "none";
}

/**
 * tiptap の現在の選択がメディアブロックの NodeSelection なら
 * 当該ブロック ID とメディア種別を返す。それ以外は null。
 */
function getSelectedMediaBlock(
  editor: any,
): { blockId: string; blockType: string } | null {
  const tiptap = editor?._tiptapEditor;
  if (!tiptap) return null;
  const sel = tiptap.state.selection;
  const node = sel?.node;
  if (!node) return null;

  // 1) ノード自身がメディア
  if (node.type?.name && MEDIA_BLOCK_TYPES.has(node.type.name)) {
    const $pos = sel.$from;
    for (let depth = $pos.depth; depth >= 0; depth--) {
      const ancestor = $pos.node(depth);
      if (ancestor?.type?.name === "blockContainer") {
        const id = ancestor.attrs?.id;
        if (id) return { blockId: id, blockType: node.type.name };
      }
    }
  }
  // 2) blockContainer 配下にメディアが入っている
  if (node.type?.name === "blockContainer") {
    const id = node.attrs?.id;
    let mediaType: string | null = null;
    node.descendants((d: any) => {
      if (mediaType) return false;
      if (d?.type?.name && MEDIA_BLOCK_TYPES.has(d.type.name)) {
        mediaType = d.type.name;
        return false;
      }
      return true;
    });
    if (id && mediaType) return { blockId: id, blockType: mediaType };
  }
  return null;
}

export function NoteFormattingToolbar(props: FormattingToolbarProps) {
  const editor = useBlockNoteEditor<any, any, any>();
  const aiAssistant = useAiAssistant();
  const mediaStore = useMediaInlineLabelStoreOptional();
  const ocrStore = useMediaOcrStoreOptional();
  const provLabelsEnabled = useProvLabelsEnabled();
  const t = useT();
  // ツールバーは開いたまま選択だけが変わっても再レンダーされないことがある
  // （同一ブロック内で選択し直した場合など）。step 内判定・アクティブスタイルは
  // 選択に依存するので、selection の更新で再評価させる。
  const [, forceSelectionTick] = useState(0);
  useEffect(() => {
    const tiptap = (editor as any)?._tiptapEditor;
    if (!tiptap?.on) return;
    const bump = () => forceSelectionTick((x: number) => x + 1);
    tiptap.on("selectionUpdate", bump);
    return () => tiptap.off?.("selectionUpdate", bump);
  }, [editor]);
  const mediaSel = getSelectedMediaBlock(editor);
  // 画像を選んだときだけ OCR ボタンを出す。URL 未設定（アップロード前）は対象外。
  const selectedImageUrl =
    mediaSel?.blockType === "image"
      ? (editor.getBlock?.(mediaSel.blockId)?.props?.url as string | undefined)
      : undefined;

  // 本文テキストを持たないブロック（数式・計算・チャート等）の選択では
  // ツールバーを出さない（全 hooks の後で判定する）
  if (isToolbarlessBlockSelection(editor)) return null;

  const handleAiClick = async () => {
    const selectedText = window.getSelection()?.toString()?.trim();
    if (!selectedText) return;

    const selection = editor.getSelection();
    const blockIds = selection?.blocks?.map((b: any) => b.id) ?? [];

    aiAssistant.openChat({
      sourceBlockIds: blockIds,
      quotedMarkdown: selectedText,
    });
  };

  /** テキスト選択時のラベルトグル（ショートカットと共通の経路） */
  const handleTextLabelClick = (label: InlineLabelKey) => {
    if (!toggleInlineLabelForSelection(editor, label)) {
      console.warn("[Graphium] inline label not applicable to this selection");
    }
  };

  /** メディアブロック選択時のラベルトグル（サイドストアに書き込み） */
  const handleMediaLabelClick = (label: MediaInlineLabelType, blockId: string) => {
    if (!mediaStore) return;
    const current = mediaStore.getLabel(blockId);
    if (current?.label === label) {
      mediaStore.setLabel(blockId, null);
    } else {
      mediaStore.setLabel(blockId, {
        label,
        entityId: current?.entityId ?? makeMediaEntityId(label),
      });
    }
  };

  // ラベルボタンのアクティブ状態判定
  const activeStyles = mediaSel ? {} : editor.getActiveStyles?.() ?? {};
  const mediaCurrent = mediaSel ? mediaStore?.getLabel(mediaSel.blockId) : undefined;
  // テーブルセル内ではインラインラベルボタンを出さない（構造解釈に一本化）。
  // メディアブロック選択時は別経路（サイドストア）なので対象外。
  const hideInlineLabels = !mediaSel && isSelectionInTableCell(editor);
  // ハイライトは step の「本文」でだけ付けられる（工程の外の Entity は束縛先が無い。
  // タイトルは Activity の名前なので対象外）。
  // 既にラベルが付いている選択では、外せるようにボタンを残す。
  const insideStep = mediaSel
    ? isBlockInsideStep((editor as any).document ?? [], mediaSel.blockId)
    : isSelectionInsideStep(editor) && !isSelectionInStepTitle(editor);
  const hasExistingLabel = mediaSel
    ? Boolean(mediaCurrent?.label)
    : INLINE_LABEL_ORDER.some((l) => Boolean(activeStyles[LABEL_TO_STYLE[l]]));
  const showInlineLabels =
    !hideInlineLabels && provLabelsEnabled && (insideStep || hasExistingLabel);

  return (
    <FormattingToolbar {...props}>
      {/* ラベルバー（2 行目）があるときは app.css で flex-direction: column に
          切り替わるため、標準アイテム + AI ボタンを 1 行目としてまとめる。
          gap: inherit で BlockNote 側のアイテム間隔をそのまま引き継ぐ。 */}
      <div className="flex items-center" style={{ gap: "inherit" }}>
        {getFormattingToolbarItems(props.blockTypeSelectItems)}
        {/* 画像から文字を読む / 読んだ文字を見る。画像をクリックすれば必ず目に入るので、
            ドラッグハンドルのメニューより見つけやすい主導線になる。 */}
        {ocrStore && mediaSel?.blockType === "image" && selectedImageUrl && (
          <ImageOcrToolbarButton
            key={mediaSel.blockId}
            blockId={mediaSel.blockId}
            imageUrl={selectedImageUrl}
          />
        )}
        {aiAssistant.aiAvailable && (
          <button
            onClick={handleAiClick}
            title={t("editor.askAi")}
            // サイズ・角丸は BlockNote 標準ボタン（36px 角・rounded-md）に合わせる
            className="bn-button inline-flex h-9 w-9 items-center justify-center rounded-md hover:bg-violet-100 text-violet-500 transition-colors"
            data-test="aiButton"
          >
            <Bot size={18} />
          </button>
        )}
      </div>
      {/* ラベルバー: ボタン自体を 2 行目に置き、ショートカットキーをボタン内に
          キーキャップで埋め込む。1 行目に埋め込む案は幅が +220px 膨らみ
          1280px 級の画面ではみ出したが、専用行なら幅に余裕がある。
          説明行を分けるより「押すものの中にキーが書いてある」方が結び付きも強い。
          キーキャップはモバイル（キーボードが無い）とメディア選択
          （ショートカット対象外）では出さない。 */}
      {showInlineLabels && (
        <div
          className="flex items-center gap-1 self-stretch border-t border-foreground/10 pt-1"
          data-test="inlineLabelRow"
        >
          {INLINE_LABEL_ORDER.map((label) => {
            const isActive = mediaSel
              ? mediaCurrent?.label === label
              : Boolean(activeStyles[LABEL_TO_STYLE[label]]);
            const onClick = () => {
              if (mediaSel) {
                handleMediaLabelClick(label as MediaInlineLabelType, mediaSel.blockId);
              } else {
                handleTextLabelClick(label);
              }
            };
            return (
              <button
                key={label}
                onClick={onClick}
                title={`${getDisplayLabelName(label)} (${getInlineLabelShortcutHint(label)})`}
                className={[
                  "bn-button inline-flex items-center justify-center rounded transition-colors px-1.5 py-0.5 text-[11px] font-semibold",
                  INLINE_LABEL_COLOR_CLASS[label],
                  isActive ? "bg-black/5 ring-1 ring-current/30" : "",
                ].join(" ")}
                data-test={`inlineLabel-${label}`}
              >
                {getDisplayLabelName(label)}
                {!mediaSel && (
                  <span className="ml-1.5 hidden md:inline-flex items-center gap-0.5 font-normal">
                    {getInlineLabelShortcutKeys(label).map((k) => (
                      <kbd
                        key={k}
                        className="inline-flex min-w-[13px] justify-center rounded border border-foreground/15 bg-foreground/5 px-0.5 py-px text-[9px] leading-none text-foreground/60"
                      >
                        {k}
                      </kbd>
                    ))}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      )}
    </FormattingToolbar>
  );
}
