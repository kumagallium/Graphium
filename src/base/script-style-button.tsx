// 書式ツールバーの上付き・下付きボタン
//
// BlockNote 標準の太字・斜体…のボタン（BasicTextStyleButton）と同じ部品・同じ表示条件で
// 作り、取り消し線の直後に並べる。寸法もツールチップ（ショートカット表記）も
// 標準ボタンと揃うので、列の中でここだけ浮いて見えることがない。

import { formatKeyboardShortcut } from "@blocknote/core";
import {
  FormattingToolbar,
  getFormattingToolbarItems,
  useBlockNoteEditor,
  useComponentsContext,
  useDictionary,
  useEditorState,
  type FormattingToolbarProps,
} from "@blocknote/react";
import { Subscript, Superscript } from "lucide-react";
import type { ReactElement } from "react";
import { useT } from "../i18n";
import { SCRIPT_STYLES, type ScriptStyle } from "../lib/script-styles";
import { scriptStyleShortcutLabel, toggleScriptStyle } from "./script-styles";

const ICONS = { superscript: Superscript, subscript: Subscript } as const;

export function ScriptStyleButton({ style }: { style: ScriptStyle }) {
  const Components = useComponentsContext()!;
  const dict = useDictionary();
  const t = useT();
  const editor = useBlockNoteEditor<any, any, any>();

  // 表示条件は BasicTextStyleButton と同じ: 編集可能・スキーマにある・
  // 選択中のブロックのどれかが本文（inline content）を持つ
  const state = useEditorState({
    editor,
    selector: ({ editor }) => {
      if (
        !editor.isEditable ||
        !(style in editor.schema.styleSchema) ||
        !(editor.getSelection()?.blocks || [editor.getTextCursorPosition().block]).find(
          (block: any) => block.content !== undefined,
        )
      ) {
        return undefined;
      }
      return { active: style in editor.getActiveStyles() };
    },
  });

  if (state === undefined) return null;

  const Icon = ICONS[style];
  const label = t(`editor.${style}`);
  return (
    <Components.FormattingToolbar.Button
      className="bn-button"
      data-test={style}
      onClick={() => {
        editor.focus();
        toggleScriptStyle(editor._tiptapEditor, style);
      }}
      isSelected={state.active}
      label={label}
      mainTooltip={label}
      secondaryTooltip={formatKeyboardShortcut(
        scriptStyleShortcutLabel(style),
        dict.generic.ctrl_shortcut,
      )}
      // 標準ボタンのアイコン（react-icons）は 1em＝文字サイズで描かれる。lucide の既定
      // （24px）のままだとこの 2 つだけ大きく、ボタン幅も広がる
      icon={<Icon size="1em" />}
    />
  );
}

/** 標準アイテム列の取り消し線ボタンの直後に上付き・下付きを差し込む */
export function withScriptStyleButtons(items: ReactElement[]): ReactElement[] {
  const buttons = SCRIPT_STYLES.map((style) => (
    <ScriptStyleButton key={`${style}StyleButton`} style={style} />
  ));
  const at = items.findIndex((item) => item.key === "strikeStyleButton");
  if (at < 0) return [...items, ...buttons];
  return [...items.slice(0, at + 1), ...buttons, ...items.slice(at + 1)];
}

/**
 * カスタムツールバーを渡さないエディタ（サイドピーク等）の既定ツールバー。
 * BlockNote 既定の並びに上付き・下付きを足しただけで、ほかは変えない。
 */
export function DefaultFormattingToolbar(props: FormattingToolbarProps) {
  return (
    <FormattingToolbar {...props}>
      {withScriptStyleButtons(getFormattingToolbarItems(props.blockTypeSelectItems))}
    </FormattingToolbar>
  );
}
