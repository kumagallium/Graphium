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
import { ParamLinkButton, ParamValueField, resolveParamLinkTarget } from "./param-link";
import { getActiveProvider } from "../../lib/storage/registry";
import { t, getDisplayLabel } from "../../i18n";
import {
  splitAttrLabel,
  type ActivityIoKind,
  type ExternalFlowOrigin,
  type FlowEntity,
  type FlowStep,
} from "./activity-graph-adapter";
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
  /** 外部参照インプット行（行名 → 由来）。参照元の現在の属性を RO で並記する */
  externalOrigins?: Record<string, ExternalFlowOrigin>;
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
  /**
   * まだ表が無いセクションで最初の 1 マスが入力されたとき、その内容で表を作る。
   * 入出力・ツールは name を 1 行目の名前に、パラメータは name を最初のキーにする。
   */
  onCreateSectionTable?: (stepBlockId: string, kind: SectionKind, name: string) => void;
  // ── 本文ハイライト由来の編集・移行 ──
  onRenameEntity?: (entityId: string, text: string) => void;
  onRemoveEntity?: (entityId: string) => void;
  /** 本文ハイライト由来の Entity を所属 step の表へ移す（nodeId 指定） */
  onMoveEntityToTable?: (entityNodeId: string) => void;
  /** 本文ハイライト由来のパラメータをパラメータ表の列へ移す */
  onMoveParamToTable?: (stepBlockId: string, entityId: string, key: string, value: string) => void;
  /** 共有行を、このステップの表にも 1 行として置く（同じモノなのでグラフでは 1 ノードのまま） */
  onAddSharedRow?: (stepBlockId: string, kind: ActivityIoKind, name: string) => void;
  /**
   * セル値の @参照（ノート / 素材）を開く。ID はノートの素 ID または
   * 外部ソース ID（pdf:/document:/data: 等）で、振り分けは受け側の Side Peek が行う
   */
  onOpenExternalNote?: (id: string) => void;
};

const SECTION_ORDER: SectionKind[] = ["attribute", "material", "tool", "output"];

/** 本文由来の属性を薄い列として見せる上限。横に伸び続けるのを防ぐ */
const GHOST_ATTR_COLUMN_LIMIT = 6;

// パラメータのグレーグリーンはノート側の [パラメータ] チップと同じ
const SECTION_COLOR: Record<SectionKind, string> = {
  attribute: "#8fa394",
  material: KIND_PALETTE.material.main,
  tool: KIND_PALETTE.tool.main,
  output: KIND_PALETTE.output.main,
};

/**
 * 見出し帯の濃さ（色ごとの alpha）。
 * 一律の濃度にすると、彩度の低いブランドグリーンだけが灰色に沈んで
 * パラメータ（グレー）と見分けが付かなくなる。見た目の強さを揃えるため、
 * 緑だけ濃く敷く。
 */
const SECTION_BAND_ALPHA: Record<SectionKind, string> = {
  attribute: "26",
  material: "45",
  tool: "26",
  output: "26",
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

/** 右パネルのセルに埋まっているインライン画像のサムネイル（ノードのサムネと同じ流儀） */
function CellImageThumb({
  fileId,
  alt,
  onOpen,
}: {
  fileId: string;
  alt: string;
  onOpen?: (id: string) => void;
}) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    getActiveProvider()
      .getMediaBlobUrl(fileId)
      .then((url: string) => {
        if (!cancelled) setSrc(url);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [fileId]);
  if (!src) return null;
  return (
    <img
      src={src}
      alt={alt}
      loading="lazy"
      // テキストのクリック（セル編集）と分けるため、画像自体が開くボタンを兼ねる
      onClick={onOpen ? (e) => { e.stopPropagation(); onOpen(`image:${fileId}`); } : undefined}
      title={onOpen ? t("inlineImage.clickToOpen") : undefined}
      style={{
        height: 28,
        maxWidth: 72,
        objectFit: "cover",
        borderRadius: 3,
        border: "1px solid var(--color-border)",
        verticalAlign: "middle",
        cursor: onOpen ? "pointer" : "default",
        flexShrink: 0,
      }}
    />
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
  onOpenExternalNote,
}: FlowStepPanelProps) {
  // 編集対象: `h:<blockId>:<col>`（ヘッダ） / `c:<blockId>:<row>:<col>`（セル）
  //           / `inline:<entityId>`（本文ハイライトの名前）
  const [edit, setEdit] = useState<{ key: string; draft: string } | null>(null);
  // 追加入力中: 既存表への行・列、またはまだ無いセクションの最初の 1 マス
  const [adding, setAdding] = useState<
    | { what: "column" | "row"; blockId: string; draft: string }
    | { what: "firstCell"; kind: SectionKind; draft: string }
    | null
  >(null);
  // 「表を追加」直後、できた表の最初のセルを編集状態にする予約
  const [pendingFocus, setPendingFocus] = useState<SectionKind | null>(null);
  const { compositionHandlers, isImeKey } = useImeEnterGuard();
  const sectionRefs = useRef<Partial<Record<SectionKind, HTMLDivElement | null>>>({});

  // セル値の表示。値が @ノート名 / @素材名 として解決できるときだけ、
  // 隣に参照先を開くボタン（↗）を添える。テキスト部分のクリックは従来どおり編集
  const cellValue = (text: string, table?: TableData | null, r?: number, c?: number) => {
    const imageFileId =
      table?.cellImages && r !== undefined && c !== undefined
        ? table.cellImages[`${r}:${c}`]
        : undefined;
    const target = onOpenExternalNote ? resolveParamLinkTarget(text) : null;
    if (!target && !imageFileId) return text;
    return (
      <span style={{ display: "inline-flex", alignItems: "center", gap: 4, maxWidth: "100%" }}>
        {imageFileId && (
          <CellImageThumb fileId={imageFileId} alt={text} onOpen={onOpenExternalNote} />
        )}
        <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis" }}>{text}</span>
        {target && <ParamLinkButton targetId={target} onOpen={onOpenExternalNote!} />}
      </span>
    );
  };

  const stepId = data?.stepId ?? null;
  useEffect(() => {
    setEdit(null);
    setAdding(null);
    setPendingFocus(null);
  }, [stepId]);

  // パラメータのキーを名付けて表ができたら、続けて値を打てるようにする。
  // 送る先はヘッダ（キー）ではなく 1 行目の値セル — ヘッダに戻すと、
  // いま名付けたキーを打ち直す形になり上書きされる（実バグ）
  const pendingTable = pendingFocus ? (data?.tables[pendingFocus] ?? null) : null;
  useEffect(() => {
    if (!pendingFocus || !pendingTable) return;
    setEdit({ key: `c:${pendingTable.blockId}:0:0`, draft: pendingTable.rows[0]?.[0] ?? "" });
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

  /** 編集の確定（値を直渡し）。@候補の確定は state（edit.draft）を経由すると
   *  古い値で確定してしまうので、こちらを直接呼ぶ */
  const commitEditValue = (key: string, raw: string) => {
    const v = raw.trim();
    const parts = key.split(":");
    if (parts[0] === "h" && v) onRenameColumn?.(parts[1], Number(parts[2]), v);
    else if (parts[0] === "c") onSetCell?.(parts[1], Number(parts[2]), Number(parts[3]), raw);
    else if (parts[0] === "inline" && v) onRenameEntity?.(key.slice("inline:".length), v);
    setEdit(null);
  };
  const commitEdit = () => {
    if (edit) commitEditValue(edit.key, edit.draft);
    else setEdit(null);
  };

  const commitAddValue = (
    a: { what: "column" | "row"; blockId: string } | { what: "firstCell"; kind: SectionKind },
    raw: string
  ) => {
    const v = raw.trim();
    if (v) {
      if (a.what === "firstCell") {
        onCreateSectionTable?.(data.stepId, a.kind, v);
        // パラメータはキーを名付けたので、続けて値を打てるようにする
        if (a.kind === "attribute") setPendingFocus("attribute");
      } else if (a.what === "column") onAddColumn?.(a.blockId, v);
      else onAddRow?.(a.blockId, v);
    }
    setAdding(null);
  };
  const commitAdd = () => {
    if (adding) commitAddValue(adding, adding.draft);
    else setAdding(null);
  };

  // すべての編集入力に @候補（本文メンションと同じ参照）を出す。
  // onPickValue は候補確定時の処理（state を経由せず値を直渡しで確定する）
  const field = (
    value: string,
    onChange: (v: string) => void,
    onCommit: () => void,
    onPickValue: (v: string) => void
  ) => (
    <ParamValueField
      value={value}
      onChange={onChange}
      onCommit={onCommit}
      onCancel={() => {
        setEdit(null);
        setAdding(null);
      }}
      onPick={onPickValue}
      compositionHandlers={compositionHandlers}
      isImeKey={isImeKey}
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
      field(edit!.draft, (v) => setEdit({ key: k, draft: v }), commitEdit, (v) => commitEditValue(k, v))
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
    // 本文でその Entity に付いた属性のうち、表にまだ列が無いもの。
    // 列が無いと値の置き場所が無く、本文にラベルがあるのに表から消える
    const ghostAttrCols: string[] = [];
    for (const g of ghosts) {
      for (const a of g.attrs ?? []) {
        const { key, value } = splitAttrLabel(a.label);
        const col = key ?? value;
        if (!col || headers.includes(col) || ghostAttrCols.includes(col)) continue;
        if (ghostAttrCols.length >= GHOST_ATTR_COLUMN_LIMIT) break;
        ghostAttrCols.push(col);
      }
    }
    /** ghost 行のその列の値。キー無し属性は値そのものが列名なので印だけ返す */
    const ghostAttrValue = (item: ProseItem, col: string): string | null => {
      for (const a of item.attrs ?? []) {
        const { key, value } = splitAttrLabel(a.label);
        if (key === col) return value;
        if (!key && value === col) return "✓";
      }
      return null;
    };
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
                    field(edit!.draft, (v) => setEdit({ key, draft: v }), commitEdit, (v) => commitEditValue(key, v))
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
            {ghostAttrCols.map((col) => (
              <th key={`ghostcol:${col}`} style={th}>
                <span style={ghostText}>{col}</span>
              </th>
            ))}
            {trailing && (
              <th style={{ ...th, borderRight: "none" }}>
                {adding?.what === "column" && adding.blockId === blockId ? (
                  field(adding.draft, (v) => setAdding({ what: "column", blockId: blockId!, draft: v }), commitAdd, (v) => commitAddValue({ what: "column", blockId: blockId! }, v))
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
                    {editing(key) ? field(edit!.draft, (v) => setEdit({ key, draft: v }), commitEdit, (v) => commitEditValue(key, v)) : cellValue(row[col] ?? "", table, r, col)}
                  </td>
                );
              })}
              {ghostAttrCols.map((col) => (
                <td key={`ghostcell:${col}`} style={td} />
              ))}
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
                {ghostAttrCols.map((col) => (
                  <td
                    key={`ghostcell:${col}`}
                    style={{ ...td, ...ghostText, cursor: "pointer" }}
                    title={t("flowTable.ghostHint")}
                    onClick={migrate}
                  >
                    {ghostAttrValue(item, col) ?? "–"}
                  </td>
                ))}
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
          {/* まだ表が無いセクションの空 1 行。ここに名前を打つと表ができる */}
          {!table && onCreateSectionTable && (
            <tr>
              <td style={td} onClick={() => !editing("first") && setAdding({ what: "firstCell", kind, draft: "" })}>
                {adding?.what === "firstCell" && adding.kind === kind ? (
                  field(adding.draft, (v) => setAdding({ what: "firstCell", kind, draft: v }), commitAdd, (v) => commitAddValue({ what: "firstCell", kind }, v))
                ) : (
                  <span style={{ ...ghostText, display: "inline-flex", alignItems: "center", gap: 4 }}>
                    <Plus size={11} /> {getDisplayLabel(kind).replace(/^\[|\]$/g, "")}
                  </span>
                )}
              </td>
              {ghostAttrCols.map((col) => (
                <td key={`emptycell:${col}`} style={td} />
              ))}
              <td style={{ ...td, borderRight: "none" }} />
            </tr>
          )}
          {table && onAddRow && (
            <tr>
              <td colSpan={headers.length + (trailing ? 1 : 0)} style={{ border: "none", padding: 0 }}>
                {adding?.what === "row" && adding.blockId === table.blockId ? (
                  <div style={{ padding: "3px 6px", maxWidth: 220 }}>
                    {field(adding.draft, (v) => setAdding({ what: "row", blockId: table.blockId, draft: v }), commitAdd, (v) => commitAddValue({ what: "row", blockId: table.blockId }, v))}
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
                    field(edit!.draft, (v) => setEdit({ key, draft: v }), commitEdit, (v) => commitEditValue(key, v))
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
                  field(adding.draft, (v) => setAdding({ what: "column", blockId: blockId!, draft: v }), commitAdd, (v) => commitAddValue({ what: "column", blockId: blockId! }, v))
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
            {/* まだ表が無いパラメータ: 最初のキーをここで名付ける */}
            {!table && onCreateSectionTable && (
              <th style={th} onClick={() => setAdding({ what: "firstCell", kind: "attribute", draft: "" })}>
                {adding?.what === "firstCell" && adding.kind === "attribute" ? (
                  field(adding.draft, (v) => setAdding({ what: "firstCell", kind: "attribute", draft: v }), commitAdd, (v) => commitAddValue({ what: "firstCell", kind: "attribute" }, v))
                ) : (
                  <span style={{ ...ghostText, display: "inline-flex", alignItems: "center", gap: 4 }}>
                    <Plus size={11} /> {t("graphTable.paramColumn")}
                  </span>
                )}
              </th>
            )}
            {!table && <th style={{ ...th, borderRight: "none", width: "1%" }} />}
          </tr>
        </thead>
        <tbody>
          {!table && (
            <tr>
              <td style={{ ...td, ...ghostText }} />
              <td style={{ ...td, borderRight: "none" }} />
            </tr>
          )}
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
                    {editing(key) ? field(edit!.draft, (v) => setEdit({ key, draft: v }), commitEdit, (v) => commitEditValue(key, v)) : cellValue(row[col] ?? "", table, r, col)}
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
            background: `${color}${SECTION_BAND_ALPHA[kind]}`,
          }}
        >
          <SectionChip kind={kind} />
        </div>
        {/* 表がまだ無くても、空の 1 行がある表として描く。ここに打ち込んだ
            瞬間にノート側の表が生まれる（「表を追加」という前段は置かない）。
            打たなければノートには何も書かれない — ステップを作っただけで
            空の表が 4 つ並ぶのは、ノートとして読めなくなるので避ける */}
        {kind === "attribute"
          ? paramGrid(table, ghosts)
          : entityGrid(table, kind as ActivityIoKind, ghosts)}
        {/* 外部参照行の「参照元の現在値」。編集経路は無い（読み取り専用） —
            表の列は選択時点のコピーで自由に編集できるので、参照元とのズレは
            ここで気づける。broken はリンク切れとして示す */}
        {kind === "material" &&
          Object.entries(data.externalOrigins ?? {}).map(([rowName, origin]) => (
            <div
              key={`origin:${rowName}`}
              style={{
                margin: "0 4px 4px",
                padding: "3px 8px",
                borderRadius: 4,
                background: "var(--color-surface)",
                fontSize: 10.5,
                lineHeight: 1.6,
                color: origin.broken
                  ? "var(--color-error)"
                  : "var(--color-text-tertiary)",
              }}
            >
              <span style={{ fontWeight: 600 }}>{rowName}</span>
              {" — "}
              {origin.broken
                ? `${origin.noteTitle} › ${origin.stepTitle}（${t("step.brokenLink")}）`
                : t("flowTable.externalAttrsFrom", {
                    note: origin.noteTitle,
                    step: origin.stepTitle,
                  })}
              {!origin.broken && (origin.attrs?.length ?? 0) > 0 && (
                <span>
                  {": "}
                  {origin.attrs!
                    .map((a) => (a.key ? `${a.key}: ${a.value}` : a.value))
                    .join(" ・ ")}
                </span>
              )}
            </div>
          ))}
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
