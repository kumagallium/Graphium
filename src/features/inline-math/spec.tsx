// インライン数式（本文中の $ ... $ / \( ... \)）
//
// 論文では「対数尺度上では \(\log A = 3.862\) である」のように、文の中に数式が
// 埋まっている。ブロック数式だけでは本文に LaTeX の生ソースが残るため、
// インライン要素としても数式を持てるようにする。
//
// BlockNote の custom inline content として実装する。値は props.latex に持ち、
// クリックすると小さな入力欄（ポップオーバー）で編集できる。

import { createReactInlineContentSpec } from "@blocknote/react";
import { useState, useRef, useEffect, useLayoutEffect } from "react";
import { renderMath } from "../math/render-katex";
import { t } from "../../i18n";

export const InlineMath = createReactInlineContentSpec(
  {
    type: "inlineMath" as const,
    propSchema: {
      // LaTeX ソース（デリミタを含まない中身だけを持つ）
      latex: { default: "" },
    },
    content: "none" as const,
  },
  {
    render: (props) => {
      const latex = String((props.inlineContent as any).props?.latex ?? "");
      const editable = (props.editor as any).isEditable !== false;
      // 空で挿入された直後（スラッシュメニュー経由）はすぐ入力できる状態にする
      const [editing, setEditing] = useState(() => editable && latex.trim() === "");
      const [draft, setDraft] = useState(latex);
      const rootRef = useRef<HTMLSpanElement>(null);
      const inputRef = useRef<HTMLInputElement>(null);

      useEffect(() => {
        if (!editing) setDraft(latex);
      }, [latex, editing]);

      useLayoutEffect(() => {
        if (editing) inputRef.current?.focus();
      }, [editing]);

      const commit = (value: string) => {
        (props.updateInlineContent as any)({ type: "inlineMath", props: { latex: value } });
      };

      useEffect(() => {
        if (!editing) return;
        const onDown = (e: MouseEvent) => {
          if (!rootRef.current?.contains(e.target as Node)) {
            commit(draft);
            setEditing(false);
          }
        };
        document.addEventListener("mousedown", onDown);
        return () => document.removeEventListener("mousedown", onDown);
      });

      const { html, error } = renderMath(latex, false);

      return (
        <span ref={rootRef} style={styles.root} contentEditable={false} data-test="inline-math">
          <span
            onClick={() => { if (editable) { setDraft(latex); setEditing(true); } }}
            title={editable ? t("math.clickToEdit") : undefined}
            style={{ ...styles.body, cursor: editable ? "pointer" : "default" }}
          >
            {!latex.trim() ? (
              <span style={styles.placeholder}>{t("math.inlinePlaceholder")}</span>
            ) : error ? (
              <code style={styles.errorSource} title={t("math.parseError")}>{latex}</code>
            ) : (
              <span dangerouslySetInnerHTML={{ __html: html ?? "" }} />
            )}
          </span>
          {editing && (
            <span style={styles.popover}>
              <input
                ref={inputRef}
                value={draft}
                placeholder={t("math.placeholder")}
                onChange={(e) => { setDraft(e.target.value); commit(e.target.value); }}
                // BlockNote 側にキーを渡すと本文編集と競合するため止める
                onKeyDown={(e) => {
                  e.stopPropagation();
                  if (e.key === "Enter" || e.key === "Escape") {
                    e.preventDefault();
                    commit(draft);
                    setEditing(false);
                  }
                }}
                style={styles.input}
              />
            </span>
          )}
        </span>
      );
    },
  }
);

const styles: Record<string, React.CSSProperties> = {
  root: {
    position: "relative",
    display: "inline-block",
    verticalAlign: "baseline",
  },
  body: {
    display: "inline-block",
    padding: "0 2px",
    borderRadius: 4,
  },
  placeholder: {
    fontSize: "0.9em",
    color: "var(--color-text-tertiary)",
  },
  errorSource: {
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
    fontSize: "0.9em",
    color: "var(--color-error)",
    textDecoration: "underline dotted",
  },
  popover: {
    position: "absolute",
    top: "calc(100% + 4px)",
    left: 0,
    zIndex: 20,
    display: "block",
    padding: 6,
    borderRadius: 8,
    background: "var(--color-card)",
    border: "1px solid var(--color-border)",
    boxShadow: "0 4px 16px rgba(26,46,29,0.12)",
  },
  input: {
    width: 220,
    padding: "4px 8px",
    borderRadius: 6,
    border: "1px solid var(--color-input)",
    background: "var(--color-card)",
    color: "var(--color-foreground)",
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
    fontSize: 13,
    outline: "none",
  },
};

/** エディタ登録用（BlockNoteSchema.create の inlineContentSpecs に混ぜる） */
export const inlineMathSpecs = {
  inlineMath: InlineMath,
};

// スラッシュメニュー用アイテム（カーソル位置にインライン数式を挿入）
export const inlineMathSlashItem = {
  title: t("slash.inlineMath"),
  subtext: t("slash.inlineMathSub"),
  group: t("slash.advancedGroup"),
  onItemClick: (editor: any) => {
    editor.insertInlineContent([{ type: "inlineMath", props: { latex: "" } }]);
  },
  aliases: ["inlinemath", "imath", "インライン数式", "行内数式", "文中数式"],
};
