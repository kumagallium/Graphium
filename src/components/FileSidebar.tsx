// ファイル一覧サイドバー

import { useMemo, type ReactNode } from "react";
import { Image, FileText, Table, Video, Volume2, Link, StickyNote, Bot, History, ShieldCheck, Wrench, PanelLeftClose, Sparkles, Trash2, Settings as SettingsIcon, Library, FilePlus, ArrowRight, Waypoints } from "lucide-react";
import { AiUpgradeNotice } from "./AiUpgradeNotice";
import { BackendStartingNotice, BackendUnavailableNotice } from "./BackendStatusNotice";
import { CollapsibleSection } from "./CollapsibleSection";
import { FolderTree } from "../features/note-context/FolderTree";
import { buildFolderTree, collectFolderSource, expandFolderToContextValues } from "../features/note-context/folder-tree-model";
import { isTauri } from "../lib/platform";
import type { WikiKind } from "../lib/document-types";
import { type RecentNote } from "../features/navigation";
import { useT, getDisplayLabelName } from "../i18n";
import type { MediaIndex, MediaType } from "../features/asset-browser";
import { countByType } from "../features/asset-browser";
import type { GraphiumIndex } from "../features/navigation/index-file";
import { NavBackButton } from "./NavBackButton";

export type FileSidebarProps = {
  activeFileId: string | null;
  onSelect: (fileId: string) => void;
  onNewNote: () => void;
  /** Quick Memo ダイアログを開く（思いつきを 1 行で書き留める入口） */
  onNewMemo?: () => void;
  /** ヘッダーの「戻る」操作（履歴を 1 段戻す）。canGoBack が false のときは非表示。 */
  onBack?: () => void;
  /** 戻れる履歴があるか。 */
  canGoBack?: boolean;
  onRefresh: () => void;
  onShowReleaseNotes: () => void;
  onShowSettings: () => void;
  agentConfigured: boolean;
  recentNotes: RecentNote[];
  onShowNoteList: () => void;
  /** ノート一覧画面がアクティブか（ハイライト用） */
  noteListActive?: boolean;
  /**
   * フォルダ（noteContexts のフォルダ見せ）— 選択中のフォルダ path。
   * 未分類は UNFILED_PATH（folder-tree-model）。null は非選択。
   */
  selectedFolder?: string | null;
  /**
   * フォルダクリック。contextValues はノート一覧の文脈フィルタにそのまま渡せる
   * 展開済みの値（親フォルダなら子フォルダの path も含む）。
   * 未指定ならフォルダセクション自体を表示しない。
   */
  onSelectFolder?: (path: string, contextValues: string[]) => void;
  /** 未分類（文脈なしノート）フォルダのクリック */
  onSelectUnfiledFolder?: () => void;
  /** ノート 0 件の空フォルダ定義（appdata 由来）。タグ由来のフォルダと名寄せで和集合表示 */
  emptyFolders?: readonly string[];
  /** 「＋ 新しいフォルダ」の確定。未指定なら作成行を出さない */
  onCreateFolder?: (path: string) => void;
  /** フォルダの右クリック（名前の変更・削除メニュー） */
  onFolderContextMenu?: (
    folder: { path: string; name: string; noteCount: number },
    position: { top: number; left: number },
  ) => void;
  mediaIndex: MediaIndex | null;
  onShowAssetGallery: (type: MediaType) => void;
  noteIndex: GraphiumIndex | null;
  /** 全ノードグラフ（全画面オーバーレイ）を開く */
  onShowGlobalGraph?: () => void;
  /** 全ノードグラフがアクティブか（ハイライト用） */
  globalGraphActive?: boolean;
  onShowLabelGallery: (label: string) => void;
  /** 現在アクティブなメディアタイプ（ハイライト用） */
  activeAssetType: MediaType | null;
  /** プロセス一覧を開く。手順を持つノートが 1 件以上あるときだけ渡す */
  onShowProcessGallery?: () => void;
  /** プロセス一覧を表示中か（ハイライト用） */
  processGalleryActive?: boolean;
  /** 手順を持つノートの件数 */
  processCount?: number;
  /** 現在アクティブなラベル（ハイライト用） */
  activeLabel: string | null;
  /** ファイル一覧の読み込み中フラグ */
  filesLoading?: boolean;
  /** メモの件数 */
  memoCount?: number;
  /** メモセクションクリック時 */
  onShowMemos?: () => void;
  /** メモセクションがアクティブか */
  memosActive?: boolean;
  /** モバイル受信箱の未処理件数（<root>/Inbox/ にある未取り込みファイルの数） */
  mobileCount?: number;
  /** モバイル受信箱クリック時。未指定なら見出しごと非表示（web モード） */
  onShowMobile?: () => void;
  /** モバイル受信箱ビューがアクティブか */
  mobileActive?: boolean;
  /** Wiki カテゴリ別カウント */
  wikiCounts?: { summary: number; claim: number; atom: number; synthesis: number };
  /**
   * Atom（洞察）レイヤをサイドバーに表示するか。
   * 2026-05-27 の design revision で Atom は default 表示に昇格したため、
   * このフラグは互換のために残しているが既定 true で扱われる。
   */
  showAtomLayer?: boolean;
  /** Wiki リスト表示 */
  onShowWikiList?: (kind: WikiKind) => void;
  /** 現在アクティブな Wiki カテゴリ（ハイライト用） */
  activeWikiKind?: WikiKind | null;
  /**
   * AI バックエンドが利用可能か。
   * `null` = まだ判定中（デスクトップ版の sidecar 起動待ち）。判定中と到達不可を
   * 区別しないと、起動直後の数秒だけ web 版向けの「デスクトップ版を入手」が
   * 出てしまう（2026-08-26）。false なら AI セクションの中身を案内に差し替える。
   */
  aiAvailable?: boolean | null;
  /** Wiki ログ表示 */
  onShowWikiLog?: () => void;
  /** Wiki ヘルスチェック表示 */
  onShowWikiLint?: () => void;
  /** Log/Lint がアクティブか */
  activeWikiView?: "log" | "lint" | null;
  /** Skill 件数 */
  skillCount?: number;
  /** Skill リスト表示 */
  onShowSkillList?: () => void;
  /** Skill セクションがアクティブか */
  skillActive?: boolean;
  /**
   * デスクトップでサイドバーを折り畳むハンドラ。
   * 渡されると右上に折り畳みボタンが表示される。モバイル Sheet では undefined のまま。
   */
  onCollapse?: () => void;
  /** ゴミ箱を開く */
  onShowTrash?: () => void;
  /** ゴミ箱がアクティブか */
  trashActive?: boolean;
  /** ゴミ箱内のノート数 */
  trashCount?: number;
  /**
   * Library > Shared を開く（Phase 2c）。
   * shared root が未設定なら呼び出し側で undefined を渡し、項目自体を非表示にする。
   */
  onShowSharedLibrary?: () => void;
  /** Shared Library がアクティブか */
  sharedLibraryActive?: boolean;
};

// ラベル色マッピング（NoteListView と同じ）
const LABEL_HEX: Record<string, string> = {
  procedure: "#5b8fb9",
  material: "#4B7A52",
  tool: "#c08b3e",
  attribute: "#c08b3e",
  // Output Entity は v3→v4 で "result" から改名。新キーが無いと色を失う
  output: "#c26356",
  result: "#c26356",
};

// メディアタイプ別のアイコンと表示順
// PDF は Documents タブに統合（FileText アイコンで表示）。PDF/Word/Excel 等を
// 「原本ファイル」として一括で扱うため、サイドバーに単独タブは置かない。
const MEDIA_NAV_ITEMS: { type: MediaType; icon: ReactNode }[] = [
  { type: "image", icon: <Image size={14} /> },
  { type: "document", icon: <FileText size={14} /> },
  // 装置の生データ（.csv / .dat 等）。読む物ではなく表にする物なので
  // Documents とは別の棚に置く
  { type: "data", icon: <Table size={14} /> },
  { type: "video", icon: <Video size={14} /> },
  { type: "audio", icon: <Volume2 size={14} /> },
  { type: "url", icon: <Link size={14} /> },
];

export function FileSidebar({
  activeFileId,
  onSelect,
  onNewNote,
  onNewMemo,
  onBack,
  canGoBack,
  onRefresh,
  onShowReleaseNotes,
  onShowSettings,
  agentConfigured,
  recentNotes,
  onShowNoteList,
  noteListActive = false,
  selectedFolder = null,
  onSelectFolder,
  onSelectUnfiledFolder,
  emptyFolders,
  onCreateFolder,
  onFolderContextMenu,
  mediaIndex,
  onShowAssetGallery,
  noteIndex,
  onShowGlobalGraph,
  globalGraphActive = false,
  onShowLabelGallery,
  activeAssetType,
  activeLabel,
  filesLoading = false,
  memoCount = 0,
  onShowMemos,
  memosActive = false,
  mobileCount = 0,
  onShowMobile,
  mobileActive = false,
  wikiCounts,
  // Atom レイヤは default で表示する（design revision 2026-05-27）。
  // 旧 showAtomLayer prop は互換のため受け取るが、内部では未使用。
  showAtomLayer: _showAtomLayer = true,
  onShowWikiList,
  activeWikiKind,
  aiAvailable = true,
  onShowWikiLog,
  onShowWikiLint,
  onShowProcessGallery,
  processGalleryActive,
  processCount = 0,
  activeWikiView,
  skillCount = 0,
  onShowSkillList,
  skillActive = false,
  onCollapse,
  onShowTrash,
  trashActive = false,
  trashCount = 0,
  onShowSharedLibrary,
  sharedLibraryActive = false,
}: FileSidebarProps) {
  const t = useT();
  const mediaCounts = mediaIndex ? countByType(mediaIndex) : null;

  // セクション右上に出す件数バッジの集計（メモは独立セクションに移したので含めない）
  const dataCount = useMemo(() => {
    if (!mediaCounts) return 0;
    return (mediaCounts.image ?? 0) + (mediaCounts.pdf ?? 0) + (mediaCounts.video ?? 0)
      + (mediaCounts.audio ?? 0) + (mediaCounts.url ?? 0);
  }, [mediaCounts]);

  // ノート見出し横に出す件数バッジ（人間が書いた active ノートのみ）
  // wiki/skill 派生は別カテゴリ、archive/trash は除外。
  const noteCount = useMemo(() => {
    if (!noteIndex) return 0;
    let n = 0;
    for (const note of noteIndex.notes) {
      if (note.wikiKind) continue;
      if (note.source === "skill") continue;
      if (note.deletedAt) continue;
      if (note.archivedAt) continue;
      n++;
    }
    return n;
  }, [noteIndex]);

  // フォルダ（noteContexts のフォルダ見せ）。集計規則は folder-tree-model に 1 本化してあり、
  // ノート一覧側（パンくずの親たどり）も同じものを使う
  const folderData = useMemo(
    () => collectFolderSource(noteIndex?.notes ?? []),
    [noteIndex],
  );
  // 親フォルダ選択時に子を含めた文脈フィルタへ展開するためのツリー
  // （FolderTree も内部で組むが軽い計算なので二重でよしとする）
  const folderTree = useMemo(
    () => buildFolderTree(folderData.folders, emptyFolders ?? []),
    [folderData.folders, emptyFolders],
  );
  // セクションヘッダの件数はフォルダ数（ラベルセクションが「種類数」を出す慣例に合わせる）
  const folderCount = useMemo(
    () => folderTree.reduce((sum, n) => sum + 1 + n.children.length, 0),
    [folderTree],
  );

  // Skill はフッターに移したのでカウントには含めない。
  // synthesis（発想）はサイドバーに表示しないため total にも含めない（design revision 2026-05-27）。
  const aiTotalCount = useMemo(() => {
    const w = wikiCounts;
    return (
      (w?.summary ?? 0) + (w?.claim ?? 0) + (w?.atom ?? 0)
    );
  }, [wikiCounts]);

  // ラベルカウント（ギャラリーの行数 = 同ラベル内のユニーク preview / text 数）
  // Phase D-3-α: インライン由来のハイライト text もユニーク集計に合流する。
  //   block-level: preview 文字列単位
  //   インライン: ハイライト text 単位（複数ノートにまたがる同一 text は 1 行に集約される）
  const labelCounts = useMemo(() => {
    if (!noteIndex) return new Map<string, number>();
    const keySets = new Map<string, Set<string>>();
    const ensure = (label: string): Set<string> => {
      let s = keySets.get(label);
      if (!s) { s = new Set(); keySets.set(label, s); }
      return s;
    };
    for (const note of noteIndex.notes) {
      for (const l of note.labels) {
        ensure(l.label).add(`block::${l.preview}`);
      }
      if (note.inlineLabels) {
        for (const il of note.inlineLabels) {
          ensure(il.label).add(`inline::${il.text}`);
        }
      }
      // step コンテナも「ステップ」ラベルとして一覧に出す。
      // ハイライトラベルだけ並んで工程が並ばないと、同じ来歴系の入口なのに
      // 片方しか辿れない非対称になる（v6 で procedure block ラベルは
      // step ブロックに変換され labels には現れない）。
      for (const s of note.steps ?? []) {
        ensure("procedure").add(`step::${s.text}`);
      }
    }
    const counts = new Map<string, number>();
    for (const [label, keys] of keySets) {
      counts.set(label, keys.size);
    }
    return counts;
  }, [noteIndex]);
  return (
    <aside className="w-full md:w-64 shrink-0 border-r border-sidebar-border bg-sidebar-background flex flex-col h-full">
      {/* ヘッダー */}
      <div className="p-4 border-b border-sidebar-border">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <img src={`${import.meta.env.BASE_URL}logo.png`} alt="" className="w-7 h-7" />
            <img src={`${import.meta.env.BASE_URL}logo-text.png`} alt="Graphium" className="h-[18px] mt-px" />
          </div>
          <div className="flex items-center gap-2">
            {onBack && (
              <NavBackButton onBack={onBack} canGoBack={canGoBack ?? false} />
            )}
            <button
              onClick={onRefresh}
              title={t("sidebar.refresh")}
              className="text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              &#8635;
            </button>
            {onCollapse && (
              <button
                onClick={onCollapse}
                title={t("sidebar.collapse")}
                className="text-muted-foreground hover:text-foreground transition-colors"
              >
                <PanelLeftClose size={14} />
              </button>
            )}
          </div>
        </div>
        {/* 入口は縦並びの対等な雙子ボタン:
            メモは「思いつきの原料」、ノートは「構造を持つ脳の中身」。
            ショートカットはメモ（⌘⇧M）のみ。実動作は metaKey/ctrlKey 両対応で Win/Linux でも反応する。
            ノートに ⌘⇧N を割り当てないのは、ブラウザの「新規シークレットウィンドウ」と衝突して
            preventDefault が効かないため。期待を裏切るより、サイドバーボタン経由に一本化する。
            「メモ=即速度、ノート=じっくり」の非対称さを UI でも素直に表現する。
            パディングは py-1.5 で抑えて、ロゴが視覚的なトップにくるようにヒエラルキーを保つ。 */}
        {onNewMemo && (
          <button
            onClick={onNewMemo}
            title={t("sidebar.newMemoTooltip")}
            className="w-full flex items-center justify-between rounded-lg px-3 py-1.5 mb-1 text-sm font-medium border border-sidebar-border text-sidebar-foreground/85 bg-transparent hover:bg-sidebar-accent hover:text-sidebar-foreground transition-colors"
          >
            <span>{t("sidebar.newMemo")}</span>
            {/* ⌘ ⇧ M を1つの塊で出すと ⇧ が埋もれて見落とされる（実際に「⌘M で効かない」と
                誤解された）。キーごとに keycap 化して分離し、Shift が要ることを一目で示す。
                背景は foreground tint なので、ボタン hover の sidebar-accent 上でも沈まない。 */}
            <span className="flex items-center gap-0.5 font-normal tabular-nums">
              {["⌘", "⇧", "M"].map((k) => (
                <kbd
                  key={k}
                  className="inline-flex min-w-[15px] justify-center rounded border border-sidebar-foreground/20 bg-sidebar-foreground/10 px-1 py-px text-[10px] leading-none text-sidebar-foreground/75"
                >
                  {k}
                </kbd>
              ))}
            </span>
          </button>
        )}
        <button
          onClick={onNewNote}
          title={t("sidebar.newNoteTooltip")}
          className="w-full text-left rounded-lg px-3 py-1.5 text-sm font-medium border border-sidebar-border text-sidebar-foreground/85 bg-transparent hover:bg-sidebar-accent hover:text-sidebar-foreground transition-colors"
        >
          {t("sidebar.newNote")}
        </button>
      </div>

      {/* セクション一覧
          IA 構成: ノート → メモ → ナレッジ ─divider─ 素材 → ラベル → Library
          ノート / メモ は CollapsibleSection ヘッダーと完全に同じスタイル（text-xs font-semibold）
          に揃え、視覚階層を「セクション見出し」レイヤーで統一する。
          中身を持たない（クリックで一覧画面に遷移する）ので、シェブロンは出さない。 */}
      <div className="flex-1 overflow-y-auto pb-2">
        {/* ① ノート（見出し風リンク — CollapsibleSection ヘッダーと同階層）
            ArrowRight を静的に置いて、CollapsibleSection の Chevron と同じ左端位置に揃える。
            Chevron ではなく Arrow なのは、「クリックで開閉する」誤解を避けるため。
            → の形は「別の場所に進む」のメンタルモデルが世界共通で、ナビ項目として誤読されない。 */}
        <button
          onClick={onShowNoteList}
          className={`w-full flex items-center gap-1 px-4 pt-2 pb-1 text-xs font-semibold transition-colors ${
            noteListActive
              ? "text-primary"
              : "text-sidebar-foreground/40 hover:text-sidebar-foreground/70"
          }`}
        >
          <span className="shrink-0 -ml-0.5" aria-hidden>
            <ArrowRight size={12} />
          </span>
          {/* 「ノート」でなく「すべてのノート」— 直下にフォルダが並ぶと、
              「ノート」ではフォルダとの包含関係（フォルダの中身もノート）が読めない。
              遷移先の一覧ヘッダのパンくずと同じ nav.noteList を使い、名前を一致させる。
              プロセス・メモは下にフォルダを持たないのでこの問題が無く、揃えない
              （見方の重複は左ナビ IA 第 2 ラウンドで扱う / design.md 2026-08-31） */}
          <span className="flex-1 text-left">{t("nav.noteList")}</span>
          {noteCount > 0 && (
            <span className="text-xs text-muted-foreground/70 font-normal tabular-nums">{noteCount}</span>
          )}
        </button>

        {/* ①'' フォルダ（noteContexts のフォルダ見せ）— ノート直下・初期畳み。
            実体はタグなので、このセクションを外してもノートのデータには何も起きない（可逆）。
            ノート/プロセスと「見方」が被る IA 問題は認識済みで、左ナビ再編の第 2 ラウンドで
            扱う（design.md 決定事項 2026-08-31）。空フォルダ作成（＋行）は永続化と併せて次段。 */}
        {onSelectFolder && (
          <CollapsibleSection
            storageKey="folders"
            title={<span title={t("nav.foldersTooltip")}>{t("nav.folders")}</span>}
            defaultOpen={false}
            count={folderCount}
          >
            <FolderTree
              folders={folderData.folders}
              emptyFolders={emptyFolders}
              unfiledCount={folderData.unfiledCount}
              selected={selectedFolder}
              onSelectFolder={(path) =>
                onSelectFolder(path, expandFolderToContextValues(folderTree, path))
              }
              onSelectUnfiled={onSelectUnfiledFolder}
              onCreateFolder={onCreateFolder}
              onFolderContextMenu={onFolderContextMenu}
            />
          </CollapsibleSection>
        )}

        {/* ①' プロセス（見出し風リンク） — ノートの別の見方なので隣に置く。
            手順を書いたノートが 1 件も無いうちは出さない（progressive disclosure）。 */}
        {onShowProcessGallery && processCount > 0 && (
          <button
            onClick={onShowProcessGallery}
            className={`w-full flex items-center gap-1 px-4 pt-2 pb-1 text-xs font-semibold transition-colors ${
              processGalleryActive
                ? "text-primary"
                : "text-sidebar-foreground/40 hover:text-sidebar-foreground/70"
            }`}
          >
            <span className="shrink-0 -ml-0.5" aria-hidden>
              <ArrowRight size={12} />
            </span>
            <span className="flex-1 text-left">{t("process.title")}</span>
            <span className="text-xs text-muted-foreground/70 font-normal tabular-nums">
              {processCount}
            </span>
          </button>
        )}

        {/* ②' メモ（見出し風リンク） — ノートと同列。
            この節の最後の見出しが mb-1.5 でナレッジ節との間隔を作る。モバイル（受信箱）は
            web では出ないので、その場合はメモがこの節の最後になり mb-1.5 を引き受ける。 */}
        {onShowMemos && (
          <button
            onClick={onShowMemos}
            className={`w-full flex items-center gap-1 px-4 pt-2 pb-1 ${onShowMobile ? "" : "mb-1.5"} text-xs font-semibold transition-colors ${
              memosActive
                ? "text-primary"
                : "text-sidebar-foreground/40 hover:text-sidebar-foreground/70"
            }`}
          >
            <span className="shrink-0 -ml-0.5" aria-hidden>
              <ArrowRight size={12} />
            </span>
            <span className="flex-1 text-left">{t("memo.title")}</span>
            {memoCount > 0 && (
              <span className="text-xs text-muted-foreground/70 font-normal tabular-nums">{memoCount}</span>
            )}
          </button>
        )}

        {/* ②'' モバイル（見出し風リンク） — メモと対の独立見出し。
            同期フォルダ <root>/Inbox/ の受信箱（未取り込みファイル）ビューへ遷移する。
            件数は「未処理件数」= これから捌く数。取り込むと素材になり、ここからは消える。
            受信箱は Tauri 専用なので、web では onShowMobile が渡らず見出しごと消える。
            mb-1.5 でナレッジ節との間隔を確保する（この見出しが節の最後）。 */}
        {onShowMobile && (
          <button
            onClick={onShowMobile}
            className={`w-full flex items-center gap-1 px-4 pt-2 pb-1 mb-1.5 text-xs font-semibold transition-colors ${
              mobileActive
                ? "text-primary"
                : "text-sidebar-foreground/40 hover:text-sidebar-foreground/70"
            }`}
          >
            <span className="shrink-0 -ml-0.5" aria-hidden>
              <ArrowRight size={12} />
            </span>
            <span className="flex-1 text-left">{t("mobile.title")}</span>
            {mobileCount > 0 && (
              <span className="text-xs text-muted-foreground/70 font-normal tabular-nums">{mobileCount}</span>
            )}
          </button>
        )}

        {/* ② ナレッジ（AI が編む脳）— Notes 直下に配置 */}
        {/* 到達性が未判定（null）の間は「起動中」だけを示す。ここで web 版向けの
            AiUpgradeNotice を出すと、デスクトップ版の起動直後の数秒間だけ
            「デスクトップ版を入手」が出るという矛盾した表示になる（2026-08-26）。
            節そのものは出しておくので、判定が付いても場所が動かない。
            web に待つバックエンドは無いので、この表示はデスクトップ版だけ。 */}
        {onShowWikiList && aiAvailable === null && isTauri() && (
          <CollapsibleSection
            storageKey="ai"
            title={(
              <span className="flex items-center gap-1">
                {t("sidebar.knowledge")}
                <Sparkles size={11} className="text-muted-foreground/60" />
              </span>
            )}
            defaultOpen={false}
          >
            <BackendStartingNotice />
          </CollapsibleSection>
        )}
        {/* 到達不可が確定。web はデスクトップ版への導線、デスクトップは
            バックエンドが起動しなかったということなので再起動の導線を出す。 */}
        {onShowWikiList && aiAvailable === false && (
          <CollapsibleSection
            storageKey="ai"
            title={(
              <span className="flex items-center gap-1">
                {t("sidebar.knowledge")}
                <Sparkles size={11} className="text-muted-foreground/60" />
              </span>
            )}
            defaultOpen={false}
          >
            {isTauri() ? <BackendUnavailableNotice /> : <AiUpgradeNotice variant="card" />}
          </CollapsibleSection>
        )}
        {/* AI モデル未登録（agentConfigured=false）ならナレッジセクション自体を隠す。
            ただし既存のナレッジデータが残っている場合は閲覧用に表示を維持する
            （モデルを消しただけで既存データへの導線が消えるとデータ喪失に見えるため）。 */}
        {onShowWikiList && aiAvailable && (agentConfigured || aiTotalCount > 0) && (
          <CollapsibleSection
            storageKey="ai"
            // 見出しに title ツールチップを付けて「ナレッジ」が何かを補足する。
            title={<span title={t("sidebar.knowledgeHint")}>{t("sidebar.knowledge")}</span>}
            // 初見ユーザーには閉じた状態で出す（気軽さ優先 / サイドバーの圧迫を減らす）。
            // 既に開閉した既存ユーザーは localStorage("ai") の値が優先されるので影響を受けない。
            defaultOpen={false}
            count={aiTotalCount}
          >
            {(() => {
                // 要約 / 知見 / 洞察（Atom）の 3 種類を default 表示する。
                // 2026-05-27 の design revision で synthesis（発想）レイヤはサイドバーから
                // 非表示化（Cmd-K Composer 経由で再構築する想定）。既存 synthesis ファイルの
                // 物理データは保持されるが、ここからの動線は提供しない。
                const kinds: WikiKind[] = ["summary", "claim", "atom"];
                return kinds.map((kind) => {
                  const count = wikiCounts?.[kind] ?? 0;
                  const label =
                    kind === "summary" ? t("wikiList.kindSummary")
                    : kind === "claim" ? t("wikiList.kindClaim")
                    : t("wikiList.kindAtom");
                  // 各 kind の意味を title ツールチップで補足する（初見ユーザー向け）。
                  const hint =
                    kind === "summary" ? t("wikiList.kindSummaryHint")
                    : kind === "claim" ? t("wikiList.kindClaimHint")
                    : t("wikiList.kindAtomHint");
                  // Atom は default 昇格したので "exp" バッジは不要。
                  const isExperimental = false;
                  return (
                    <button
                      key={kind}
                      onClick={() => onShowWikiList(kind)}
                      title={`${label} — ${hint}`}
                      className={`w-full flex items-center gap-2 px-2 py-1 rounded text-sm transition-colors ${
                        activeWikiKind === kind
                          ? "bg-primary/10 text-primary font-semibold"
                          : "text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-foreground"
                      }`}
                    >
                      <span className="text-muted-foreground shrink-0"><Bot size={14} /></span>
                      <span className="flex-1 text-left flex items-center gap-1.5">
                        {label}
                        {isExperimental && (
                          <span className="text-[9px] uppercase tracking-wide text-muted-foreground/70 border border-muted-foreground/30 rounded px-1 py-px">
                            exp
                          </span>
                        )}
                      </span>
                      {count > 0 && (
                        <span className="text-xs text-muted-foreground">{count}</span>
                      )}
                    </button>
                  );
                });
              })()}
            {(onShowWikiLog || onShowWikiLint) && (
              <div className="flex items-center gap-1 px-2 pt-1">
                {onShowWikiLog && (
                  <button
                    onClick={onShowWikiLog}
                    title={`${t("sidebar.wikiLog")} — ${t("sidebar.wikiLogHint")}`}
                    aria-label={t("sidebar.wikiLog")}
                    className={`flex-1 flex items-center justify-center gap-1.5 px-2 py-1 rounded text-xs transition-colors ${
                      activeWikiView === "log"
                        ? "bg-primary/10 text-primary"
                        : "text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-foreground"
                    }`}
                  >
                    <History size={12} />
                    <span>{t("sidebar.wikiLog")}</span>
                  </button>
                )}
                {onShowWikiLint && (
                  <button
                    onClick={onShowWikiLint}
                    title={`${t("sidebar.wikiLint")} — ${t("sidebar.wikiLintHint")}`}
                    aria-label={t("sidebar.wikiLint")}
                    className={`flex-1 flex items-center justify-center gap-1.5 px-2 py-1 rounded text-xs transition-colors ${
                      activeWikiView === "lint"
                        ? "bg-primary/10 text-primary"
                        : "text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-foreground"
                    }`}
                  >
                    <ShieldCheck size={12} />
                    <span>{t("sidebar.wikiLint")}</span>
                  </button>
                )}
              </div>
            )}
          </CollapsibleSection>
        )}

        {/* ── divider: 脳の中身（Notes/Knowledge）と入口（Materials/Labels）の区切り ── */}
        <div className="mx-4 my-3 border-t border-sidebar-border/50" aria-hidden />

        {/* ③ 素材（旧: データ） */}
        <CollapsibleSection
          storageKey="data"
          title={t("asset.dataSection")}
          defaultOpen={true}
          count={dataCount}
        >
          {MEDIA_NAV_ITEMS.map(({ type, icon }) => {
            // Documents タブには PDF も含まれる（mediaType の内部区別は維持しつつ UI 上で統合）
            const count = type === "document"
              ? (mediaCounts?.document ?? 0) + (mediaCounts?.pdf ?? 0)
              : mediaCounts?.[type] ?? 0;
            // カウント 0 でも表示（将来のアップロードに備える）
            return (
              <button
                key={type}
                onClick={() => onShowAssetGallery(type)}
                className={`w-full flex items-center gap-2 px-2 py-1 rounded text-sm transition-colors ${
                  activeAssetType === type
                    ? "bg-primary/10 text-primary font-semibold"
                    : "text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-foreground"
                }`}
              >
                <span className="text-muted-foreground shrink-0">{icon}</span>
                <span className="flex-1 text-left">{t(`asset.type.${type}`)}</span>
                {count > 0 && (
                  <span className="text-xs text-muted-foreground">{count}</span>
                )}
              </button>
            );
          })}
        </CollapsibleSection>

        {/* ④ ラベル: 1 件以上付与されてから表示（progressive disclosure） */}
        {labelCounts.size > 0 && (
        <CollapsibleSection
          storageKey="labels"
          title={t("label.section")}
          defaultOpen={true}
          count={labelCounts.size}
        >
          {[...labelCounts.entries()]
              .sort((a, b) => b[1] - a[1])
              .map(([label, count]) => {
                const color = LABEL_HEX[label] ?? "#8fa394";
                return (
                  <button
                    key={label}
                    onClick={() => onShowLabelGallery(label)}
                    className={`w-full flex items-center gap-2 px-2 py-1 rounded text-sm transition-colors ${
                      activeLabel === label
                        ? "bg-primary/10 text-primary font-semibold"
                        : "text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-foreground"
                    }`}
                  >
                    <span
                      className="inline-block w-2 h-2 rounded-full shrink-0"
                      style={{ backgroundColor: color }}
                    />
                    <span className="flex-1 text-left truncate">{getDisplayLabelName(label)}</span>
                    <span className="text-xs text-muted-foreground">{count}</span>
                  </button>
                );
              })}
        </CollapsibleSection>
        )}

        {/* Library セクション（Phase 2c — Shared root が設定されていれば表示） */}
        {onShowSharedLibrary && (
          <CollapsibleSection
            storageKey="library"
            title={t("sidebar.library")}
            defaultOpen={false}
          >
            <button
              onClick={onShowSharedLibrary}
              className={`w-full flex items-center gap-2 px-2 py-1 rounded text-sm transition-colors ${
                sharedLibraryActive
                  ? "bg-primary/10 text-primary font-semibold"
                  : "text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-foreground"
              }`}
            >
              <span className="text-muted-foreground shrink-0"><Library size={14} /></span>
              <span className="flex-1 text-left">{t("sidebar.shared")}</span>
            </button>
          </CollapsibleSection>
        )}
      </div>

      {/* フッター（メタ群: Skill / 全体グラフ / 設定 / ゴミ箱 / Release Notes） */}
      <div className="p-2 border-t border-sidebar-border space-y-0.5">
        {/* スキルは AI チャット / ingest への注入専用なので、AI が使えない
            （バックエンド未到達 or モデル未登録）ときは項目ごと隠す。
            データ自体は残るのでモデル再登録で復活する。 */}
        {onShowSkillList && aiAvailable && agentConfigured && (
          <button
            onClick={onShowSkillList}
            className={`w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-xs transition-colors ${
              skillActive
                ? "text-primary font-semibold bg-sidebar-accent/40"
                : "text-muted-foreground hover:text-foreground hover:bg-sidebar-accent/50"
            }`}
          >
            <Wrench size={12} className="shrink-0" />
            <span className="flex-1 text-left">{t("sidebar.skill")}</span>
            {skillCount > 0 && (
              <span className="text-xs">{skillCount}</span>
            )}
          </button>
        )}
        {onShowGlobalGraph && (
          <button
            onClick={onShowGlobalGraph}
            className={`w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-xs transition-colors ${
              globalGraphActive
                ? "text-primary font-semibold bg-sidebar-accent/40"
                : "text-muted-foreground hover:text-foreground hover:bg-sidebar-accent/50"
            }`}
          >
            <Waypoints size={12} className="shrink-0" />
            <span className="flex-1 text-left">{t("sidebar.globalGraph")}</span>
          </button>
        )}
        <button
          onClick={onShowSettings}
          className="w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-xs text-muted-foreground hover:text-foreground hover:bg-sidebar-accent/50 transition-colors"
        >
          <SettingsIcon size={12} className="shrink-0" />
          <span className="flex-1 text-left">{t("common.settings")}</span>
          {/* デスクトップ版の起動待ちの間も点の場所を確保しておく。判定が付いた
              瞬間に点が生えるより、灰色が色付く方が落ち着いて見える。 */}
          {aiAvailable === null && isTauri() && (
            <span
              className="inline-block w-1.5 h-1.5 rounded-full bg-muted-foreground/40 animate-pulse"
              title={t("sidebar.backendStarting")}
            />
          )}
          {aiAvailable && (agentConfigured ? (
            <span className="inline-block w-1.5 h-1.5 rounded-full bg-emerald-500" title={t("sidebar.aiConnected")} />
          ) : (
            <span className="inline-block w-1.5 h-1.5 rounded-full bg-orange-400" title={t("sidebar.aiNotConfigured")} />
          ))}
        </button>
        {onShowTrash && (
          <button
            onClick={onShowTrash}
            className={`w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-xs transition-colors ${
              trashActive
                ? "text-primary font-semibold bg-sidebar-accent/40"
                : "text-muted-foreground hover:text-foreground hover:bg-sidebar-accent/50"
            }`}
          >
            <Trash2 size={12} className="shrink-0" />
            <span className="flex-1 text-left">{t("nav.trashAndArchive")}</span>
            {trashCount > 0 && (
              <span className="text-xs">{trashCount}</span>
            )}
          </button>
        )}
        <button
          onClick={onShowReleaseNotes}
          className="w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-xs text-muted-foreground hover:text-foreground hover:bg-sidebar-accent/50 transition-colors"
        >
          <History size={12} className="shrink-0" />
          <span className="flex-1 text-left">{t("sidebar.releaseNotes")}</span>
        </button>
      </div>
    </aside>
  );
}
