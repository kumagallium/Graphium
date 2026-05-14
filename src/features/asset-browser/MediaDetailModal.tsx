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
  Images,
} from "lucide-react";
import cytoscape from "cytoscape";
import { ensureCytoscapePlugins } from "../../lib/cytoscape-setup";
import { getActiveProvider } from "../../lib/storage/registry";
import { useT } from "../../i18n";
import type { MediaIndex, MediaIndexEntry, MediaSharedRef } from "./media-index";
import { getFaviconUrl } from "./media-index";
import { isTauri } from "../../lib/platform";
import { loadAuthorIdentity } from "../identity";
import { getSharedRoot, getBlobRoot } from "../../lib/storage/shared";
import { shareMedia, shareReference } from "../sharing";
import type { WikiKind } from "../../lib/document-types";
import {
  knowledgeKindColor,
  knowledgeKindBorder,
  KNOWLEDGE_KIND_LEGEND_ORDER,
} from "../network-graph/knowledge-colors";
import { isThumbnailable, resolveMediaThumbUrl } from "./media-thumbnails";

ensureCytoscapePlugins();

// ── グラフカラー（design.md 準拠） ──

const MEDIA_CENTER_COLOR = "#c08b3e"; // ゴールド（中心メディア）
const MEDIA_CENTER_BORDER = "#a6782f";
const MEDIA_RELATED_COLOR = "#d6b27f"; // 淡いゴールド（関連メディア = 派生 / 派生元）
const MEDIA_RELATED_BORDER = "#a6782f";
const NOTE_NODE_COLOR = "#5b8fb9"; // 落ち着いた青（通常ノート）
const NOTE_BORDER = "#4a7da6";
const EDGE_COLOR = "#b8d4bb";
const EDGE_DERIVED_COLOR = "#c7b389"; // 派生エッジ（中心メディア ↔ 関連メディア）
const BG_COLOR = "#fafdf7";

// ── Cytoscape スタイル ──
// 形状はノードデータの `shape` を `node` セレクタ側で参照する。
// kind 別の塗り色はノードデータの `color` / `borderColor` で動的に渡す。

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
      shape: "data(shape)" as any,
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
    selector: "node.center-node",
    style: {
      "font-weight": "bold" as any,
      "font-size": "11px",
    },
  },
  {
    selector: "node.clickable.hover",
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
  {
    selector: "edge.derived",
    style: {
      "line-color": EDGE_DERIVED_COLOR,
      "target-arrow-color": EDGE_DERIVED_COLOR,
      "line-style": "dashed" as any,
    },
  },
  // 画像 / 動画アセット用: サムネイルを背景画像として表示する
  // background-fit: contain で全体を見せる（縦横比は維持、余白は塗り色で埋まる）。
  {
    selector: "node.thumb",
    style: {
      "background-image": "data(thumbUrl)" as any,
      "background-fit": "contain" as any,
      "background-opacity": 1 as any,
      "background-color": "#ffffff",
      "background-clip": "node" as any,
      shape: "round-rectangle",
      width: 44,
      height: 44,
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

/** ラベルを最大文字数で省略する */
function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max - 1) + "…" : s;
}

/**
 * メディアアイコンの形状を type 別に決める。
 *  - URL: rectangle（外部リソースを表す ext 風）
 *  - PDF: triangle（書類）
 *  - その他: diamond（メディア共通）
 */
function getMediaShape(type: MediaIndexEntry["type"]): string {
  if (type === "url") return "round-rectangle";
  if (type === "pdf") return "round-triangle";
  return "diamond";
}

export type KnowledgeKindLookup = (rawWikiId: string) => WikiKind | undefined;

function buildMediaGraph(
  entry: MediaIndexEntry,
  mediaIndex: MediaIndex | null,
  getKnowledgeKind: KnowledgeKindLookup | undefined,
  /** 関連アセットの fileId → 解決済み blob URL（プロバイダ依存の URL を Cytoscape で表示できる形式にしたもの） */
  assetThumbUrls: Map<string, string>,
): cytoscape.ElementDefinition[] {
  const elements: cytoscape.ElementDefinition[] = [];
  const centerId = `media-${entry.fileId}`;

  // ── 1. 中心ノード（このメディア） ──
  // 画像/動画はサムネイル背景で表示する。サムネイル URL は親の useEffect で解決済み。
  const centerThumb = isThumbnailable(entry) ? assetThumbUrls.get(entry.fileId) : undefined;
  const centerHasThumb = !!centerThumb;
  elements.push({
    data: {
      id: centerId,
      label: truncate(entry.name, 20),
      color: MEDIA_CENTER_COLOR,
      borderColor: MEDIA_CENTER_BORDER,
      shape: centerHasThumb ? "round-rectangle" : getMediaShape(entry.type),
      size: centerHasThumb ? 60 : 44,
      ...(centerHasThumb ? { thumbUrl: centerThumb } : {}),
    },
    classes: centerHasThumb ? "center-node thumb" : "center-node",
  });

  // ── 2. 関連アセット（派生元 + 派生先） ──
  // 派生元: 自分の derivedFromAssets が参照する fileId
  // 派生先: media index 内で derivedFromAssets に自分の fileId を含む entry
  const allMedia = mediaIndex?.media ?? [];
  const byFileId = new Map(allMedia.map((m) => [m.fileId, m]));
  const relatedAssetIds = new Set<string>();

  const parents: MediaIndexEntry[] = [];
  for (const parentId of entry.derivedFromAssets ?? []) {
    const parent = byFileId.get(parentId);
    if (parent && parent.fileId !== entry.fileId) {
      parents.push(parent);
      relatedAssetIds.add(parent.fileId);
    }
  }

  const children: MediaIndexEntry[] = [];
  for (const m of allMedia) {
    if (m.fileId === entry.fileId) continue;
    if (m.derivedFromAssets?.includes(entry.fileId)) {
      children.push(m);
      relatedAssetIds.add(m.fileId);
    }
  }

  for (const asset of [...parents, ...children]) {
    const assetNodeId = `media-${asset.fileId}`;
    // 画像 / 動画はサムネイル背景で描画する（resolveMediaThumbUrl で静止画 URL を生成）。
    // プロバイダ依存の URL は直接読めないので、必ず親側で解決済みの URL を経由する。
    const thumbUrl = isThumbnailable(asset) ? assetThumbUrls.get(asset.fileId) : undefined;
    const hasThumb = !!thumbUrl;
    elements.push({
      data: {
        id: assetNodeId,
        label: truncate(asset.name, 18),
        fullTitle: asset.name,
        color: MEDIA_RELATED_COLOR,
        borderColor: MEDIA_RELATED_BORDER,
        shape: hasThumb ? "round-rectangle" : getMediaShape(asset.type),
        size: hasThumb ? 44 : 30,
        ...(hasThumb ? { thumbUrl } : {}),
      },
      classes: hasThumb ? "clickable asset-node thumb" : "clickable asset-node",
    });
  }
  // edge: parent → 中心
  for (const parent of parents) {
    elements.push({
      data: {
        id: `edge-derived-${parent.fileId}-${entry.fileId}`,
        source: `media-${parent.fileId}`,
        target: centerId,
      },
      classes: "derived",
    });
  }
  // edge: 中心 → child
  for (const child of children) {
    elements.push({
      data: {
        id: `edge-derived-${entry.fileId}-${child.fileId}`,
        source: centerId,
        target: `media-${child.fileId}`,
      },
      classes: "derived",
    });
  }

  // ── 3. 使用ノート（重複除去） ──
  const seenNotes = new Set<string>();
  for (const usage of entry.usedIn) {
    if (seenNotes.has(usage.noteId)) continue;
    seenNotes.add(usage.noteId);

    const isKnowledge = usage.noteId.startsWith("wiki:");
    const rawId = isKnowledge ? usage.noteId.slice(5) : usage.noteId;
    const kind = isKnowledge ? getKnowledgeKind?.(rawId) : undefined;
    const color = isKnowledge ? knowledgeKindColor(kind) : NOTE_NODE_COLOR;
    const borderColor = isKnowledge ? knowledgeKindBorder(kind) : NOTE_BORDER;
    const shape = isKnowledge ? "diamond" : "ellipse";

    elements.push({
      data: {
        id: usage.noteId,
        label: truncate(usage.noteTitle, 18),
        fullTitle: usage.noteTitle,
        color,
        borderColor,
        shape,
        size: 32,
      },
      classes: "clickable note-node",
    });

    elements.push({
      data: {
        id: `edge-${entry.fileId}-${usage.noteId}`,
        source: centerId,
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
   * PDF アセットから各ページを画像として抽出して、画像アセットとして登録するアクション。
   * onProgress で進捗を受け取れる。完了時に「N 件登録」をユーザーに伝える側は呼び出し元が担う。
   */
  onExtractPdfPages?: (
    entry: MediaIndexEntry,
    onProgress: (done: number, total: number) => void,
  ) => Promise<{ extracted: number }>;
  /**
   * team-shared storage への共有が成功したときに呼ばれる（Phase 2b-media）。
   * 親側で media index を更新（sharedRef を埋め込む）して再描画する想定。
   */
  onSharedRefUpdated?: (entry: MediaIndexEntry, sharedRef: MediaSharedRef) => Promise<void> | void;
  /**
   * 関連アセット（このメディアの派生元 / 派生先）をグラフに表示するための index。
   * 渡されないと中心メディアと利用ノートだけのグラフになる。
   */
  mediaIndex?: MediaIndex | null;
  /**
   * Knowledge ノート ID（`wiki:` prefix を外した素の id）から WikiKind を引くルックアップ。
   * 渡されない場合はフォールバック色（紫）で描画する。
   */
  getKnowledgeKind?: KnowledgeKindLookup;
  /**
   * グラフ内の関連アセットノードをクリックしたときに呼ばれる。
   * 親側でモーダルの `entry` を新しいアセットに差し替える想定。
   */
  onSwitchAsset?: (entry: MediaIndexEntry) => void;
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
  onExtractPdfPages,
  mediaIndex,
  getKnowledgeKind,
  onSwitchAsset,
}: MediaDetailModalProps) {
  const t = useT();
  const graphContainerRef = useRef<HTMLDivElement>(null);
  const cyRef = useRef<cytoscape.Core | null>(null);
  const [editing, setEditing] = useState(false);
  const [editName, setEditName] = useState(entry.name);
  const [renaming, setRenaming] = useState(false);

  // ── PDF ページ画像抽出（PDF 専用） ──
  const [extracting, setExtracting] = useState(false);
  const [extractProgress, setExtractProgress] = useState<{ done: number; total: number } | null>(null);
  const [extractError, setExtractError] = useState<string | null>(null);
  const handleExtractPages = useCallback(async () => {
    if (!onExtractPdfPages || extracting) return;
    setExtracting(true);
    setExtractError(null);
    setExtractProgress({ done: 0, total: 0 });
    try {
      const result = await onExtractPdfPages(entry, (done, total) => {
        setExtractProgress({ done, total });
      });
      // 完了通知（最小実装：alert）。トーストは別タスクで検討。
      // 0 件のときは PDF 構造の制約を案内する文言に切り替える。
      if (result.extracted === 0) {
        alert(t("asset.pdfExtractImages.empty"));
      } else {
        alert(`${result.extracted} 件の画像を抽出しました。`);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setExtractError(message);
    } finally {
      setExtracting(false);
      setExtractProgress(null);
    }
  }, [entry, extracting, onExtractPdfPages]);

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
  // 関連アセット（PDF↔画像 等）か利用ノートがあれば描画する。
  // 中心メディアしかない場合（孤立アセット）は描画しない。
  const hasRelatedAssets =
    (entry.derivedFromAssets && entry.derivedFromAssets.length > 0) ||
    (mediaIndex?.media ?? []).some(
      (m) => m.fileId !== entry.fileId && m.derivedFromAssets?.includes(entry.fileId),
    );
  const hasUsages = entry.usedIn.length > 0;
  const showGraph = hasUsages || hasRelatedAssets;

  // サムネイル URL を解決（プロバイダ経由で blob URL を取得 / 動画はフレームを抜き出して
  // data URL 化）。解決結果が空でもグラフは描画する（アイコン形状で表示）。
  // 対象は中心メディア自身と、関連アセット（派生元 / 派生先）のうち image/video。
  const [assetThumbUrls, setAssetThumbUrls] = useState<Map<string, string>>(new Map());
  useEffect(() => {
    const allMedia = mediaIndex?.media ?? [];
    const targets: MediaIndexEntry[] = [];
    if (isThumbnailable(entry)) targets.push(entry);
    for (const m of allMedia) {
      if (m.fileId === entry.fileId) continue;
      if (!isThumbnailable(m)) continue;
      if (
        entry.derivedFromAssets?.includes(m.fileId) ||
        m.derivedFromAssets?.includes(entry.fileId)
      ) {
        targets.push(m);
      }
    }
    if (targets.length === 0) {
      setAssetThumbUrls(new Map());
      return;
    }
    let cancelled = false;
    const next = new Map<string, string>();
    Promise.all(
      targets.map(async (a) => {
        const url = await resolveMediaThumbUrl(a);
        if (url) next.set(a.fileId, url);
      }),
    ).then(() => {
      if (!cancelled) setAssetThumbUrls(next);
    });
    return () => {
      cancelled = true;
    };
  }, [entry, mediaIndex]);

  useEffect(() => {
    if (!graphContainerRef.current || !showGraph) return;

    const elements = buildMediaGraph(entry, mediaIndex ?? null, getKnowledgeKind, assetThumbUrls);

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

    // ノードホバー（クリック可能ノードのみ）
    cy.on("mouseover", "node.clickable", (evt) => {
      evt.target.addClass("hover");
      graphContainerRef.current!.style.cursor = "pointer";
    });
    cy.on("mouseout", "node.clickable", () => {
      cy.nodes().removeClass("hover");
      graphContainerRef.current!.style.cursor = "default";
    });

    // ノートノードクリックで遷移
    cy.on("tap", "node.note-node", (evt) => {
      handleNavigate(evt.target.id());
    });
    // 関連アセットノードクリックでそのアセット詳細に切り替える
    cy.on("tap", "node.asset-node", (evt) => {
      const nodeId = evt.target.id();
      const fileId = nodeId.replace(/^media-/, "");
      const next = mediaIndex?.media.find((m) => m.fileId === fileId);
      if (next) onSwitchAsset?.(next);
    });

    cyRef.current = cy;

    return () => {
      cy.destroy();
      cyRef.current = null;
    };
  }, [entry, handleNavigate, mediaIndex, getKnowledgeKind, showGraph, onSwitchAsset, assetThumbUrls]);

  // ESC でモーダルを閉じる
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

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
            {/* PDF のページを画像として抽出して画像アセットに登録する */}
            {onExtractPdfPages && entry.type === "pdf" && (
              <button
                onClick={handleExtractPages}
                disabled={extracting}
                className="text-xs px-2.5 py-1 rounded-md bg-primary/10 text-primary hover:bg-primary/20 transition-colors font-medium inline-flex items-center gap-1.5 disabled:opacity-50 disabled:cursor-not-allowed"
                title={t("asset.pdfExtractImages.help")}
              >
                {extracting ? (
                  <>
                    <Loader2 size={14} className="animate-spin" />
                    {extractProgress && extractProgress.total > 0
                      ? t("asset.pdfExtractImages.progress", {
                          done: String(extractProgress.done),
                          total: String(extractProgress.total),
                        })
                      : t("asset.pdfExtractImages.running")}
                  </>
                ) : (
                  <>
                    <Images size={14} />
                    {t("asset.pdfExtractImages.button")}
                  </>
                )}
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

        {/* PDF 画像抽出のエラー表示 */}
        {extractError && (
          <div className="px-5 py-2 border-b border-border bg-red-50 text-xs text-red-600 flex items-start gap-1.5">
            <AlertCircle size={12} className="mt-0.5 shrink-0" />
            <span className="break-all">{t("asset.pdfExtractImages.error")}: {extractError}</span>
          </div>
        )}

        {/* コンテンツ: 左 画像 / 右 グラフ */}
        <div className="flex-1 flex overflow-hidden">
          {/* 左: メディアプレビュー */}
          <div className={`flex items-center justify-center p-6 bg-muted/30 ${showGraph ? "w-1/2 border-r border-border" : "w-full"}`}>
            <MediaPreview entry={entry} />
          </div>

          {/* 右: 関連グラフ（利用ノート + 派生アセット） */}
          {showGraph && (
            <div className="w-1/2 flex flex-col">
              {/* 凡例 */}
              <div className="px-4 py-2 border-b border-border flex items-center flex-wrap gap-x-3 gap-y-1 text-[10px] text-muted-foreground">
                <span className="flex items-center gap-1">
                  <span
                    className="inline-block w-2.5 h-2.5 rounded-sm"
                    style={{ backgroundColor: MEDIA_CENTER_COLOR, transform: "rotate(45deg)" }}
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
                {/* Knowledge kind */}
                {KNOWLEDGE_KIND_LEGEND_ORDER.map((kind) => (
                  <span key={kind} className="flex items-center gap-1">
                    <span
                      className="inline-block w-2.5 h-2.5"
                      style={{
                        backgroundColor: knowledgeKindColor(kind),
                        transform: "rotate(45deg)",
                      }}
                    />
                    {t(`knowledge.kind.${kind}` as any)}
                  </span>
                ))}
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
