// 選択中ノードの裏にある step の中身（全テーブル）を編集するパネル。
//
// パネルは「ステップの中身ぜんぶ」— パラメータ / インプット / ツール /
// アウトプットの 4 セクション。step を選んでも、その中の Entity を選んでも
// 同じパネルで、Entity 選択は該当行のハイライト + そこへのスクロールになる
// だけ。グラフからの追加はすべてここ（行を追加 / 列を追加）に一本化されている。
// ヘッダはステップノードと同じ青帯 — パネル＝選択中ステップの中身、を色で言う。
//
// 本文のハイライト由来（インライン span）の Entity・パラメータは、別枠に
// 隔離せず**その種類のセクションの中に薄い行 / 薄い列**として混ぜて見せる。
// 名前の編集はその場で span を書き換え、それ以外のセル・「表に追加」を
// 押した瞬間に表の行 / 列へ移る（ハイライト利用者がそのまま表に移行できる）。
//
// 1 セクション = 1 カード。ノート側で 1 つのラベル付き表が 1 ブロックなのと
// 同じ区切りで、見出しにはノードと同じ種類色の帯 + ノートの表と同じラベル
// チップを置く。表がまだ無いセクションは破線カード。

import { useEffect, useRef, useState, type CSSProperties } from "react";
import { Link2, Plus, Trash2 } from "lucide-react";
import { useImeEnterGuard } from "../../hooks/use-ime-enter-guard";
import { t, getDisplayLabel } from "../../i18n";
import { splitAttrLabel, type ActivityIoKind, type FlowEntity, type FlowStep } from "./activity-graph-adapter";
import { KIND_PALETTE } from "./flow-palette";
import type { TableData } from "./table-row-edit";

export type FlowSelection =
  | { kind: "step"; step: FlowStep }
  | { kind: "entity"; entity: FlowEntity }
  | null;

export type SectionKind = "attribute" | ActivityIoKind;

/** 本文ハイライト（インライン span）由来で、まだ表に入っていないもの */
export type ProseItem = {
  entityId: string;
  /** グラフのノード id（Entity のみ。表へ移すときに使う） */
  nodeId?: string;
  kind: SectionKind;
  label: string;
  /** この Entity にハイライトで紐付いた属性（表への移行時に列として付いて行く） */
  attrs?: { label: string }[];
  /** 他のステップの表にある行（共有）。移行はできないので実体の場所を示す */
  external?: boolean;
  /** 共有行の実体がある表のブロック id（「本文へ」で飛ぶ先） */
  homeBlockId?: string;
  /** 共有行の実体がある step の名前 */
  homeStepName?: string;
};

/** 選択の裏にある step の中身（getPanelFor が組み立てる） */
export type StepPanelData = {
  stepId: string;
  stepName: string;
  tables: Record<SectionKind, TableData | null>;
  /** テーブル行 Entity を選択中: その行をハイライト */
  highlight?: { blockId: string; rowName: string };
  prose: ProseItem[];
  /** 本文ハイライト由来の項目を選択中: その entityId */
  proseHighlight?: string;
};

export type FlowStepPanelProps = {
  selection: FlowSelection;
  data: StepPanelData | null;
  // ── テーブル編集（既存の表） ──
  onSetCell?: (blockId: string, rowIndex: number, colIndex: number, value: string) => void;
  onRenameColumn?: (blockId: string, colIndex: number, name: string) => void;
  onAddColumn?: (blockId: string, name: string) => void;
  onRemoveColumn?: (blockId: string, colIndex: number) => void;
  onAddRow?: (blockId: string, name: string) => void;
  // ── 表がまだ無いセクション ──
  /** 「表を追加」: 空の表（ヘッダ 1 列 + 空行）をラベル付きで作る */
  onCreateSectionTable?: (stepBlockId: string, kind: SectionKind) => void;
  // ── 本文ハイライト由来の編集・移行 ──
  onRenameEntity?: (entityId: string, text: string) => void;
  onRemoveEntity?: (entityId: string) => void;
  /** 本文ハイライト由来の Entity を所属 step の表へ移す（nodeId 指定） */
  onMoveEntityToTable?: (entityNodeId: string) => void;
  /** 本文ハイライト由来のパラメータをパラメータ表の列へ移す */
  onMoveParamToTable?: (stepBlockId: string, entityId: string, key: string, value: string) => void;
  /** 共有行を、このステップの表にも 1 行として置く（同じモノなのでグラフでは 1 ノードのまま） */
  onAddSharedRow?: (stepBlockId: string, kind: ActivityIoKind, name: string) => void;
};

const SECTION_ORDER: SectionKind[] = ["attribute", "material", "tool", "output"];

// パラメータのグレーグリーンはノート側の [パラメータ] チップと同じ
const SECTION_COLOR: Record<SectionKind, string> = {
  attribute: "#8fa394",
  material: KIND_PALETTE.material.main,
  tool: KIND_PALETTE.tool.main,
  output: KIND_PALETTE.output.main,
};

const th: CSSProperties = {
  padding: "4px 8px",
  fontSize: 11,
  fontWeight: 700,
  textAlign: "left",
  whiteSpace: "nowrap",
  background: "var(--color-surface)",
  borderBottom: "1px solid var(--color-border)",
  borderRight: "1px solid var(--color-border-subtle)",
};

const td: CSSProperties = {
  padding: "3px 8px",
  fontSize: 12,
  // 空セルでも行が潰れないように高さを持たせる（クリック対象が線になるのを防ぐ）
  height: 26,
  lineHeight: "20px",
  borderBottom: "1px solid var(--color-border-subtle)",
  borderRight: "1px solid var(--color-border-subtle)",
  cursor: "text",
};

// 本文ハイライト由来の薄い行・列。表の行と同じ場所に置き、
// 「まだ表には入っていない」ことだけ色で伝える
const ghostText: CSSProperties = {
  color: "var(--color-text-tertiary)",
};

const inputStyle: CSSProperties = {
  width: "100%",
  padding: "1px 4px",
  fontSize: 12,
  border: "1px solid var(--color-primary)",
  borderRadius: 3,
  outline: "none",
};

const addBtnStyle: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 3,
  padding: "2px 7px 2px 4px",
  fontSize: 11,
  fontWeight: 600,
  color: "var(--color-primary)",
  background: "transparent",
  border: "none",
  borderRadius: 5,
  cursor: "pointer",
  whiteSpace: "nowrap",
};

const ghostIconBtn: CSSProperties = {
  border: "none",
  background: "transparent",
  color: "var(--color-destructive)",
  cursor: "pointer",
  padding: 2,
  lineHeight: 1,
};

/** ノート側の表ラベルチップ（#646）と同じ見た目のセクション見出しチップ */
function SectionChip({ kind }: { kind: SectionKind }) {
  const color = SECTION_COLOR[kind];
  return (
    <span
      style={{
        display: "inline-block",
        padding: "0 6px",
        fontSize: 11,
        fontWeight: 600,
        lineHeight: 1.6,
        whiteSpace: "nowrap",
        borderRadius: 999,
        color,
        backgroundColor: `${color}18`,
        border: `1px solid ${color}38`,
        flexShrink: 0,
      }}
    >
      {getDisplayLabel(kind)}
    </span>
  );
}

export function FlowStepPanel({
  selection,
  data,
  onSetCell,
  onRenameColumn,
  onAddColumn,
  onRemoveColumn,
  onAddRow,
  onCreateSectionTable,
  onRenameEntity,
  onRemoveEntity,
  onMoveEntityToTable,
  onMoveParamToTable,
  onAddSharedRow,
}: FlowStepPanelProps) {
  // 編集対象: `h:<blockId>:<col>`（ヘッダ） / `c:<blockId>:<row>:<col>`（セル）
  //           / `inline:<entityId>`（本文ハイライトの名前）
  const [edit, setEdit] = useState<{ key: string; draft: string } | null>(null);
  // 追加入力中: 既存表への行・列
  const [adding, setAdding] = useState<{ what: "column" | "row"; blockId: string; draft: string } | null>(null);
  // 「表を追加」直後、できた表の最初のセルを編集状態にする予約
  const [pendingFocus, setPendingFocus] = useState<SectionKind | null>(null);
  const { compositionHandlers, isImeKey } = useImeEnterGuard();
  const sectionRefs = useRef<Partial<Record<SectionKind, HTMLDivElement | null>>>({});

  const stepId = data?.stepId ?? null;
  useEffect(() => {
    setEdit(null);
    setAdding(null);
    setPendingFocus(null);
  }, [stepId]);

  // 「表を追加」の後、できた表の最初のセルをそのまま編集状態にする。
  // パラメータはキー（ヘッダ）、入出力・ツールは 1 行目の名前セル
  const pendingTable = pendingFocus ? (data?.tables[pendingFocus] ?? null) : null;
  useEffect(() => {
    if (!pendingFocus || !pendingTable) return;
    if (pendingFocus === "attribute") {
      setEdit({ key: `h:${pendingTable.blockId}:0`, draft: pendingTable.headers[0] ?? "" });
    } else {
      setEdit({ key: `c:${pendingTable.blockId}:0:0`, draft: pendingTable.rows[0]?.[0] ?? "" });
    }
    setPendingFocus(null);
  }, [pendingFocus, pendingTable]);

  // Entity 選択が変わったら、その行のあるセクションを視界に入れる
  const highlightBlockId = data?.highlight?.blockId ?? null;
  const highlightRowName = data?.highlight?.rowName ?? null;
  const proseHighlight = data?.proseHighlight ?? null;
  useEffect(() => {
    if (!data) return;
    let key: SectionKind | null = null;
    if (proseHighlight) {
      key = data.prose.find((p) => p.entityId === proseHighlight)?.kind ?? null;
    } else if (highlightBlockId) {
      key = SECTION_ORDER.find((k) => data.tables[k]?.blockId === highlightBlockId) ?? null;
    }
    if (!key) return;
    sectionRefs.current[key]?.scrollIntoView({ block: "nearest", behavior: "smooth" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [highlightBlockId, highlightRowName, proseHighlight]);

  if (!selection) {
    return (
      <div style={emptyStyle}>
        <span>{t("flowTable.noSelection")}</span>
      </div>
    );
  }

  if (!data) {
    // 所属 step が特定できない（孤立した Entity など）ときの逃げ道
    const title = selection.kind === "step" ? selection.step.name : selection.entity.label;
    return (
      <div style={emptyStyle}>
        <span style={{ fontWeight: 700, color: "var(--color-foreground)" }}>{title}</span>
        <span>{t("flowTable.noTableYet")}</span>
      </div>
    );
  }

  const commitEdit = () => {
    if (edit) {
      const v = edit.draft.trim();
      const parts = edit.key.split(":");
      if (parts[0] === "h" && v) onRenameColumn?.(parts[1], Number(parts[2]), v);
      else if (parts[0] === "c") onSetCell?.(parts[1], Number(parts[2]), Number(parts[3]), edit.draft);
      else if (parts[0] === "inline" && v) onRenameEntity?.(edit.key.slice("inline:".length), v);
    }
    setEdit(null);
  };

  const commitAdd = () => {
    if (adding) {
      const v = adding.draft.trim();
      if (v) {
        if (adding.what === "column") onAddColumn?.(adding.blockId, v);
        else onAddRow?.(adding.blockId, v);
      }
    }
    setAdding(null);
  };

  const field = (value: string, onChange: (v: string) => void, onCommit: () => void) => (
    <input
      value={value}
      autoFocus
      onFocus={(e) => e.target.select()}
      onChange={(e) => onChange(e.target.value)}
      {...compositionHandlers}
      onKeyDown={(e) => {
        if (e.key === "Enter" && !isImeKey(e)) onCommit();
        else if (e.key === "Escape") {
          e.stopPropagation();
          setEdit(null);
          setAdding(null);
        }
      }}
      onBlur={() => {
        setEdit(null);
        setAdding(null);
      }}
      style={inputStyle}
    />
  );

  const editing = (key: string) => edit?.key === key;
  const highlightBg = { background: "var(--color-accent)" } as const;

  /** 本文ハイライトの名前セル（クリックでその場リネーム = span 書き換え） */
  const ghostNameCell = (item: ProseItem, extraStyle?: CSSProperties) => {
    const k = `inline:${item.entityId}`;
    if (item.external) {
      return (
        <span style={{ ...ghostText, ...extraStyle }} title={t("flowTable.sharedHint")}>
          {item.label}
        </span>
      );
    }

    return editing(k) ? (
      field(edit!.draft, (v) => setEdit({ key: k, draft: v }), commitEdit)
    ) : (
      <span
        style={{ ...ghostText, cursor: onRenameEntity ? "text" : "default", ...extraStyle }}
        onClick={() => onRenameEntity && setEdit({ key: k, draft: item.label })}
      >
        {item.label}
      </span>
    );
  };

  /** 入出力・ツールのセクション表。ghosts は本文ハイライト由来の薄い行 */
  const entityGrid = (table: TableData | null, kind: ActivityIoKind, ghosts: ProseItem[]) => {
    const headers = table?.headers ?? [t("graphTable.nameColumn")];
    const blockId = table?.blockId ?? null;
    const highlightRow =
      table && highlightBlockId === table.blockId && highlightRowName != null
        ? table.rows.findIndex((r) => r[0] === highlightRowName)
        : -1;
    const trailing = !!onAddColumn && !!table;
    return (
      <table style={{ borderCollapse: "collapse", minWidth: "100%" }}>
        <thead>
          <tr>
            {headers.map((h, col) => {
              const key = blockId ? `h:${blockId}:${col}` : `nohead:${col}`;
              return (
                <th key={col} style={th}>
                  {blockId && editing(key) ? (
                    field(edit!.draft, (v) => setEdit({ key, draft: v }), commitEdit)
                  ) : (
                    <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                      <span
                        onClick={() => blockId && onRenameColumn && setEdit({ key, draft: h })}
                        style={{ cursor: blockId && onRenameColumn ? "text" : "default" }}
                      >
                        {h || "—"}
                      </span>
                      {blockId && col > 0 && onRemoveColumn && (
                        <button
                          onClick={() => onRemoveColumn(blockId, col)}
                          title={t("flowTable.removeColumn")}
                          style={ghostIconBtn}
                        >
                          <Trash2 size={10} />
                        </button>
                      )}
                    </span>
                  )}
                </th>
              );
            })}
            {trailing && (
              <th style={{ ...th, borderRight: "none" }}>
                {adding?.what === "column" && adding.blockId === blockId ? (
                  field(adding.draft, (v) => setAdding({ what: "column", blockId: blockId!, draft: v }), commitAdd)
                ) : (
                  <button
                    onClick={() => setAdding({ what: "column", blockId: blockId!, draft: "" })}
                    style={addBtnStyle}
                  >
                    <Plus size={11} /> {t("flowTable.addColumn")}
                  </button>
                )}
              </th>
            )}
            {!table && <th style={{ ...th, borderRight: "none", width: "1%" }} />}
          </tr>
        </thead>
        <tbody>
          {(table?.rows ?? []).map((row, r) => (
            <tr key={r} style={highlightRow === r ? highlightBg : undefined}>
              {headers.map((_, col) => {
                const key = `c:${blockId}:${r}:${col}`;
                return (
                  <td
                    key={col}
                    style={td}
                    onClick={() => onSetCell && !editing(key) && setEdit({ key, draft: row[col] ?? "" })}
                  >
                    {editing(key) ? field(edit!.draft, (v) => setEdit({ key, draft: v }), commitEdit) : (row[col] ?? "")}
                  </td>
                );
              })}
              {trailing && <td style={{ ...td, borderRight: "none" }} />}
            </tr>
          ))}
          {/* 本文ハイライト由来: 同じ表の中に薄い行として見せる。名前はその場で
              編集でき、他のセル・「表に追加」で行として取り込む（span は外れる） */}
          {ghosts.map((item) => {
            const highlighted = proseHighlight === item.entityId;
            const migrate = () => {
              if (item.external) {
                onAddSharedRow?.(data.stepId, kind, item.label);
                return;
              }
              if (item.nodeId) onMoveEntityToTable?.(item.nodeId);
            };
            return (
              <tr key={item.entityId} style={highlighted ? highlightBg : undefined}>
                <td style={td}>{ghostNameCell(item)}</td>
                {/* キーが列名と一致する属性は値をプレビュー（移行後の姿を先に見せる） */}
                {headers.slice(1).map((h, i) => {
                  const match = item.attrs?.find((a) => splitAttrLabel(a.label).key === h);
                  return (
                    <td
                      key={i}
                      style={{ ...td, ...ghostText, cursor: "pointer" }}
                      title={t("flowTable.ghostHint")}
                      onClick={migrate}
                    >
                      {match ? splitAttrLabel(match.label).value : "–"}
                    </td>
                  );
                })}
                <td style={{ ...td, borderRight: "none", whiteSpace: "nowrap", width: "1%" }}>
                  {item.external ? (
                    // 共有でも「このステップの表にも書く」は選べる。同名は
                    // 1 つの Entity に統合されるので、行が増えてもノードは増えない
                    <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                      <span style={{ ...ghostText, fontSize: 10 }} title={t("flowTable.sharedHint")}>
                        <Link2 size={11} style={{ verticalAlign: "-2px" }} />{" "}
                        {item.homeStepName
                          ? t("flowTable.sharedFrom", { step: item.homeStepName })
                          : t("flowTable.shared")}
                      </span>
                      {onAddSharedRow && (
                        <button onClick={migrate} style={{ ...addBtnStyle, padding: "1px 5px 1px 3px", fontSize: 10 }}>
                          <Plus size={10} /> {t("flowTable.addToTable")}
                        </button>
                      )}
                    </span>
                  ) : (
                    <>
                      {item.nodeId && onMoveEntityToTable && (
                        <button onClick={migrate} style={{ ...addBtnStyle, padding: "1px 5px 1px 3px", fontSize: 10 }}>
                          <Plus size={10} /> {t("flowTable.addToTable")}
                        </button>
                      )}
                      {onRemoveEntity && (
                        <button
                          onClick={() => onRemoveEntity(item.entityId)}
                          title={t("activityGraph.removeChip")}
                          style={ghostIconBtn}
                        >
                          <Trash2 size={11} />
                        </button>
                      )}
                    </>
                  )}
                </td>
              </tr>
            );
          })}
          {table && onAddRow && (
            <tr>
              <td colSpan={headers.length + (trailing ? 1 : 0)} style={{ border: "none", padding: 0 }}>
                {adding?.what === "row" && adding.blockId === table.blockId ? (
                  <div style={{ padding: "3px 6px", maxWidth: 220 }}>
                    {field(adding.draft, (v) => setAdding({ what: "row", blockId: table.blockId, draft: v }), commitAdd)}
                  </div>
                ) : (
                  <button
                    onClick={() => setAdding({ what: "row", blockId: table.blockId, draft: "" })}
                    style={{ ...addBtnStyle, margin: "2px 4px 4px" }}
                  >
                    <Plus size={11} /> {t("flowTable.addRow")}
                  </button>
                )}
              </td>
            </tr>
          )}
        </tbody>
      </table>
    );
  };

  /** パラメータ表（ヘッダ=キー / 1 行目=値）。ghosts は本文ハイライト由来の薄い列 */
  const paramGrid = (table: TableData | null, ghosts: ProseItem[]) => {
    const blockId = table?.blockId ?? null;
    const headers = table?.headers ?? [];
    const rows = table?.rows ?? (ghosts.length > 0 ? [[]] : []);
    const ghostCols = ghosts.map((g) => ({ item: g, ...splitAttrLabel(g.label) }));
    const trailing = !!onAddColumn && !!table;
    return (
      <table style={{ borderCollapse: "collapse", minWidth: "100%" }}>
        <thead>
          <tr>
            {headers.map((h, col) => {
              const key = `h:${blockId}:${col}`;
              return (
                <th key={col} style={th}>
                  {editing(key) ? (
                    field(edit!.draft, (v) => setEdit({ key, draft: v }), commitEdit)
                  ) : (
                    <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                      <span
                        onClick={() => onRenameColumn && setEdit({ key, draft: h })}
                        style={{ cursor: onRenameColumn ? "text" : "default" }}
                      >
                        {h || "—"}
                      </span>
                      {col > 0 && onRemoveColumn && blockId && (
                        <button
                          onClick={() => onRemoveColumn(blockId, col)}
                          title={t("flowTable.removeColumn")}
                          style={ghostIconBtn}
                        >
                          <Trash2 size={10} />
                        </button>
                      )}
                    </span>
                  )}
                </th>
              );
            })}
            {ghostCols.map(({ item, key }) => (
              <th key={item.entityId} style={{ ...th, ...(proseHighlight === item.entityId ? highlightBg : {}) }}>
                <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                  <span style={ghostText}>{key ?? "—"}</span>
                  {onRemoveEntity && (
                    <button
                      onClick={() => onRemoveEntity(item.entityId)}
                      title={t("activityGraph.removeChip")}
                      style={ghostIconBtn}
                    >
                      <Trash2 size={10} />
                    </button>
                  )}
                </span>
              </th>
            ))}
            {trailing && (
              <th style={{ ...th, borderRight: "none" }}>
                {adding?.what === "column" && adding.blockId === blockId ? (
                  field(adding.draft, (v) => setAdding({ what: "column", blockId: blockId!, draft: v }), commitAdd)
                ) : (
                  <button
                    onClick={() => setAdding({ what: "column", blockId: blockId!, draft: "" })}
                    style={addBtnStyle}
                  >
                    <Plus size={11} /> {t("flowTable.addColumn")}
                  </button>
                )}
              </th>
            )}
            {!table && <th style={{ ...th, borderRight: "none", width: "1%" }} />}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, r) => (
            <tr key={r}>
              {headers.map((_, col) => {
                const key = `c:${blockId}:${r}:${col}`;
                return (
                  <td
                    key={col}
                    style={td}
                    onClick={() => onSetCell && !editing(key) && setEdit({ key, draft: row[col] ?? "" })}
                  >
                    {editing(key) ? field(edit!.draft, (v) => setEdit({ key, draft: v }), commitEdit) : (row[col] ?? "")}
                  </td>
                );
              })}
              {/* 値の行（1 行目）にだけ本文由来の値を出す。クリックで列として取り込む */}
              {ghostCols.map(({ item, value }) => (
                <td
                  key={item.entityId}
                  style={{
                    ...td,
                    ...ghostText,
                    cursor: onMoveParamToTable ? "pointer" : "default",
                    ...(proseHighlight === item.entityId ? highlightBg : {}),
                  }}
                  title={t("flowTable.ghostHint")}
                  onClick={() => {
                    if (r !== 0 || !onMoveParamToTable) return;
                    const split = splitAttrLabel(item.label);
                    onMoveParamToTable(data.stepId, item.entityId, split.key ?? item.label, split.value);
                  }}
                >
                  {r === 0 ? value : ""}
                </td>
              ))}
              {trailing && <td style={{ ...td, borderRight: "none" }} />}
            </tr>
          ))}
        </tbody>
      </table>
    );
  };

  const section = (kind: SectionKind) => {
    const color = SECTION_COLOR[kind];
    const table = data.tables[kind];
    const ghosts = data.prose.filter((p) => p.kind === kind);
    const hasBody = !!table || ghosts.length > 0;
    const canStart = !!onCreateSectionTable;
    return (
      <div
        key={kind}
        ref={(el) => {
          sectionRefs.current[kind] = el;
        }}
        style={{
          borderRadius: 6,
          // 空でも種類色は保つ（破線が「表はまだ無い」を言う）。帯は全色 15% —
          // 一律 8% だと赤系だけ目立ち、緑・アンバーが灰色に沈む
          border: table ? `1px solid ${color}66` : `1px dashed ${color}88`,
          background: "var(--color-card)",
          overflow: "hidden",
          flexShrink: 0,
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            padding: "4px 6px",
            background: `${color}26`,
          }}
        >
          <SectionChip kind={kind} />
          {/* 表が無いセクションは「表を追加」。押した瞬間に空の表がラベル付きで
              生まれ、最初のセル（パラメータはキー、他は名前）が入力待ちになる。
              薄い行（本文ハイライト / 共有）が出ているときは、その行の操作が
              先にあるので見出しにボタンを重ねない */}
          {!table && ghosts.length === 0 && canStart && (
            <button
              onClick={() => {
                onCreateSectionTable?.(data.stepId, kind);
                setPendingFocus(kind);
              }}
              style={addBtnStyle}
            >
              <Plus size={11} /> {t("flowTable.addTable")}
            </button>
          )}
        </div>
        {hasBody &&
          (kind === "attribute"
            ? paramGrid(table, ghosts)
            : entityGrid(table, kind as ActivityIoKind, ghosts))}
      </div>
    );
  };

  return (
    <div style={wrapStyle}>
      {/* パネル＝選択中ステップの中身。ステップノードと同じ青帯で言う */}
      <div style={headerStyle}>
        <span
          style={{
            width: 8,
            height: 8,
            flexShrink: 0,
            borderRadius: "50%",
            background: KIND_PALETTE.activity.main,
          }}
        />
        <span
          style={{
            flex: 1,
            minWidth: 0,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            fontWeight: 700,
            color: KIND_PALETTE.activity.text,
          }}
        >
          {data.stepName}
        </span>
        <span style={{ color: KIND_PALETTE.activity.text, opacity: 0.65, flexShrink: 0 }}>
          {t("flowTable.tableHint")}
        </span>
      </div>

      <div
        style={{
          flex: 1,
          minHeight: 0,
          overflow: "auto",
          display: "flex",
          flexDirection: "column",
          gap: 8,
          padding: 8,
          // カードを浮かせる薄い地。ここが白だと 1 枚の長い表に見えてしまう
          background: "var(--color-surface)",
        }}
      >
        {SECTION_ORDER.map(section)}
      </div>
    </div>
  );
}

const wrapStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  height: "100%",
  minHeight: 0,
  background: "var(--color-card)",
  borderRadius: 8,
  border: "1px solid var(--color-border)",
  overflow: "hidden",
};

const headerStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 6,
  padding: "6px 10px",
  fontSize: 12,
  borderBottom: "1px solid var(--color-border)",
  background: KIND_PALETTE.activity.bg,
  flexShrink: 0,
};

const emptyStyle: CSSProperties = {
  ...wrapStyle,
  alignItems: "center",
  justifyContent: "center",
  gap: 4,
  fontSize: 12,
  color: "var(--color-text-tertiary)",
  textAlign: "center",
  padding: 12,
};
