// 受信箱（モバイル同期フォルダ <root>/Inbox/ の未取り込みファイル）ビュー。
//
// AssetGalleryView とは別物として作る。あちらは「取り込み済み素材」= MediaIndexEntry
// の一覧だが、ここに並ぶのは **まだ Graphium に入っていない FS 上のファイル**（CaptureRef）
// で、型も出自も違う。取り込むと素材ライブラリ（画像/動画/音声…）へ振り分けられ、
// Inbox/_imported/ へ退避されるので、この一覧からは自然に消える。
//
// 受信箱 = 一時置き場。フォルダを接続した瞬間に中身が見え（取り込み操作は不要）、
// 取り込んだものは「もはやモバイルのものではない」＝普通の素材として扱う。

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Image as ImageIcon,
  Video,
  Volume2,
  FileText,
  Paperclip,
  FolderInput,
  FolderCog,
  RefreshCw,
  Loader2,
} from "lucide-react";
import { useT } from "../../../i18n";
import { useIsDesktop } from "../../../hooks/use-media-query";
import { formatDateTime } from "../../../lib/format-datetime";
import { MaterialSidePeek } from "../../asset-browser/MaterialSidePeek";
import { mimeFromExtension, kindFromMime } from "./mime";
import { buildInboxPeekEntry } from "./preview";
import type { CaptureRef } from "./types";

/**
 * 受信箱の読み取り面。FolderInbox が構造的に満たす（Tauri 依存はそちら側に閉じる）。
 * ビューは transport の実体を知らないのでテストで差し替えられる。
 */
export type InboxSource = {
  listPending(): Promise<CaptureRef[]>;
  readBlob(ref: CaptureRef): Promise<Blob>;
};

/**
 * サムネイルを読む上限。IPC は base64 で全バイトを渡すので、大きいファイルの
 * プレビューは体感を壊す（動画・RAW 等）。超えたものはアイコン表示に倒す。
 */
const THUMBNAIL_MAX_BYTES = 20 * 1024 * 1024;

/** バイト数を人が読める単位に。1024 進、小数 1 桁（KB 未満は B のまま）。 */
function formatBytes(bytes: number | undefined): string {
  if (bytes == null || !Number.isFinite(bytes)) return "";
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB"];
  let v = bytes / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(1)} ${units[i]}`;
}

/** 拡張子から推定した種別。mime 不明なら "other"。 */
function refKind(ref: CaptureRef): "image" | "video" | "audio" | "pdf" | "other" {
  const mime = mimeFromExtension(ref.name);
  if (!mime) return "other";
  if (mime === "application/pdf") return "pdf";
  return kindFromMime(mime) ?? "other";
}

function KindIcon({ kind, size = 16 }: { kind: ReturnType<typeof refKind>; size?: number }) {
  switch (kind) {
    case "image":
      return <ImageIcon size={size} className="text-muted-foreground" />;
    case "video":
      return <Video size={size} className="text-muted-foreground" />;
    case "audio":
      return <Volume2 size={size} className="text-muted-foreground" />;
    case "pdf":
      return <FileText size={size} className="text-muted-foreground" />;
    default:
      return <Paperclip size={size} className="text-muted-foreground" />;
  }
}

/**
 * 行のサムネイル。画像かつ THUMBNAIL_MAX_BYTES 以下のときだけ、
 * 画面に入った時点で本体を読み blob URL を作る（遅延読み込み）。
 * blob URL は行の unmount（再スキャン・ビューを閉じる）で必ず revoke する。
 */
function InboxThumbnail({
  entryRef,
  source,
}: {
  entryRef: CaptureRef;
  source: InboxSource;
}) {
  const kind = refKind(entryRef);
  const holderRef = useRef<HTMLDivElement | null>(null);
  const [visible, setVisible] = useState(false);
  const [url, setUrl] = useState<string | null>(null);

  const thumbnailable =
    kind === "image" && (entryRef.bytes ?? 0) <= THUMBNAIL_MAX_BYTES;

  // 画面内に入ったら読み込む。IntersectionObserver が無い環境では即時可視扱い。
  useEffect(() => {
    if (!thumbnailable) return;
    const el = holderRef.current;
    if (!el || typeof IntersectionObserver === "undefined") {
      setVisible(true);
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setVisible(true);
          io.disconnect();
        }
      },
      { rootMargin: "200px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [thumbnailable]);

  useEffect(() => {
    if (!thumbnailable || !visible) return;
    let cancelled = false;
    let created: string | null = null;
    void (async () => {
      try {
        const blob = await source.readBlob(entryRef);
        if (cancelled) return;
        created = URL.createObjectURL(blob);
        setUrl(created);
      } catch {
        // サムネが出ないだけ。アイコン表示にフォールバックする。
      }
    })();
    return () => {
      cancelled = true;
      if (created) URL.revokeObjectURL(created);
      setUrl(null);
    };
  }, [thumbnailable, visible, source, entryRef]);

  return (
    <div
      ref={holderRef}
      className="w-10 h-10 shrink-0 rounded border border-border bg-muted/40 flex items-center justify-center overflow-hidden"
    >
      {url ? (
        <img src={url} alt="" className="w-full h-full object-cover" />
      ) : (
        <KindIcon kind={kind} />
      )}
    </div>
  );
}

/**
 * ピークで開いている 1 件の本体を読み、プレビュー用の blob URL を作る。
 *
 * サムネイルと違いサイズ上限（THUMBNAIL_MAX_BYTES）は掛けない。ユーザーが明示的に
 * 開いた 1 件だけなので都度読む、という判断（受信箱の目的は取り込む前の取捨選択で、
 * 中身が見えないと選べない）。
 *
 * blob URL は effect のクリーンアップで必ず revoke する。別項目への切り替え・
 * ピークを閉じる・ビューの unmount のすべてがここを通るので、大きな動画を何度
 * 開いてもメモリに残らない。
 */
function useInboxPreviewBlob(
  source: InboxSource | null,
  entryRef: CaptureRef | null,
): { url: string | null; loading: boolean; error: string | null } {
  const [state, setState] = useState<{
    url: string | null;
    loading: boolean;
    error: string | null;
  }>({ url: null, loading: false, error: null });

  // 再スキャンのたびに CaptureRef のオブジェクト同一性は変わる（中身は同じ）。
  // 読み直しの判定はファイル名で行い、実体は ref 経由で最新を参照する
  // （同じファイルを開いたままの定期再スキャンで blob を読み直さない）。
  const latestRef = useRef(entryRef);
  latestRef.current = entryRef;
  const name = entryRef?.name ?? null;

  useEffect(() => {
    const target = latestRef.current;
    if (!source || !target) {
      setState({ url: null, loading: false, error: null });
      return;
    }
    let cancelled = false;
    let created: string | null = null;
    setState({ url: null, loading: true, error: null });
    void (async () => {
      try {
        const blob = await source.readBlob(target);
        if (cancelled) return;
        created = URL.createObjectURL(blob);
        setState({ url: created, loading: false, error: null });
      } catch (e) {
        if (cancelled) return;
        setState({
          url: null,
          loading: false,
          error: e instanceof Error ? e.message : String(e),
        });
      }
    })();
    return () => {
      cancelled = true;
      if (created) URL.revokeObjectURL(created);
    };
  }, [source, name]);

  return state;
}

export type InboxViewProps = {
  /** 同期フォルダが接続済みか（未接続なら接続 CTA を出す）。 */
  rootConfigured: boolean;
  /** 受信箱の読み取り面。未接続なら null。 */
  source: InboxSource | null;
  /** 同期フォルダを選択/変更する。 */
  onPickRoot: () => void | Promise<void>;
  /**
   * 取り込みを実行する。refs を渡すと選択取り込み、省略すると全件取り込み。
   * 完了後にビュー側で再スキャンするので、呼び出し側は media index の更新と
   * 結果トーストに専念してよい。
   */
  onImport: (refs?: CaptureRef[]) => Promise<void>;
  /**
   * 未処理件数が判明するたびに呼ぶ（サイドバーのバッジ用）。
   * ビューを開いた直後の初回スキャン・手動更新・取り込み後の再スキャンの全てで発火するので、
   * 呼び出し側は「開いたとき」「取り込み後」に自前で数え直す必要がない（IPC が二重にならない）。
   */
  onPendingCount?: (count: number) => void;
  onBack: () => void;
};

export function InboxView({
  rootConfigured,
  source,
  onPickRoot,
  onImport,
  onPendingCount,
  onBack,
}: InboxViewProps) {
  const t = useT();
  const isDesktop = useIsDesktop();
  const [items, setItems] = useState<CaptureRef[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [importing, setImporting] = useState(false);
  // サイドピークでプレビュー中のファイル名（null = 閉じている）。CaptureRef 実体でなく
  // 名前で持つ: 再スキャンで配列が作り直されても同じ項目を開いたままにでき、
  // 消えたファイルは名前の突き合わせで自然に閉じられる。
  const [previewName, setPreviewName] = useState<string | null>(null);
  // 非同期の再スキャンが古い結果で新しい結果を上書きしないための世代カウンタ。
  const scanSeq = useRef(0);

  const scan = useCallback(async () => {
    if (!source) {
      setItems([]);
      setSelected(new Set());
      setPreviewName(null);
      onPendingCount?.(0);
      return;
    }
    const seq = ++scanSeq.current;
    setLoading(true);
    setError(null);
    try {
      const listed = await source.listPending();
      if (seq !== scanSeq.current) return;
      setItems(listed);
      onPendingCount?.(listed.length);
      // 消えたファイルの選択は落とす（同期フォルダは外から書き換わる）。
      const names = new Set(listed.map((r) => r.name));
      setSelected((prev) => new Set([...prev].filter((n) => names.has(n))));
      // 実体が消えた（取り込み済み → _imported/ へ移動、外部から削除）ものの
      // プレビューは閉じる。blob URL は useInboxPreviewBlob のクリーンアップで revoke。
      setPreviewName((prev) => (prev != null && names.has(prev) ? prev : null));
    } catch (e) {
      if (seq !== scanSeq.current) return;
      setItems([]);
      setPreviewName(null);
      // 失敗時は件数を 0 扱いにする（バッジが古い数のまま残らないように）。
      onPendingCount?.(0);
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      if (seq === scanSeq.current) setLoading(false);
    }
  }, [source, onPendingCount]);

  // 接続済みなら「開いた瞬間」に列挙する（取り込み操作は不要で中身が見える）。
  // source が差し替わる（フォルダ変更）たびに再スキャンする。
  useEffect(() => {
    void scan();
  }, [scan]);

  const allSelected = items.length > 0 && selected.size === items.length;
  const selectedRefs = useMemo(
    () => items.filter((r) => selected.has(r.name)),
    [items, selected],
  );

  const toggleOne = useCallback((name: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  }, []);

  const toggleAll = useCallback(() => {
    setSelected((prev) =>
      prev.size === items.length ? new Set() : new Set(items.map((r) => r.name)),
    );
  }, [items]);

  // 取り込み → 再スキャン。取り込んだものは _imported/ へ移動済みなので一覧から消える。
  const runImport = useCallback(
    async (refs?: CaptureRef[]) => {
      if (importing) return;
      setImporting(true);
      try {
        await onImport(refs);
        setSelected(new Set());
      } finally {
        setImporting(false);
        await scan();
      }
    },
    [importing, onImport, scan],
  );

  // ── プレビュー（サイドピーク） ──
  // 未取り込みファイルは MediaIndexEntry ではないので、メモピークと同じ流儀で
  // transient エントリ（blob URL 入り）を組み、既存の素材サイドピークに流す。
  const previewRef = useMemo(
    () => (previewName == null ? null : items.find((r) => r.name === previewName) ?? null),
    [items, previewName],
  );
  const preview = useInboxPreviewBlob(source, previewRef);
  const previewEntry = useMemo(
    () => (previewRef ? buildInboxPeekEntry(previewRef, preview.url ?? "") : null),
    [previewRef, preview.url],
  );

  // 読み込み中・失敗はピーク本体を差し替える（url がまだ無い状態を viewer に渡さない）。
  const previewOverride = !previewRef ? undefined
    : preview.error ? (
      <p className="text-sm text-destructive max-w-md text-center break-all">
        {t("mobile.previewFailed", { error: preview.error })}
      </p>
    ) : !preview.url ? (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 size={16} className="animate-spin" />
        {t("mobile.previewLoading")}
      </div>
    ) : undefined;

  // ピーク下部のファイル情報（サイズ・更新日時）と、その場で取り込む導線。
  // 名前・種別（MIME）はピークのヘッダーが出すのでここでは重複させない。
  // 色・境界線はピーク自身のトークンに合わせる（MaterialSidePeek の GraphSection と同じ）。
  const previewFooter = previewRef ? (
    <div
      className="px-3 py-2 flex items-center gap-3"
      style={{
        flexShrink: 0,
        borderTop: "1px solid var(--color-border-subtle)",
        background: "var(--color-card)",
      }}
    >
      <div className="min-w-0 flex-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-muted-foreground">
        {previewRef.bytes != null && (
          <span className="tabular-nums">{formatBytes(previewRef.bytes)}</span>
        )}
        {previewRef.modifiedAt && (
          <span className="whitespace-nowrap">{formatDateTime(previewRef.modifiedAt)}</span>
        )}
      </div>
      <button
        onClick={() => { void runImport([previewRef]); }}
        disabled={importing}
        className="flex items-center gap-1 px-3 py-1.5 text-xs rounded border border-border text-foreground hover:bg-muted transition-colors whitespace-nowrap shrink-0 disabled:opacity-50"
      >
        {importing ? <Loader2 size={12} className="animate-spin" /> : <FolderInput size={12} />}
        {t("mobile.importThis")}
      </button>
    </div>
  ) : null;

  return (
    <div className="flex-1 flex overflow-hidden bg-background">
      <div className="flex-1 flex flex-col overflow-hidden min-w-0">
        {/* ヘッダー */}
        <div className="flex items-center gap-3 px-6 py-4 border-b border-border">
          <button
            onClick={onBack}
            className="text-sm text-muted-foreground hover:text-foreground transition-colors whitespace-nowrap shrink-0"
          >
            {t("common.back")}
          </button>
          <h1 className="text-base font-semibold text-foreground whitespace-nowrap shrink-0">
            {t("mobile.title")}
          </h1>
          <span className="text-xs text-muted-foreground whitespace-nowrap shrink-0">
            {t("mobile.pendingCount", { count: String(items.length) })}
          </span>
          <div className="ml-auto flex items-center gap-2 shrink-0">
            <button
              onClick={() => { void onPickRoot(); }}
              className="inline-flex items-center justify-center w-8 h-8 rounded-md border border-border text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
              title={rootConfigured ? t("mobile.changeFolder") : t("mobile.connectFolder")}
              aria-label={rootConfigured ? t("mobile.changeFolder") : t("mobile.connectFolder")}
            >
              <FolderCog size={14} />
            </button>
            <button
              onClick={() => { void scan(); }}
              disabled={!source || loading}
              className="inline-flex items-center justify-center w-8 h-8 rounded-md border border-border text-muted-foreground hover:text-foreground hover:bg-muted transition-colors disabled:opacity-50"
              title={t("mobile.refresh")}
              aria-label={t("mobile.refresh")}
            >
              <RefreshCw size={14} className={loading ? "animate-spin" : undefined} />
            </button>
            <button
              onClick={() => { void runImport(selectedRefs); }}
              disabled={importing || selectedRefs.length === 0}
              className="flex items-center gap-1 px-3 py-1.5 text-xs rounded border border-border text-foreground hover:bg-muted transition-colors whitespace-nowrap shrink-0 disabled:opacity-50"
            >
              <FolderInput size={12} />
              {t("mobile.importSelected", { count: String(selectedRefs.length) })}
            </button>
            <button
              onClick={() => { void runImport(); }}
              disabled={importing || items.length === 0}
              className="flex items-center gap-1 px-3 py-1.5 text-xs rounded bg-primary text-primary-foreground hover:opacity-90 transition-opacity whitespace-nowrap shrink-0 disabled:opacity-50"
            >
              {importing ? <Loader2 size={12} className="animate-spin" /> : <FolderInput size={12} />}
              {importing ? t("mobile.importing") : t("mobile.importAll")}
            </button>
          </div>
        </div>

        {/* 本体 */}
        <div className="flex-1 overflow-y-auto">
          {!rootConfigured || !source ? (
            // 未接続: 接続 CTA。接続した瞬間に中身が見える（取り込みは別操作）。
            <div className="flex flex-col items-center justify-center gap-3 py-16 text-center px-6">
              <p className="text-sm text-muted-foreground max-w-sm">
                {t("mobile.connectHint")}
              </p>
              <button
                onClick={() => { void onPickRoot(); }}
                className="flex items-center gap-1.5 px-4 py-2 text-xs rounded bg-primary text-primary-foreground hover:opacity-90 transition-opacity"
              >
                <FolderCog size={13} />
                {t("mobile.connectFolder")}
              </button>
            </div>
          ) : error ? (
            <div className="flex flex-col items-center justify-center gap-3 py-16 text-center px-6">
              <p className="text-sm text-destructive max-w-lg break-all">
                {t("mobile.scanFailed", { error })}
              </p>
              <button
                onClick={() => { void scan(); }}
                className="flex items-center gap-1.5 px-4 py-2 text-xs rounded border border-border text-foreground hover:bg-muted transition-colors"
              >
                <RefreshCw size={13} />
                {t("mobile.refresh")}
              </button>
            </div>
          ) : loading && items.length === 0 ? (
            <div className="flex items-center justify-center py-16">
              <p className="text-sm text-muted-foreground">{t("common.loading")}</p>
            </div>
          ) : items.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-2 py-16 text-center px-6">
              <p className="text-sm text-muted-foreground">{t("mobile.emptyInbox")}</p>
              <p className="text-xs text-muted-foreground/70 max-w-sm">
                {t("mobile.emptyInboxHint")}
              </p>
            </div>
          ) : (
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-background border-b border-border">
                <tr className="text-muted-foreground">
                  <th className="py-2 pl-6 pr-2 w-8">
                    <input
                      type="checkbox"
                      checked={allSelected}
                      onChange={toggleAll}
                      aria-label={allSelected ? t("mobile.deselectAll") : t("mobile.selectAll")}
                      title={allSelected ? t("mobile.deselectAll") : t("mobile.selectAll")}
                      className="cursor-pointer"
                    />
                  </th>
                  <th className="py-2 px-3 w-14 text-left font-medium">{t("mobile.colPreview")}</th>
                  <th className="py-2 px-3 text-left font-medium">{t("mobile.colName")}</th>
                  <th className="py-2 px-3 w-24 text-right font-medium">{t("mobile.colSize")}</th>
                  <th className="py-2 px-3 pr-6 w-40 text-left font-medium">{t("mobile.colModified")}</th>
                </tr>
              </thead>
              <tbody>
                {items.map((ref) => {
                  const checked = selected.has(ref.name);
                  const previewing = previewName === ref.name;
                  return (
                    // 行クリック = プレビュー（取り込む前に中身を大きく見る）。
                    // チェックボックスのセルはクリックを止めるので、選択操作とは干渉しない。
                    <tr
                      key={ref.name}
                      onClick={() => setPreviewName(ref.name)}
                      className={`border-b border-border/60 hover:bg-muted/40 transition-colors cursor-pointer ${previewing ? "bg-muted/60" : checked ? "bg-primary/5" : ""}`}
                    >
                      <td
                        className="py-2 pl-6 pr-2 align-middle"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => toggleOne(ref.name)}
                          aria-label={ref.name}
                          className="cursor-pointer"
                        />
                      </td>
                      <td className="py-2 px-3 align-middle">
                        <InboxThumbnail entryRef={ref} source={source} />
                      </td>
                      <td className="py-2 px-3 align-middle max-w-0 w-full">
                        {/* キーボードでも開けるよう、名前自体をボタンにする
                            （行クリックはマウス用の広い当たり判定） */}
                        <button
                          type="button"
                          onClick={(e) => { e.stopPropagation(); setPreviewName(ref.name); }}
                          aria-label={`${t("mobile.openPreview")}: ${ref.name}`}
                          title={ref.name}
                          className="text-foreground truncate block w-full text-left hover:text-primary transition-colors"
                        >
                          {ref.name}
                        </button>
                      </td>
                      <td className="py-2 px-3 align-middle text-right text-muted-foreground tabular-nums whitespace-nowrap">
                        {formatBytes(ref.bytes)}
                      </td>
                      <td className="py-2 px-3 pr-6 align-middle text-muted-foreground whitespace-nowrap">
                        {ref.modifiedAt ? formatDateTime(ref.modifiedAt) : ""}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {/* プレビュー: 既存の素材サイドピークをそのまま流用する（transient エントリ）。
          素材系のコールバック（リネーム / Knowledge 化 / 削除 / Full 昇格 / Asset graph）は
          渡さないので、メモピークと同じく「見るだけ」のピークになる。
          デスクトップは inline flex item（一覧が縮んでリフロー）、モバイルは overlay —
          AssetGalleryView と同じ方針。 */}
      {previewEntry && (
        <MaterialSidePeek
          inline={isDesktop}
          entry={previewEntry}
          onClose={() => setPreviewName(null)}
          previewOverride={previewOverride}
          footer={previewFooter}
        />
      )}
    </div>
  );
}
