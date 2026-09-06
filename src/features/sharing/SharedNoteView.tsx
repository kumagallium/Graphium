// 共有エントリの全画面表示。個人のノートと同じ場所・同じ幅で読み取り専用に読む。
//
// なぜ詳細パネル（サイドピーク）と別に用意するか:
//   共有ノートは「ちらっと確認する」だけでなく「腰を据えて読む・コメントで返す」
//   対象でもある。個人のノートがサイドピークと全画面の両方を持つのと同じ鏡にして、
//   一覧からの入り方（クリック = サイドピーク / ダブルクリック = 全画面）を揃える。
//
// 守っていること:
//   - 読み取り専用。ここから共有フォルダの本文を書き換える口は持たない
//     （コメントだけは別エントリとして書ける）
//   - 見出し・メタ・操作・履歴・逆引き・段落の指定は詳細パネルと同じ部品を使う
//     （shared-entry-parts / use-shared-preview-anchor）。二重に持たない
//   - 右レールは個人のノートの右レールと同じ作り（アイコン縦列 + 幅可変パネル）
//
// 設計詳細: docs/internal/team-shared-storage-design.md §22 B

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { History, Link2, MessageSquare, Waypoints, X } from "lucide-react";
import type { AuthorIdentity } from "../document-provenance/types";
import {
  LocalFolderSharedProvider,
  type BlobRef,
  type SharedEntry,
} from "../../lib/storage/shared";
import { Breadcrumb } from "../../components/Breadcrumb";
import { ResizeHandle } from "../../components/ResizeHandle";
import { useResizableWidth } from "../../hooks/use-resizable-width";
import { formatDate } from "../../lib/format-datetime";
import { useT } from "../../i18n";
import { StepFlowView } from "../network-graph/step-flow-view";
import { SharedEntryComments } from "./SharedEntryComments";
import {
  SharedEntryBody,
  useSharedEntryBodyText,
  type SharedEntryBodyReader,
} from "./SharedEntryBody";
import {
  ReverseLinksSection,
  SharedEntryActions,
  SharedEntryHistory,
  SharedEntryMeta,
  sharedEntryTitle,
  sharedEntryTypeLabel,
} from "./shared-entry-parts";
import { useSharedPreviewAnchor } from "./use-shared-preview-anchor";
import { useSharedLibrary } from "./shared-library-store";
import {
  buildReverseLinks,
  useSharedProjection,
  type SharedProjection,
} from "./shared-projection";
import { countCommentsFor } from "./shared-comments";
import {
  isUpdatedSince,
  markSeen,
  newCommentCount,
  readSeenStore,
} from "./shared-seen";
import { type HashStatus } from "./hash-badge";

/** 右レールに出すパネル。既定はコメント（読んですぐ返せる状態で開く） */
export type SharedNoteRailTab = "comments" | "version" | "process" | "links";
type RailTab = SharedNoteRailTab;

// 全画面の右パネルは本文を読みながら使うので、サイドピーク（共有の幅記憶）とは
// 別のキーで覚える。既定はサイドピークより細い（本文の幅を優先する）
const RAIL_WIDTH_STORAGE_KEY = "graphium-shared-note-panel-width";
const RAIL_MIN_WIDTH = 280;
const RAIL_MAX_WIDTH = 640;
/** 本文側に最低限残す幅 px（use-resizable-width の containerReserve と同じ意味） */
const RAIL_CONTAINER_RESERVE = 360;

export type SharedNoteViewProps = {
  entry: SharedEntry;
  /** 現在のユーザー identity（未登録時は null）。自分作の判定とコメント投稿に使う */
  currentIdentity: AuthorIdentity | null;
  /** Settings の shared root path（コメントの書き込み先・hash 検証に使う） */
  sharedRoot: string;
  /** パンくず「ライブラリ」から一覧へ戻る */
  onBack: () => void;
  /** 逆引きの行から別の共有エントリへ移る */
  onOpenEntry?: (id: string) => void;
  onForkNote: (sharedId: string) => Promise<void>;
  onForkKnowledge: (sharedId: string) => Promise<void>;
  onUnshare: (entry: SharedEntry) => Promise<void>;
  /** テンプレートから新規ノート（未指定なら操作を出さない） */
  onCreateNoteFromTemplate?: (sharedId: string) => Promise<void>;
  /**
   * 共有ノート内の画像・ファイルを自分の素材として取り込む。
   * 全画面では取り込みの導線を持たない（一覧の素材タブが担当）が、
   * 呼び出し側が Library と同じ props 一式を渡せるよう受け口だけ揃えておく。
   */
  onImportBlob?: (parent: SharedEntry, blob: BlobRef) => Promise<void>;
  /** DI: 本文の取り寄せ（既定は共有ストア経由） */
  readEntryBody?: SharedEntryBodyReader;
  /** DI: 共有エントリ一覧（コメント封筒・逆引きの題名に使う。既定は共有ストア） */
  entries?: readonly SharedEntry[];
  /** DI: 共有ノートの投影（プロセス・逆引きの元。既定は投影ストア） */
  projection?: SharedProjection;
  /** 既読を記録したことの通知（一覧の印を消すため） */
  onSeenRecorded?: () => void;
  /**
   * 最初に開いておく右パネル（既定はコメント）。実アプリでは指定しない
   * —— Storybook / テストで各パネルを直接描くための入口。
   */
  initialRailTab?: RailTab;
};

export function SharedNoteView({
  entry,
  currentIdentity,
  sharedRoot,
  onBack,
  onOpenEntry,
  onForkNote,
  onForkKnowledge,
  onUnshare,
  onCreateNoteFromTemplate,
  readEntryBody,
  entries,
  projection,
  onSeenRecorded,
  initialRailTab = "comments",
}: SharedNoteViewProps) {
  const uiT = useT();
  const [railTab, setRailTab] = useState<RailTab | null>(initialRailTab);
  const [hashStatus, setHashStatus] = useState<HashStatus>("unknown");
  const [busy, setBusy] = useState(false);

  const { body, bodyError } = useSharedEntryBodyText(entry, readEntryBody);
  const preview = useSharedPreviewAnchor(entry.type);
  const railResize = useResizableWidth({
    storageKey: RAIL_WIDTH_STORAGE_KEY,
    min: RAIL_MIN_WIDTH,
    max: RAIL_MAX_WIDTH,
    containerReserve: RAIL_CONTAINER_RESERVE,
  });

  const snapshot = useSharedLibrary();
  const allEntries = entries ?? snapshot.entries;
  const storeProjection = useSharedProjection();
  const activeProjection = projection ?? storeProjection;

  const title = sharedEntryTitle(entry, uiT);
  const isMine =
    !!currentIdentity && entry.author?.email === currentIdentity.email;

  // 「更新あり」「新着コメント N」は開いた瞬間の控えで判定する。
  // 下の markSeen が控えを進めてしまうので、進む前の値を握っておく
  const [seenAtOpen] = useState(() => readSeenStore());
  const commentTotal = useMemo(
    () => countCommentsFor(entry.id, allEntries),
    [entry.id, allEntries],
  );
  const wasUpdated = isUpdatedSince(entry, currentIdentity?.email ?? null, seenAtOpen);
  const newComments = newCommentCount(entry.id, commentTotal, seenAtOpen);

  // 開いた＝読んだ、とみなして控えを更新する（一覧の印を消す）。
  // 通知の関数は毎レンダー作り直されうるので条件に混ぜない
  const onSeenRecordedRef = useRef(onSeenRecorded);
  onSeenRecordedRef.current = onSeenRecorded;
  useEffect(() => {
    markSeen(entry.id, entry.hash, commentTotal);
    onSeenRecordedRef.current?.();
  }, [entry.id, entry.hash, commentTotal]);

  const verifyHash = useCallback(async () => {
    setHashStatus("verifying");
    try {
      const provider = new LocalFolderSharedProvider(sharedRoot);
      setHashStatus((await provider.verifyHash(entry.id)) ? "ok" : "mismatch");
    } catch {
      setHashStatus("error");
    }
  }, [sharedRoot, entry.id]);

  // 失敗の通知は呼び出し元のハンドラが出す（Library の handleFork と同じ作法）
  const handleFork = useCallback(async () => {
    setBusy(true);
    try {
      if (entry.type === "knowledge") await onForkKnowledge(entry.id);
      else await onForkNote(entry.id);
    } catch {
      // 失敗表示は呼び出し元
    } finally {
      setBusy(false);
    }
  }, [entry.id, entry.type, onForkNote, onForkKnowledge]);

  const handleCreateFromTemplate = useCallback(async () => {
    if (!onCreateNoteFromTemplate) return;
    setBusy(true);
    try {
      await onCreateNoteFromTemplate(entry.id);
    } catch {
      // 失敗表示は呼び出し元
    } finally {
      setBusy(false);
    }
  }, [entry.id, onCreateNoteFromTemplate]);

  const handleUnshare = useCallback(async () => {
    const confirmed = window.confirm(
      uiT("library.unshareConfirm", { title }) +
        "\n\n" +
        uiT("share.unshareConfirmBody"),
    );
    if (!confirmed) return;
    setBusy(true);
    try {
      await onUnshare(entry);
    } finally {
      setBusy(false);
    }
  }, [entry, onUnshare, title, uiT]);

  const reverseLinks = useMemo(
    () => buildReverseLinks(activeProjection).get(entry.id),
    [activeProjection, entry.id],
  );
  const entryById = useMemo(() => {
    const map = new Map<string, SharedEntry>();
    for (const e of allEntries) map.set(e.id, e);
    return map;
  }, [allEntries]);
  const hasReverseLinks =
    (reverseLinks?.cites.length ?? 0) +
      (reverseLinks?.forks.length ?? 0) +
      (reverseLinks?.templates.length ?? 0) >
    0;

  // 手順は投影から引く（本文を読めた共有ノートにだけ載る）
  const processProjection = activeProjection.entries[entry.id] ?? null;
  const processGraph = processProjection?.process?.graph ?? null;
  // StepFlowView を作り直すための key。id だけだと、共有ノートが更新されて同じ id の
  // まま別の手順構成に入れ替わったときに同じインスタンスが再利用され、新旧のノードが
  // 混ざって ELK が走らないまま全ノードが原点に重なる（ProcessGalleryView と同じ罠）。
  // 投影は元にした hash を持っているので、それが変われば作り直す
  const processKey = `${entry.id}:${processProjection?.hash ?? entry.hash}`;

  const updateCount = entry.history?.length ?? 0;
  const railItems: { tab: RailTab; icon: React.ReactNode; label: string }[] = [
    { tab: "comments", icon: <MessageSquare size={18} />, label: uiT("panel.comments") },
    { tab: "version", icon: <History size={18} />, label: uiT("sharedNote.rail.version") },
    { tab: "process", icon: <Waypoints size={18} />, label: uiT("sharedNote.rail.process") },
    { tab: "links", icon: <Link2 size={18} />, label: uiT("sharedNote.rail.links") },
  ];
  const railTitle = railItems.find((i) => i.tab === railTab)?.label ?? "";

  return (
    <div className="flex-1 flex overflow-hidden" data-testid="shared-note-view">
      {/* 左: ヘッダ + 本文 */}
      <div className="flex-1 min-w-0 flex flex-col overflow-hidden">
        <div className="px-6 py-4 border-b border-border bg-background shrink-0">
          <Breadcrumb
            items={[
              { label: uiT("sidebar.library"), onClick: onBack },
              { label: uiT("sidebar.shared"), onClick: onBack },
              { label: title },
            ]}
          />
          <div className="mt-2 flex items-start justify-between gap-4">
            <div className="min-w-0 flex-1">
              <div className="text-[10px] text-muted-foreground/70">
                {sharedEntryTypeLabel(entry, uiT)}
                {isMine && (
                  <span className="ml-1.5 px-1 py-0.5 rounded bg-primary/10 text-primary normal-case">
                    {uiT("library.you")}
                  </span>
                )}
              </div>
              <h2 className="text-lg font-semibold text-foreground mt-0.5 flex items-center gap-2 min-w-0">
                <span className="truncate">{title}</span>
                {wasUpdated && (
                  <span
                    className="px-1 py-0.5 rounded bg-amber-500/10 text-amber-700 dark:text-amber-400 text-[9px] shrink-0"
                    title={uiT("comment.updatedBadgeHint")}
                  >
                    {uiT("comment.updatedBadge")}
                  </span>
                )}
                {newComments > 0 && (
                  <span
                    className="px-1 py-0.5 rounded bg-primary/10 text-primary text-[9px] tabular-nums shrink-0"
                    title={uiT("comment.newBadgeHint")}
                  >
                    {uiT("comment.newBadge", { count: String(newComments) })}
                  </span>
                )}
              </h2>
              <div className="text-xs text-muted-foreground mt-0.5 truncate">
                {entry.author?.name ?? uiT("library.unknownAuthor")}
                {entry.author?.email ? ` · ${entry.author.email}` : ""}
                {" · "}
                {formatDate(entry.updated_at)}
                {` · v${entry.version ?? 1}`}
                {updateCount > 0
                  ? ` · ${uiT("library.updateCount", { count: String(updateCount) })}`
                  : ""}
              </div>
            </div>
            {/* 操作は詳細パネルと同じ部品（出し分けの条件を二重に持たない） */}
            <div className={busy ? "opacity-50 pointer-events-none shrink-0" : "shrink-0"}>
              <SharedEntryActions
                entry={entry}
                isMine={isMine}
                onFork={
                  entry.type === "note" || entry.type === "knowledge"
                    ? () => void handleFork()
                    : undefined
                }
                onCreateFromTemplate={
                  entry.type === "template" && onCreateNoteFromTemplate
                    ? () => void handleCreateFromTemplate()
                    : undefined
                }
                onUnshare={() => void handleUnshare()}
              />
            </div>
          </div>
        </div>

        {/* 本文（個人のノートと同じ本文カラム幅・同じ余白）。段落クリックでコメントの付け先を指定。
            余白の取り方も個人のノート（note-app.tsx の本文ペイン）に合わせる: 左右 24px・
            上下 16px は 828px の箱の「外側」で取り、箱の内側には足さない。828px は
            「本文テキスト 720px + .bn-editor の padding-inline 54px×2」で既に余白込みの
            数字なので、内側に px を足すと本文だけが個人のノートより狭くなる。 */}
        <div className="flex-1 overflow-auto px-6 py-4">
          <div
            className="mx-auto w-full max-w-[828px]"
            ref={preview.previewRef}
            data-preview-scope={preview.previewScopeId}
            data-testid="shared-note-body"
            onClick={preview.handlePreviewClick}
          >
            <SharedEntryBody
              entry={entry}
              body={body}
              bodyError={bodyError}
              onEditorReady={preview.handleEditorReady}
            />
          </div>
        </div>
      </div>

      {/* 右: 展開パネル（幅は覚える） */}
      {railTab && (
        <div
          // bg-muted は個人のノートの右パネル（note-app.tsx の rightTab）と同じトーン。
          // アイコン縦列（bg-muted/50）と合わせて「本文＝明るい、右レール＝少し沈む」を保つ
          className="relative shrink-0 border-l border-border bg-muted flex flex-col overflow-hidden"
          style={{ width: railResize.widthStyle ?? "clamp(280px, 26vw, 420px)" }}
          data-testid={`shared-note-panel-${railTab}`}
        >
          <ResizeHandle
            handleProps={railResize.handleProps}
            isResizing={railResize.isResizing}
            label={uiT("sidePeek.resizeHandle")}
          />
          <div className="px-3 py-2 border-b border-border flex items-center gap-2 shrink-0">
            <span className="text-xs font-bold tracking-wide text-foreground">{railTitle}</span>
            <button
              onClick={() => setRailTab(null)}
              className="ml-auto p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground"
              aria-label={uiT("common.close")}
            >
              <X size={14} />
            </button>
          </div>

          {railTab === "comments" && (
            <SharedEntryComments
              targetId={entry.id}
              targetHash={entry.hash}
              sharedRoot={sharedRoot}
              currentIdentity={currentIdentity}
              // 解決済み（DI 未指定なら共有ストア）の一覧を渡す。生の DI prop を渡すと
              // SharedEntryComments 側でもう一度 useSharedLibrary が走り、同じストアを
              // 2 本購読して更新のたびに二重で再計算することになる
              entries={allEntries}
              readBody={readEntryBody}
              anchorLabel={preview.anchorLabel}
              onJumpToBlock={preview.jumpToBlock}
              pendingAnchor={preview.pendingAnchor}
              onClearAnchor={preview.clearAnchor}
              onSeenRecorded={onSeenRecorded}
              layout="panel"
            />
          )}

          {railTab === "version" && (
            <div className="flex-1 overflow-auto px-4 py-3 space-y-4 text-xs">
              <div className="space-y-1.5">
                <SharedEntryMeta
                  entry={entry}
                  hashStatus={hashStatus}
                  onVerifyHash={() => void verifyHash()}
                />
              </div>
              <SharedEntryHistory entry={entry} />
            </div>
          )}

          {railTab === "process" && (
            <div className="flex-1 min-h-0 flex flex-col">
              {processGraph ? (
                // 読み取り専用（コールバックを渡さない ＝ P-3）。プロセス一覧の
                // 右ペインと同じ使い方にする
                <div className="flex-1 min-h-0">
                  <StepFlowView key={processKey} graph={processGraph} variant="preview" />
                </div>
              ) : (
                <div className="px-4 py-8 text-center text-xs text-muted-foreground">
                  {uiT("sharedNote.processEmpty")}
                </div>
              )}
            </div>
          )}

          {railTab === "links" && (
            <div className="flex-1 overflow-auto px-4 py-3">
              {hasReverseLinks ? (
                <ReverseLinksSection
                  links={reverseLinks}
                  entryTitleById={(id) => {
                    const hit = entryById.get(id);
                    return hit ? sharedEntryTitle(hit, uiT) : null;
                  }}
                  onOpenEntry={onOpenEntry}
                />
              ) : (
                // 「0 件」と断言しない: 元になるのは本文を読めた共有ノートの投影だけ
                <p className="text-xs text-muted-foreground leading-relaxed">
                  {uiT("sharedNote.backlinksEmpty")}
                </p>
              )}
            </div>
          )}
        </div>
      )}

      {/* 右端のアイコン縦列（個人のノートの右レールと同じ作り） */}
      <div className="shrink-0 w-10 border-l border-border bg-muted/50 flex flex-col items-center gap-1 py-2">
        {railItems.map((item) => (
          <button
            key={item.tab}
            onClick={() => setRailTab((prev) => (prev === item.tab ? null : item.tab))}
            title={item.label}
            aria-label={item.label}
            aria-pressed={railTab === item.tab}
            data-testid={`shared-note-rail-${item.tab}`}
            className={`w-8 h-8 flex items-center justify-center rounded-md transition-colors ${
              railTab === item.tab
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground hover:bg-background/50"
            }`}
          >
            {item.icon}
          </button>
        ))}
      </div>
    </div>
  );
}
