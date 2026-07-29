// 数式ブロック（ブロック数式 / display math）
//
// 論文 PDF の取り込みでは `\[ ... \]` や `$$ ... $$` の独立した数式が出てくる。
// これを段落テキストのままにすると LaTeX の生ソースが本文に散らばるため、
// 専用ブロックとして KaTeX で描画する。
//
// 表示と編集を 1 ブロックで切り替える:
//   - 通常は KaTeX の描画結果（中央寄せ）
//   - クリックすると textarea で LaTeX を直接編集
//   - Escape / 外側クリックで表示に戻る
//
// 配色は design.md のトークン（--color-*）のみを使い、ハードコード色は使わない。

import { createReactBlockSpec } from "@blocknote/react";
import { useState, useRef, useEffect, useLayoutEffect } from "react";
import { Sigma } from "lucide-react";
import { renderMath } from "../../features/math/render-katex";
// BlockNote の render は React ツリー外でも呼ばれ得るため Context 不要の t を使う
import { t } from "../../i18n";

export const MathBlock = createReactBlockSpec(
  {
    type: "math" as const,
    propSchema: {
      // LaTeX ソース（デリミタを含まない中身だけを持つ）
      latex: { default: "" },
    },
    content: "none" as const,
  },
  {
    render: (props) => {
      const latex = String(props.block.props.latex ?? "");
      const editable = (props.editor as any).isEditable !== false;
      // 空のまま挿入された直後（スラッシュメニュー経由）はすぐ入力できる状態にする
      const [editing, setEditing] = useState(() => editable && latex.trim() === "");
      const [draft, setDraft] = useState(latex);
      const rootRef = useRef<HTMLDivElement>(null);
      const textareaRef = useRef<HTMLTextAreaElement>(null);

      // 外部（取り込み・undo 等）で latex が変わったら下書きも追従させる
      useEffect(() => {
        if (!editing) setDraft(latex);
      }, [latex, editing]);

      // 編集開始時にフォーカスし、高さを内容に合わせる
      useLayoutEffect(() => {
        if (!editing) return;
        const el = textareaRef.current;
        if (!el) return;
        el.focus();
        el.selectionStart = el.selectionEnd = el.value.length;
        el.style.height = "auto";
        el.style.height = `${el.scrollHeight}px`;
      }, [editing]);

      const commit = (value: string) => {
        (props.editor as any).updateBlock(props.block, { props: { latex: value } });
      };

      const stopEditing = () => {
        commit(draft);
        setEditing(false);
      };

      // 外側クリックで編集を終了する
      useEffect(() => {
        if (!editing) return;
        const onDown = (e: MouseEvent) => {
          if (!rootRef.current?.contains(e.target as Node)) stopEditing();
        };
        document.addEventListener("mousedown", onDown);
        return () => document.removeEventListener("mousedown", onDown);
      });

      const { html, error } = renderMath(latex, true);

      if (editing) {
        return (
          <div ref={rootRef} data-test="math-block" data-editing="true" contentEditable={false} style={styles.editorShell}>
            <div style={styles.editorHeader}>
              <Sigma size={14} strokeWidth={2} />
              <span>{t("math.editorLabel")}</span>
            </div>
            <textarea
              ref={textareaRef}
              value={draft}
              placeholder={t("math.placeholder")}
              onChange={(e) => {
                setDraft(e.target.value);
                // 入力のたびに永続化する（保存漏れを作らない）
                commit(e.target.value);
                const el = e.target;
                el.style.height = "auto";
                el.style.height = `${el.scrollHeight}px`;
              }}
              // BlockNote 側にキーを渡すとブロック削除・改行挿入と競合するため止める
              onKeyDown={(e) => {
                e.stopPropagation();
                if (e.key === "Escape") {
                  e.preventDefault();
                  stopEditing();
                }
              }}
              style={styles.textarea}
            />
            {/* 入力中もプレビューを出して、閉じる前に結果が分かるようにする */}
            <MathPreview latex={draft} />
          </div>
        );
      }

      return (
        <div
          ref={rootRef}
          data-test="math-block"
          contentEditable={false}
          onClick={() => { if (editable) { setDraft(latex); setEditing(true); } }}
          title={editable ? t("math.clickToEdit") : undefined}
          style={{ ...styles.display, cursor: editable ? "pointer" : "default" }}
        >
          {!latex.trim() ? (
            <span style={styles.placeholder}>
              <Sigma size={15} strokeWidth={2} />
              {t("math.placeholder")}
            </span>
          ) : error ? (
            <span style={styles.errorBox}>
              <span style={styles.errorLabel}>{t("math.parseError")}</span>
              <code style={styles.errorSource}>{latex}</code>
            </span>
          ) : (
            <span dangerouslySetInnerHTML={{ __html: html ?? "" }} />
          )}
        </div>
      );
    },
  }
);

/** 編集中プレビュー（描画できない間はエラー文言を出す） */
function MathPreview({ latex }: { latex: string }) {
  const { html, error } = renderMath(latex, true);
  if (!latex.trim()) return null;
  if (error) {
    return <div style={styles.previewError}>{t("math.parseError")}</div>;
  }
  return <div style={styles.preview} dangerouslySetInnerHTML={{ __html: html ?? "" }} />;
}

const styles: Record<string, React.CSSProperties> = {
  display: {
    display: "flex",
    justifyContent: "center",
    alignItems: "center",
    width: "100%",
    minHeight: 40,
    padding: "10px 12px",
    borderRadius: 8,
    // 通常は枠を出さず、本文の流れを乱さない
    border: "1px solid transparent",
    overflowX: "auto",
  },
  placeholder: {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    fontSize: 14,
    color: "var(--color-text-tertiary)",
  },
  errorBox: {
    display: "inline-flex",
    flexDirection: "column",
    alignItems: "center",
    gap: 4,
  },
  errorLabel: {
    fontSize: 12,
    color: "var(--color-error)",
  },
  errorSource: {
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
    fontSize: 13,
    color: "var(--color-foreground)",
    whiteSpace: "pre-wrap",
    wordBreak: "break-word",
  },
  editorShell: {
    display: "flex",
    flexDirection: "column",
    gap: 8,
    width: "100%",
    padding: "10px 12px",
    borderRadius: 8,
    background: "var(--color-muted)",
    border: "1px solid var(--color-border)",
  },
  editorHeader: {
    display: "flex",
    alignItems: "center",
    gap: 6,
    fontSize: 12,
    color: "var(--color-muted-foreground)",
  },
  textarea: {
    width: "100%",
    minHeight: 44,
    resize: "vertical",
    padding: "8px 10px",
    borderRadius: 6,
    border: "1px solid var(--color-input)",
    background: "var(--color-card)",
    color: "var(--color-foreground)",
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
    fontSize: 13,
    lineHeight: 1.5,
    outline: "none",
  },
  preview: {
    display: "flex",
    justifyContent: "center",
    padding: "6px 4px",
    overflowX: "auto",
  },
  previewError: {
    fontSize: 12,
    textAlign: "center",
    color: "var(--color-error)",
  },
};
