// テキスト選択時の FormattingToolbar に AI ボタンを追加

import {
  FormattingToolbar,
  getFormattingToolbarItems,
  useBlockNoteEditor,
} from "@blocknote/react";
import { Bot } from "lucide-react";
import { useAiAssistant } from "../features/ai-assistant";
import type { FormattingToolbarProps } from "@blocknote/react";

export function NoteFormattingToolbar(props: FormattingToolbarProps) {
  const editor = useBlockNoteEditor<any, any, any>();
  const aiAssistant = useAiAssistant();

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

  return (
    <FormattingToolbar {...props}>
      {getFormattingToolbarItems(props.blockTypeSelectItems)}
      <button
        onClick={handleAiClick}
        title="選択範囲を AI に聞く"
        className="bn-button inline-flex items-center justify-center rounded hover:bg-violet-100 text-violet-500 transition-colors"
        data-test="aiButton"
      >
        <Bot size={18} />
      </button>
    </FormattingToolbar>
  );
}
