// 素材リスト行（material as note の Step 1 設計用）
// Note 行と視覚言語を揃えつつ、素材固有の列（type / usedIn / derived-from）を持つ <tr>
// 親テーブルから渡される列幅・ヘッダと合わせて使う。

import { Image as ImageIcon, Video, Volume2, FileText, Files, Paperclip, Link as LinkIcon, ExternalLink, GitBranch } from "lucide-react";
import type { MediaIndexEntry, MediaType } from "./media-index";
import { formatDateTime } from "../../lib/format-datetime";

const TYPE_LABEL: Record<MediaType, string> = {
  image: "Image",
  video: "Video",
  audio: "Audio",
  pdf: "PDF",
  url: "URL",
  document: "Document",
  other: "File",
};

const TYPE_HEX: Record<MediaType, string> = {
  image: "#5b8fb9",
  video: "#5b8fb9",
  audio: "#c08b3e",
  pdf: "#c26356",
  url: "#4B7A52",
  document: "#6f5b8b",
  other: "#7a7a7a",
};

function TypeIcon({ type, size = 14 }: { type: MediaType; size?: number }) {
  switch (type) {
    case "image":
      return <ImageIcon size={size} />;
    case "video":
      return <Video size={size} />;
    case "audio":
      return <Volume2 size={size} />;
    case "pdf":
      return <FileText size={size} />;
    case "url":
      return <LinkIcon size={size} />;
    case "document":
      return <Files size={size} />;
    default:
      return <Paperclip size={size} />;
  }
}

// 素材タイプの badge（Note 行の label badge と同じ visual primitive）
function TypeBadge({ type }: { type: MediaType }) {
  const color = TYPE_HEX[type];
  return (
    <span
      className="inline-flex items-center gap-1 text-xs font-semibold rounded-full whitespace-nowrap"
      style={{
        padding: "0px 6px",
        backgroundColor: color + "18",
        color,
        border: `1px solid ${color}38`,
        lineHeight: 1.6,
      }}
    >
      <TypeIcon type={type} size={11} />
      {TYPE_LABEL[type]}
    </span>
  );
}

// サムネイル（compact 専用、Note 行と高さを揃える）
function ThumbCell({ entry }: { entry: MediaIndexEntry }) {
  if (entry.type === "image" && entry.thumbnailUrl) {
    return (
      <div className="w-10 h-10 rounded bg-muted overflow-hidden shrink-0">
        <img
          src={entry.thumbnailUrl}
          alt=""
          className="w-full h-full object-cover"
          onError={(e) => {
            (e.target as HTMLImageElement).style.display = "none";
          }}
        />
      </div>
    );
  }
  // 表示優先度: leadImage (Reader 抽出) → ogImage (publisher 提供) → fallback アイコン
  const hero = entry.type === "url" ? (entry.urlMeta?.leadImage || entry.urlMeta?.ogImage) : undefined;
  if (hero) {
    return (
      <div className="w-10 h-10 rounded bg-muted overflow-hidden shrink-0">
        <img
          src={hero}
          alt=""
          className="w-full h-full object-cover"
          referrerPolicy="no-referrer"
          onError={(e) => {
            (e.target as HTMLImageElement).style.display = "none";
          }}
        />
      </div>
    );
  }
  return (
    <div className="w-10 h-10 rounded bg-muted flex items-center justify-center shrink-0 text-muted-foreground">
      <TypeIcon type={entry.type} size={16} />
    </div>
  );
}

export type MaterialListItemProps = {
  entry: MediaIndexEntry;
  index: number;
  selected?: boolean;
  /** クリック時のコールバック（サイドピーク表示用） */
  onOpen?: (entry: MediaIndexEntry) => void;
  /** ダブルクリック or full open */
  onOpenFull?: (entry: MediaIndexEntry) => void;
  /** チェックボックストグル */
  onToggleSelect?: (entry: MediaIndexEntry) => void;
  /** 削除ボタン（hover ✕） */
  onDelete?: (entry: MediaIndexEntry) => void;
  /** チェックボックスを表示するか */
  showCheckbox?: boolean;
};

/**
 * 素材リスト行コンポーネント。<tr> を返す。
 * 親 <table> 側で column の幅・ヘッダを定義する。
 *
 * 列構成（NoteListView と高さ・hover・選択スタイルを揃える）:
 *  1. checkbox (w-[36px], optional)
 *  2. thumbnail (w-[56px])
 *  3. type badge (w-[80px])
 *  4. name (+ サブ行: domain or 派生元)
 *  5. usedIn count (w-[80px], 中央寄せ — Note 行の outgoing と同位置)
 *  6. derived-from indicator (w-[60px], 中央寄せ)
 *  7. uploaded date (w-[130px])
 *  8. delete (w-[40px], hover ✕, optional)
 */
export function MaterialListItem({
  entry,
  index,
  selected = false,
  onOpen,
  onOpenFull,
  onToggleSelect,
  onDelete,
  showCheckbox = true,
}: MaterialListItemProps) {
  const derivedCount = entry.derivedFromAssets?.length ?? 0;

  return (
    <tr
      key={entry.fileId}
      data-row-index={index}
      className={`border-b border-border/50 hover:bg-muted/50 transition-colors cursor-pointer group ${
        selected ? "bg-primary/5" : ""
      }`}
      onClick={() => onOpen?.(entry)}
      onDoubleClick={() => onOpenFull?.(entry)}
    >
      {showCheckbox && (
        <td
          className="py-2 px-2 cursor-pointer"
          onClick={(e) => {
            e.stopPropagation();
            onToggleSelect?.(entry);
          }}
        >
          <input
            type="checkbox"
            checked={selected}
            readOnly
            tabIndex={-1}
            className="w-3.5 h-3.5 rounded border-border accent-primary pointer-events-none"
          />
        </td>
      )}
      <td className="py-1 px-2">
        <ThumbCell entry={entry} />
      </td>
      <td className="py-2 px-2">
        <TypeBadge type={entry.type} />
      </td>
      <td className="py-2 px-3">
        <div className="flex items-center gap-1 min-w-0">
          <span className="text-foreground truncate" title={entry.name}>
            {entry.name}
          </span>
          {entry.type === "url" && entry.url && (
            <a
              href={entry.url}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => e.stopPropagation()}
              className="text-muted-foreground hover:text-primary transition-colors shrink-0"
              title="Open in new tab"
            >
              <ExternalLink size={12} />
            </a>
          )}
        </div>
        {entry.type === "url" && entry.urlMeta?.domain && (
          <p className="text-[10px] text-muted-foreground truncate mt-0.5">
            {entry.urlMeta.domain}
          </p>
        )}
      </td>
      <td className="py-2 px-2 text-center">
        {entry.usedIn.length > 0 ? (
          <span
            className={`inline-flex items-center justify-center text-xs px-1.5 py-0.5 rounded-full ${
              entry.usedIn.length >= 3
                ? "bg-info-bg text-info font-medium"
                : "text-muted-foreground"
            }`}
            title={`Used in ${entry.usedIn.length} notes`}
          >
            {entry.usedIn.length} &larr;
          </span>
        ) : (
          <span className="text-muted-foreground/30 text-xs">—</span>
        )}
      </td>
      <td className="py-2 px-2 text-center">
        {derivedCount > 0 ? (
          <span
            className="inline-flex items-center gap-0.5 text-xs text-muted-foreground"
            title={`Derived from ${derivedCount} asset(s)`}
          >
            <GitBranch size={11} />
            <span className="tabular-nums">{derivedCount}</span>
          </span>
        ) : (
          <span className="text-muted-foreground/30 text-xs">—</span>
        )}
      </td>
      <td className="py-2 pl-3 text-xs text-muted-foreground tabular-nums whitespace-nowrap">
        {formatDateTime(entry.uploadedAt)}
      </td>
      {onDelete && (
        <td className="py-2 px-2" onClick={(e) => e.stopPropagation()}>
          <button
            onClick={() => onDelete(entry)}
            className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive transition-all text-xs p-1"
            title="Delete"
          >
            ✕
          </button>
        </td>
      )}
    </tr>
  );
}

/**
 * MaterialListItem 用のテーブルヘッダ。
 * 親で <table><thead>{MaterialListHeader}</thead><tbody>...</tbody></table> 形式で使う。
 */
export function MaterialListHeader({
  showCheckbox = true,
  showDelete = true,
  allSelected = false,
  onToggleSelectAll,
  sortKey,
  sortAsc,
  onSort,
}: {
  showCheckbox?: boolean;
  showDelete?: boolean;
  allSelected?: boolean;
  onToggleSelectAll?: () => void;
  sortKey?: "name" | "type" | "usedIn" | "uploadedAt";
  sortAsc?: boolean;
  onSort?: (key: "name" | "type" | "usedIn" | "uploadedAt") => void;
}) {
  const sortMark = (key: "name" | "type" | "usedIn" | "uploadedAt") =>
    sortKey === key ? (sortAsc ? " ↑" : " ↓") : "";

  return (
    <thead>
      <tr className="text-left text-xs font-semibold bg-secondary text-secondary-foreground border-b border-border">
        {showCheckbox && (
          <th className="py-2 px-2 w-[36px]">
            <input
              type="checkbox"
              checked={allSelected}
              onChange={onToggleSelectAll}
              className="w-3.5 h-3.5 rounded border-border accent-primary cursor-pointer"
            />
          </th>
        )}
        <th className="py-2 px-2 w-[56px]" />
        <th
          className="py-2 px-2 w-[100px] cursor-pointer hover:text-foreground"
          onClick={() => onSort?.("type")}
        >
          Type{sortMark("type")}
        </th>
        <th
          className="py-2 px-3 cursor-pointer hover:text-foreground"
          onClick={() => onSort?.("name")}
        >
          Name{sortMark("name")}
        </th>
        <th
          className="py-2 px-2 w-[80px] text-center cursor-pointer hover:text-foreground"
          onClick={() => onSort?.("usedIn")}
          title="Number of notes using this asset"
        >
          Used in{sortMark("usedIn")}
        </th>
        <th className="py-2 px-2 w-[60px] text-center" title="Derived from N asset(s)">
          Derived
        </th>
        <th
          className="py-2 pl-3 w-[130px] cursor-pointer hover:text-foreground"
          onClick={() => onSort?.("uploadedAt")}
        >
          Date{sortMark("uploadedAt")}
        </th>
        {showDelete && <th className="py-2 px-2 w-[40px]" />}
      </tr>
    </thead>
  );
}
