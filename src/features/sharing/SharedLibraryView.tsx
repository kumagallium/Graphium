// Shared Library — 左ナビ「Library > Shared」から開くメインビュー（Phase 2c）。
//
// 表示:
// - shared root から 6 種類の SharedEntry を読み出し、type タブで切り替え
// - 各カード: title / author / sharedAt / hash 検証バッジ
// - カードクリックで読み取り専用の詳細パネルを開く
// - 自分作 → Update 動線（ヒントのみ）/ Unshare ボタン
// - 他人作（type=note / knowledge）→ Fork ボタン（note → notes、knowledge → wiki）
//
// 設計詳細: docs/internal/team-shared-storage-design.md §3 Library / §8 共有 Concept

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  ExternalLink,
  GitFork,
  Library,
  Link2,
  RefreshCw,
  ShieldQuestion,
  Trash2,
  X,
} from "lucide-react";
import type { AuthorIdentity } from "../document-provenance/types";
import {
  LocalFolderSharedProvider,
  LocalFolderBlobProvider,
  getBlobRoot,
  type BlobRef,
  type SharedEntry,
  type SharedEntryType,
} from "../../lib/storage/shared";
import { Breadcrumb } from "../../components/Breadcrumb";
import { ResizeHandle } from "../../components/ResizeHandle";
import { useSidePeekWidth } from "../../hooks/use-resizable-width";
import { loadAllSharedEntries } from "./shared-library-loader";
import { buildSharedCitationLink } from "./citation-link";
import {
  collectSharedBlobHashes,
  rewriteSharedBlobUrls,
} from "./materialize-blobs";
import { formatDate } from "../../lib/format-datetime";
import { t } from "../../i18n";
import { SandboxEditor } from "../../base/editor";
import { customBlockEntries, sanitizeBlocksForLoad } from "../../blocks/registry";
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

type Props = {
  /** Settings の shared root path */
  sharedRoot: string;
  /** 現在のユーザー identity（未登録時は null）。author 一致判定に使う */
  currentIdentity: AuthorIdentity | null;
  /** ノートの fork 実行（呼び出し側で新規ノートを作成して開く） */
  onForkNote: (sharedId: string) => Promise<void>;
  /** Knowledge の fork 実行（呼び出し側で新規 Wiki ページを作成して開く） */
  onForkKnowledge: (sharedId: string) => Promise<void>;
  /** 自分作ノートの Unshare（成功時はリストを再読み込み） */
  onUnshare: (entry: SharedEntry) => Promise<void>;
  onBack: () => void;
  /** 引用カードの「開く」から特定エントリを選択表示で開く（consume 後に onFocusConsumed） */
  focusEntryId?: string | null;
  onFocusConsumed?: () => void;
};

// 共有導線（Share ボタン）が実装されている type のみ tab に出す。
// template / report は SharedEntryType としては予約されており
// データ層は読み書きできるが、UI に「Share」エントリポイントが整うまで非表示。
const TYPE_TABS: { type: SharedEntryType; label: string }[] = [
  { type: "note", label: "Notes" },
  { type: "knowledge", label: "Knowledge" },
  { type: "reference", label: "References" },
  { type: "data-manifest", label: "Data" },
];

/** fork 導線を持つ type（fork 先: note → notes、knowledge → wiki） */
function isForkable(type: SharedEntryType): boolean {
  return type === "note" || type === "knowledge";
}

function entryTitle(entry: SharedEntry): string {
  const t = (entry.extra as Record<string, unknown> | undefined)?.title;
  if (typeof t === "string" && t.trim()) return t;
  return `(untitled ${entry.type})`;
}

type HashStatus = "unknown" | "verifying" | "ok" | "mismatch" | "error";

export function SharedLibraryView({
  sharedRoot,
  currentIdentity,
  onForkNote,
  onForkKnowledge,
  onUnshare,
  onBack,
  focusEntryId,
  onFocusConsumed,
}: Props) {
  const [activeType, setActiveType] = useState<SharedEntryType>("note");
  const [loading, setLoading] = useState(false);
  const [entriesByType, setEntriesByType] = useState<
    Record<SharedEntryType, SharedEntry[]>
  >({
    note: [],
    reference: [],
    "data-manifest": [],
    template: [],
    knowledge: [],
    report: [],
  });
  const [loadErrors, setLoadErrors] = useState<
    Partial<Record<SharedEntryType, string>>
  >({});
  const [selected, setSelected] = useState<SharedEntry | null>(null);
  const [hashStatus, setHashStatus] = useState<Record<string, HashStatus>>({});
  const [busyId, setBusyId] = useState<string | null>(null);
  // 「引用リンクをコピー」の完了フィードバック（1.5 秒だけチェック表示）
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const copyCitationLink = useCallback((entry: SharedEntry) => {
    void navigator.clipboard?.writeText(buildSharedCitationLink(entry.id));
    setCopiedId(entry.id);
    window.setTimeout(() => {
      setCopiedId((prev) => (prev === entry.id ? null : prev));
    }, 1500);
  }, []);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const result = await loadAllSharedEntries(sharedRoot);
      setEntriesByType(result.entries);
      setLoadErrors(result.errors);
    } finally {
      setLoading(false);
    }
  }, [sharedRoot]);

  useEffect(() => {
    void reload();
  }, [reload]);

  // 引用カードの「開く」→ ロード済みエントリから該当 id を探して選択表示する。
  // ロード完了前は entriesByType が空なので、entries が入ってから発火する。
  useEffect(() => {
    if (!focusEntryId) return;
    for (const [type, list] of Object.entries(entriesByType)) {
      const hit = list.find((e) => e.id === focusEntryId);
      if (hit) {
        setActiveType(type as SharedEntryType);
        setSelected(hit);
        onFocusConsumed?.();
        return;
      }
    }
    // 全 type ロード後も見つからなければ consume だけする（削除済み等）
    if (!loading && Object.values(entriesByType).some((l) => l.length > 0)) {
      onFocusConsumed?.();
    }
  }, [focusEntryId, entriesByType, loading, onFocusConsumed]);

  const counts = useMemo(() => {
    const out: Record<SharedEntryType, number> = {
      note: 0,
      reference: 0,
      "data-manifest": 0,
      template: 0,
      knowledge: 0,
      report: 0,
    };
    for (const t of TYPE_TABS) {
      out[t.type] = entriesByType[t.type].length;
    }
    return out;
  }, [entriesByType]);

  const verifyHash = useCallback(
    async (entry: SharedEntry) => {
      setHashStatus((s) => ({ ...s, [entry.id]: "verifying" }));
      try {
        const provider = new LocalFolderSharedProvider(sharedRoot);
        const ok = await provider.verifyHash(entry.id);
        setHashStatus((s) => ({ ...s, [entry.id]: ok ? "ok" : "mismatch" }));
      } catch {
        setHashStatus((s) => ({ ...s, [entry.id]: "error" }));
      }
    },
    [sharedRoot],
  );

  const handleFork = useCallback(
    async (entry: SharedEntry) => {
      setBusyId(entry.id);
      try {
        if (entry.type === "knowledge") {
          await onForkKnowledge(entry.id);
        } else {
          await onForkNote(entry.id);
        }
      } finally {
        setBusyId(null);
      }
    },
    [onForkNote, onForkKnowledge],
  );

  const handleUnshare = useCallback(
    async (entry: SharedEntry) => {
      const confirmed = window.confirm(
        `Unshare "${entryTitle(entry)}"?\n\n` + t("share.unshareConfirmBody"),
      );
      if (!confirmed) return;
      setBusyId(entry.id);
      try {
        await onUnshare(entry);
        await reload();
      } finally {
        setBusyId(null);
      }
    },
    [onUnshare, reload],
  );

  const activeEntries = entriesByType[activeType];
  const activeError = loadErrors[activeType];

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* ヘッダー */}
      <div className="px-6 py-4 border-b border-border bg-background sticky top-0 z-10">
        <Breadcrumb
          items={[
            { label: "Library", onClick: onBack },
            { label: "Shared" },
          ]}
        />
        <div className="mt-2 flex items-center justify-between gap-2">
          <h2 className="text-lg font-semibold text-foreground flex items-center gap-2">
            <Library size={18} className="text-muted-foreground" />
            Shared Library
          </h2>
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground truncate max-w-[280px]" title={sharedRoot}>
              {sharedRoot}
            </span>
            <button
              onClick={reload}
              disabled={loading}
              className="p-1.5 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
              title="Reload"
            >
              <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
            </button>
          </div>
        </div>

        {/* タブ */}
        <div className="mt-3 flex gap-1 overflow-x-auto">
          {TYPE_TABS.map((tab) => {
            const isActive = activeType === tab.type;
            const count = counts[tab.type];
            return (
              <button
                key={tab.type}
                onClick={() => setActiveType(tab.type)}
                className={`px-3 py-1.5 text-xs rounded-md transition-colors whitespace-nowrap ${
                  isActive
                    ? "bg-primary/10 text-primary font-semibold"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground"
                }`}
              >
                {tab.label}
                {count > 0 && (
                  <span className="ml-1.5 text-[10px] opacity-70">({count})</span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* リスト + 詳細パネル（既存サイドピークと同じ並置レイアウト） */}
      <div className="flex-1 flex overflow-hidden">
      <div className="flex-1 min-w-0 overflow-auto px-6 py-4">
        {activeError && (
          <div className="mb-3 p-3 rounded border border-destructive/30 bg-destructive/5 text-xs text-destructive flex items-center gap-2">
            <AlertTriangle size={14} />
            <span>Failed to load: {activeError}</span>
          </div>
        )}

        {!activeError && activeEntries.length === 0 && !loading && (
          <div className="text-center py-12 text-sm text-muted-foreground">
            No shared {activeType.replace("-", " ")} entries yet.
          </div>
        )}

        <div
          className={`grid gap-3 ${
            selected
              ? "grid-cols-1 xl:grid-cols-2"
              : "grid-cols-1 md:grid-cols-2 lg:grid-cols-3"
          }`}
        >
          {activeEntries.map((entry) => {
            const isMine =
              !!currentIdentity &&
              entry.author?.email === currentIdentity.email;
            const status = hashStatus[entry.id] ?? "unknown";
            const isBusy = busyId === entry.id;
            return (
              <button
                key={entry.id}
                onClick={() => setSelected(entry)}
                className="text-left p-3 rounded-md border border-border hover:border-primary/50 hover:bg-muted/40 transition-colors flex flex-col gap-2"
              >
                <div className="flex items-start justify-between gap-2">
                  <h3 className="text-sm font-medium text-foreground truncate flex-1">
                    {entryTitle(entry)}
                  </h3>
                  <HashBadge
                    status={status}
                    onClick={(e) => {
                      e.stopPropagation();
                      void verifyHash(entry);
                    }}
                  />
                </div>
                <div className="text-xs text-muted-foreground flex items-center gap-2 flex-wrap">
                  <span className="truncate" title={entry.author?.email}>
                    {entry.author?.name ?? "(unknown)"}
                    {isMine && (
                      <span className="ml-1 px-1 py-0.5 rounded bg-primary/10 text-primary text-[9px] uppercase tracking-wide">
                        you
                      </span>
                    )}
                  </span>
                  <span className="opacity-50">·</span>
                  <span>{formatDate(entry.updated_at)}</span>
                </div>
                <div className="flex items-center justify-between gap-2 mt-1">
                  <span className="text-[10px] text-muted-foreground/70">
                    {entry.type}
                    {entry.type === "knowledge" &&
                    typeof (entry.extra as Record<string, unknown> | undefined)?.wikiKind === "string"
                      ? ` · ${(entry.extra as Record<string, unknown>).wikiKind as string}`
                      : ""}
                    {entry.version && entry.version > 1 ? ` · v${entry.version}` : ""}
                  </span>
                  <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                    <button
                      onClick={() => copyCitationLink(entry)}
                      className="px-2 py-1 text-[11px] rounded border border-border hover:bg-muted text-foreground transition-colors flex items-center gap-1"
                      title={t("share.copyCitation")}
                    >
                      {copiedId === entry.id ? (
                        <Check size={11} className="text-emerald-600" />
                      ) : (
                        <Link2 size={11} />
                      )}
                    </button>
                    {!isMine && isForkable(entry.type) && (
                      <button
                        onClick={() => handleFork(entry)}
                        disabled={isBusy}
                        className="px-2 py-1 text-[11px] rounded border border-border hover:bg-muted text-foreground transition-colors flex items-center gap-1 disabled:opacity-50"
                        title={entry.type === "knowledge" ? "Fork to my knowledge" : "Fork to my notes"}
                      >
                        <GitFork size={11} />
                        Fork
                      </button>
                    )}
                    {isMine && (
                      <button
                        onClick={() => handleUnshare(entry)}
                        disabled={isBusy}
                        className="px-2 py-1 text-[11px] rounded border border-border hover:bg-destructive/10 hover:border-destructive/50 hover:text-destructive transition-colors flex items-center gap-1 disabled:opacity-50"
                        title="Unshare (tombstone)"
                      >
                        <Trash2 size={11} />
                        Unshare
                      </button>
                    )}
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* 詳細パネル（一覧と並置。fixed オーバーレイにしない）。
          key remount でエントリ切替時の body / プレビュー残留を防ぐ
          （SidePeek のノート切替と同じ作法） */}
      {selected && (
        <SharedEntryDetail
          key={selected.id}
          entry={selected}
          isMine={
            !!currentIdentity &&
            selected.author?.email === currentIdentity.email
          }
          hashStatus={hashStatus[selected.id] ?? "unknown"}
          sharedRoot={sharedRoot}
          onVerifyHash={() => verifyHash(selected)}
          onFork={
            isForkable(selected.type)
              ? () => handleFork(selected)
              : undefined
          }
          onUnshare={() => handleUnshare(selected)}
          onClose={() => setSelected(null)}
        />
      )}
      </div>
    </div>
  );
}

function HashBadge({
  status,
  onClick,
}: {
  status: HashStatus;
  onClick: (e: React.MouseEvent) => void;
}) {
  if (status === "ok") {
    return (
      <span
        className="inline-flex items-center gap-0.5 text-[10px] text-emerald-700 dark:text-emerald-400"
        title="Hash verified"
      >
        <CheckCircle2 size={11} />
        ok
      </span>
    );
  }
  if (status === "mismatch") {
    return (
      <span
        className="inline-flex items-center gap-0.5 text-[10px] text-destructive"
        title="Hash mismatch — content may have been tampered with"
      >
        <AlertTriangle size={11} />
        mismatch
      </span>
    );
  }
  if (status === "verifying") {
    return (
      <span className="inline-flex items-center gap-0.5 text-[10px] text-muted-foreground">
        <RefreshCw size={11} className="animate-spin" />
      </span>
    );
  }
  if (status === "error") {
    return (
      <span
        className="inline-flex items-center gap-0.5 text-[10px] text-amber-600"
        title="Verification failed (read error)"
      >
        <AlertTriangle size={11} />
        ?
      </span>
    );
  }
  return (
    <button
      onClick={onClick}
      className="inline-flex items-center gap-0.5 text-[10px] text-muted-foreground hover:text-foreground"
      title="Verify hash"
    >
      <ShieldQuestion size={11} />
      verify
    </button>
  );
}

// ── 詳細パネル（read-only viewer） ──

type DetailProps = {
  entry: SharedEntry;
  isMine: boolean;
  hashStatus: HashStatus;
  sharedRoot: string;
  onVerifyHash: () => void;
  onFork?: () => void;
  onUnshare: () => void;
  onClose: () => void;
};

function SharedEntryDetail({
  entry,
  isMine,
  hashStatus,
  sharedRoot,
  onVerifyHash,
  onFork,
  onUnshare,
  onClose,
}: DetailProps) {
  const [body, setBody] = useState<string | null>(null);
  const [bodyError, setBodyError] = useState<string | null>(null);
  // 「引用リンクをコピー」の完了フィードバック（コンポーネントは entry ごとに
  // key remount されるため、ローカル state で持って問題ない）
  const [citationCopied, setCitationCopied] = useState(false);
  // 既存ノートのサイドピークと同じ幅設定を共有する（storage key 共通 = 幅の記憶も共通）
  const peekResize = useSidePeekWidth();

  // ESC で閉じる（オーバーレイの黒幕クリックを廃止した代替）
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const provider = new LocalFolderSharedProvider(sharedRoot);
        const { body: bytes } = await provider.read(entry.id);
        if (cancelled) return;
        const text = new TextDecoder().decode(bytes);
        setBody(text);
      } catch (e) {
        if (cancelled) return;
        setBodyError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [entry.id, sharedRoot]);

  const extra = (entry.extra ?? {}) as Record<string, unknown>;
  const title =
    typeof extra.title === "string" && extra.title.trim()
      ? extra.title
      : `(untitled ${entry.type})`;

  return (
    <div
      className="relative shrink-0 bg-background border-l border-border flex flex-col overflow-hidden"
      style={{ width: peekResize.widthStyle ?? "clamp(320px, 38vw, 480px)" }}
    >
      <ResizeHandle
        handleProps={peekResize.handleProps}
        isResizing={peekResize.isResizing}
        label={t("sidePeek.resizeHandle")}
      />
        {/* ヘッダー */}
        <div className="px-5 py-3 border-b border-border flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="text-[10px] text-muted-foreground/70">
              {entry.type}
              {entry.version && entry.version > 1 ? ` · v${entry.version}` : ""}
              {isMine && (
                <span className="ml-1.5 px-1 py-0.5 rounded bg-primary/10 text-primary normal-case">
                  yours
                </span>
              )}
            </div>
            <h2 className="text-base font-semibold text-foreground truncate mt-0.5">
              {title}
            </h2>
            <div className="text-xs text-muted-foreground mt-0.5 truncate">
              {entry.author?.name ?? "(unknown)"} · {entry.author?.email ?? ""}
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground"
            aria-label="Close"
          >
            <X size={16} />
          </button>
        </div>

        {/* メタ情報 */}
        <div className="px-5 py-3 border-b border-border text-xs space-y-1.5 bg-muted/20">
          <DetailRow label="ID" value={<span className="font-mono break-all">{entry.id}</span>} />
          <DetailRow label="Created" value={formatDate(entry.created_at)} />
          <DetailRow label="Updated" value={formatDate(entry.updated_at)} />
          <DetailRow
            label="Hash"
            value={
              <span className="flex items-center gap-2">
                <span className="font-mono text-[10px] truncate max-w-[260px]" title={entry.hash}>
                  {entry.hash.slice(0, 16)}…
                </span>
                <HashBadge
                  status={hashStatus}
                  onClick={(e) => {
                    e.stopPropagation();
                    onVerifyHash();
                  }}
                />
              </span>
            }
          />
          {entry.prov.derived_from.length > 0 && (
            <DetailRow
              label="Derived from"
              value={
                <ul className="list-disc list-inside">
                  {entry.prov.derived_from.map((id) => (
                    <li key={id} className="font-mono text-[10px] truncate">
                      {id}
                    </li>
                  ))}
                </ul>
              }
            />
          )}
        </div>

        {/* type 別 read-only コンテンツ */}
        <div className="flex-1 overflow-auto px-5 py-4">
          <SharedEntryBody entry={entry} body={body} bodyError={bodyError} />
        </div>

        {/* フッターアクション */}
        <div className="px-5 py-3 border-t border-border flex items-center justify-between gap-2">
          <div className="text-xs text-muted-foreground">
            {isMine
              ? t("share.updateHint")
              : t("share.readOnlyOthers")}
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => {
                void navigator.clipboard?.writeText(buildSharedCitationLink(entry.id));
                setCitationCopied(true);
                window.setTimeout(() => setCitationCopied(false), 1500);
              }}
              className="px-3 py-1.5 text-xs rounded border border-border hover:bg-muted text-foreground transition-colors flex items-center gap-1"
              title={t("share.copyCitationHint")}
            >
              {citationCopied ? (
                <Check size={12} className="text-emerald-600" />
              ) : (
                <Link2 size={12} />
              )}
              {citationCopied ? t("share.copied") : t("share.copyCitation")}
            </button>
            {onFork && !isMine && (
              <button
                onClick={onFork}
                className="px-3 py-1.5 text-xs rounded border border-border hover:bg-muted text-foreground transition-colors flex items-center gap-1"
              >
                <GitFork size={12} />
                {entry.type === "knowledge" ? "Fork to my knowledge" : "Fork to my notes"}
              </button>
            )}
            {isMine && (
              <button
                onClick={onUnshare}
                className="px-3 py-1.5 text-xs rounded border border-border hover:bg-destructive/10 hover:border-destructive/50 hover:text-destructive transition-colors flex items-center gap-1"
              >
                <Trash2 size={12} />
                Unshare
              </button>
            )}
          </div>
        </div>
    </div>
  );
}

function DetailRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-start gap-3">
      <span className="text-muted-foreground w-20 shrink-0">{label}</span>
      <div className="flex-1 min-w-0 text-foreground">{value}</div>
    </div>
  );
}

function SharedEntryBody({
  entry,
  body,
  bodyError,
}: {
  entry: SharedEntry;
  body: string | null;
  bodyError: string | null;
}) {
  if (bodyError) {
    return (
      <div className="text-xs text-destructive flex items-center gap-2">
        <AlertTriangle size={14} />
        Failed to load body: {bodyError}
      </div>
    );
  }
  if (body === null) {
    return <div className="text-xs text-muted-foreground">Loading…</div>;
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

  if (entry.type === "note" || entry.type === "knowledge") {
    // body は GraphiumDocument JSON。読み取り専用エディタでフル内容を表示する
    return <SharedNotePreview body={body} />;
  }

  // template / report はテキスト系として中身をそのまま表示
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

export function SharedNotePreview({ body }: { body: string }) {
  const [state, setState] = useState<NotePreviewState>({ phase: "loading" });

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
            content: [{ type: "text", text: page.title || `Page ${i + 1}`, styles: {} }],
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
        <div className="text-xs text-muted-foreground">MIME: {mime}</div>
      )}
      {original && (
        <div className="text-xs text-muted-foreground">
          Original filename: {original}
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
            {loading ? "Loading…" : "Preparing…"}
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
            {loading ? "Loading…" : "Click to load PDF preview"}
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
            {loading ? "Loading…" : "Click to load video"}
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
            {loading ? "Loading…" : "Click to load audio"}
          </button>
        )
      ) : (
        <div className="p-3 text-xs text-muted-foreground">
          (No inline preview for this file type)
        </div>
      )}

      {/* meta */}
      <div className="p-2 text-xs space-y-0.5 border-t border-border">
        <div className="font-mono break-all">{blob.uri}</div>
        <div className="text-muted-foreground">
          {blob.size} bytes ·{" "}
          <span className="font-mono">{blob.hash.slice(0, 16)}…</span>
        </div>
      </div>
    </div>
  );
}
