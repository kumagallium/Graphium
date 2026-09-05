// Shared Library — 左ナビ「Library > Shared」から開くメインビュー（Phase 2c）。
//
// 表示:
// - shared root から 6 種類の SharedEntry を読み出し、3 つの表示タブ
//   （note / knowledge / asset）に集約して表形式（NoteListView と同じ型）で出す。
//   asset タブは reference + data-manifest を合算する。
// - 表の行クリックで読み取り専用の詳細パネルを開く
// - 自分作 → Update 動線（ヒントのみ）/ Unshare ボタン
// - 他人作（type=note / knowledge）→ Fork ボタン（note → notes、knowledge → wiki）
//
// 設計詳細: docs/internal/team-shared-storage-design.md §3 Library / §8 共有 Concept

import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  Check,
  ExternalLink,
  FilePlus2,
  GitFork,
  Library,
  Link2,
  RefreshCw,
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
import { type SharedLibraryLoadResult } from "./shared-library-loader";
import {
  groupSharedEntriesByType,
  readSharedEntryBody,
  refreshSharedLibrary,
  useSharedLibrary,
} from "./shared-library-store";
import { buildSharedCitationLink } from "./citation-link";
import {
  buildReverseLinks,
  buildSharedProcessIndex,
  countProjectedLabelNotes,
  countProjectedProcessNotes,
  useSharedProjection,
  type SharedReverseLinks,
} from "./shared-projection";
import { SharedEntryComments } from "./SharedEntryComments";
import type { SharedCommentAnchor } from "./SharedCommentsThread";
// メモの ¶ チップと同じ関数で抜粋を作る（作成時と表示時の見え方を揃える）。
// features/mobile-capture の index はモバイル取り込みの UI まで引き込むため直接参照する
import { resolveMemoBlockLabel } from "../mobile-capture/block-label";
import { SharedLabelsTab, SharedProjectionHint } from "./SharedLabelsTab";
import { ProcessGalleryView } from "../network-graph/ProcessGalleryView";
import {
  collectSharedBlobHashes,
  rewriteSharedBlobUrls,
} from "./materialize-blobs";
import { readSeenStore } from "./shared-seen";
import { formatDate } from "../../lib/format-datetime";
import { t, useT } from "../../i18n";
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
import {
  SharedLibraryTable,
  type SharedLibraryTab,
} from "./SharedLibraryTable";
import { HashBadge, type HashStatus } from "./hash-badge";

type Props = {
  /** Settings の shared root path */
  sharedRoot: string;
  /** 現在のユーザー identity（未登録時は null）。author 一致判定に使う */
  currentIdentity: AuthorIdentity | null;
  /** ノートの fork 実行（呼び出し側で新規ノートを作成して開く） */
  onForkNote: (sharedId: string) => Promise<void>;
  /** Knowledge の fork 実行（呼び出し側で新規 Wiki ページを作成して開く） */
  onForkKnowledge: (sharedId: string) => Promise<void>;
  /**
   * 共有テンプレートから新規ノートを作る（誰の作でも実行できる）。
   * fork と違い「記録のコピー」ではなく「雛形からの新規」なので導線を分ける。
   * 未指定ならテンプレートの操作を出さない（デスクトップ以外・共有ルート未設定）。
   */
  onCreateNoteFromTemplate?: (sharedId: string) => Promise<void>;
  /** 自分作ノートの Unshare（成功時はリストを再読み込み） */
  onUnshare: (entry: SharedEntry) => Promise<void>;
  onBack: () => void;
  /** 引用カードの「開く」から特定エントリを選択表示で開く（consume 後に onFocusConsumed） */
  focusEntryId?: string | null;
  onFocusConsumed?: () => void;
  /**
   * エントリ読み込み。既定は共有ストア（shared-library-store）で、
   * 指定するとストアを使わずこちらから読む（Storybook のモック用 DI）。
   */
  loadEntries?: (root: string) => Promise<SharedLibraryLoadResult>;
  /**
   * 詳細パネルが読む本文（ノート本文とコメント本文の両方）。既定は共有ストア
   * （readSharedEntryBody）。共有フォルダを読めない場所（Storybook / テスト）で
   * 差し替える。entry.type で中身を出し分ける想定。
   */
  readEntryBody?: (
    entry: SharedEntry,
  ) => Promise<{ body: Uint8Array; verified: boolean }>;
  /** 初期表示タブ（既定 "note"） */
  initialTab?: SharedLibraryTab;
  /**
   * 共有ノート内の画像・ファイル（extra.blobs）を自分の素材として取り込む。
   * blob root 未設定などで取り込めない環境では未指定にする（操作を出さない）。
   */
  onImportBlob?: (parent: SharedEntry, blob: BlobRef) => Promise<void>;
  /**
   * ラベル / プロセスタブの説明バーから個人のノート一覧へ移動する。
   * これらのタブは共有ノートの本文からの投影で、専用の共有操作を持たない
   * （ノートを共有すれば増える）。その導線がここしか無いので案内を出す。
   * 未指定なら説明バーのボタンを出さない。
   */
  onOpenNoteList?: () => void;
};

// 共有導線（Share ボタン）が実装されている type のみ表示タブに出す。
// report は SharedEntryType としては予約されており
// データ層は読み書きできるが、UI に「Share」エントリポイントが整うまで非表示。
// asset タブは reference + data-manifest を合算する（利用者からは「素材」1 種に見える）。
const TAB_ORDER: { tab: SharedLibraryTab; labelKey: string; types: SharedEntryType[] }[] = [
  { tab: "note", labelKey: "library.tab.note", types: ["note"] },
  { tab: "knowledge", labelKey: "library.tab.knowledge", types: ["knowledge"] },
  { tab: "asset", labelKey: "library.tab.asset", types: ["reference", "data-manifest"] },
  // ラベル / プロセスは共有ノートの投影から描くタブ。エントリ種別を持たないので
  // types は空にする（entriesByTab / activeErrors の対象外になる）。
  // 並びは個人側の左ナビ（素材 → ラベル → プロセス）の鏡にする。
  { tab: "labels", labelKey: "library.tab.labels", types: [] },
  { tab: "process", labelKey: "library.tab.process", types: [] },
  // テンプレートは「記録」ではなく雛形なので、記録系（ノート〜プロセス）の後ろに置く
  { tab: "template", labelKey: "library.tab.template", types: ["template"] },
];

function typeToTab(type: SharedEntryType): SharedLibraryTab | null {
  const hit = TAB_ORDER.find((t) => t.types.includes(type));
  return hit?.tab ?? null;
}

/** fork 導線を持つ type（fork 先: note → notes、knowledge → wiki） */
function isForkable(type: SharedEntryType): boolean {
  return type === "note" || type === "knowledge";
}

function entryTitle(entry: SharedEntry, translate: (k: string) => string): string {
  const title = (entry.extra as Record<string, unknown> | undefined)?.title;
  if (typeof title === "string" && title.trim()) return title;
  return translate("library.untitled");
}

/** 詳細パネルの type ラベル（note/knowledge はタブ名、reference/data-manifest は素材種別名） */
function entryTypeLabel(entry: SharedEntry, translate: (k: string, p?: Record<string, string>) => string): string {
  if (entry.type === "note") return translate("library.tab.note");
  if (entry.type === "knowledge") return translate("library.tab.knowledge");
  if (entry.type === "template") return translate("library.tab.template");
  if (entry.type === "reference") return translate("asset.type.url");
  if (entry.type === "data-manifest") {
    const mediaType = (entry.extra as Record<string, unknown> | undefined)?.media_type;
    return translate(`asset.type.${typeof mediaType === "string" ? mediaType : "other"}`);
  }
  return entry.type;
}

export function SharedLibraryView({
  sharedRoot,
  currentIdentity,
  onForkNote,
  onForkKnowledge,
  onCreateNoteFromTemplate,
  onUnshare,
  onBack,
  focusEntryId,
  onFocusConsumed,
  loadEntries,
  readEntryBody,
  initialTab = "note",
  onImportBlob,
  onOpenNoteList,
}: Props) {
  const uiT = useT();
  const [activeTab, setActiveTab] = useState<SharedLibraryTab>(initialTab);
  // 共有ストア（既定の読み出し経路）。loadEntries が渡されたときだけ下の DI 用 state を使う
  const shared = useSharedLibrary();
  const [diLoading, setDiLoading] = useState(false);
  const [diEntriesByType, setDiEntriesByType] = useState<
    Record<SharedEntryType, SharedEntry[]>
  >({
    note: [],
    reference: [],
    "data-manifest": [],
    template: [],
    knowledge: [],
    report: [],
    comment: [],
  });
  const [diLoadErrors, setDiLoadErrors] = useState<
    Partial<Record<SharedEntryType, string>>
  >({});
  const entriesByType = useMemo(
    () => (loadEntries ? diEntriesByType : groupSharedEntriesByType(shared.entries)),
    [loadEntries, diEntriesByType, shared.entries],
  );
  const loadErrors = loadEntries ? diLoadErrors : shared.errors;
  const loading = loadEntries ? diLoading : shared.loading;
  const [selected, setSelected] = useState<SharedEntry | null>(null);
  // 既読の控え（localStorage）を読み直す合図。詳細パネルが記録したら進める
  // —— これが無いと、開いた行の「新着」の印が次の再描画まで残る
  const [seenTick, setSeenTick] = useState(0);
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
    if (!loadEntries) {
      // 既定: 共有ストア経由（進行中の読み出しがあれば相乗りする）
      await refreshSharedLibrary();
      return;
    }
    setDiLoading(true);
    try {
      const result = await loadEntries(sharedRoot);
      setDiEntriesByType(result.entries);
      setDiLoadErrors(result.errors);
    } finally {
      setDiLoading(false);
    }
  }, [sharedRoot, loadEntries]);

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
        const tab = typeToTab(type as SharedEntryType);
        // タブを持たない type（report）は一覧から辿れないので、選択せず consume だけする
        if (tab) {
          setActiveTab(tab);
          setSelected(hit);
        }
        onFocusConsumed?.();
        return;
      }
    }
    // 全 type ロード後も見つからなければ consume だけする（削除済み等）
    if (!loading && Object.values(entriesByType).some((l) => l.length > 0)) {
      onFocusConsumed?.();
    }
  }, [focusEntryId, entriesByType, loading, onFocusConsumed]);

  // タブごとのエントリ（asset タブは reference + data-manifest を合算し updated_at 降順）
  const entriesByTab = useMemo<Record<SharedLibraryTab, SharedEntry[]>>(() => {
    const out = {} as Record<SharedLibraryTab, SharedEntry[]>;
    for (const { tab, types } of TAB_ORDER) {
      const merged = types.flatMap((type) => entriesByType[type]);
      merged.sort((a, b) => (b.updated_at ?? "").localeCompare(a.updated_at ?? ""));
      out[tab] = merged;
    }
    return out;
  }, [entriesByType]);

  // ラベル / プロセスは共有ノートの本文から投影した結果を見る（表の行ではない）
  const projection = useSharedProjection();
  const sharedNoteIds = useMemo(() => entriesByTab.note.map((e) => e.id), [entriesByTab]);

  // プロセスタブに渡す ProcessIndex。毎レンダーで作り直すと ProcessGalleryView 内の
  // フローが作り直されて重いので、投影が変わったときだけ組み立てる
  const sharedProcessIndex = useMemo(() => buildSharedProcessIndex(projection), [projection]);

  // 「更新あり」「新着コメント N」の判定に使う控え。localStorage 読み出しなので
  // 行ごとではなくここで 1 回だけ取り、記録されたら取り直す
  const seenSnapshot = useMemo(
    () => readSeenStore(),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [seenTick, entriesByType],
  );

  // 引用・派生・テンプレート利用の逆引き（投影から作る純関数の結果）。
  // 投影は本文を読めた共有ノートの分だけなので、読み込み前は少なく見える
  const reverseLinks = useMemo(() => buildReverseLinks(projection), [projection]);

  // 逆引きの行から相手のエントリを開く / 題名を出すための id 索引。
  // タブをまたいで探す（引用元がノートとは限らない）
  const entryById = useMemo(() => {
    const map = new Map<string, SharedEntry>();
    for (const list of Object.values(entriesByType)) {
      for (const e of list) map.set(e.id, e);
    }
    return map;
  }, [entriesByType]);

  const openEntryById = useCallback(
    (id: string) => {
      const hit = entryById.get(id);
      if (!hit) return;
      const tab = typeToTab(hit.type);
      if (tab) setActiveTab(tab);
      setSelected(hit);
    },
    [entryById],
  );

  // ラベル / プロセスの行から「ノートを開く」= 一覧の詳細パネルで開く。
  // 共有ノートは個人のノートとして開けないので、遷移先はここになる
  const openSharedNote = useCallback(
    (sharedId: string) => {
      const hit = entriesByTab.note.find((e) => e.id === sharedId);
      if (hit) setSelected(hit);
    },
    [entriesByTab],
  );

  // プロセスの「派生」は共有ノートの fork に倒す（fork 先は自分のノート）。
  // onForkNote は新ノート id を返さないが、null を返すと ProcessGalleryView が
  // 失敗表示になってしまうため、成功の印として共有 id を返す
  // （戻り値は成否判定にしか使われない。失敗は onForkNote が throw して伝える
  //  ＝ ProcessGalleryView 側の catch が失敗表示にする）
  const forkProcessNote = useCallback(
    async (sharedId: string): Promise<string | null> => {
      await onForkNote(sharedId);
      return sharedId;
    },
    [onForkNote],
  );

  const counts = useMemo(() => {
    const out = {} as Record<SharedLibraryTab, number>;
    for (const { tab } of TAB_ORDER) {
      out[tab] = entriesByTab[tab].length;
    }
    // 件数の意味が他タブと違う: ラベルを持つ共有ノート数 / 手順を持つ共有ノート数。
    // まだ本文を読めていないノートは 0 に見える（読めた分だけ増えていく）
    out.labels = countProjectedLabelNotes(projection, sharedNoteIds);
    out.process = countProjectedProcessNotes(projection, sharedNoteIds);
    return out;
  }, [entriesByTab, projection, sharedNoteIds]);

  // 素材タブに仮想行として並べる「共有ノート内の画像・ファイル」の親ノート。
  // 行の組み立ては SharedLibraryTable 側（後続担当）が行う
  const blobParents = useMemo(
    () =>
      entriesByTab.note.filter((entry) => {
        const blobs = (entry.extra as Record<string, unknown> | undefined)?.blobs;
        return Array.isArray(blobs) && blobs.length > 0;
      }),
    [entriesByTab],
  );

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
      } catch {
        // 失敗の通知は fork 側（呼び出し元のハンドラ）が出す。ここで投げ直すと
        // ボタンの onClick から未処理の rejection になるだけなので握る
      } finally {
        setBusyId(null);
      }
    },
    [onForkNote, onForkKnowledge],
  );

  // テンプレートから新規ノート。失敗の通知は呼び出し元のハンドラが出すので、
  // ここでは握って busy 表示だけ戻す（fork と同じ作法）
  const handleCreateFromTemplate = useCallback(
    async (entry: SharedEntry) => {
      if (!onCreateNoteFromTemplate) return;
      setBusyId(entry.id);
      try {
        await onCreateNoteFromTemplate(entry.id);
      } catch {
        // 失敗表示は呼び出し元
      } finally {
        setBusyId(null);
      }
    },
    [onCreateNoteFromTemplate],
  );

  const handleUnshare = useCallback(
    async (entry: SharedEntry) => {
      const confirmed = window.confirm(
        uiT("library.unshareConfirm", { title: entryTitle(entry, uiT) }) +
          "\n\n" +
          uiT("share.unshareConfirmBody"),
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
    [onUnshare, reload, uiT],
  );

  const activeEntries = entriesByTab[activeTab];
  // asset タブは 2 type を合算しているため、失敗した type のエラーをすべて並べて出す
  // （片方だけ出すと、もう片方の読み込み失敗がユーザーから見えなくなる）
  const activeErrors = (TAB_ORDER.find((t) => t.tab === activeTab)?.types ?? [])
    .map((type) => loadErrors[type])
    .filter((e): e is string => !!e);
  const activeError = activeErrors.length > 0 ? activeErrors.join(" / ") : undefined;

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* ヘッダー */}
      <div className="px-6 py-4 border-b border-border bg-background sticky top-0 z-10">
        <Breadcrumb
          items={[
            { label: uiT("sidebar.library"), onClick: onBack },
            { label: uiT("sidebar.shared") },
          ]}
        />
        <div className="mt-2 flex items-center justify-between gap-2">
          <h2 className="text-lg font-semibold text-foreground flex items-center gap-2">
            <Library size={18} className="text-muted-foreground" />
            {uiT("library.title")}
          </h2>
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground truncate max-w-[280px]" title={sharedRoot}>
              {sharedRoot}
            </span>
            <button
              onClick={reload}
              disabled={loading}
              className="p-1.5 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
              title={uiT("sidebar.refresh")}
            >
              <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
            </button>
          </div>
        </div>

        {/* タブ */}
        <div className="mt-3 flex gap-1 overflow-x-auto">
          {TAB_ORDER.map(({ tab, labelKey }) => {
            const isActive = activeTab === tab;
            const count = counts[tab];
            return (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={`px-3 py-1.5 text-xs rounded-md transition-colors whitespace-nowrap ${
                  isActive
                    ? "bg-primary/10 text-primary font-semibold"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground"
                }`}
              >
                {uiT(labelKey)}
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
      <div className="flex-1 min-w-0 overflow-hidden flex flex-col">
        {activeError && (
          <div className="m-3 p-3 rounded border border-destructive/30 bg-destructive/5 text-xs text-destructive flex items-center gap-2 shrink-0">
            <AlertTriangle size={14} />
            <span>{uiT("library.loadFailed", { error: activeError })}</span>
          </div>
        )}

        {activeTab === "labels" ? (
          <div
            className="flex-1 min-h-0 flex flex-col overflow-hidden"
            data-testid="shared-library-tab-labels"
          >
            <SharedLabelsTab
              projection={projection}
              entries={entriesByTab.note}
              onNavigateNote={openSharedNote}
              onOpenNoteList={onOpenNoteList}
            />
          </div>
        ) : activeTab === "process" ? (
          <div
            className="flex-1 min-h-0 flex flex-col overflow-hidden"
            data-testid="shared-library-tab-process"
          >
            {/* ラベルタブと同じ説明バー（共有操作が無いことの説明はここでも同じ） */}
            <SharedProjectionHint
              text={uiT("library.processHint")}
              onOpenNoteList={onOpenNoteList}
            />
            {sharedProcessIndex.processes.length === 0 ? (
              // 本文をまだ読めていない間もここに来る（読めた分から増えていく）ので、
              // 個人側の process.empty ではなく共有側の言い方にする
              <div className="flex-1 overflow-auto px-6 py-10 text-center text-xs text-muted-foreground">
                {uiT("library.empty.process")}
              </div>
            ) : (
              <ProcessGalleryView
                processIndex={sharedProcessIndex}
                hideBack
                onBack={onBack}
                forkLabel={uiT("library.forkToNotes")}
                onNavigateNote={openSharedNote}
                onForkProcess={forkProcessNote}
              />
            )}
          </div>
        ) : (
          <SharedLibraryTable
            // タブごとに語彙が違う種別フィルタや検索語を持ち越さないよう、タブ切替で表を作り直す
            key={activeTab}
            tab={activeTab}
            entries={activeEntries}
            currentIdentity={currentIdentity}
            hashStatus={hashStatus}
            selectedId={selected?.id ?? null}
            busyId={busyId}
            copiedId={copiedId}
            onSelect={setSelected}
            onVerifyHash={verifyHash}
            onCopyCitation={copyCitationLink}
            onFork={handleFork}
            onUnshare={handleUnshare}
            blobParents={activeTab === "asset" ? blobParents : undefined}
            onImportBlob={onImportBlob}
            // コメントは一覧タブに出さないが、行の「新着コメント N」には数が要る。
            // DI（Storybook）でも同じ経路で渡るよう、読み出し済みの封筒をそのまま渡す
            commentEntries={entriesByType.comment}
            seenStore={seenSnapshot}
          />
        )}
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
          currentIdentity={currentIdentity}
          commentEntries={entriesByType.comment}
          readEntryBody={readEntryBody}
          reverseLinks={reverseLinks.get(selected.id)}
          entryTitleById={(id) => {
            const hit = entryById.get(id);
            return hit ? entryTitle(hit, uiT) : null;
          }}
          onOpenEntry={openEntryById}
          onSeenRecorded={() => setSeenTick((v) => v + 1)}
          onVerifyHash={() => verifyHash(selected)}
          onFork={
            isForkable(selected.type)
              ? () => handleFork(selected)
              : undefined
          }
          onCreateFromTemplate={
            selected.type === "template" && onCreateNoteFromTemplate
              ? () => handleCreateFromTemplate(selected)
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

// ── 詳細パネル（read-only viewer） ──

type DetailProps = {
  entry: SharedEntry;
  isMine: boolean;
  hashStatus: HashStatus;
  sharedRoot: string;
  /** コメントの投稿者。未登録（null）ならコメント欄は案内文だけになる */
  currentIdentity: AuthorIdentity | null;
  /** 読み出し済みのコメント封筒（DI 経路でも同じものを見せる） */
  commentEntries?: readonly SharedEntry[];
  /** DI: 本文の取り寄せ（既定は共有ストア経由） */
  readEntryBody?: (
    entry: SharedEntry,
  ) => Promise<{ body: Uint8Array; verified: boolean }>;
  /** このエントリを指している共有ノート（引用・派生・テンプレート利用）。無ければ 0 件 */
  reverseLinks?: SharedReverseLinks;
  /** 逆引きの行に出す題名（読めていない / 消えた id は null） */
  entryTitleById?: (id: string) => string | null;
  /** 逆引きの行のクリックでそのエントリを開く */
  onOpenEntry?: (id: string) => void;
  /** コメント節が既読を記録したことの通知（一覧の印を消すため） */
  onSeenRecorded?: () => void;
  onVerifyHash: () => void;
  onFork?: () => void;
  /** テンプレートのときだけ渡る（自分作・他人作を問わず出す） */
  onCreateFromTemplate?: () => void;
  onUnshare: () => void;
  onClose: () => void;
};

function SharedEntryDetail({
  entry,
  isMine,
  hashStatus,
  sharedRoot,
  currentIdentity,
  commentEntries,
  readEntryBody,
  reverseLinks,
  entryTitleById,
  onOpenEntry,
  onSeenRecorded,
  onVerifyHash,
  onFork,
  onCreateFromTemplate,
  onUnshare,
  onClose,
}: DetailProps) {
  const uiT = useT();
  const [body, setBody] = useState<string | null>(null);
  const [bodyError, setBodyError] = useState<string | null>(null);
  // プレビュー（read-only エディタ）の DOM とエディタ実体。
  // 「段落に付ける」「該当ブロックへ飛ぶ」の両方でここを起点にする
  const previewRef = useRef<HTMLDivElement | null>(null);
  const previewEditorRef = useRef<any>(null);
  const highlightTimerRef = useRef<number | null>(null);
  const [pendingAnchor, setPendingAnchor] = useState<SharedCommentAnchor | null>(null);
  // 動的 <style> をこのパネルのプレビューだけに効かせるための目印。
  // ノート編集画面と同じ id 選択子を使うので、スコープを付けないと本文側の
  // 同じ id のブロックまで塗ってしまう
  const previewScopeId = useId();
  const previewStyleRef = useRef<HTMLStyleElement | null>(null);
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
        // 既定は共有ストア経由（本文は id|hash で LRU キャッシュされる。語彙索引が
        // 直前に読んでいれば I/O ゼロ）。DI 指定時はそちらから読む
        const { body: bytes } = await (readEntryBody ?? readSharedEntryBody)(entry);
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
  }, [entry, readEntryBody]);

  const title = entryTitle(entry, uiT);

  /** プレビュー内のブロック要素（詳細パネルの中だけを探す。本文側の同 id を掴まない） */
  const findBlockEl = useCallback((blockId: string): HTMLElement | null => {
    const root = previewRef.current;
    if (!root || !blockId) return null;
    const escaped =
      typeof CSS !== "undefined" && typeof CSS.escape === "function"
        ? CSS.escape(blockId)
        : blockId;
    return root.querySelector(
      `[data-id="${escaped}"][data-node-type="blockOuter"]`,
    ) as HTMLElement | null;
  }, []);

  /** 現在の本文からブロックの抜粋を出す（消えていれば付けた時点の控えに戻す） */
  const anchorLabel = useCallback((blockId: string, fallback: string): string => {
    try {
      const block = previewEditorRef.current?.getBlock?.(blockId);
      return resolveMemoBlockLabel(block) || fallback;
    } catch {
      // ブロックが消えている / エディタがまだ無い → 墓標（付けた時点の抜粋）
      return fallback;
    }
  }, []);

  /**
   * プレビューで段落を選ぶ = その段落にコメントを付ける指定。
   *
   * read-only のエディタではキャレットが立たない環境があるため、
   * まず DOM（blockOuter の data-id）から拾い、取れないときだけ
   * エディタのカーソル位置に頼る。
   */
  const handlePreviewClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      // 段落を持つのはノート / ナレッジのプレビューだけ（素材・URL には付けない）
      if (entry.type !== "note" && entry.type !== "knowledge") return;
      const target = e.target as HTMLElement | null;
      const el = target?.closest?.('[data-node-type="blockOuter"]') as HTMLElement | null;
      const blockId =
        el?.getAttribute("data-id") ??
        previewEditorRef.current?.getTextCursorPosition?.()?.block?.id ??
        null;
      if (!blockId) return;
      let label = "";
      try {
        label = resolveMemoBlockLabel(previewEditorRef.current?.getBlock?.(blockId));
      } catch {
        // 抜粋が取れなくてもブロックの指定自体は成立する
      }
      // 同じ段落をもう一度クリックしたら指定を外す（付け外しを同じ操作で行う）
      setPendingAnchor((prev) =>
        prev?.blockId === blockId ? null : { blockId, blockText: label },
      );
    },
    [entry.type],
  );

  /** コメントのカード / ¶ チップ → プレビューの該当ブロックへスクロール + 一時ハイライト */
  const jumpToBlock = useCallback(
    (blockId: string) => {
      const el = findBlockEl(blockId);
      if (!el) return;
      el.scrollIntoView({ behavior: "smooth", block: "center" });
      // ノート編集画面の highlightBlockIds と違い、ここは一時的な目印だけで足りる
      // （常時の印はエディタに出さない ＝ #587 の決定）
      el.style.transition = "background-color 0.2s ease";
      el.style.backgroundColor = "rgba(59, 130, 246, 0.12)";
      if (highlightTimerRef.current) window.clearTimeout(highlightTimerRef.current);
      highlightTimerRef.current = window.setTimeout(() => {
        el.style.backgroundColor = "";
        highlightTimerRef.current = null;
      }, 1600);
    },
    [findBlockEl],
  );

  useEffect(
    () => () => {
      if (highlightTimerRef.current) window.clearTimeout(highlightTimerRef.current);
    },
    [],
  );

  /**
   * 選んでいる段落の常時ハイライト（+ 段落が押せることを示す cursor / hover）。
   *
   * ノート編集画面の highlightBlockIds と同じ方式・同じ見た目にする
   * （動的 <style> でブロックの外枠に当てる）。エディタの DOM を直接いじると
   * BlockNote が持ち主の内容を描き直したときに消えるため、CSS 側で持つ。
   */
  const anchoredBlockId = pendingAnchor?.blockId ?? null;
  const previewClickable = entry.type === "note" || entry.type === "knowledge";
  useEffect(() => {
    const scope = `[data-preview-scope="${previewScopeId}"]`;
    const rules: string[] = [];
    if (previewClickable) {
      rules.push(
        `${scope} [data-node-type="blockOuter"] { cursor: pointer; }`,
        `${scope} [data-node-type="blockOuter"]:hover { background: rgba(59, 130, 246, 0.04); }`,
      );
    }
    if (anchoredBlockId) {
      const escaped =
        typeof CSS !== "undefined" && typeof CSS.escape === "function"
          ? CSS.escape(anchoredBlockId)
          : anchoredBlockId;
      rules.push(
        `${scope} [data-id="${escaped}"][data-node-type="blockOuter"] {
  background: rgba(59, 130, 246, 0.08);
  border-left: 2px solid rgba(59, 130, 246, 0.5);
  transition: background 0.2s ease;
}`,
      );
    }
    if (rules.length === 0) {
      previewStyleRef.current?.remove();
      previewStyleRef.current = null;
      return;
    }
    let styleEl = previewStyleRef.current;
    if (!styleEl) {
      styleEl = document.createElement("style");
      styleEl.dataset.sharedPreviewHighlight = previewScopeId;
      document.head.appendChild(styleEl);
      previewStyleRef.current = styleEl;
    }
    styleEl.textContent = rules.join("\n");
  }, [previewScopeId, previewClickable, anchoredBlockId]);

  // パネルを閉じたら <style> も片付ける（他のエントリを開くと key remount される）
  useEffect(
    () => () => {
      previewStyleRef.current?.remove();
      previewStyleRef.current = null;
    },
    [],
  );

  const history = entry.history ?? [];

  return (
    <div
      className="relative shrink-0 bg-background border-l border-border flex flex-col overflow-hidden"
      style={{ width: peekResize.widthStyle ?? "clamp(320px, 38vw, 480px)" }}
    >
      <ResizeHandle
        handleProps={peekResize.handleProps}
        isResizing={peekResize.isResizing}
        label={uiT("sidePeek.resizeHandle")}
      />
        {/* ヘッダー */}
        <div className="px-5 py-3 border-b border-border flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="text-[10px] text-muted-foreground/70">
              {entryTypeLabel(entry, uiT)}
              {entry.version && entry.version > 1 ? ` · v${entry.version}` : ""}
              {isMine && (
                <span className="ml-1.5 px-1 py-0.5 rounded bg-primary/10 text-primary normal-case">
                  {uiT("library.you")}
                </span>
              )}
            </div>
            <h2 className="text-base font-semibold text-foreground truncate mt-0.5">
              {title}
            </h2>
            <div className="text-xs text-muted-foreground mt-0.5 truncate">
              {entry.author?.name ?? uiT("library.unknownAuthor")} · {entry.author?.email ?? ""}
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground"
            aria-label={uiT("common.close")}
          >
            <X size={16} />
          </button>
        </div>

        {/* メタ情報 */}
        <div className="px-5 py-3 border-b border-border text-xs space-y-1.5 bg-muted/20">
          <DetailRow label={uiT("library.detail.id")} value={<span className="font-mono break-all">{entry.id}</span>} />
          <DetailRow label={uiT("library.detail.created")} value={formatDate(entry.created_at)} />
          <DetailRow label={uiT("library.detail.updated")} value={formatDate(entry.updated_at)} />
          <DetailRow
            label={uiT("library.detail.hash")}
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
              label={uiT("library.detail.derivedFrom")}
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

        {/* type 別 read-only コンテンツ + 往復（履歴・逆引き・コメント） */}
        <div className="flex-1 overflow-auto px-5 py-4 space-y-4">
          {/* プレビューのクリックで「この段落に」付ける指定を作る */}
          <div
            ref={previewRef}
            data-preview-scope={previewScopeId}
            onClick={handlePreviewClick}
          >
            <SharedEntryBody
              entry={entry}
              body={body}
              bodyError={bodyError}
              onEditorReady={(editor) => {
                previewEditorRef.current = editor;
              }}
            />
          </div>

          {history.length > 0 && (
            <section>
              <h3 className="text-xs font-semibold text-foreground mb-1.5">
                {uiT("library.detail.history")}
              </h3>
              <ul className="text-[11px] text-muted-foreground space-y-1">
                {/* 新しい順に見せる（メタ情報の「更新」の隣に続く読み方） */}
                {[...history].reverse().map((h, i) => (
                  <li key={`${h.hash}-${i}`} className="flex items-center gap-2">
                    <span className="tabular-nums whitespace-nowrap">
                      {formatDate(h.updated_at)}
                    </span>
                    <span className="truncate">
                      {h.updated_by?.name ?? uiT("library.unknownAuthor")}
                    </span>
                    <span className="font-mono text-[10px] shrink-0" title={h.hash}>
                      {h.hash.replace(/^sha256:/, "").slice(0, 8)}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          )}

          <ReverseLinksSection
            links={reverseLinks}
            entryTitleById={entryTitleById}
            onOpenEntry={onOpenEntry}
          />
        </div>

        {/* コメントのドック（スクロール領域の外・フッターの上）。
            上の方の段落を選んでから下まで戻らなくても書けるよう、常に手元に置く */}
        <SharedEntryComments
          targetId={entry.id}
          targetHash={entry.hash}
          sharedRoot={sharedRoot}
          currentIdentity={currentIdentity}
          entries={commentEntries}
          readBody={readEntryBody}
          anchorLabel={anchorLabel}
          onJumpToBlock={jumpToBlock}
          pendingAnchor={pendingAnchor}
          onClearAnchor={() => setPendingAnchor(null)}
          onSeenRecorded={onSeenRecorded}
          layout="docked"
        />

        {/* フッターアクション */}
        <div className="px-5 py-3 border-t border-border flex items-center justify-between gap-2">
          <div className="text-xs text-muted-foreground">
            {isMine
              ? uiT("share.updateHint")
              : uiT("share.readOnlyOthers")}
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => {
                void navigator.clipboard?.writeText(buildSharedCitationLink(entry.id));
                setCitationCopied(true);
                window.setTimeout(() => setCitationCopied(false), 1500);
              }}
              className="px-3 py-1.5 text-xs rounded border border-border hover:bg-muted text-foreground transition-colors flex items-center gap-1"
              title={uiT("share.copyCitationHint")}
            >
              {citationCopied ? (
                <Check size={12} className="text-emerald-600" />
              ) : (
                <Link2 size={12} />
              )}
              {citationCopied ? uiT("share.copied") : uiT("share.copyCitation")}
            </button>
            {onCreateFromTemplate && (
              <button
                onClick={onCreateFromTemplate}
                className="px-3 py-1.5 text-xs rounded border border-border hover:bg-muted text-foreground transition-colors flex items-center gap-1"
              >
                <FilePlus2 size={12} />
                {uiT("library.createFromTemplate")}
              </button>
            )}
            {onFork && !isMine && (
              <button
                onClick={onFork}
                className="px-3 py-1.5 text-xs rounded border border-border hover:bg-muted text-foreground transition-colors flex items-center gap-1"
              >
                <GitFork size={12} />
                {entry.type === "knowledge" ? uiT("library.forkToKnowledge") : uiT("library.forkToNotes")}
              </button>
            )}
            {isMine && (
              <button
                onClick={onUnshare}
                className="px-3 py-1.5 text-xs rounded border border-border hover:bg-destructive/10 hover:border-destructive/50 hover:text-destructive transition-colors flex items-center gap-1"
              >
                <Trash2 size={12} />
                {uiT("library.unshare")}
              </button>
            )}
          </div>
        </div>
    </div>
  );
}

/**
 * 逆引き（このエントリを指している共有ノート）。
 *
 * 元になるのは本文を読めた共有ノートの投影だけなので、読み込み前は少なく見える。
 * 0 件のときは何も出さない（「無い」と「まだ読めていない」を言い分けられないため、
 * 空の見出しを出して 0 件だと断言しない）。
 */
function ReverseLinksSection({
  links,
  entryTitleById,
  onOpenEntry,
}: {
  links?: SharedReverseLinks;
  entryTitleById?: (id: string) => string | null;
  onOpenEntry?: (id: string) => void;
}) {
  const uiT = useT();
  const groups: { labelKey: string; ids: string[] }[] = [
    { labelKey: "library.detail.citedBy", ids: links?.cites ?? [] },
    { labelKey: "library.detail.forkedBy", ids: links?.forks ?? [] },
    { labelKey: "library.detail.templateUsedBy", ids: links?.templates ?? [] },
  ].filter((g) => g.ids.length > 0);
  if (groups.length === 0) return null;

  return (
    <div className="space-y-2">
      {groups.map(({ labelKey, ids }) => (
        <section key={labelKey}>
          <h3 className="text-xs font-semibold text-foreground mb-1.5">
            {uiT(labelKey, { count: String(ids.length) })}
          </h3>
          <ul className="space-y-0.5">
            {ids.map((id) => {
              const title = entryTitleById?.(id) ?? null;
              return (
                <li key={id}>
                  <button
                    onClick={() => onOpenEntry?.(id)}
                    // 相手のエントリが一覧に無い（未読込・共有解除）ときは押せない
                    disabled={!title || !onOpenEntry}
                    className="text-[11px] text-left text-primary hover:underline disabled:text-muted-foreground disabled:no-underline truncate max-w-full"
                    title={id}
                  >
                    {title ?? id}
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
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
