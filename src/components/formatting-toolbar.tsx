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
import { isBlockInsideStep, isSelectionInsideStep } from "../blocks/step/view";
import { useProvLabelsEnabled } from "../features/context-label";
import {
  useMediaInlineLabelStoreOptional,
  makeMediaEntityId,
  type MediaInlineLabelType,
} from "../features/inline-label/media-store";

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
  // ハイライトは step の中でだけ付けられる（工程の外の Entity は束縛先が無い）。
  // 既にラベルが付いている選択では、外せるようにボタンを残す。
  const insideStep = mediaSel
    ? isBlockInsideStep((editor as any).document ?? [], mediaSel.blockId)
    : isSelectionInsideStep(editor);
  const hasExistingLabel = mediaSel
    ? Boolean(mediaCurrent?.label)
    : INLINE_LABEL_ORDER.some((l) => Boolean(activeStyles[LABEL_TO_STYLE[l]]));
  const showInlineLabels =
    !hideInlineLabels && provLabelsEnabled && (insideStep || hasExistingLabel);

  return (
    <FormattingToolbar {...props}>
      {getFormattingToolbarItems(props.blockTypeSelectItems)}
      {/* AI ボタンはラベル群より左（リンクの右）。ラベルは ml-auto で右端に寄せ、
          2 行目のショートカット説明も右寄せにして、ラベルの真下に説明が来るようにする */}
      {aiAssistant.aiAvailable && (
        <button
          onClick={handleAiClick}
          title={t("editor.askAi")}
          className="bn-button inline-flex items-center justify-center rounded hover:bg-violet-100 text-violet-500 transition-colors"
          data-test="aiButton"
        >
          <Bot size={18} />
        </button>
      )}
      {showInlineLabels && (
        <div className="ml-auto flex items-center gap-1">
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
                  "bn-button inline-flex items-center justify-center rounded transition-colors px-1.5 text-[11px] font-semibold",
                  INLINE_LABEL_COLOR_CLASS[label],
                  isActive ? "bg-black/5 ring-1 ring-current/30" : "",
                ].join(" ")}
                data-test={`inlineLabel-${label}`}
              >
                {getDisplayLabelName(label)}
              </button>
            );
          })}
        </div>
      )}
      {/* ショートカットの発見可能性: tooltip は hover しないと気づけないので、
          ツールバー 2 行目にヒント行を出す（app.css で flex-wrap を許可、
          basis-full で折り返し）。ボタン内キーキャップ案は幅が +220px 膨らみ
          1280px 級の画面で右端からはみ出したため、行を分ける方式にした。
          ラベルボタンが右端にあるので、説明も justify-end で真下に揃える。
          テキスト選択時のみ（メディアはショートカット対象外）。モバイルは非表示。 */}
      {showInlineLabels && !mediaSel && (
        <div
          className="hidden md:flex basis-full items-center justify-end gap-2.5 px-1 pt-0.5 select-none"
          data-test="inlineLabelShortcutHints"
        >
          {INLINE_LABEL_ORDER.map((label) => (
            <span key={label} className="inline-flex items-center gap-1 text-[10px] text-muted-foreground">
              <span className="inline-flex items-center gap-0.5">
                {getInlineLabelShortcutKeys(label).map((k) => (
                  <kbd
                    key={k}
                    className="inline-flex min-w-[13px] justify-center rounded border border-foreground/15 bg-foreground/5 px-0.5 py-px text-[9px] leading-none text-foreground/60"
                  >
                    {k}
                  </kbd>
                ))}
              </span>
              {getDisplayLabelName(label)}
            </span>
          ))}
        </div>
      )}
    </FormattingToolbar>
  );
}
