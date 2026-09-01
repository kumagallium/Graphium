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
// - 変数スコープはブロック内で閉じる（ブロック間共有はしない）。
//   例外は「名前を付けた表の列」で、`table["秤量表"]["質量"]` や
//   `col("秤量表", "質量")` として読める（table-scope.ts）。
//   表の側には式も結果も書き込まない — 参照は評価時に片方向で解決するだけ
// - props には式（source）と評価スナップショット（results）の両方を保存する。
//   式だけだと、mathjs のバージョン差や将来の関数変更で「当時の値」が
//   再現できなくなる。実験ノートとしては評価時の値が一次記録になる。
// - mathjs は評価が初めて走る瞬間に動的 import する（mathjs-loader）
// - 配色は design.md のトークン（--color-*）のみを使う

import { createReactBlockSpec } from "@blocknote/react";
import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowRightToLine, Calculator, Check, ChevronRight } from "lucide-react";
import { evaluateSource, isCommentLine, parseCalcResults, type CalcLineResult } from "./engine";
import {
  assignedVariableOf,
  extractReadColumns,
  parseCalcTargets,
  type CalcTargets,
  type CalcWritebackRequest,
} from "./writeback";
import { applyCalcSuggestion, computeCalcSuggestion, type CalcSuggestion } from "./suggest";
import { buildTableIndex, collectTableColumns } from "./table-scope";
import { computeTableDisplayNames } from "../../features/table-meta/auto-name";
import { useTableMetaStoreOptional } from "../../features/table-meta/store";
// BlockNote の render は React ツリー外でも呼ばれ得るため Context 不要の t を使う
import { t, useLocaleSubscription } from "../../i18n";

export const CalcBlock = createReactBlockSpec(
  {
    type: "calc" as const,
    propSchema: {
      // 1 行 1 式のソーステキスト
      source: { default: "" },
      // 最終評価スナップショット（CalcLineResult[] の JSON）。
      // 読み取り専用表示や、評価エンジン読込前の初期表示に使う。
      results: { default: "" },
      // 表への書き戻し先（CalcTargets の JSON）。変数名 → { tableBlockId, column }
      targets: { default: "" },
      // 計算ブロックの名前。表側のバッジ「列 ← 名前」や参照の目印に使う
      name: { default: "" },
    },
    content: "none" as const,
  },
  {
    render: (props) => {
      // 言語切替でラベルを引き直す（BlockNote の render は Context を辿れないため購読する）
      useLocaleSubscription();
      const source = String(props.block.props.source ?? "");
      const savedResults = String(props.block.props.results ?? "");
      const savedTargets = String((props.block.props as { targets?: string }).targets ?? "");
      const calcName = String((props.block.props as { name?: string }).name ?? "");
      const editable = (props.editor as any).isEditable !== false;
      const targets = useMemo(() => parseCalcTargets(savedTargets), [savedTargets]);

      const [draft, setDraft] = useState(source);
      const [results, setResults] = useState<CalcLineResult[]>(() => parseCalcResults(savedResults));
      const [copiedLine, setCopiedLine] = useState<number | null>(null);
      // 表参照の入力補完（table[ / col( の途中で表名・列名の候補を出す）
      const [suggest, setSuggest] = useState<CalcSuggestion | null>(null);
      const [suggestIndex, setSuggestIndex] = useState(0);
      // 書き戻し先ピッカー（⇥ で開く。表 → 列の 2 段選択）
      const [picker, setPicker] = useState<{ varName: string; tableName: string | null } | null>(null);
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

      // 名前も同じパターン（IME 入力中に updateBlock しないよう blur/Enter で確定）
      const [nameDraft, setNameDraft] = useState(calcName);
      const lastCommittedName = useRef(calcName);
      useEffect(() => {
        if (calcName !== lastCommittedName.current) {
          lastCommittedName.current = calcName;
          setNameDraft(calcName);
        }
      }, [calcName]);
      const commitName = (value: string) => {
        const trimmed = value.trim();
        lastCommittedName.current = trimmed;
        setNameDraft(trimmed);
        (props.editor as any).updateBlock(props.block, { props: { name: trimmed } });
      };

      const commit = (
        nextSource: string,
        nextResults?: CalcLineResult[],
        nextTargets?: CalcTargets,
      ) => {
        lastCommitted.current = nextSource;
        (props.editor as any).updateBlock(props.block, {
          props: {
            source: nextSource,
            ...(nextResults ? { results: JSON.stringify(nextResults) } : {}),
            ...(nextTargets !== undefined
              ? { targets: Object.keys(nextTargets).length > 0 ? JSON.stringify(nextTargets) : "" }
              : {}),
          },
        });
      };

      // 参照できる表（名前が付いているものだけ）。
      // ホストが編集のたびにストアへ置き直す列データを読む。ブロックの render に
      // 渡る editor.document は描画時点のスナップショットで古くなるため（実測）、
      // ストアが未配布の間（ノート読込直後）だけ document から読むフォールバックを使う
      const tableStore = useTableMetaStoreOptional();
      const tableIndex = useMemo(() => {
        if (!tableStore) return null;
        if (tableStore.tableColumns) return tableStore.tableColumns;
        const doc = (props.editor as any)?.document;
        if (!Array.isArray(doc)) return null;
        const displayNames = computeTableDisplayNames(doc, tableStore.getCaption);
        return buildTableIndex(collectTableColumns(doc, displayNames));
        // eslint-disable-next-line react-hooks/exhaustive-deps
      }, [tableStore?.tableColumns, tableStore?.metas]);
      // 表の中身が変わったかを見る署名（列名と値だけ。位置や書式は無視する）
      const tableSignature = tableIndex ? JSON.stringify(tableIndex) : "";

      const refreshSuggest = (value: string, caret: number) => {
        setSuggest(computeCalcSuggestion(value, caret, tableIndex));
        setSuggestIndex(0);
      };

      const applySuggestionAt = (item: string) => {
        if (!suggest) return;
        // 表名を確定した瞬間に、その表が無名（自動名）ならキャプションへ昇格して
        // 固定する。自動名は文書順で振り直されるため、参照がズレるのを防ぐ
        if (suggest.kind === "table" && tableStore) {
          const blockId = tableStore.tableBlockIds?.[item];
          if (blockId && !tableStore.getCaption(blockId)) {
            tableStore.setCaption(blockId, item);
          }
        }
        const caret = textareaRef.current?.selectionStart ?? draft.length;
        const r = applyCalcSuggestion(draft, caret, suggest, item);
        setDraft(r.text);
        commit(r.text);
        // React の再描画で caret が末尾に飛ぶので置き直す
        requestAnimationFrame(() => {
          const el = textareaRef.current;
          if (el) {
            el.focus();
            el.setSelectionRange(r.caret, r.caret);
          }
        });
        // 表名の確定は列名の候補へそのまま繋がる
        refreshSuggest(r.text, r.caret);
      };

      // この式が読んでいる (表名, 列名)。読んでいる列へ書くと発振するので候補から外す
      const readColumns = useMemo(() => extractReadColumns(draft), [draft]);
      const setTarget = (varName: string, target: { tableBlockId: string; column: string } | null) => {
        const next: CalcTargets = { ...targets };
        if (target) next[varName] = target;
        else delete next[varName];
        commit(draft, undefined, next);
        setPicker(null);
      };
      // 表示用: blockId → 表示名（ストア配布の逆引き）
      const tableNameOfId = (blockId: string): string | undefined => {
        for (const [name, id] of Object.entries(tableStore?.tableBlockIds ?? {})) {
          if (id === blockId) return name;
        }
        return undefined;
      };

      // 入力から少し置いて評価。結果はスナップショットとして props にも保存する
      useEffect(() => {
        if (!editable) return;
        const gen = ++evalGen.current;
        const timer = setTimeout(async () => {
          // mathjs の識別子は ASCII 限定なので、表は文字列キーで引く形にする
          //   表["秤量表"]["質量"] / col("秤量表", "質量")
          const { lines: evaluated, exports } = await evaluateSource(
            draft,
            tableIndex ?? undefined,
            Object.keys(targets),
          );
          if (gen !== evalGen.current) return;
          setResults(evaluated);
          // 書き戻し先が設定された変数の値をストアに宣言する。
          // 実際の書き込みはホスト（実エディタを持つ側）が差分だけ行う
          if (tableStore) {
            const requests: CalcWritebackRequest[] = [];
            for (const [name, target] of Object.entries(targets)) {
              const texts = exports[name];
              if (texts) {
                requests.push({ ...target, texts, ...(calcName ? { calcName } : {}) });
              }
            }
            tableStore.setCalcWriteback(props.block.id, requests.length > 0 ? requests : null);
          }
          // 評価中にさらに入力が進んでいたら、その評価に任せる
          if (draft === lastCommitted.current) {
            commit(draft, evaluated);
          }
        }, 200);
        return () => clearTimeout(timer);
        // eslint-disable-next-line react-hooks/exhaustive-deps
      }, [draft, editable, tableSignature, savedTargets]);

      // ブロックが消えたら宣言も消す（残ると表が同期され続ける）
      useEffect(() => {
        const blockId = props.block.id;
        return () => {
          tableStore?.setCalcWriteback(blockId, null);
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
      }, []);

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
              {editable ? (
                <input
                  value={nameDraft}
                  placeholder={t("calc.label")}
                  title={t("calc.nameHint")}
                  onChange={(e) => setNameDraft(e.target.value)}
                  onBlur={() => commitName(nameDraft)}
                  onKeyDown={(e) => {
                    e.stopPropagation();
                    if (e.key === "Enter" && !(e.nativeEvent as { isComposing?: boolean }).isComposing) {
                      (e.target as HTMLInputElement).blur();
                    }
                  }}
                  style={styles.nameInput}
                />
              ) : (
                calcName || t("calc.label")
              )}
            </span>
          </div>
          <div style={styles.body}>
            {/* 左: ソース入力（行を折り返すと右の結果列とズレるため折り返さない） */}
            {editable ? (
              <div style={styles.sourceWrap}>
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
                    refreshSuggest(e.target.value, e.target.selectionStart ?? e.target.value.length);
                  }}
                  // BlockNote 側にキーを渡すとブロック削除・改行挿入と競合するため止める。
                  // 補完が開いている間は ↑↓ / Enter / Tab / Esc を候補操作に使う
                  onKeyDown={(e) => {
                    e.stopPropagation();
                    if (!suggest || suggest.items.length === 0) return;
                    if ((e.nativeEvent as { isComposing?: boolean }).isComposing) return;
                    if (e.key === "ArrowDown") {
                      e.preventDefault();
                      setSuggestIndex((i) => (i + 1) % suggest.items.length);
                    } else if (e.key === "ArrowUp") {
                      e.preventDefault();
                      setSuggestIndex((i) => (i - 1 + suggest.items.length) % suggest.items.length);
                    } else if (e.key === "Enter" || e.key === "Tab") {
                      e.preventDefault();
                      applySuggestionAt(suggest.items[suggestIndex] ?? suggest.items[0]);
                    } else if (e.key === "Escape") {
                      e.preventDefault();
                      setSuggest(null);
                    }
                  }}
                  onBlur={() => setSuggest(null)}
                  style={styles.textarea}
                />
                {suggest && suggest.items.length > 0 && (
                  <div style={styles.suggestBox} data-test="calc-suggest">
                    {suggest.items.slice(0, 8).map((item, i) => (
                      <button
                        key={item}
                        type="button"
                        // クリックで textarea の blur（= 候補が閉じる）を起こさない
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => applySuggestionAt(item)}
                        style={{
                          ...styles.suggestItem,
                          ...(i === suggestIndex ? styles.suggestItemActive : {}),
                        }}
                      >
                        {item}
                      </button>
                    ))}
                  </div>
                )}
              </div>
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
              <div data-calc-results style={styles.resultsColWrap}>
              <div style={styles.resultsCol} aria-hidden={false}>
                {lines.map((line, i) => {
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
                  const varName = editable ? assignedVariableOf(line) : null;
                  const target = varName ? targets[varName] : undefined;
                  const targetLabel = target
                    ? `${tableNameOfId(target.tableBlockId) ?? "?"}.${target.column}`
                    : undefined;
                  return (
                    <div key={i} style={{ ...styles.resultLine, ...styles.resultRow }}>
                      <span
                        style={styles.resultValue}
                        title={t("calc.clickToCopy")}
                        onClick={() => copyResult(i, r.text ?? "")}
                      >
                        {copiedLine === i ? t("calc.copied") : r.text || " "}
                      </span>
                      {varName && (
                        <button
                          type="button"
                          data-test="calc-writeback-btn"
                          title={targetLabel ?? t("calc.writeToTable")}
                          onClick={() =>
                            setPicker((cur) =>
                              cur?.varName === varName ? null : { varName, tableName: null }
                            )
                          }
                          style={{
                            ...styles.writebackBtn,
                            ...(target ? styles.writebackBtnActive : {}),
                          }}
                        >
                          <ArrowRightToLine size={12} strokeWidth={2} />
                          {target && targetLabel && (
                            <span style={styles.writebackBtnText}>{targetLabel}</span>
                          )}
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
              {picker && (
                <div style={styles.writebackBox} data-test="calc-writeback-picker">
                  {/* 左パネル: 表の一覧。選ぶと右に列のパネルが展開する
                      （step の前手順ピッカーと同じカスケードの流儀） */}
                  <div style={styles.writebackPanel}>
                    <div style={styles.writebackLabel}>
                      {`${picker.varName} → ${t("calc.writebackPickTable")}`}
                    </div>
                    {Object.keys(tableStore?.tableColumns ?? {}).map((name) => {
                      const isOpen = picker.tableName === name;
                      const current = targets[picker.varName];
                      const isTargetTable =
                        !!current && tableStore?.tableBlockIds?.[name] === current.tableBlockId;
                      return (
                        <button
                          key={name}
                          type="button"
                          aria-expanded={isOpen}
                          style={{
                            ...styles.writebackItem,
                            ...(isOpen ? styles.writebackItemOpen : {}),
                          }}
                          onClick={() => {
                            // 書き戻し先に選ばれた表も名前を固定する（表示の一貫性）
                            const blockId = tableStore?.tableBlockIds?.[name];
                            if (blockId && tableStore && !tableStore.getCaption(blockId)) {
                              tableStore.setCaption(blockId, name);
                            }
                            setPicker({ ...picker, tableName: isOpen ? null : name });
                          }}
                        >
                          <span style={styles.writebackItemLabel}>{name}</span>
                          <span style={styles.writebackItemIcons}>
                            {isTargetTable && <Check size={12} strokeWidth={2.4} />}
                            <ChevronRight size={12} strokeWidth={2.2} />
                          </span>
                        </button>
                      );
                    })}
                    {targets[picker.varName] && (
                      <button
                        type="button"
                        style={{ ...styles.writebackItem, ...styles.writebackClear }}
                        onClick={() => setTarget(picker.varName, null)}
                      >
                        {t("calc.writebackClear")}
                      </button>
                    )}
                  </div>
                  {picker.tableName !== null && (
                    <div style={{ ...styles.writebackPanel, ...styles.writebackPanelNext }}>
                      <div style={styles.writebackLabel}>{t("calc.writebackPickColumn")}</div>
                      {Object.keys(tableStore?.tableColumns?.[picker.tableName] ?? {}).map((column) => {
                        const reads = readColumns.has(`${picker.tableName} ${column}`);
                        const blockId = tableStore?.tableBlockIds?.[picker.tableName ?? ""];
                        const current = targets[picker.varName];
                        const isCurrent =
                          !!current && current.tableBlockId === blockId && current.column === column;
                        return (
                          <button
                            key={column}
                            type="button"
                            disabled={reads || !blockId}
                            title={reads ? t("calc.writebackReadColumn") : undefined}
                            style={{
                              ...styles.writebackItem,
                              ...(reads || !blockId ? styles.writebackDisabled : {}),
                            }}
                            onClick={() =>
                              blockId && setTarget(picker.varName, { tableBlockId: blockId, column })
                            }
                          >
                            <span style={styles.writebackItemLabel}>{column}</span>
                            {isCurrent && <Check size={12} strokeWidth={2.4} />}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}
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
    minWidth: 0,
    flex: 1,
  },
  nameInput: {
    flex: 1,
    minWidth: 0,
    maxWidth: 240,
    border: "none",
    outline: "none",
    background: "transparent",
    color: "var(--color-muted-foreground)",
    fontSize: 12,
    padding: 0,
  },
  writebackBtnText: {
    fontSize: 10,
    maxWidth: 140,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  body: {
    display: "flex",
    gap: 12,
    alignItems: "stretch",
  },
  sourceWrap: {
    flex: 1,
    minWidth: 0,
    position: "relative",
    display: "flex",
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
  resultsColWrap: {
    flexShrink: 0,
    maxWidth: "45%",
    position: "relative",
    display: "flex",
  },
  resultsCol: {
    flex: 1,
    minWidth: 0,
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
  resultRow: {
    display: "flex",
    alignItems: "center",
    justifyContent: "flex-end",
    gap: 4,
  },
  resultValue: {
    color: "var(--color-primary)",
    cursor: "pointer",
  },
  writebackBtn: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    gap: 3,
    minWidth: 18,
    height: 18,
    padding: "0 3px",
    border: "none",
    borderRadius: 4,
    background: "transparent",
    color: "var(--color-text-tertiary)",
    cursor: "pointer",
    flexShrink: 0,
  },
  writebackBtnActive: {
    color: "var(--color-primary)",
    background: "var(--color-muted)",
  },
  writebackBox: {
    position: "absolute",
    top: "calc(100% + 4px)",
    right: 0,
    zIndex: 30,
    display: "flex",
    alignItems: "stretch",
    maxWidth: 420,
    padding: 4,
    borderRadius: 6,
    background: "var(--color-card)",
    border: "1px solid var(--color-border)",
    boxShadow: "0 4px 12px rgba(0, 0, 0, 0.08)",
  },
  writebackLabel: {
    fontSize: 11,
    color: "var(--color-muted-foreground)",
    padding: "0 4px 4px",
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
  },
  writebackPanel: {
    display: "flex",
    flexDirection: "column",
    gap: 2,
    padding: 2,
    minWidth: 130,
  },
  writebackPanelNext: {
    borderLeft: "1px solid var(--color-border)",
  },
  writebackItem: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
    width: "100%",
    border: "none",
    borderRadius: 4,
    padding: "4px 8px",
    background: "transparent",
    color: "var(--color-foreground)",
    fontFamily: mono,
    fontSize: 12,
    cursor: "pointer",
    whiteSpace: "nowrap",
    textAlign: "left",
  },
  writebackItemOpen: {
    background: "var(--color-muted)",
    color: "var(--color-primary)",
  },
  writebackItemLabel: {
    overflow: "hidden",
    textOverflow: "ellipsis",
    maxWidth: 180,
  },
  writebackItemIcons: {
    display: "inline-flex",
    alignItems: "center",
    gap: 2,
    color: "var(--color-text-tertiary)",
  },
  writebackClear: {
    color: "var(--color-error)",
  },
  writebackDisabled: {
    opacity: 0.4,
    cursor: "not-allowed",
  },
  resultError: {
    color: "var(--color-error)",
    cursor: "help",
  },
  emptyNote: {
    fontSize: 12,
    color: "var(--color-text-tertiary)",
  },
  suggestBox: {
    position: "absolute",
    top: "calc(100% + 4px)",
    left: 0,
    zIndex: 30,
    display: "flex",
    flexWrap: "wrap",
    gap: 2,
    maxWidth: "100%",
    padding: 4,
    borderRadius: 6,
    background: "var(--color-card)",
    border: "1px solid var(--color-border)",
    boxShadow: "0 4px 12px rgba(0, 0, 0, 0.08)",
  },
  suggestItem: {
    border: "none",
    borderRadius: 4,
    padding: "3px 8px",
    background: "transparent",
    color: "var(--color-foreground)",
    fontFamily: mono,
    fontSize: 12,
    cursor: "pointer",
    whiteSpace: "nowrap",
  },
  suggestItemActive: {
    background: "var(--color-muted)",
    color: "var(--color-primary)",
  },
};
