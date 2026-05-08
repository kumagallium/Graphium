// メディア詳細モーダル
// 左: 画像拡大表示 / 右: 使用ノートのグラフ構造

import { useEffect, useRef, useCallback, useState } from "react";
import {
  ExternalLink,
  BookPlus,
  BookOpen,
  FlaskConical,
  RefreshCw,
  Share2,
  Loader2,
  AlertCircle,
} from "lucide-react";
import cytoscape from "cytoscape";
import { ensureCytoscapePlugins } from "../../lib/cytoscape-setup";
import { getActiveProvider } from "../../lib/storage/registry";
import { useT } from "../../i18n";
import type { MediaIndexEntry, MediaSharedRef } from "./media-index";
import { getFaviconUrl } from "./media-index";
import { isTauri } from "../../lib/platform";
import { loadAuthorIdentity } from "../identity";
import { getSharedRoot, getBlobRoot } from "../../lib/storage/shared";
import { shareMedia, shareReference } from "../sharing";

ensureCytoscapePlugins();

// ── グラフカラー（design.md 準拠） ──

const MEDIA_NODE_COLOR = "#c08b3e"; // ゴールド（メディア = 中心）
const MEDIA_BORDER = "#a6782f";
const NOTE_NODE_COLOR = "#5b8fb9"; // 落ち着いた青（ノート）
const NOTE_BORDER = "#4a7da6";
const EDGE_COLOR = "#b8d4bb";
const BG_COLOR = "#fafdf7";

// ── Cytoscape スタイル ──

const graphStyle: cytoscape.StylesheetStyle[] = [
  {
    selector: "node",
    style: {
      label: "data(label)",
      "text-wrap": "wrap",
      "text-max-width": "100px",
      "font-size": "10px",
      "font-family": "Atkinson Hyperlegible Next, BIZ UDPGothic, Inter, system-ui, sans-serif",
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
    selector: "node.media-node",
    style: {
      shape: "diamond",
      "font-weight": "bold" as any,
      "font-size": "11px",
    },
  },
  {
    selector: "node.note-node",
    style: {
      // カーソル変更は mouseover イベントで制御
    },
  },
  {
    selector: "node.note-node.hover",
    style: {
      "border-width": 3,
      "overlay-opacity": 0.06,
      "overlay-color": "#000",
    },
  },
  {
    selector: "edge",
    style: {
      width: 1.5,
      "line-color": EDGE_COLOR,
      "target-arrow-color": EDGE_COLOR,
      "target-arrow-shape": "triangle",
      "arrow-scale": 0.8,
      "curve-style": "unbundled-bezier" as any,
      "control-point-distances": 30,
      "control-point-weights": 0.5,
      opacity: 0.7,
    },
  },
];

// ── メディアプレビュー（タイプ別） ──

/** 動画・音声・PDF 用: Blob URL を非同期取得して再生するラッパー */
function BlobMediaPlayer({
  entry,
  tag,
}: {
  entry: MediaIndexEntry;
  tag: "video" | "audio" | "iframe";
}) {
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const [error, setError] = useState(false);
  const mediaRef = useRef<HTMLVideoElement | HTMLAudioElement | null>(null);

  useEffect(() => {
    const fileId = getActiveProvider().extractFileId(entry.url);
    if (!fileId) { setError(true); return; }

    let cancelled = false;
    getActiveProvider().getMediaBlobUrl(fileId)
      .then((url) => { if (!cancelled) setBlobUrl(url); })
      .catch(() => { if (!cancelled) setError(true); });

    return () => { cancelled = true; };
  }, [entry.url]);

  // Blob URL が設定されたら load() を呼んで再生可能にする
  useEffect(() => {
    if (blobUrl && mediaRef.current) {
      mediaRef.current.load();
    }
  }, [blobUrl]);

  if (error) {
    return (
      <div className="flex items-center justify-center text-muted-foreground text-sm">
        再生できませんでした
      </div>
    );
  }

  if (!blobUrl) {
    return (
      <div className="flex items-center justify-center text-muted-foreground text-sm">
        読み込み中...
      </div>
    );
  }

  if (tag === "video") {
    return (
      <video
        ref={mediaRef as React.RefObject<HTMLVideoElement>}
        src={blobUrl}
        controls
        preload="auto"
        className="max-w-full max-h-full rounded"
      />
    );
  }
  if (tag === "audio") {
    return (
      <div className="flex flex-col items-center justify-center gap-4 w-full">
        <audio
          ref={mediaRef as React.RefObject<HTMLAudioElement>}
          src={blobUrl}
          controls
          preload="auto"
          className="w-full max-w-sm"
        />
      </div>
    );
  }
  // PDF
  return <iframe src={blobUrl} title={entry.name} className="w-full h-full rounded border-0" />;
}

function ResolvedImage({ entry }: { entry: MediaIndexEntry }) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    const provider = getActiveProvider();
    const fileId = provider.extractFileId(entry.url);
    if (!fileId) { setSrc(entry.url); return; }
    provider.getMediaBlobUrl(fileId).then(setSrc).catch(() => {});
  }, [entry.url]);
  if (!src) return <div className="flex items-center justify-center text-muted-foreground">読み込み中...</div>;
  return <img src={src} alt={entry.name} className="max-w-full max-h-full object-contain rounded" />;
}

function UrlPreview({ entry }: { entry: MediaIndexEntry }) {
  const t = useT();
  const domain = entry.urlMeta?.domain ?? "";
  return (
    <div className="flex flex-col items-center justify-center gap-4 max-w-sm text-center px-6">
      {entry.urlMeta?.ogImage ? (
        <img src={entry.urlMeta.ogImage} alt="" className="max-w-full max-h-48 rounded object-cover" />
      ) : (
        <img
          src={getFaviconUrl(domain, 128)}
          alt=""
          className="w-16 h-16 rounded"
          onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
        />
      )}
      <div className="space-y-1">
        <p className="text-sm font-medium text-foreground">{entry.name}</p>
        <p className="text-[10px] text-muted-foreground">{domain}</p>
        {entry.urlMeta?.description && (
          <p className="text-xs text-muted-foreground mt-2">{entry.urlMeta.description}</p>
        )}
      </div>
      <a
        href={entry.url}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center gap-1.5 px-4 py-2 text-xs rounded bg-primary text-primary-foreground hover:opacity-90 transition-opacity"
      >
        <ExternalLink size={12} />
        {t("asset.urlOpen")}
      </a>
    </div>
  );
}

export function MediaPreview({ entry }: { entry: MediaIndexEntry }) {
  switch (entry.type) {
    case "image":
      return <ResolvedImage entry={entry} />;
    case "video":
      return <BlobMediaPlayer entry={entry} tag="video" />;
    case "audio":
      return <BlobMediaPlayer entry={entry} tag="audio" />;
    case "pdf":
      return <BlobMediaPlayer entry={entry} tag="iframe" />;
    case "url":
      return <UrlPreview entry={entry} />;
    default:
      return (
        <div className="flex items-center justify-center">
          <span className="text-6xl">📎</span>
        </div>
      );
  }
}

// ── グラフ構築 ──

function buildMediaGraph(entry: MediaIndexEntry): cytoscape.ElementDefinition[] {
  const elements: cytoscape.ElementDefinition[] = [];

  // 中心ノード: メディア
  const mediaLabel = entry.name.length > 20
    ? entry.name.slice(0, 18) + "…"
    : entry.name;
  elements.push({
    data: {
      id: `media-${entry.fileId}`,
      label: mediaLabel,
      color: MEDIA_NODE_COLOR,
      borderColor: MEDIA_BORDER,
      size: 44,
    },
    classes: "media-node",
  });

  // 使用ノート（重複除去）
  const seenNotes = new Set<string>();
  for (const usage of entry.usedIn) {
    if (seenNotes.has(usage.noteId)) continue;
    seenNotes.add(usage.noteId);

    const noteLabel = usage.noteTitle.length > 18
      ? usage.noteTitle.slice(0, 16) + "…"
      : usage.noteTitle;
    elements.push({
      data: {
        id: usage.noteId,
        label: noteLabel,
        color: NOTE_NODE_COLOR,
        borderColor: NOTE_BORDER,
        size: 32,
        fullTitle: usage.noteTitle,
      },
      classes: "note-node",
    });

    elements.push({
      data: {
        id: `edge-${entry.fileId}-${usage.noteId}`,
        source: `media-${entry.fileId}`,
        target: usage.noteId,
      },
    });
  }

  return elements;
}

// ── モーダルコンポーネント ──

export type MediaDetailModalProps = {
  entry: MediaIndexEntry;
  onClose: () => void;
  onNavigateNote: (noteId: string) => void;
  onRename?: (entry: MediaIndexEntry, newName: string) => Promise<void>;
  onIngest?: (entry: MediaIndexEntry) => void;
  /** URL から PROV ラベル付きノートを生成する（URL エントリー限定） */
  onCreateProvNote?: (entry: MediaIndexEntry) => void;
  /** この URL/PDF を派生元として参照する wiki ノート ID。あれば「In Knowledge」表示に切り替わる */
  knowledgeWikiNoteId?: string;
  /**
   * team-shared storage への共有が成功したときに呼ばれる（Phase 2b-media）。
   * 親側で media index を更新（sharedRef を埋め込む）して再描画する想定。
   */
  onSharedRefUpdated?: (entry: MediaIndexEntry, sharedRef: MediaSharedRef) => Promise<void> | void;
};

export function MediaDetailModal({
  entry,
  onClose,
  onNavigateNote,
  onRename,
  onIngest,
  onCreateProvNote,
  knowledgeWikiNoteId,
  onSharedRefUpdated,
}: MediaDetailModalProps) {
  const t = useT();
  const graphContainerRef = useRef<HTMLDivElement>(null);
  const cyRef = useRef<cytoscape.Core | null>(null);
  const [editing, setEditing] = useState(false);
  const [editName, setEditName] = useState(entry.name);
  const [renaming, setRenaming] = useState(false);

  // ── team-shared storage 共有（Phase 2b-media、Tauri 専用） ──
  const [shareDialogOpen, setShareDialogOpen] = useState(false);
  const [shareTitle, setShareTitle] = useState(entry.name);
  const [shareDescription, setShareDescription] = useState("");
  const [shareBusy, setShareBusy] = useState(false);
  const [shareError, setShareError] = useState<string | null>(null);
  const [sharedRefState, setSharedRefState] = useState(entry.sharedRef);
  useEffect(() => {
    setSharedRefState(entry.sharedRef);
  }, [entry.sharedRef]);
  const isShared = !!sharedRefState;

  // 共有可能かどうか
  // - URL ブックマーク: shared root + identity だけで OK（reference type、blob 不要）
  // - それ以外: shared root + blob root + identity（data-manifest type、blob 必要）
  const sharedRoot = getSharedRoot();
  const blobRoot = getBlobRoot();
  const sharedAuthor = loadAuthorIdentity();
  const isUrlEntry = entry.type === "url";
  const shareDisabledReason: string | undefined = !isTauri()
    ? t("share.disabled.desktopOnly")
    : !sharedRoot
      ? t("share.disabled.noRoot")
      : !sharedAuthor
        ? t("share.disabled.noIdentity")
        : !isUrlEntry && !blobRoot
          ? t("share.media.disabled.noBlobRoot")
          : undefined;

  const openShareDialog = useCallback(() => {
    setShareTitle(entry.name);
    setShareDescription("");
    setShareError(null);
    setShareDialogOpen(true);
  }, [entry.name]);

  const handleShare = useCallback(async () => {
    if (!sharedRoot || !sharedAuthor) return;
    if (!isUrlEntry && !blobRoot) return;
    setShareBusy(true);
    setShareError(null);
    try {
      // 既存の sharedRef を保持したまま entry に反映
      const entryWithRef: MediaIndexEntry = sharedRefState
        ? { ...entry, sharedRef: sharedRefState }
        : entry;
      // URL ブックマークは reference として、それ以外は data-manifest として共有
      const result = isUrlEntry
        ? await shareReference(entryWithRef, {
            sharedRoot,
            author: sharedAuthor,
            title: shareTitle,
            description: shareDescription,
          })
        : await shareMedia(entryWithRef, {
            sharedRoot,
            blobRoot: blobRoot!,
            author: sharedAuthor,
            title: shareTitle,
            description: shareDescription,
          });
      if (!result.ok) {
        setShareError(result.error);
        return;
      }
      setSharedRefState(result.sharedRef);
      if (onSharedRefUpdated) {
        await onSharedRefUpdated(entryWithRef, result.sharedRef);
      }
      setShareDialogOpen(false);
    } finally {
      setShareBusy(false);
    }
  }, [sharedRoot, blobRoot, sharedAuthor, isUrlEntry, entry, sharedRefState, shareTitle, shareDescription, onSharedRefUpdated]);

  // entry prop が更新されたら editName も同期
  useEffect(() => {
    if (!editing) setEditName(entry.name);
  }, [entry.name, editing]);

  const handleRename = useCallback(async () => {
    const trimmed = editName.trim();
    if (!trimmed || trimmed === entry.name || !onRename) {
      setEditing(false);
      setEditName(entry.name);
      return;
    }
    setRenaming(true);
    try {
      await onRename(entry, trimmed);
      setEditing(false);
    } catch {
      setEditName(entry.name);
      setEditing(false);
    } finally {
      setRenaming(false);
    }
  }, [editName, entry, onRename]);

  const handleNavigate = useCallback(
    (noteId: string) => {
      onClose();
      onNavigateNote(noteId);
    },
    [onClose, onNavigateNote],
  );

  // グラフ描画
  useEffect(() => {
    if (!graphContainerRef.current || entry.usedIn.length === 0) return;

    const elements = buildMediaGraph(entry);

    if (cyRef.current) {
      cyRef.current.destroy();
    }

    const cy = cytoscape({
      container: graphContainerRef.current,
      elements,
      style: graphStyle,
      layout: { name: "preset" },
      userZoomingEnabled: true,
      userPanningEnabled: true,
      boxSelectionEnabled: false,
      wheelSensitivity: 0.3,
      minZoom: 0.3,
      maxZoom: 3,
    });

    // fcose レイアウト
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
      gravityRange: 3.0,
      nodeSeparation: 60,
      padding: 30,
    } as any);
    layout.on("layoutstop", () => {
      cy.fit(undefined, 20);
    });
    layout.run();

    // ノードホバー
    cy.on("mouseover", "node.note-node", (evt) => {
      evt.target.addClass("hover");
      graphContainerRef.current!.style.cursor = "pointer";
    });
    cy.on("mouseout", "node.note-node", () => {
      cy.nodes().removeClass("hover");
      graphContainerRef.current!.style.cursor = "default";
    });

    // ノートノードクリックで遷移
    cy.on("tap", "node.note-node", (evt) => {
      handleNavigate(evt.target.id());
    });

    cyRef.current = cy;

    return () => {
      cy.destroy();
      cyRef.current = null;
    };
  }, [entry, handleNavigate]);

  // ESC でモーダルを閉じる
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  const hasUsages = entry.usedIn.length > 0;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="relative bg-background border border-border rounded-lg shadow-2xl w-[90vw] max-w-5xl h-[75vh] flex flex-col overflow-hidden">
        {/* ヘッダー */}
        <div className="flex items-center gap-3 px-5 py-3 border-b border-border">
          <div className="flex items-center gap-3 min-w-0 flex-1">
            {editing ? (
              <input
                type="text"
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                onBlur={handleRename}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleRename();
                  if (e.key === "Escape") { setEditing(false); setEditName(entry.name); }
                }}
                disabled={renaming}
                autoFocus
                className="text-sm font-semibold text-foreground bg-transparent border-b-2 border-primary outline-none min-w-[200px]"
              />
            ) : (
              <h2
                className="text-sm font-semibold text-foreground truncate cursor-pointer hover:text-primary transition-colors"
                title={t("asset.clickToRename")}
                onClick={() => { if (onRename) setEditing(true); }}
              >
                {entry.name}
              </h2>
            )}
            <span className="text-[10px] text-muted-foreground shrink-0">
              {entry.type === "url" ? entry.urlMeta?.domain ?? "" : entry.mimeType}
            </span>
            {hasUsages && (
              <span className="text-[10px] text-muted-foreground shrink-0">
                {t("asset.usedInCount", { count: String(new Set(entry.usedIn.map(u => u.noteId)).size) })}
              </span>
            )}
            {isShared && (
              <span
                className="text-[10px] px-1.5 py-0.5 rounded-md bg-primary/10 text-primary shrink-0 inline-flex items-center gap-1"
                title={t("share.badgeTooltip")}
              >
                <Share2 size={10} />
                {t("share.badge")}
              </span>
            )}
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {onIngest && (entry.type === "url" || entry.type === "pdf") && (
              knowledgeWikiNoteId ? (
                <>
                  <button
                    onClick={() => handleNavigate(`wiki:${knowledgeWikiNoteId}`)}
                    className="text-xs px-2.5 py-1 rounded-md bg-primary/10 text-primary hover:bg-primary/20 transition-colors font-medium inline-flex items-center gap-1.5"
                    title={t("knowledge.openInKnowledge")}
                  >
                    <BookOpen size={14} />
                    {t("knowledge.inKnowledge")}
                  </button>
                  <button
                    onClick={() => onIngest(entry)}
                    className="text-muted-foreground hover:text-primary transition-colors p-1.5 rounded-md hover:bg-primary/10"
                    title={t("knowledge.regenerate")}
                    aria-label={t("knowledge.regenerate")}
                  >
                    <RefreshCw size={14} />
                  </button>
                </>
              ) : (
                <button
                  onClick={() => onIngest(entry)}
                  className="text-xs px-2.5 py-1 rounded-md bg-primary/10 text-primary hover:bg-primary/20 transition-colors font-medium inline-flex items-center gap-1.5"
                >
                  <BookPlus size={14} />
                  {t("knowledge.addToKnowledge")}
                </button>
              )
            )}
            {onCreateProvNote && (entry.type === "url" || entry.type === "pdf") && (
              <button
                onClick={() => onCreateProvNote(entry)}
                className="text-xs px-2.5 py-1 rounded-md bg-primary/10 text-primary hover:bg-primary/20 transition-colors font-medium inline-flex items-center gap-1.5"
              >
                <FlaskConical size={14} />
                Create PROV Note
              </button>
            )}
            {/* Share to team — URL ブックマークも reference として共有可。disabled 理由は title に */}
            <button
              onClick={openShareDialog}
              disabled={!!shareDisabledReason}
              title={shareDisabledReason}
              className="text-xs px-2.5 py-1 rounded-md bg-primary/10 text-primary hover:bg-primary/20 transition-colors font-medium inline-flex items-center gap-1.5 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <Share2 size={14} />
              {isShared ? t("share.reshareToTeam") : t("share.shareToTeam")}
            </button>
            <button
              onClick={onClose}
              className="text-muted-foreground hover:text-foreground transition-colors text-lg leading-none px-1 ml-1"
              aria-label={t("common.close")}
            >
              ✕
            </button>
          </div>
        </div>

        {/* コンテンツ: 左 画像 / 右 グラフ */}
        <div className="flex-1 flex overflow-hidden">
          {/* 左: メディアプレビュー */}
          <div className={`flex items-center justify-center p-6 bg-muted/30 ${hasUsages ? "w-1/2 border-r border-border" : "w-full"}`}>
            <MediaPreview entry={entry} />
          </div>

          {/* 右: 使用ノートグラフ */}
          {hasUsages && (
            <div className="w-1/2 flex flex-col">
              {/* 凡例 */}
              <div className="px-4 py-2 border-b border-border flex items-center gap-3 text-[10px] text-muted-foreground">
                <span className="flex items-center gap-1">
                  <span
                    className="inline-block w-2.5 h-2.5 rounded-sm"
                    style={{ backgroundColor: MEDIA_NODE_COLOR, transform: "rotate(45deg)" }}
                  />
                  {t("asset.legendMedia")}
                </span>
                <span className="flex items-center gap-1">
                  <span
                    className="inline-block w-2.5 h-2.5 rounded-full"
                    style={{ backgroundColor: NOTE_NODE_COLOR }}
                  />
                  {t("asset.legendNote")}
                </span>
                <span className="ml-auto text-[10px] text-muted-foreground/60">
                  {t("asset.clickToNavigate")}
                </span>
              </div>
              {/* グラフ */}
              <div
                ref={graphContainerRef}
                className="flex-1"
                style={{ background: BG_COLOR }}
              />
            </div>
          )}
        </div>

        {/* Share metadata ダイアログ（モーダル on モーダル） */}
        {shareDialogOpen && (
          <div
            className="absolute inset-0 z-10 flex items-center justify-center bg-black/40"
            onClick={(e) => {
              if (e.target === e.currentTarget && !shareBusy) setShareDialogOpen(false);
            }}
          >
            <div className="bg-background border border-border rounded-lg shadow-2xl w-[90%] max-w-md p-5 space-y-4">
              <div>
                <h3 className="text-sm font-semibold text-foreground mb-1">
                  {isShared ? t("share.media.dialog.titleReshare") : t("share.media.dialog.titleFirst")}
                </h3>
                <p className="text-xs text-muted-foreground">
                  {t("share.media.dialog.help")}
                </p>
              </div>
              <div>
                <label className="text-[11px] text-muted-foreground block mb-1">
                  {t("share.media.dialog.titleLabel")}
                </label>
                <input
                  type="text"
                  value={shareTitle}
                  onChange={(e) => setShareTitle(e.target.value)}
                  disabled={shareBusy}
                  className="w-full px-3 py-2 text-sm rounded-md border border-border bg-background text-foreground focus:border-primary focus:outline-none"
                />
              </div>
              <div>
                <label className="text-[11px] text-muted-foreground block mb-1">
                  {t("share.media.dialog.descLabel")}
                </label>
                <textarea
                  value={shareDescription}
                  onChange={(e) => setShareDescription(e.target.value)}
                  disabled={shareBusy}
                  rows={3}
                  className="w-full px-3 py-2 text-sm rounded-md border border-border bg-background text-foreground focus:border-primary focus:outline-none resize-none"
                />
              </div>
              {shareError && (
                <p className="text-xs text-red-500 flex items-start gap-1">
                  <AlertCircle size={12} className="mt-0.5 shrink-0" />
                  <span className="break-all">{shareError}</span>
                </p>
              )}
              <div className="flex justify-end gap-2 pt-1">
                <button
                  onClick={() => setShareDialogOpen(false)}
                  disabled={shareBusy}
                  className="text-xs px-3 py-1.5 rounded-md text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
                >
                  {t("common.cancel")}
                </button>
                <button
                  onClick={handleShare}
                  disabled={shareBusy || !shareTitle.trim()}
                  className="text-xs px-3 py-1.5 rounded-md bg-primary text-primary-foreground hover:opacity-90 transition-opacity disabled:opacity-50 inline-flex items-center gap-1.5"
                >
                  {shareBusy ? (
                    <>
                      <Loader2 size={12} className="animate-spin" />
                      {t("share.sharing")}
                    </>
                  ) : isShared ? (
                    t("share.media.dialog.update")
                  ) : (
                    t("share.media.dialog.share")
                  )}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
