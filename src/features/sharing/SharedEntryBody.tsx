// 共有エントリの本文（read-only 表示）。type 別の見せ方をここに集約する。
//
// なぜ SharedLibraryView から出したか:
//   同じ本文を 2 か所で見せるようになった（詳細パネル＝サイドピーク と
//   全画面表示 SharedNoteView）。表示の分岐を両方に持つと、type が増えたときに
//   片方だけ古くなる。読み込み（body 文字列の取り寄せ）は呼び出し側の担当で、
//   ここは受け取った文字列を描くことだけを担う。
//
// 設計詳細: docs/internal/team-shared-storage-design.md §3 Library / §22

import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, ExternalLink, RefreshCw } from "lucide-react";
import {
  LocalFolderBlobProvider,
  getBlobRoot,
  type BlobRef,
  type SharedEntry,
} from "../../lib/storage/shared";
import {
  collectSharedBlobHashes,
  rewriteSharedBlobUrls,
} from "./materialize-blobs";
import { t } from "../../i18n";
import { SandboxEditor } from "../../base/editor";
import { customBlockEntries, sanitizeBlocksForLoad } from "../../blocks/registry";
import { useRemoteContentScope } from "../../blocks/remote-content";
import {
  LabelStoreProvider,
  ProvLabelsEnabledProvider,
} from "../context-label/store";
import { LinkStoreProvider } from "../block-link/store";
import { TableMetaStoreProvider } from "../table-meta/store";
import { MediaInlineLabelProvider } from "../inline-label/media-store";
import { BlockAlignmentProvider } from "../block-alignment/store";
import { AiAssistantProvider } from "../ai-assistant/store";
import type { GraphiumDocument } from "../../lib/document-types";
// 直接 save.ts から取る（features/template の index はピッカーのモーダルまで引き込むため）
import { deserializeTemplate } from "../template/save";
import { LATEST_DOCUMENT_VERSION } from "../../lib/document-migration";
import { readSharedEntryBody } from "./shared-library-store";

/** 本文の取り寄せ（DI 用の型。既定は共有ストア経由） */
export type SharedEntryBodyReader = (
  entry: SharedEntry,
) => Promise<{ body: Uint8Array; verified: boolean }>;

/**
 * 共有エントリの本文（文字列）を取り寄せる。詳細パネルと全画面で同じ経路を使う。
 *
 * 既定は共有ストア経由（本文は id|hash で LRU キャッシュされる。語彙索引が
 * 直前に読んでいれば I/O ゼロ）。DI 指定時はそちらから読む。
 */
export function useSharedEntryBodyText(
  entry: SharedEntry,
  readEntryBody?: SharedEntryBodyReader,
): { body: string | null; bodyError: string | null } {
  const [body, setBody] = useState<string | null>(null);
  const [bodyError, setBodyError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { body: bytes } = await (readEntryBody ?? readSharedEntryBody)(entry);
        if (cancelled) return;
        setBody(new TextDecoder().decode(bytes));
      } catch (e) {
        if (cancelled) return;
        setBodyError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [entry, readEntryBody]);

  return { body, bodyError };
}

export function SharedEntryBody({
  entry,
  body,
  bodyError,
  onEditorReady,
}: {
  entry: SharedEntry;
  body: string | null;
  bodyError: string | null;
  /** ノート / ナレッジのプレビューのエディタ実体（段落の指定・抜粋の解決に使う） */
  onEditorReady?: (editor: any) => void;
}) {
  if (bodyError) {
    return (
      <div className="text-xs text-destructive flex items-center gap-2">
        <AlertTriangle size={14} />
        {t("library.detail.bodyLoadFailed", { error: bodyError })}
      </div>
    );
  }
  if (body === null) {
    return <div className="text-xs text-muted-foreground">{t("common.loading")}</div>;
  }

  const extra = (entry.extra ?? {}) as Record<string, unknown>;

  if (entry.type === "reference") {
    const url = typeof extra.url === "string" ? extra.url : null;
    const description =
      typeof extra.description === "string" ? extra.description : null;
    return (
      <div className="space-y-2 text-sm">
        {url && (
          <a
            href={url}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 text-primary hover:underline break-all"
          >
            <ExternalLink size={12} />
            {url}
          </a>
        )}
        {description && (
          <p className="text-foreground/90 whitespace-pre-wrap">{description}</p>
        )}
      </div>
    );
  }

  if (entry.type === "data-manifest") {
    return <DataManifestPreview entry={entry} />;
  }

  if (entry.type === "template") {
    const description =
      typeof extra.description === "string" ? extra.description : null;
    return (
      <div className="space-y-3">
        {description && (
          <p className="text-sm text-foreground/90 whitespace-pre-wrap">{description}</p>
        )}
        <SharedTemplatePreview body={body} />
      </div>
    );
  }

  if (entry.type === "note" || entry.type === "knowledge") {
    // body は GraphiumDocument JSON。読み取り専用エディタでフル内容を表示する
    return <SharedNotePreview body={body} onEditorReady={onEditorReady} />;
  }

  // report はテキスト系として中身をそのまま表示
  return (
    <pre className="text-xs font-mono whitespace-pre-wrap break-all bg-muted/30 p-3 rounded">
      {body.slice(0, 8000)}
    </pre>
  );
}

// ── note の read-only preview ──
//
// shared 側の body（GraphiumDocument JSON）を読み取り専用エディタで描画する。
// ノート内メディアは Share 時に `shared-blob:sha256:<hex>` へ置換されている
// （auto-blob）ため、表示前に blob root から Blob URL を作って差し戻す。
// 解決できない blob はそのまま残す（該当メディアだけ壊れ表示、本文は読める）。

type NotePreviewState =
  | { phase: "loading" }
  | { phase: "ready"; blocks: unknown[] }
  | { phase: "error" };

// 共有側では解決できないメディア参照。
// - shared-blob: … blob root 未設定 / blob 欠落で解決できなかったもの
// - file-media: / local-media: … auto-blob 導入前に共有されたノートに残る、
//   共有した本人のマシン専用の参照（実体が共有フォルダに無い）
// これらを壊れ画像アイコンのまま出すと「リンク切れ？」と不安にさせるので、
// ファイル名入りの案内テキストに置き換える。
const UNRESOLVABLE_MEDIA_TYPES = new Set(["image", "video", "audio", "file", "pdf"]);

function isUnresolvableMediaUrl(url: string): boolean {
  return (
    url.startsWith("shared-blob:") ||
    url.startsWith("file-media://") ||
    url.startsWith("local-media://")
  );
}

function replaceUnresolvableMedia(blocks: any[]): any[] {
  return blocks.map((b) => {
    if (
      UNRESOLVABLE_MEDIA_TYPES.has(b?.type) &&
      typeof b?.props?.url === "string" &&
      isUnresolvableMediaUrl(b.props.url)
    ) {
      const name =
        typeof b.props.name === "string" && b.props.name ? b.props.name : b.type;
      return {
        type: "paragraph",
        props: {},
        content: [
          {
            type: "text",
            text: `📎 ${name} — ${t("share.preview.mediaNotIncluded")}`,
            styles: { italic: true },
          },
        ],
        children: b.children ?? [],
      };
    }
    if (b?.children?.length) {
      return { ...b, children: replaceUnresolvableMedia(b.children) };
    }
    return b;
  });
}

export function SharedNotePreview({
  body,
  onEditorReady,
}: {
  body: string;
  /** 読み取り専用エディタの実体を親へ渡す（段落の指定・¶ 抜粋のライブ解決に使う） */
  onEditorReady?: (editor: any) => void;
}) {
  const [state, setState] = useState<NotePreviewState>({ phase: "loading" });
  // 共有ライブラリのプレビューも本文を描くので、外部メディアのゲートが要る。
  // scope を渡さないと editorRemoteScope() が "" になり、ブロックはされるものの
  // プレースホルダの「読み込む」が何も起こさない（allowRemoteContentFor("") は
  // 早期 return する）。押しても無反応のボタンを出さないため、ここで scope を採る。
  const remoteScope = useRemoteContentScope();

  useEffect(() => {
    let cancelled = false;
    const createdUrls: string[] = [];
    (async () => {
      let doc: GraphiumDocument;
      try {
        doc = JSON.parse(body) as GraphiumDocument;
        if (!Array.isArray(doc.pages)) throw new Error("not a GraphiumDocument");
      } catch {
        if (!cancelled) setState({ phase: "error" });
        return;
      }
      // ノート内メディア（shared-blob:）→ Blob URL
      const blobRoot = getBlobRoot();
      const hashes = collectSharedBlobHashes(doc);
      const mapping = new Map<string, string>();
      if (blobRoot && hashes.length > 0) {
        const provider = new LocalFolderBlobProvider(blobRoot);
        for (const hash of hashes) {
          try {
            // get() は hash のみ参照するため、他フィールドはプレースホルダで足りる
            const u = await provider.url({ provider: "local-folder", uri: "", hash, size: 0 });
            mapping.set(hash, u);
            createdUrls.push(u);
          } catch {
            // 未解決 blob は shared-blob: のまま残す
          }
        }
      }
      if (cancelled) return;
      const resolved = rewriteSharedBlobUrls(doc, mapping);
      // 全ページを「ページタイトル見出し + 本文」で連結（2 ページ目以降のみ見出しを挟む）
      const blocks: unknown[] = [];
      resolved.pages.forEach((page, i) => {
        if (i > 0) {
          blocks.push({
            type: "heading",
            props: { level: 2 },
            content: [{ type: "text", text: page.title || t("library.detail.pageN", { n: String(i + 1) }), styles: {} }],
            children: [],
          });
        }
        blocks.push(
          ...replaceUnresolvableMedia(sanitizeBlocksForLoad(page.blocks ?? [])),
        );
      });
      setState({ phase: "ready", blocks });
    })();
    return () => {
      cancelled = true;
      for (const u of createdUrls) {
        if (u.startsWith("blob:")) URL.revokeObjectURL(u);
      }
    };
  }, [body]);

  if (state.phase === "loading") {
    return (
      <div className="flex items-center gap-2 text-xs text-muted-foreground py-4">
        <RefreshCw size={12} className="animate-spin" />
        {t("share.preview.loading")}
      </div>
    );
  }
  if (state.phase === "error") {
    // GraphiumDocument として読めない body は raw 表示にフォールバック
    return (
      <pre className="text-[11px] font-mono whitespace-pre-wrap break-all bg-muted/30 p-2 rounded">
        {body.slice(0, 4000)}
      </pre>
    );
  }
  return (
    <div className="shared-note-preview -mx-2 text-sm">
      {/* SandboxEditor は SelectionToolbar / InlineAnchorController が常時
          mount するため note-app と同じ Context 群を要求する（step ストーリーと
          同じスタック）。Library パネルは Provider ツリーの外なのでここで
          完結させる — ラベル・AI は無効の読み取り表示 */}
      <ProvLabelsEnabledProvider enabled={false}>
        <LabelStoreProvider>
          <LinkStoreProvider>
            <TableMetaStoreProvider>
              <MediaInlineLabelProvider>
                <BlockAlignmentProvider>
                  <AiAssistantProvider aiAvailable={false}>
                    <SandboxEditor
                      blocks={customBlockEntries}
                      initialContent={state.blocks as any[]}
                      editable={false}
                      remoteContentScope={remoteScope}
                      onEditorReady={onEditorReady}
                    />
                  </AiAssistantProvider>
                </BlockAlignmentProvider>
              </MediaInlineLabelProvider>
            </TableMetaStoreProvider>
          </LinkStoreProvider>
        </LabelStoreProvider>
      </ProvLabelsEnabledProvider>
    </div>
  );
}

// ── template の read-only preview ──
//
// 本文は PageTemplate JSON（GraphiumDocument ではない）。ノートと同じ読み取り専用
// ビューアで見せるため、擬似 GraphiumDocument に包んでから SharedNotePreview に渡す。
// なぜ包むだけで足りるか: プレビューが読むのは pages[].blocks だけで、
// shared-blob: の解決も doc の走査で行われるため。
function SharedTemplatePreview({ body }: { body: string }) {
  const pseudoBody = useMemo(() => {
    try {
      const template = deserializeTemplate(body);
      if (!Array.isArray(template?.blocks)) return null;
      const doc: GraphiumDocument = {
        version: LATEST_DOCUMENT_VERSION,
        title: template.name,
        // 表示専用の擬似ドキュメント。日時はテンプレートの保存時刻で埋める
        // （プレビューは読まないが GraphiumDocument の必須フィールド）
        createdAt: template.savedAt,
        modifiedAt: template.savedAt,
        pages: [
          {
            id: "main",
            title: template.pageTitle || template.name,
            blocks: template.blocks,
            labels: Object.fromEntries(template.labels ?? []),
            provLinks: [],
            knowledgeLinks: [],
            ...(template.tableMeta ? { tableMeta: template.tableMeta } : {}),
            ...(template.mediaInlineLabels
              ? { mediaInlineLabels: template.mediaInlineLabels }
              : {}),
          },
        ],
      };
      return JSON.stringify(doc);
    } catch {
      return null;
    }
  }, [body]);

  // PageTemplate として読めない body は raw 表示にフォールバック（ノートと同じ扱い）
  if (!pseudoBody) {
    return (
      <pre className="text-[11px] font-mono whitespace-pre-wrap break-all bg-muted/30 p-2 rounded">
        {body.slice(0, 4000)}
      </pre>
    );
  }
  return <SharedNotePreview body={pseudoBody} />;
}

// ── data-manifest の inline preview ──

function DataManifestPreview({ entry }: { entry: SharedEntry }) {
  const extra = (entry.extra ?? {}) as Record<string, unknown>;
  const blobs: BlobRef[] = Array.isArray(extra.blobs)
    ? (extra.blobs as BlobRef[]).filter(
        (b) => b && typeof b.hash === "string" && typeof b.uri === "string",
      )
    : [];
  const mime = typeof extra.mime_type === "string" ? extra.mime_type : null;
  const mediaType = typeof extra.media_type === "string" ? extra.media_type : null;
  const original =
    typeof extra.original_filename === "string"
      ? extra.original_filename
      : null;

  return (
    <div className="space-y-3 text-sm">
      {mime && (
        <div className="text-xs text-muted-foreground">{t("library.detail.mime", { mime })}</div>
      )}
      {original && (
        <div className="text-xs text-muted-foreground">
          {t("library.detail.originalFilename", { name: original })}
        </div>
      )}
      {blobs.map((b) => (
        <BlobPreviewCard key={b.hash} blob={b} mime={mime} mediaType={mediaType} />
      ))}
    </div>
  );
}

function BlobPreviewCard({
  blob,
  mime,
  mediaType,
}: {
  blob: BlobRef;
  mime: string | null;
  mediaType: string | null;
}) {
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const blobRoot = getBlobRoot();

  // 画像は自動ロード（軽量）。PDF / 動画 / 音声はクリックでロード
  const isImage = (mime ?? "").startsWith("image/") || mediaType === "image";
  const isPdf = mime === "application/pdf" || mediaType === "pdf";
  const isVideo = (mime ?? "").startsWith("video/") || mediaType === "video";
  const isAudio = (mime ?? "").startsWith("audio/") || mediaType === "audio";

  const loadUrl = useCallback(async () => {
    if (!blobRoot || url) return;
    setLoading(true);
    try {
      const provider = new LocalFolderBlobProvider(blobRoot);
      const u = await provider.url(blob);
      setUrl(u);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [blobRoot, blob, url]);

  // 画像は自動で blob URL を取りに行く
  useEffect(() => {
    if (isImage) void loadUrl();
    return () => {
      if (url && url.startsWith("blob:")) URL.revokeObjectURL(url);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isImage]);

  return (
    <div className="rounded border border-border bg-muted/30 overflow-hidden">
      {/* preview slot */}
      {!blobRoot ? (
        <div className="p-3 text-xs text-muted-foreground">
          {t("share.noBlobRootPreview")}
        </div>
      ) : error ? (
        <div className="p-3 text-xs text-destructive flex items-center gap-2">
          <AlertTriangle size={12} />
          {error}
        </div>
      ) : isImage ? (
        url ? (
          <img
            src={url}
            alt={blob.filename ?? blob.hash}
            className="w-full max-h-[480px] object-contain bg-checkerboard"
          />
        ) : (
          <div className="p-6 text-xs text-muted-foreground text-center">
            {loading ? t("library.detail.loading") : t("library.detail.preparing")}
          </div>
        )
      ) : isPdf ? (
        url ? (
          <embed
            src={url}
            type="application/pdf"
            className="w-full h-[640px] block"
          />
        ) : (
          <button
            onClick={() => void loadUrl()}
            disabled={loading}
            className="w-full p-6 text-xs text-muted-foreground hover:bg-muted/50 transition-colors disabled:opacity-50"
          >
            {loading ? t("library.detail.loading") : t("library.detail.loadPdf")}
          </button>
        )
      ) : isVideo ? (
        url ? (
          <video
            src={url}
            controls
            className="w-full max-h-[480px] block bg-black"
          />
        ) : (
          <button
            onClick={() => void loadUrl()}
            disabled={loading}
            className="w-full p-6 text-xs text-muted-foreground hover:bg-muted/50 transition-colors disabled:opacity-50"
          >
            {loading ? t("library.detail.loading") : t("library.detail.loadVideo")}
          </button>
        )
      ) : isAudio ? (
        url ? (
          <audio src={url} controls className="w-full p-3" />
        ) : (
          <button
            onClick={() => void loadUrl()}
            disabled={loading}
            className="w-full p-6 text-xs text-muted-foreground hover:bg-muted/50 transition-colors disabled:opacity-50"
          >
            {loading ? t("library.detail.loading") : t("library.detail.loadAudio")}
          </button>
        )
      ) : (
        <div className="p-3 text-xs text-muted-foreground">
          {t("library.detail.noPreview")}
        </div>
      )}

      {/* meta */}
      <div className="p-2 text-xs space-y-0.5 border-t border-border">
        <div className="font-mono break-all">{blob.uri}</div>
        <div className="text-muted-foreground">
          {t("library.detail.bytes", { size: String(blob.size) })} ·{" "}
          <span className="font-mono">{blob.hash.slice(0, 16)}…</span>
        </div>
      </div>
    </div>
  );
}
