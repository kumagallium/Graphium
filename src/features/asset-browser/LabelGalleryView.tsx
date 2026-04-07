// ラベル付きブロックのギャラリービュー
// 同じ内容（preview）を1行にグループ化し、クリックでネットワークモーダルを表示する

import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import cytoscape from "cytoscape";
import { ensureCytoscapePlugins } from "../../lib/cytoscape-setup";
import { useT, getDisplayLabelName } from "../../i18n";
import { Modal, ModalHeader, ModalBody } from "../../ui/modal";
import type { ProvNoteIndex } from "../navigation/index-file";

// fcose レイアウト登録（重複防止）
ensureCytoscapePlugins();

// ラベル色マッピング（NoteListView と同じ）
const LABEL_HEX: Record<string, string> = {
  "[手順]": "#5b8fb9",
  "[使用したもの]": "#4B7A52",
  "[結果]": "#c26356",
  "[属性]": "#c08b3e",
  "[条件]": "#c08b3e",
};

/** 日付を YYYY-MM-DD 形式でフォーマット */
function formatDate(isoDate: string): string {
  const d = new Date(isoDate);
  if (isNaN(d.getTime())) return "";
  return d.toLocaleDateString(undefined, { year: "numeric", month: "2-digit", day: "2-digit" });
}

type LabelEntry = {
  noteId: string;
  noteTitle: string;
  blockId: string;
  label: string;
  preview: string;
  modifiedAt: string;
};

/** 同じ preview でグループ化された行 */
type GroupedRow = {
  preview: string;
  entries: LabelEntry[];
  latestModifiedAt: string;
};

type SortKey = "noteCount" | "modifiedAt" | "preview";

export type LabelGalleryViewProps = {
  noteIndex: ProvNoteIndex | null;
  label: string;
  onBack: () => void;
  onNavigateNote: (noteId: string) => void;
};

// ── ネットワークモーダル ──

const GRAPH_BG = "#fafdf7";
const CENTER_COLOR = "#4B7A52";
const NOTE_COLOR = "#5b8fb9";
const EDGE_COLOR = "#b8d4bb";

const networkStyle: cytoscape.StylesheetStyle[] = [
  {
    selector: "node",
    style: {
      label: "data(label)",
      "text-wrap": "wrap",
      "text-max-width": "120px",
      "font-size": "11px",
      "font-family": "Inter, system-ui, sans-serif",
      "text-valign": "bottom",
      "text-margin-y": 6,
      "background-color": "data(color)",
      width: "data(size)",
      height: "data(size)",
      "border-width": 2,
      "border-color": "data(borderColor)",
      color: "#6b7f6e",
      "transition-property": "background-color, border-color, opacity, width, height" as any,
      "transition-duration": 200,
    },
  },
  {
    selector: "node.hover",
    style: {
      "border-width": 3,
      "overlay-opacity": 0.06,
      "overlay-color": "#000",
    },
  },
  {
    selector: "node.faded",
    style: { opacity: 0.15 },
  },
  {
    selector: "edge",
    style: {
      width: 1.5,
      "line-color": EDGE_COLOR,
      "curve-style": "unbundled-bezier" as any,
      "control-point-distances": 30,
      "control-point-weights": 0.5,
      opacity: 1,
      "transition-property": "opacity, width, line-color" as any,
      "transition-duration": 200,
    },
  },
  {
    selector: "edge.hover-connected",
    style: {
      width: 2.5,
      "line-color": CENTER_COLOR,
      "z-index": 10,
    },
  },
  {
    selector: "edge.faded",
    style: { opacity: 0.08 },
  },
];

function LabelNetworkModal({
  open,
  onClose,
  group,
  labelColor,
  onNavigateNote,
}: {
  open: boolean;
  onClose: () => void;
  group: GroupedRow | null;
  labelColor: string;
  onNavigateNote: (noteId: string) => void;
}) {
  const t = useT();
  const containerRef = useRef<HTMLDivElement>(null);
  const cyRef = useRef<cytoscape.Core | null>(null);

  const handleNavigate = useCallback(
    (noteId: string) => {
      onClose();
      onNavigateNote(noteId);
    },
    [onClose, onNavigateNote],
  );

  useEffect(() => {
    if (!open || !group || !containerRef.current) return;

    // 少し待ってから cytoscape を初期化（モーダルの表示完了を待つ）
    const timer = setTimeout(() => {
      if (!containerRef.current) return;

      const centerId = "__label-center__";
      const elements: cytoscape.ElementDefinition[] = [];

      // 中央ノード（ラベル値）
      elements.push({
        data: {
          id: centerId,
          label: group.preview || t("common.empty"),
          color: labelColor,
          borderColor: labelColor,
          size: 44,
          isCenter: true,
        },
      });

      // ノートノード（重複 noteId を除外）
      const seen = new Set<string>();
      for (const entry of group.entries) {
        if (seen.has(entry.noteId)) continue;
        seen.add(entry.noteId);
        elements.push({
          data: {
            id: entry.noteId,
            label: entry.noteTitle,
            color: NOTE_COLOR,
            borderColor: "#4a7da6",
            size: 30,
            isCenter: false,
          },
        });
        elements.push({
          data: {
            id: `${centerId}->${entry.noteId}`,
            source: centerId,
            target: entry.noteId,
          },
        });
      }

      if (cyRef.current) cyRef.current.destroy();

      const cy = cytoscape({
        container: containerRef.current,
        elements,
        style: networkStyle,
        layout: { name: "preset" },
        userZoomingEnabled: true,
        userPanningEnabled: true,
        boxSelectionEnabled: false,
        wheelSensitivity: 0.3,
        minZoom: 0.3,
        maxZoom: 3,
      });

      const layout = cy.layout({
        name: "fcose",
        animate: true,
        animationDuration: 600,
        animationEasing: "ease-out-cubic" as any,
        quality: "default",
        randomize: true,
        nodeRepulsion: 5000,
        idealEdgeLength: 100,
        edgeElasticity: 0.45,
        gravity: 0.3,
        nodeSeparation: 60,
        padding: 30,
      } as any);
      layout.on("layoutstop", () => cy.fit(undefined, 20));
      layout.run();

      // ホバーエフェクト
      cy.on("mouseover", "node", (evt) => {
        const node = evt.target;
        const neighborhood = node.neighborhood();
        cy.elements().addClass("faded");
        node.removeClass("faded").addClass("hover");
        neighborhood.removeClass("faded");
        neighborhood.edges().addClass("hover-connected");
        if (!node.data("isCenter")) {
          containerRef.current!.style.cursor = "pointer";
        }
      });

      cy.on("mouseout", "node", () => {
        cy.elements().removeClass("faded hover hover-connected");
        containerRef.current!.style.cursor = "default";
      });

      // ノートノードクリックでナビゲーション
      cy.on("tap", "node", (evt) => {
        if (!evt.target.data("isCenter")) {
          handleNavigate(evt.target.id());
        }
      });

      cyRef.current = cy;
    }, 50);

    return () => {
      clearTimeout(timer);
      if (cyRef.current) {
        cyRef.current.destroy();
        cyRef.current = null;
      }
    };
  }, [open, group, labelColor, handleNavigate, t]);

  if (!group) return null;

  const title = t("label.networkTitle", { name: group.preview || t("common.empty") });

  return (
    <Modal open={open} onClose={onClose}>
      <div className="w-[600px]">
        <ModalHeader onClose={onClose}>{title}</ModalHeader>
        <ModalBody className="p-0">
          {/* 凡例 */}
          <div className="px-4 py-2 border-b border-border flex items-center gap-4 text-[10px] text-muted-foreground">
            <span className="flex items-center gap-1">
              <span
                className="inline-block w-2.5 h-2.5 rounded-full"
                style={{ backgroundColor: labelColor }}
              />
              {t("label.legendLabel")}
            </span>
            <span className="flex items-center gap-1">
              <span
                className="inline-block w-2.5 h-2.5 rounded-full"
                style={{ backgroundColor: NOTE_COLOR }}
              />
              {t("label.legendNote")}
            </span>
            <span className="ml-auto">{t("asset.clickToNavigate")}</span>
          </div>
          {/* グラフ */}
          <div
            ref={containerRef}
            className="w-full"
            style={{ height: 360, background: GRAPH_BG }}
          />
        </ModalBody>
      </div>
    </Modal>
  );
}

// ── メインコンポーネント ──

export function LabelGalleryView({
  noteIndex,
  label,
  onBack,
  onNavigateNote,
}: LabelGalleryViewProps) {
  const t = useT();
  const [searchQuery, setSearchQuery] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("noteCount");
  const [sortAsc, setSortAsc] = useState(false);
  const [selectedGroup, setSelectedGroup] = useState<GroupedRow | null>(null);

  // ラベルに一致するブロックを全ノートから収集
  const entries = useMemo(() => {
    if (!noteIndex) return [];
    const result: LabelEntry[] = [];
    for (const note of noteIndex.notes) {
      for (const l of note.labels) {
        if (l.label === label) {
          result.push({
            noteId: note.noteId,
            noteTitle: note.title,
            blockId: l.blockId,
            label: l.label,
            preview: l.preview,
            modifiedAt: note.modifiedAt,
          });
        }
      }
    }
    return result;
  }, [noteIndex, label]);

  // preview でグループ化
  const grouped = useMemo(() => {
    const map = new Map<string, LabelEntry[]>();
    for (const entry of entries) {
      const key = entry.preview;
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(entry);
    }
    const rows: GroupedRow[] = [];
    for (const [preview, items] of map) {
      const latest = items.reduce((a, b) =>
        new Date(a.modifiedAt).getTime() >= new Date(b.modifiedAt).getTime() ? a : b
      );
      rows.push({ preview, entries: items, latestModifiedAt: latest.modifiedAt });
    }
    return rows;
  }, [entries]);

  // フィルタ + ソート
  const filtered = useMemo(() => {
    let result = grouped;
    if (searchQuery.trim()) {
      const q = searchQuery.trim().toLowerCase();
      result = result.filter(
        (g) =>
          g.preview.toLowerCase().includes(q) ||
          g.entries.some((e) => e.noteTitle.toLowerCase().includes(q))
      );
    }
    return [...result].sort((a, b) => {
      let cmp = 0;
      if (sortKey === "noteCount") {
        const aCount = new Set(a.entries.map((e) => e.noteId)).size;
        const bCount = new Set(b.entries.map((e) => e.noteId)).size;
        cmp = aCount - bCount;
      } else if (sortKey === "modifiedAt") {
        cmp = new Date(a.latestModifiedAt).getTime() - new Date(b.latestModifiedAt).getTime();
      } else {
        cmp = a.preview.localeCompare(b.preview);
      }
      return sortAsc ? cmp : -cmp;
    });
  }, [grouped, searchQuery, sortKey, sortAsc]);

  const handleSort = (key: SortKey) => {
    setSortKey((prev) => {
      if (prev === key) {
        setSortAsc((a) => !a);
        return key;
      }
      // noteCount・modifiedAt は降順デフォルト、preview は昇順デフォルト
      setSortAsc(key === "preview");
      return key;
    });
  };

  const displayName = getDisplayLabelName(label);
  const color = LABEL_HEX[label] ?? "#8fa394";

  // ユニークなノート数（グループ化後の合計）
  const uniqueNoteIds = useMemo(() => {
    const ids = new Set<string>();
    for (const g of filtered) {
      for (const e of g.entries) ids.add(e.noteId);
    }
    return ids.size;
  }, [filtered]);

  return (
    <div className="flex-1 flex flex-col overflow-hidden bg-background">
      {/* ヘッダー */}
      <div className="flex items-center gap-3 px-6 py-4 border-b border-border">
        <button
          onClick={onBack}
          className="text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          {t("common.back")}
        </button>
        <span
          className="inline-block text-sm font-semibold rounded-full px-2.5 py-0.5"
          style={{
            backgroundColor: color + "18",
            color,
            border: `1px solid ${color}38`,
          }}
        >
          {displayName}
        </span>
        <span className="text-xs text-muted-foreground">
          {t("asset.count", { count: String(filtered.length) })}
        </span>
      </div>

      {/* 検索 + ソート */}
      <div className="px-6 py-2 border-b border-border flex items-center gap-3">
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder={t("label.search")}
          className="w-full max-w-xs text-xs px-3 py-1.5 rounded border border-border bg-background text-foreground placeholder:text-muted-foreground outline-none focus:border-primary transition-colors"
        />
        <div className="flex items-center gap-1 ml-auto">
          <button
            onClick={() => handleSort("noteCount")}
            className={`text-[11px] px-2 py-1 rounded transition-colors ${
              sortKey === "noteCount"
                ? "bg-primary/10 text-primary font-semibold"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {t("label.noteCount")}{sortKey === "noteCount" && (sortAsc ? " ↑" : " ↓")}
          </button>
          <button
            onClick={() => handleSort("modifiedAt")}
            className={`text-[11px] px-2 py-1 rounded transition-colors ${
              sortKey === "modifiedAt"
                ? "bg-primary/10 text-primary font-semibold"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {t("asset.sortDate")}{sortKey === "modifiedAt" && (sortAsc ? " ↑" : " ↓")}
          </button>
          <button
            onClick={() => handleSort("preview")}
            className={`text-[11px] px-2 py-1 rounded transition-colors ${
              sortKey === "preview"
                ? "bg-primary/10 text-primary font-semibold"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {t("label.previewColumn")}{sortKey === "preview" && (sortAsc ? " ↑" : " ↓")}
          </button>
        </div>
      </div>

      {/* リスト */}
      <div className="flex-1 overflow-auto px-6">
        {!noteIndex ? (
          <div className="flex items-center justify-center py-16">
            <p className="text-sm text-muted-foreground">{t("common.loading")}</p>
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex items-center justify-center py-16">
            <p className="text-sm text-muted-foreground">{t("label.noBlocks")}</p>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs font-semibold bg-secondary text-secondary-foreground border-b border-border">
                <th className="py-2 px-3">{t("label.previewColumn")}</th>
                <th className="py-2 px-3 w-[80px] text-center">{t("label.noteCount")}</th>
                <th className="py-2 pl-3 w-[80px]">{t("nav.modifiedDate")}</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((group) => {
                // 同一 noteId を重複カウントしない
                const uniqueNotes = new Set(group.entries.map((e) => e.noteId)).size;
                return (
                  <tr
                    key={group.preview}
                    className="border-b border-border/50 hover:bg-muted/50 transition-colors cursor-pointer"
                    onClick={() => setSelectedGroup(group)}
                  >
                    <td className="py-2 px-3">
                      <span className="text-foreground font-medium">
                        {group.preview || t("common.empty")}
                      </span>
                    </td>
                    <td className="py-2 px-3 text-xs text-muted-foreground text-center">
                      {t("label.noteCountValue", { count: String(uniqueNotes) })}
                    </td>
                    <td className="py-2 pl-3 text-xs text-muted-foreground">
                      {formatDate(group.latestModifiedAt)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* ネットワークモーダル */}
      <LabelNetworkModal
        open={selectedGroup !== null}
        onClose={() => setSelectedGroup(null)}
        group={selectedGroup}
        labelColor={color}
        onNavigateNote={onNavigateNote}
      />
    </div>
  );
}
