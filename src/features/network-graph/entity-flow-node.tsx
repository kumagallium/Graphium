// フロービュー（F 案）の Entity ノード。
//
// material / tool / output の Entity が独立ノードになる。ノードが持つのは
// 名前・画像サムネイル・属性の件数だけで、属性の閲覧と編集は
// flow-attribute-table 側に集約する（ノードに表を詰めるとグラフが読めなくなる）。
//
// ノード上でできるのは名前のリネームと削除。書き込み先は出自で分かれ、
// インライン span 由来は entity-edit、構造化テーブルの行由来は
// table-row-edit を通る。

import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import { Handle, Position, type Node, type NodeProps } from "@xyflow/react";
import { FileText, Film, Image as ImageIcon, Music, Pencil, SlidersHorizontal, Trash2 } from "lucide-react";
import { useImeEnterGuard } from "../../hooks/use-ime-enter-guard";
import { getActiveProvider } from "../../lib/storage/registry";
import { t } from "../../i18n";
import { splitAttrLabel, type FlowEntity } from "./activity-graph-adapter";
import { KIND_PALETTE, selectionRing } from "./flow-palette";

export type EntityFlowNodeData = {
  entity: FlowEntity;
  /** entityId 指定のリネーム（Entity 名にも属性行にも使う — 同じ span 書き換え機構） */
  onRenameEntity?: (entityId: string, text: string) => void;
  /** entityId 指定の削除（同上） */
  onRemoveEntity?: (entityId: string) => void;
  /** テーブル行の名前（1 列目）を書き換える */
  onRenameTableRow?: (blockId: string, rowName: string, newName: string) => void;
  /** テーブル行を削除する */
  onRemoveTableRow?: (blockId: string, rowName: string) => void;
};

export type EntityFlowNodeType = Node<EntityFlowNodeData, "entity">;


const MEDIA_ICONS: Record<string, typeof ImageIcon> = {
  image: ImageIcon,
  video: Film,
  audio: Music,
  pdf: FileText,
  file: FileText,
};

const miniBtnStyle: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  width: 18,
  height: 18,
  padding: 0,
  border: "none",
  borderRadius: 5,
  background: "transparent",
  color: "var(--color-text-tertiary)",
  cursor: "pointer",
};

const attrInputStyle: CSSProperties = {
  flex: 1,
  minWidth: 0,
  padding: "1px 6px",
  fontSize: 11,
  border: "1px solid var(--color-border)",
  borderRadius: 4,
  outline: "none",
  color: "var(--color-foreground)",
};

/** 画像 Entity のサムネイル。local-media:// は Blob URL に変換する（AssetGalleryView と同じ流儀） */
function EntityThumbnail({ url, alt }: { url: string; alt: string }) {
  const [src, setSrc] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const provider = getActiveProvider();
    const fileId = provider.extractFileId(url);
    if (!fileId) {
      setSrc(url); // Google Drive 等はそのまま
      return;
    }
    provider
      .getMediaBlobUrl(fileId)
      .then((blobUrl) => {
        if (!cancelled) setSrc(blobUrl);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [url]);

  if (!src) return null;
  return (
    <div style={{ padding: "4px 8px 0" }}>
      <img
        src={src}
        alt={alt}
        loading="lazy"
        style={{
          display: "block",
          width: "100%",
          height: 72,
          objectFit: "cover",
          borderRadius: 4,
          background: "var(--color-surface)",
        }}
      />
    </div>
  );
}

export function EntityFlowNode({ data, selected }: NodeProps<EntityFlowNodeType>) {
  const {
    entity,
    onRenameEntity,
    onRemoveEntity,
    onRenameTableRow,
    onRemoveTableRow,
  } = data;
  const c = KIND_PALETTE[entity.kind];
  const inlineEditable = !!entity.entityId;
  const tableEditable = !!entity.tableRef;
  // 編集中の対象（合成キー）とドラフト:
  //   "name" | `inline:<entityId>` | `cell:<columnKey>`
  const [edit, setEdit] = useState<{ key: string; draft: string } | null>(null);
  const { compositionHandlers, isImeKey } = useImeEnterGuard();

  useEffect(() => {
    if (!selected) setEdit(null);
  }, [selected]);

  const commitEdit = () => {
    const v = edit?.draft.trim();
    if (edit?.key === "name" && v && tableEditable) {
      onRenameTableRow?.(entity.tableRef!.blockId, entity.tableRef!.rowName, v);
    }
    setEdit(null);
  };

  const removeSelf = () => {
    if (tableEditable) onRemoveTableRow?.(entity.tableRef!.blockId, entity.tableRef!.rowName);
  };

  // グラフ側の編集は表経由のみ。本文 span 由来の Entity は、右パネルで
  // 表に移してから編集する（ノートに単語が散らばるのを防ぐ）。
  const canRenameSelf = tableEditable && !!onRenameTableRow;
  const canRemoveSelf = tableEditable && !!onRemoveTableRow;

  const MediaIcon = entity.mediaType ? (MEDIA_ICONS[entity.mediaType] ?? FileText) : null;
  const editingName = edit?.key === "name";

  const editField = (
    value: string,
    onChange: (v: string) => void,
    onCommit: () => void,
    onCancel: () => void,
  ) => (
    <input
      className="nodrag"
      value={value}
      autoFocus
      onFocus={(e) => e.target.select()}
      onChange={(e) => onChange(e.target.value)}
      {...compositionHandlers}
      onKeyDown={(e) => {
        if (e.key === "Enter" && !isImeKey(e)) onCommit();
        else if (e.key === "Escape") {
          e.stopPropagation();
          onCancel();
        }
      }}
      onBlur={onCancel}
      style={attrInputStyle}
    />
  );

  return (
    <div
      style={{
        minWidth: 140,
        maxWidth: 220,
        borderRadius: 8,
        background: "var(--color-card)",
        border: `1.5px solid ${c.main}`,
        // 選択は枠を太くせずリングで示す。太さを変えるとノードの実寸が変わり、
        // React Flow が測り直してレイアウトが動く
        boxShadow: selected ? selectionRing(c.main) : "var(--shadow-1)",
        overflow: "hidden",
      }}
    >
      {/* ヘッダ（名前 + 選択時の操作） */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          padding: "5px 8px 5px 10px",
          background: c.bg,
          fontSize: 12,
          fontWeight: 700,
          color: c.text,
        }}
      >
        <span
          style={{
            width: 8,
            height: 8,
            borderRadius: entity.kind === "tool" ? 1 : "50%",
            transform: entity.kind === "tool" ? "rotate(45deg)" : undefined,
            background: c.main,
            flexShrink: 0,
          }}
        />
        {MediaIcon && <MediaIcon size={11} style={{ flexShrink: 0, color: c.main }} />}
        {editingName ? (
          editField(
            edit!.draft,
            (v) => setEdit((prev) => (prev ? { ...prev, draft: v } : prev)),
            commitEdit,
            () => setEdit(null),
          )
        ) : (
          <span
            title={entity.label}
            onDoubleClick={() => canRenameSelf && setEdit({ key: "name", draft: entity.label })}
            style={{
              flex: 1,
              minWidth: 0,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {entity.label}
          </span>
        )}
        {selected && !editingName && (canRenameSelf || canRemoveSelf) && (
          <span className="nodrag" style={{ display: "inline-flex", gap: 0, flexShrink: 0 }}>
            {canRenameSelf && (
              <button
                onClick={() => setEdit({ key: "name", draft: entity.label })}
                title={t("activityGraph.editChip")}
                style={{ ...miniBtnStyle, color: c.text }}
              >
                <Pencil size={11} />
              </button>
            )}
            {canRemoveSelf && (
              <button
                onClick={removeSelf}
                title={t("activityGraph.removeChip")}
                style={{ ...miniBtnStyle, color: "var(--color-destructive)" }}
              >
                <Trash2 size={11} />
              </button>
            )}
          </span>
        )}
      </div>

      {/* 画像 Entity はサムネイルを出す（動画・音声・PDF はヘッダのアイコンで示す） */}
      {entity.mediaUrl && entity.mediaType === "image" && (
        <EntityThumbnail url={entity.mediaUrl} alt={entity.label} />
      )}

      {/* 属性はテーブルパネル側で編集する。ここは「ある」ことだけ示す */}
      {entity.attrs.length > 0 && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 3,
            padding: "2px 10px 5px",
            fontSize: 10,
            color: "var(--color-text-tertiary)",
          }}
        >
          <SlidersHorizontal size={10} />
          {entity.attrs.length}
        </div>
      )}

      <Handle
        type="target"
        position={Position.Top}
        style={{ width: 8, height: 8, background: "var(--color-card)", border: `2px solid ${c.main}` }}
      />
      <Handle
        type="source"
        position={Position.Bottom}
        style={{ width: 10, height: 10, background: c.main, border: `2px solid ${c.main}` }}
      />
    </div>
  );
}
