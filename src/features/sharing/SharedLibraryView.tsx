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

import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, Library, Maximize2, RefreshCw, X } from "lucide-react";
import type { AuthorIdentity } from "../document-provenance/types";
import {
  LocalFolderSharedProvider,
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
import { SharedLabelsTab, SharedProjectionHint } from "./SharedLabelsTab";
import { ProcessGalleryView } from "../network-graph/ProcessGalleryView";
import { readSeenStore } from "./shared-seen";
import { useT } from "../../i18n";
import {
  SharedLibraryTable,
  type SharedLibraryTab,
} from "./SharedLibraryTable";
import { type HashStatus } from "./hash-badge";
// 全画面表示（SharedNoteView）と共用する部品。見た目・条件を二重に持たない
import { SharedEntryBody, useSharedEntryBodyText } from "./SharedEntryBody";
import {
  ReverseLinksSection,
  SharedEntryActions,
  SharedEntryHistory,
  SharedEntryMeta,
  sharedEntryTitle as entryTitle,
  sharedEntryTypeLabel as entryTypeLabel,
} from "./shared-entry-parts";
import { useSharedPreviewAnchor } from "./use-shared-preview-anchor";

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
  /**
   * 共有エントリを全画面（SharedNoteView）で開く。入り方は個人のノートの鏡で、
   * 表のダブルクリックと詳細パネル見出しの「開く」の 2 つ。
   * 未指定なら「開く」を出さない（全画面を持たない環境・Storybook の既定）。
   * ラベル / プロセスタブからの「ノートを開く」は従来どおりサイドピークのまま。
   */
  onOpenFull?: (entry: SharedEntry) => void;
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

export function SharedLibraryView({
  sharedRoot,
  currentIdentity,
  onForkNote,
  onForkKnowledge,
  onCreateNoteFromTemplate,
  onUnshare,
  onBack,
  onOpenFull,
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
            onOpenFull={onOpenFull}
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
          onOpenFull={onOpenFull ? () => onOpenFull(selected) : undefined}
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
  /** 全画面（SharedNoteView）へ昇格。渡されたときだけ見出しに「開く」を出す */
  onOpenFull?: () => void;
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
  onOpenFull,
  onClose,
}: DetailProps) {
  const uiT = useT();
  // 本文の取り寄せ・段落の指定は全画面表示（SharedNoteView）と同じ実装を使う
  const { body, bodyError } = useSharedEntryBodyText(entry, readEntryBody);
  const preview = useSharedPreviewAnchor(entry.type);
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

  const title = entryTitle(entry, uiT);

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
          {/* ナビゲーション（全画面 / 閉じる）は素材のサイドピークと同じく見出しの右に並べる */}
          <div className="flex items-center gap-0.5 shrink-0">
            {onOpenFull && (
              <button
                onClick={onOpenFull}
                className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground"
                title={uiT("library.openFull")}
                aria-label={uiT("library.openFull")}
                data-testid="shared-detail-open-full"
              >
                <Maximize2 size={14} />
              </button>
            )}
            <button
              onClick={onClose}
              className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground"
              aria-label={uiT("common.close")}
            >
              <X size={16} />
            </button>
          </div>
        </div>

        {/* メタ情報 */}
        <div className="px-5 py-3 border-b border-border text-xs space-y-1.5 bg-muted/20">
          <SharedEntryMeta entry={entry} hashStatus={hashStatus} onVerifyHash={onVerifyHash} />
        </div>

        {/* type 別 read-only コンテンツ + 往復（履歴・逆引き・コメント） */}
        <div className="flex-1 overflow-auto px-5 py-4 space-y-4">
          {/* プレビューのクリックで「この段落に」付ける指定を作る */}
          <div
            ref={preview.previewRef}
            data-preview-scope={preview.previewScopeId}
            onClick={preview.handlePreviewClick}
          >
            <SharedEntryBody
              entry={entry}
              body={body}
              bodyError={bodyError}
              onEditorReady={preview.handleEditorReady}
            />
          </div>

          <SharedEntryHistory entry={entry} />

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
          anchorLabel={preview.anchorLabel}
          onJumpToBlock={preview.jumpToBlock}
          pendingAnchor={preview.pendingAnchor}
          onClearAnchor={preview.clearAnchor}
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
          <SharedEntryActions
            entry={entry}
            isMine={isMine}
            onFork={onFork}
            onCreateFromTemplate={onCreateFromTemplate}
            onUnshare={onUnshare}
          />
        </div>
    </div>
  );
}
