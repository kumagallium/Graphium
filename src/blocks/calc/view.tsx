// 計算ブロック（Numi 風のライブ計算ノート）
//
// 1 行 1 式のテキストを書くと、右側に評価結果がライブ表示される。
// 材料科学の秤量計算のような「Excel を開くほどではないが電卓では足りない」
// 計算をノートの中で完結させるためのブロック。
//
//   target = 5 g
//   BaCO3 = 197.34 g/mol
//   TiO2 = 79.87 g/mol
//   target / (197.34 + 79.87) * 197.34      → 3.5595 g
//
// 設計上の決め事:
// - 変数スコープはブロック内で閉じる（ブロック間共有はしない）
// - props には式（source）と評価スナップショット（results）の両方を保存する。
//   式だけだと、mathjs のバージョン差や将来の関数変更で「当時の値」が
//   再現できなくなる。実験ノートとしては評価時の値が一次記録になる。
// - mathjs は評価が初めて走る瞬間に動的 import する（mathjs-loader）
// - 配色は design.md のトークン（--color-*）のみを使う

import { createReactBlockSpec } from "@blocknote/react";
import { useEffect, useRef, useState } from "react";
import { Calculator } from "lucide-react";
import { evaluateSource, isCommentLine, type CalcLineResult } from "./engine";
// BlockNote の render は React ツリー外でも呼ばれ得るため Context 不要の t を使う
import { t } from "../../i18n";

/** props.results（JSON 文字列）を安全に読む。壊れていたら空扱い */
function parseResults(raw: string): CalcLineResult[] {
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export const CalcBlock = createReactBlockSpec(
  {
    type: "calc" as const,
    propSchema: {
      // 1 行 1 式のソーステキスト
      source: { default: "" },
      // 最終評価スナップショット（CalcLineResult[] の JSON）。
      // 読み取り専用表示や、評価エンジン読込前の初期表示に使う。
      results: { default: "" },
    },
    content: "none" as const,
  },
  {
    render: (props) => {
      const source = String(props.block.props.source ?? "");
      const savedResults = String(props.block.props.results ?? "");
      const editable = (props.editor as any).isEditable !== false;

      const [draft, setDraft] = useState(source);
      const [results, setResults] = useState<CalcLineResult[]>(() => parseResults(savedResults));
      const [copiedLine, setCopiedLine] = useState<number | null>(null);
      const textareaRef = useRef<HTMLTextAreaElement>(null);
      // 評価の順序が入れ替わっても古い結果で上書きしないための世代カウンタ
      const evalGen = useRef(0);

      // 外部（undo・別ペイン編集）で source が変わったら下書きも追従させる
      const lastCommitted = useRef(source);
      useEffect(() => {
        if (source !== lastCommitted.current) {
          lastCommitted.current = source;
          setDraft(source);
        }
      }, [source]);

      const commit = (nextSource: string, nextResults?: CalcLineResult[]) => {
        lastCommitted.current = nextSource;
        (props.editor as any).updateBlock(props.block, {
          props: {
            source: nextSource,
            ...(nextResults ? { results: JSON.stringify(nextResults) } : {}),
          },
        });
      };

      // 入力から少し置いて評価。結果はスナップショットとして props にも保存する
      useEffect(() => {
        if (!editable) return;
        const gen = ++evalGen.current;
        const timer = setTimeout(async () => {
          const evaluated = await evaluateSource(draft);
          if (gen !== evalGen.current) return;
          setResults(evaluated);
          // 評価中にさらに入力が進んでいたら、その評価に任せる
          if (draft === lastCommitted.current) {
            commit(draft, evaluated);
          }
        }, 200);
        return () => clearTimeout(timer);
        // eslint-disable-next-line react-hooks/exhaustive-deps
      }, [draft, editable]);

      const copyResult = (index: number, text: string) => {
        void navigator.clipboard?.writeText(text);
        setCopiedLine(index);
        setTimeout(() => setCopiedLine((cur) => (cur === index ? null : cur)), 1200);
      };

      const lines = draft.split("\n");
      const empty = draft.trim() === "";

      return (
        <div data-test="calc-block" contentEditable={false} style={styles.shell}>
          <div style={styles.header}>
            <span style={styles.headerTitle}>
              <Calculator size={14} strokeWidth={2} />
              {t("calc.label")}
            </span>
          </div>
          <div style={styles.body}>
            {/* 左: ソース入力（行を折り返すと右の結果列とズレるため折り返さない） */}
            {editable ? (
              <textarea
                ref={textareaRef}
                // PDF 書き出しがソース列を識別して差し替えるための目印
                data-calc-source
                value={draft}
                wrap="off"
                spellCheck={false}
                placeholder={t("calc.placeholder")}
                rows={Math.max(lines.length, 1)}
                onChange={(e) => {
                  setDraft(e.target.value);
                  // 入力のたびに永続化する（保存漏れを作らない）。結果は評価後に追記
                  commit(e.target.value);
                }}
                // BlockNote 側にキーを渡すとブロック削除・改行挿入と競合するため止める
                onKeyDown={(e) => e.stopPropagation()}
                style={styles.textarea}
              />
            ) : (
              <div data-calc-source style={styles.sourceReadonly}>
                {lines.map((line, i) => (
                  <div key={i} style={isCommentLine(line) ? styles.commentLine : styles.sourceLine}>
                    {line || " "}
                  </div>
                ))}
              </div>
            )}

            {/* 右: 行ごとの評価結果。クリックでコピーできる */}
            {!empty && (
              <div data-calc-results style={styles.resultsCol} aria-hidden={false}>
                {lines.map((_, i) => {
                  const r = results[i];
                  if (!r || r.kind === "empty" || r.kind === "comment") {
                    return <div key={i} style={styles.resultLine}>{" "}</div>;
                  }
                  if (r.kind === "error") {
                    return (
                      <div key={i} style={{ ...styles.resultLine, ...styles.resultError }} title={r.text}>
                        {t("calc.errorMark")}
                      </div>
                    );
                  }
                  return (
                    <div
                      key={i}
                      style={{ ...styles.resultLine, ...styles.resultValue }}
                      title={t("calc.clickToCopy")}
                      onClick={() => copyResult(i, r.text ?? "")}
                    >
                      {copiedLine === i ? t("calc.copied") : r.text || " "}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
          {empty && !editable && (
            <div style={styles.emptyNote}>{t("calc.placeholder")}</div>
          )}
        </div>
      );
    },
  },
);

const mono = "ui-monospace, SFMono-Regular, Menlo, monospace";
const LINE_HEIGHT = 1.7;

const styles: Record<string, React.CSSProperties> = {
  shell: {
    display: "flex",
    flexDirection: "column",
    gap: 6,
    width: "100%",
    padding: "10px 12px",
    borderRadius: 8,
    background: "var(--color-muted)",
    border: "1px solid var(--color-border)",
  },
  header: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
    fontSize: 12,
    color: "var(--color-muted-foreground)",
  },
  headerTitle: {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
  },
  body: {
    display: "flex",
    gap: 12,
    alignItems: "stretch",
  },
  textarea: {
    flex: 1,
    minWidth: 0,
    resize: "none",
    padding: "6px 8px",
    borderRadius: 6,
    border: "1px solid var(--color-input)",
    background: "var(--color-card)",
    color: "var(--color-foreground)",
    fontFamily: mono,
    fontSize: 13,
    lineHeight: LINE_HEIGHT,
    outline: "none",
    overflowX: "auto",
    whiteSpace: "pre",
  },
  sourceReadonly: {
    flex: 1,
    minWidth: 0,
    padding: "6px 8px",
    borderRadius: 6,
    border: "1px solid transparent",
    fontFamily: mono,
    fontSize: 13,
    lineHeight: LINE_HEIGHT,
    overflowX: "auto",
  },
  sourceLine: {
    whiteSpace: "pre",
    color: "var(--color-foreground)",
  },
  commentLine: {
    whiteSpace: "pre",
    color: "var(--color-text-tertiary)",
  },
  resultsCol: {
    flexShrink: 0,
    maxWidth: "45%",
    padding: "6px 8px",
    borderRadius: 6,
    background: "var(--color-card)",
    border: "1px solid var(--color-border)",
    fontFamily: mono,
    fontSize: 13,
    lineHeight: LINE_HEIGHT,
    textAlign: "right",
    overflowX: "auto",
  },
  resultLine: {
    whiteSpace: "pre",
    minHeight: `${LINE_HEIGHT}em`,
  },
  resultValue: {
    color: "var(--color-primary)",
    cursor: "pointer",
  },
  resultError: {
    color: "var(--color-error)",
    cursor: "help",
  },
  emptyNote: {
    fontSize: 12,
    color: "var(--color-text-tertiary)",
  },
};
