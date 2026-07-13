// Notion 風サイドピーク
// 画面右側からスライドインし、リンク先ノートを編集可能な BlockNote で表示する
// 背景ページは操作可能（薄暗くならない）
// ラベル機能（ProvIndicatorLayer + LabelDropdownPortal + #オートコンプリート）対応

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Archive, ArchiveRestore, Trash2, TrendingUp } from "lucide-react";
import { summarizeWikiGrowth } from "../network-graph/growth-summary";
import { activityTypeLabelKey } from "../document-provenance/activity-label";
import {
  AddBlockButton,
  DragHandleButton,
  BlockColorsItem,
  SideMenu,
} from "@blocknote/react";
import { DeleteBlockMenuItem, AlignmentMenuItems } from "../../components/side-menu";
import {
  BlockAlignmentProvider,
  useBlockAlignmentStore,
  AlignmentStyleLayer,
} from "../block-alignment";
import type { GraphiumDocument } from "../../lib/document-types";
import { getActiveProvider } from "../../lib/storage/registry";
import { buildSavedPageFields, saveNoteDoc } from "@features/note-save";
import { SandboxEditor } from "../../base/editor";
import { ContextBadge } from "../note-context/ContextBadge";
import { ContextTagPicker } from "../note-context/ContextTagPicker";
import {
  aggregateNoteContexts,
  addNoteContext,
  removeNoteContext,
  normalizeNoteContexts,
} from "../note-context/context-tags";
import { customBlockEntries, CUSTOM_BLOCK_TYPES } from "../../blocks/registry";
import { bookmarkSlashItem, setBookmarkPickerCallback } from "../../blocks/bookmark";
import { calloutSlashItem } from "../../blocks/callout";
import {
  getMediaSlashMenuItems,
  DEFAULT_MEDIA_SLASH_TITLES,
  MediaPickerModal,
  setMediaPickerCallback,
  extractDomain,
  UrlPasteMenu,
  isHttpUrl,
  computeUrlPasteMenuPosition,
  buildPastedTextContent,
  insertBookmarkBlockFromPaste,
  retroLinkifyPastedUrl,
  blockContainsUrlLink,
  registerUrlAsset,
  buildUrlPeekEntry,
} from "@features/asset-browser";
import type { MediaIndex, MediaIndexEntry, MediaType, AssetDisplayMode } from "@features/asset-browser";
import { parseExternalSource } from "@features/network-graph/external-source";
import { openExternalUrl } from "../../lib/external-link";
import {
  GRAPHIUM_CLIPBOARD_MIME,
  applyClipboardPayload,
  buildClipboardPayload,
  computeIdMap,
  embedPayloadInHtml,
  extractPayloadFromHtml,
  flattenBlockIds,
  parseClipboardPayload,
} from "@features/block-lifecycle/clipboard";
import { regenInlineEntitiesInBlocks } from "@features/inline-label/regen-on-paste";
import {
  getMemoSlashMenuItem,
  setMemoPickerCallback,
  MemoPickerModal,
  buildMemoInsertBlock,
} from "@features/mobile-capture";
import type { CaptureIndex, CaptureEntry } from "@features/mobile-capture";
import { LabelStoreProvider, ProvLabelsEnabledProvider, useProvLabelsEnabled, useLabelStore } from "@features/context-label/store";
import { LinkStoreProvider, useLinkStore } from "@features/block-link/store";
import { useImeEnterGuard } from "../../hooks/use-ime-enter-guard";
import {
  getNoteSuggestions,
  getCreateNoteSuggestion,
  CREATE_NEW_NOTE_ID,
  insertNoteMentionInline,
  resolveMentionTargetFromLinks,
} from "@features/block-link/mention-menu";
import { useNewNoteNamePrompt } from "@features/block-link/new-note-name-dialog";
import { buildMentionPatterns, rewriteMentionRunsForBlock } from "@features/block-link/mention-rename";
import { LabelDropdownPortal } from "@features/context-label/ui";
import { ProvIndicatorLayer, BlockHoverHighlight, ProvIndicatorHoverHint } from "@features/context-label/prov-indicator";
import { buildLabelSlashMenuItems } from "@features/context-label/slash-menu-items";
import { isProvLabelsEnabled } from "@features/settings";
import { setupLabelAutoAssign } from "@features/context-label/label-auto";
import { KnowledgeStatusChip } from "@features/wiki/KnowledgeStatusChip";
import type { GraphiumIndex, NoteIndexEntry } from "@features/navigation";
import {
  CitePickerModal,
  getCiteSlashMenuItems,
  setCitePickerCallback,
  type CitePickerKind,
} from "@features/cite-picker";
import { useT, t as tStatic } from "../../i18n";

type SidePeekProps = {
  noteId: string;
  /** キャッシュ済みドキュメント（あれば API 取得をスキップして即表示） */
  cachedDoc?: GraphiumDocument;
  onClose: () => void;
  onNavigate: (noteId: string, savedDoc?: GraphiumDocument) => void;
  /**
   * ピーク内のメンションをクリックしたとき、そのノートをピークで開き直す。
   * peekId は wiki の場合 `wiki:<id>` プレフィックス付き。未指定だとピーク内クリックは無効。
   */
  onOpenNoteInPeek?: (peekId: string) => void;
  /**
   * ピーク内のメンションが外部ソース（url:/pdf:/document:）に解決されたとき、
   * 素材サイドピークで開く。未指定の場合、URL は外部ブラウザにフォールバックする
   * （外部ソース ID をノートピークとして開き直すと「読み込みに失敗しました」になるため、
   * どちらの場合も onOpenNoteInPeek には渡さない）。
   */
  onOpenMaterialPeek?: (entry: MediaIndexEntry) => void;
  /**
   * このノートを派生元とする wiki エントリ。Knowledge 化状態チップ表示用。
   * 渡されないか空配列 + onAddToKnowledge 未指定の場合はチップは描画されない。
   */
  wikiEntries?: NoteIndexEntry[];
  /** 未化のときに「Add to Knowledge」を押すと呼ばれる */
  onAddToKnowledge?: () => void;
  /** アーカイブ済みドキュメントの場合 true。エディタを read-only にする */
  archived?: boolean;
  /** アーカイブから復元するコールバック（archived のときバナーに復元ボタンを出す） */
  onRestoreFromArchive?: () => void;
  /** ゴミ箱にあるドキュメントの場合 true。エディタを read-only にする */
  trashed?: boolean;
  /** ゴミ箱から復元するコールバック（trashed のときバナーに復元ボタンを出す） */
  onRestoreFromTrash?: () => void;
  /**
   * inline=true: 親レイアウトに flex item として組み込まれる（fixed 配置せず、
   *   右パネルの左に「差し込まれる」形）。エディタ領域が自然に圧縮される。
   * inline=false（デフォルト）: 従来通り画面右端から portal で fixed 表示。
   */
  inline?: boolean;
  /** スラッシュメニューのメディア / メモピッカー用。未指定だと slash 経由の挿入はできない。 */
  mediaIndex?: MediaIndex | null;
  captureIndex?: CaptureIndex | null;
  /** /image, /video 等の新規アップロード経路。未指定だと既存メディアからの挿入のみ。 */
  uploadFile?: (file: File) => Promise<string>;
  /** /bookmark で新規 URL を追加したとき、アセットブラウザに登録する経路。 */
  onAddUrlBookmark?: (entry: MediaIndexEntry) => void;
  /** /claims, /Insights の引用ピッカー用ノートインデックス。未指定だと引用挿入は出さない。 */
  noteIndex?: GraphiumIndex | null;
  /**
   * 文脈ラベル（noteContexts）を変更しファイル保存（doSave）が完了した後に呼ばれる。
   * 保存済みの doc を渡すので、呼び出し側はこの doc からインデックスや doc キャッシュを
   * 再構築する（reindexNoteFromDoc）。ファイル保存は SidePeek 自身が済ませているため
   * 二重保存はしない。未指定でも表示・編集・ファイル保存は動く（一覧列への即時反映のみ省略）。
   */
  onNoteContextsChange?: (noteId: string, savedDoc: GraphiumDocument | null) => void;
  /**
   * doSave がストレージへの保存に成功するたびに、保存済みの doc を渡して呼ばれる。
   * 呼び出し側はここで doc キャッシュとインデックスを最新化する（reindexNoteFromDoc）。
   * 未配線だと、ピークを閉じて再オープンしたときに古い cachedDoc が表示され、
   * その stale な doc を起点にした次の保存で旧タイトル・旧メタデータがディスクへ
   * 書き戻される（タイトル変更が巻き戻るデータ破壊）。noteId は wiki:/skill:
   * プレフィックス付きのまま渡す（doc キャッシュのキーと同じ形）。
   */
  onSaved?: (noteId: string, savedDoc: GraphiumDocument) => void;
  /**
   * メインエディタ側でのタイトルリネーム時に、このピークで開いているノートの本文内
   * メンションラベルをライブ更新するための命令口。NoteEditorInner が ref に関数登録の
   * 口を渡し、SidePeek 側が実装を登録する（openSidePeekRef と同じ流儀）。
   * ピークで開いているノートはファイル直書きすると次のオートセーブで巻き戻るため、
   * エディタ経由で書き換えて通常のオートセーブ経路に乗せる。
   */
  applyMentionRenameRef?: React.MutableRefObject<
    | ((rawRenamedId: string, oldTitle: string, newTitle: string, includeWikiLabels: boolean) => void)
    | null
  >;
  /** 文脈候補（タグ）を全ノートから削除する（ピッカーのゴミ箱）。削除したら true を返す。 */
  onDeleteContextEverywhere?: (value: string) => boolean | Promise<boolean>;
  /**
   * `@` メニューの「新規ノートを作成」用。空ノートを作って ID を返す。
   * sourceNoteId にはこのピークが表示中のノート ID を渡して派生元を記録する。
   * 未指定だと `@` で既存ノート参照のみ（新規作成は出ない）。
   */
  onCreateLinkedNote?: (title: string, sourceNoteId?: string) => Promise<string | null>;
  /**
   * 保存直前に doc キャッシュから最新の chats を採用するための getter。
   * チャット実行のアプリレベル書き戻し（chat-run-manager）が、ピーク表示中の
   * ノートの doc.chats を更新することがある。doSave は docRef（このピークが
   * 最後に読んだ/保存した doc）を spread するため、そのままだと旧 chats で
   * 上書きして応答が消える。ピーク自身は chats を編集しないので、キャッシュ側
   * （reindexNoteFromDoc で常に最新化される）を常に優先してよい。
   */
  getCachedDoc?: (noteId: string) => GraphiumDocument | undefined;
};

export function SidePeek(props: SidePeekProps) {
  return (
    <ProvLabelsEnabledProvider enabled={isProvLabelsEnabled()}>
    <LabelStoreProvider>
      <LinkStoreProvider>
        <BlockAlignmentProvider>
          <SidePeekInner {...props} />
        </BlockAlignmentProvider>
      </LinkStoreProvider>
    </LabelStoreProvider>
    </ProvLabelsEnabledProvider>
  );
}

// サイドピーク用の簡易 SideMenu（ラベルは # オートコンプリートで付与）
function SidePeekSideMenu() {
  const t = useT();
  return (
    <SideMenu>
      <AddBlockButton />
      <DragHandleButton>
        <DeleteBlockMenuItem />
        <BlockColorsItem>{t("common.color")}</BlockColorsItem>
        <AlignmentMenuItems />
      </DragHandleButton>
    </SideMenu>
  );
}

// 既知のブロック型（未登録ブロック除去用）
// メインエディタ（note-app.tsx）と揃える。カスタムブロックは
// src/blocks/registry.ts の CUSTOM_BLOCK_TYPES から自動で取り込む。
// 取りこぼすと、Peek を開いた瞬間に保存済みカスタムブロックが除去された
// まま auto-save されてデータが壊れる。
const KNOWN_BLOCK_TYPES = new Set([
  "paragraph", "heading", "bulletListItem", "numberedListItem",
  "checkListItem", "table", "image", "video", "audio", "file",
  "codeBlock", "quote",
  ...CUSTOM_BLOCK_TYPES,
]);

function sanitizeBlocks(blocks: any[]): any[] {
  return blocks
    .filter((b) => KNOWN_BLOCK_TYPES.has(b.type))
    .map((b) => ({
      ...b,
      children: b.children?.length ? sanitizeBlocks(b.children) : b.children,
    }));
}

function SidePeekInner({
  noteId, cachedDoc, onClose, onNavigate, wikiEntries, onAddToKnowledge,
  archived = false, onRestoreFromArchive, trashed = false, onRestoreFromTrash, inline = false,
  mediaIndex, captureIndex, uploadFile, onAddUrlBookmark, noteIndex,
  onNoteContextsChange, onSaved, applyMentionRenameRef, onDeleteContextEverywhere,
  onCreateLinkedNote, onOpenNoteInPeek, onOpenMaterialPeek, getCachedDoc,
}: SidePeekProps) {
  const t = useT();
  const provLabelsEnabled = useProvLabelsEnabled();
  const labelStore = useLabelStore();
  const linkStore = useLinkStore();
  // labelStore/linkStore は毎レンダリング新しいオブジェクトになるため、
  // ref 経由で最新を参照し、useCallback の依存を安定化する
  const labelStoreRef = useRef(labelStore);
  labelStoreRef.current = labelStore;
  const linkStoreRef = useRef(linkStore);
  linkStoreRef.current = linkStore;
  const blockAlignmentStore = useBlockAlignmentStore();
  const blockAlignmentStoreRef = useRef(blockAlignmentStore);
  blockAlignmentStoreRef.current = blockAlignmentStore;
  const editorRef = useRef<any>(null);
  // タイトル欄の IME 確定 Enter 判定（WebKit のイベント順対応。lib/ime-enter.ts 参照）
  const { compositionHandlers: titleCompositionHandlers, isImeKey: isTitleImeKey } = useImeEnterGuard();
  // @ メニュー「新しいノートを作成」の名前入力ダイアログ（IME 安全）
  const { promptNoteName, dialog: newNoteNameDialog } = useNewNoteNamePrompt();
  // picker callbacks をエディタ単位で登録するため、editor 実体を state にも持つ
  const [sidePeekEditor, setSidePeekEditor] = useState<any>(null);
  // スラッシュメニューのピッカー状態（main editor とは独立に SidePeek 側で持つ）
  const [pickerMediaType, setPickerMediaType] = useState<MediaType | null>(null);
  const [memoPickerOpen, setMemoPickerOpen] = useState(false);
  const [urlSlashPickerOpen, setUrlSlashPickerOpen] = useState(false);
  // URL ペースト検知 → ブックマーク/リンク選択メニュー（メインエディタと同じ挙動）
  const [pastedUrl, setPastedUrl] = useState<{ url: string; position: { x: number; y: number }; blockId: string } | null>(null);
  const [citePickerKind, setCitePickerKind] = useState<CitePickerKind | null>(null);
  const [wrapperEl, setWrapperEl] = useState<HTMLDivElement | null>(null);
  const [doc, setDoc] = useState<GraphiumDocument | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saveStatus, setSaveStatus] = useState<"saving" | "saved" | "dirty">("saved");
  // 文脈ラベル（タイトル直下のタグ行）。表示・編集用のローカル state。
  const [peekContexts, setPeekContexts] = useState<string[]>([]);
  const [peekContextPickerPos, setPeekContextPickerPos] = useState<{ top: number; left: number } | null>(null);
  const contextsInitRef = useRef<string | null>(null);
  const docRef = useRef<GraphiumDocument | null>(null);
  const autoSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sidePeekRef = useRef<HTMLDivElement>(null);
  const labelAutoRef = useRef<(() => void) | null>(null);
  // onSaved は毎レンダリング新しい関数になり得るため ref 経由で参照する
  const onSavedRef = useRef(onSaved);
  onSavedRef.current = onSaved;
  // メインエディタ側のタイトルリネームを、このピークで開いているノートの本文へ
  // ライブ反映する命令口を登録する。ファイル直書きだとピークの次のオートセーブが
  // 旧内容で上書きして伝播が巻き戻るため、エディタ経由で書き換えて通常のオート
  // セーブ経路（updateBlock → onChange → doSave → onSaved）に乗せる。
  const noteIndexPropRef = useRef(noteIndex);
  noteIndexPropRef.current = noteIndex;
  useEffect(() => {
    if (!applyMentionRenameRef) return;
    applyMentionRenameRef.current = (rawRenamedId, oldTitle, newTitle, includeWikiLabels) => {
      const editor = editorRef.current;
      if (!editor || !oldTitle || !newTitle || oldTitle === newTitle) return;
      const patterns = buildMentionPatterns(oldTitle, newTitle, { includeWikiLabels });
      const allLinks = linkStoreRef.current.getAllLinks();
      const blockIds = new Set<string>();
      const blockTargets = new Map<string, Set<string>>();
      for (const l of allLinks) {
        if (!l.sourceBlockId || !l.targetNoteId) continue;
        let set = blockTargets.get(l.sourceBlockId);
        if (!set) blockTargets.set(l.sourceBlockId, (set = new Set()));
        set.add(l.targetNoteId);
        if (l.targetNoteId === rawRenamedId) blockIds.add(l.sourceBlockId);
      }
      // 同名曖昧ガード（applyMentionRenameToDoc と同じ基準）
      for (const l of allLinks) {
        if (!l.sourceBlockId || !blockIds.has(l.sourceBlockId)) continue;
        if (l.targetNoteId && l.targetNoteId !== rawRenamedId) {
          const t2 = noteIndexPropRef.current?.notes.find((n) => n.noteId === l.targetNoteId)?.title;
          if (t2 === oldTitle) blockIds.delete(l.sourceBlockId);
        }
      }
      for (const bid of blockIds) {
        try {
          const block = editor.getBlock?.(bid);
          if (!block || !Array.isArray(block.content)) continue;
          const nc = rewriteMentionRunsForBlock(block.content, patterns, {
            uniqueFallback: blockTargets.get(bid)?.size === 1,
          });
          if (nc) editor.updateBlock(block, { content: nc });
        } catch {
          // ブロックが削除済み等は無視（伝播はベストエフォート）
        }
      }
    };
    return () => {
      applyMentionRenameRef.current = null;
    };
  }, [applyMentionRenameRef]);
  // cachedDoc は「開いた瞬間を即時表示する」ための mount 時スナップショットに固定する。
  // 開いている間に親の doc キャッシュが更新されて prop の参照が変わっても
  // （onSaved → reindexNoteFromDoc 直後など）、load effect を再発火させて編集中の
  // docRef / オートセーブ状態を巻き戻してはいけない。ノートの切り替えは親が
  // key={noteId} で remount して処理する。
  const initialCachedDocRef = useRef(cachedDoc);
  const initialCachedDoc = initialCachedDocRef.current;

  // ノート読み込み（mount 時に cachedDoc がなければ API 取得）
  useEffect(() => {
    if (initialCachedDocRef.current) {
      // cachedDoc がある場合は API 不要
      const cached = initialCachedDocRef.current;
      setDoc(cached);
      docRef.current = cached;
      setLoading(false);
      setError(null);
      setSaveStatus("saved");
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);
    setDoc(null);
    setSaveStatus("saved");
    docRef.current = null;

    // wiki:xxxx 形式のIDの場合は loadWikiFile を使用
    const isWiki = noteId.startsWith("wiki:");
    const loadFn = isWiki
      ? getActiveProvider().loadWikiFile?.(noteId.replace(/^wiki:/, ""))
      : getActiveProvider().loadFile(noteId);

    (loadFn ?? Promise.reject(new Error("Wiki not supported")))
      .then((d) => {
        if (!cancelled) {
          setDoc(d);
          docRef.current = d;
          setLoading(false);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setError(
            err instanceof Error ? err.message : tStatic("sidePeek.loadError")
          );
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
      if (autoSaveTimerRef.current) {
        clearTimeout(autoSaveTimerRef.current);
        autoSaveTimerRef.current = null;
      }
    };
  }, [noteId]);

  // ドキュメント読み込み後にラベル・リンクを復元
  // setLabel / restoreLinks は useCallback で安定な参照
  const { setLabel } = labelStore;
  const { restoreLinks } = linkStore;
  useEffect(() => {
    if (!doc) return;
    const page = doc.pages?.[0];
    if (!page) return;

    // ラベル復元
    if (page.labels) {
      for (const [blockId, label] of Object.entries(page.labels)) {
        setLabel(blockId, label);
      }
    }
    // リンク復元（provLinks + knowledgeLinks、v1 互換: links）
    const allLinks = [
      ...(page.provLinks ?? []),
      ...(page.knowledgeLinks ?? []),
      ...((page as any).links ?? []),
    ];
    if (allLinks.length > 0) {
      restoreLinks(allLinks);
    }
    // ブロック配置揃え復元（table / audio / file 用サイドストア）
    blockAlignmentStoreRef.current.restoreSnapshot(page.blockAlignments);
  }, [doc, setLabel, restoreLinks]);

  // エディタ準備完了時（依存を安定化し、SandboxEditor の不要な再実行を防ぐ）
  const handleEditorReady = useCallback((editor: any) => {
    editorRef.current = editor;
    setSidePeekEditor(editor);
  }, []);

  // ラベル自動設定のセットアップ（editor 準備後・ストア更新のたびに貼り直す）。
  // label-auto は「渡された labelStore の labels Map」を読んで継承・孤立清掃を判断するが、
  // labelStore / linkStore は毎レンダリング新オブジェクトになる。editor 準備時に一度だけ
  // 捕捉すると空 Map に凍結され、読み取りが最新ラベルを見られず継承も清掃も効かない。
  // メインエディタは handleEditorReady の deps [labelStore, linkStore] で再セットアップして
  // これを回避しているが、ピークは handleEditorReady を安定化しているため、専用 effect で
  // 最新ストアを渡し直す。実際の発火は handleChange 内の labelAutoRef.current?.() が担う。
  useEffect(() => {
    if (!sidePeekEditor) return;
    labelAutoRef.current = setupLabelAutoAssign(sidePeekEditor, labelStore, linkStore);
  }, [sidePeekEditor, labelStore, linkStore]);

  // ペーストされたノートリンク（#note/<id>）を現在のタイトルへ解決する。
  // listener の closure が stale にならないよう ref 経由で最新の noteIndex を参照する。
  const resolveNoteLinkTitleRef = useRef<(fileId: string) => string | null>(() => null);
  resolveNoteLinkTitleRef.current = (fileId: string) => {
    const entry = noteIndex?.notes.find((n) => n.noteId === fileId);
    return entry ? entry.title : null;
  };

  // クリップボード処理（メインエディタ src/note-app.tsx の handleEditorReady 内と挙動を揃える）:
  //   copy) 選択ブロックの labels / links を buildClipboardPayload でシリアライズし、
  //         カスタム MIME ＋ text/html の base64 コメントに載せて運ぶ
  //   paste) Graphium ペイロードがあれば applyClipboardPayload で labels / links を復元し、
  //          全ペーストで inline entityId を再発番する。以下の救済も行う:
  //     1) ノートリンク（…#note/<id>）単体 → @タイトル のメンションに変換
  //     2) 空のリスト項目への paste 救済（BlockNote の paragraph 置換を防ぐ）
  //     3) URL 単体 → ブックマーク/リンク選択メニュー（UrlPasteMenu）
  // クリップボードリスナーの二重登録に備えてイベント単位の既処理フラグ＋
  // stopImmediatePropagation で 1 回だけ処理する。
  // ※ ピークは独自の LabelStoreProvider / LinkStoreProvider を持つため、
  //   effect closure が stale ストアを掴まないよう labelStoreRef / linkStoreRef を使う。
  useEffect(() => {
    const editor = sidePeekEditor;
    if (!editor) return;
    // URL 単体ペーストならブックマーク選択メニューを出す。位置は表示直前に計算する
    // （paste イベント同期時は空ブロックの caret rect が全ゼロを返し左上に張り付く）
    const maybeShowUrlPasteMenu = (rawText: string | undefined, blockId: string) => {
      const text = rawText?.trim();
      if (!text || !isHttpUrl(text)) return;
      setTimeout(() => {
        setPastedUrl({ url: text, position: computeUrlPasteMenuPosition(editor, blockId), blockId });
      }, 100);
    };

    // 単一トークンの Graphium ノートリンク（…#note/<id>）を @タイトル のメンション
    // に変換する。処理した場合 true を返す（呼び出し元で return する）。
    const tryConvertNoteLinkPaste = (e: ClipboardEvent, pastedText: string): boolean => {
      const m = /#note\/([^/\s#?]+)/.exec(pastedText);
      if (!m) return false;
      const fileId = decodeURIComponent(m[1]);
      const title = resolveNoteLinkTitleRef.current(fileId);
      if (!title) return false;
      if ((e as unknown as { __ghNoteLinkHandled?: boolean }).__ghNoteLinkHandled) return true;
      (e as unknown as { __ghNoteLinkHandled?: boolean }).__ghNoteLinkHandled = true;
      e.preventDefault();
      e.stopImmediatePropagation();
      const sourceBlockId = editor.getTextCursorPosition?.()?.block?.id;
      if (sourceBlockId) {
        linkStoreRef.current.addLink({
          sourceBlockId,
          targetBlockId: "",
          targetNoteId: fileId,
          type: "reference",
          createdBy: "human",
        });
      }
      // insertInlineContent の onChange で自動的に dirty 化・保存される
      setTimeout(() => {
        insertNoteMentionInline(editorRef.current, fileId, title);
      }, 0);
      return true;
    };

    // copy: 選択範囲の labels / links をクリップボードに載せて運ぶ（メインと同じ Phase 3）。
    // Chrome はカスタム MIME を OS clipboard へ書き出す際に捨てるため、
    //   1. 同タブ内で完結する場合に備えて application/x-graphium-clipboard にも setData
    //   2. OS clipboard 経由でも生存させるため text/html の先頭に base64 ペイロードを埋め込む
    // capture phase だけだと ProseMirror が後から text/html を上書きするため、bubble phase でも埋め込む。
    const copyListener = (e: ClipboardEvent) => {
      try {
        let blockIds: string[] = [];
        const selection = editor.getSelection?.();
        const selectedBlocks = selection?.blocks;
        if (selectedBlocks && selectedBlocks.length > 0) {
          blockIds = flattenBlockIds(selectedBlocks);
        } else {
          // フォールバック: カーソル位置のブロック 1 つ（部分テキスト選択など）
          const cursorBlock = editor.getTextCursorPosition?.()?.block;
          if (cursorBlock?.id) blockIds = [cursorBlock.id];
        }
        if (blockIds.length === 0) return;
        const payload = buildClipboardPayload({
          blockIds,
          getLabel: (id) => labelStoreRef.current.getLabel(id),
          getAttributes: (id) => labelStoreRef.current.getAttributes(id),
          allLinks: linkStoreRef.current.getAllLinks(),
        });
        if (!payload) return;
        e.clipboardData?.setData(GRAPHIUM_CLIPBOARD_MIME, JSON.stringify(payload));
        const existingHtml = e.clipboardData?.getData("text/html") ?? "";
        e.clipboardData?.setData("text/html", embedPayloadInHtml(payload, existingHtml));
      } catch (err) {
        // eslint-disable-next-line no-console
        console.warn("[Graphium copy] error", err);
      }
    };

    const onPaste = (e: ClipboardEvent) => {
      // 1) 空のリスト系ブロックへのテキスト paste は BlockNote がブロック自体を
      //    paragraph に置換してしまうため、ブロック型を保ったまま差し込む。
      //    Graphium ペイロード（複数ブロック）は構造が保たれるため下の payload 処理に流す。
      const cursorBlock = editor.getTextCursorPosition?.()?.block;
      const listBlockTypes = new Set(["checkListItem", "bulletListItem", "numberedListItem"]);
      if (
        cursorBlock &&
        listBlockTypes.has(cursorBlock.type) &&
        Array.isArray(cursorBlock.content) &&
        cursorBlock.content.length === 0 &&
        e.clipboardData
      ) {
        const hasGraphiumPayload =
          parseClipboardPayload(e.clipboardData.getData(GRAPHIUM_CLIPBOARD_MIME)) ??
          extractPayloadFromHtml(e.clipboardData.getData("text/html"));
        const plain = e.clipboardData.getData("text/plain");
        if (!hasGraphiumPayload && plain) {
          const cleaned = plain.replace(/\r?\n+$/g, "");
          const token = cleaned.trim();
          if (token && !/\s/.test(token) && tryConvertNoteLinkPaste(e, token)) return;
          e.preventDefault();
          e.stopImmediatePropagation();
          editor.updateBlock(cursorBlock, { content: buildPastedTextContent(cleaned) });
          maybeShowUrlPasteMenu(cleaned, cursorBlock.id);
          return;
        }
      }

      // 全コピペ共通: 挿入後にインライン entityId を再発番する後処理（メインと同じ Phase E）。
      // 同 entityId 共有は意図しない場合が多いので、コピー範囲内では一貫した
      // 新 ID に置き換える（旧 ID 同一なら新 ID も同一になる remap）。
      const beforeIdsForRegen = new Set(flattenBlockIds(editor.document));
      const scheduleEntityRegen = () => {
        setTimeout(() => {
          const afterIds = flattenBlockIds(editor.document);
          const newIds = new Set(afterIds.filter((id) => !beforeIdsForRegen.has(id)));
          if (newIds.size > 0) regenInlineEntitiesInBlocks(editor, newIds);
        }, 0);
      };

      // 2) Graphium ペイロード（ブロックコピー）を適用: labels / links を復元する。
      //    1) 同タブ内はカスタム MIME、2) OS clipboard 経由は text/html コメントから取り出す。
      const graphiumRaw = e.clipboardData?.getData(GRAPHIUM_CLIPBOARD_MIME);
      const htmlData = e.clipboardData?.getData("text/html");
      const payload = parseClipboardPayload(graphiumRaw) ?? extractPayloadFromHtml(htmlData);
      if (payload) {
        const beforeIds = new Set(flattenBlockIds(editor.document));
        // BlockNote のネイティブパースを動かしてから、追加されたブロック ID を確定させる
        setTimeout(() => {
          const afterIds = flattenBlockIds(editor.document);
          const newIds = afterIds.filter((id) => !beforeIds.has(id));
          const idMap = computeIdMap(payload.blockIds, newIds);
          if (idMap.size === 0) return;
          applyClipboardPayload(idMap, payload, {
            setLabel: (blockId, label) => labelStoreRef.current.setLabel(blockId, label),
            setAttributes: (blockId, attrs) => labelStoreRef.current.setAttributes(blockId, attrs),
            addLink: (params) => linkStoreRef.current.addLink(params),
          });
        }, 0);
        scheduleEntityRegen();
        return;
      }

      // Graphium ペイロード以外でも entity 再発番は走らせる（プレーン Markdown / HTML 等）
      scheduleEntityRegen();

      // 3) ノートリンク（…#note/<id>）単体 → @タイトルのメンションに変換
      const pastedText = e.clipboardData?.getData("text/plain")?.trim();
      if (pastedText && !/\s/.test(pastedText)) {
        if (tryConvertNoteLinkPaste(e, pastedText)) return;
      }

      // 4) URL 単体ペースト → ブックマーク選択メニュー
      if (!cursorBlock) return;
      maybeShowUrlPasteMenu(e.clipboardData?.getData("text/plain"), cursorBlock.id);
    };

    let dom: HTMLElement | null = null;
    let attempts = 0;
    const attach = () => {
      dom = editor.domElement ?? null;
      if (!dom) {
        if (attempts++ < 60) requestAnimationFrame(attach);
        return;
      }
      dom.addEventListener("paste", onPaste, true);
      // copy は capture / bubble の両方に登録する（capture で setData した内容を
      // ProseMirror が clearData している場合、bubble の最後でもう一度 setData する）
      dom.addEventListener("copy", copyListener, true);
      dom.addEventListener("copy", copyListener, false);
    };
    attach();
    return () => {
      dom?.removeEventListener("paste", onPaste, true);
      dom?.removeEventListener("copy", copyListener, true);
      dom?.removeEventListener("copy", copyListener, false);
    };
  }, [sidePeekEditor]);

  // ピーク内の @メンションクリック → そのノートをピークで開き直す。
  // note-app の document ハンドラはピーク内（data-side-peek 配下）をスキップするので、
  // ここで「このピーク自身の linkStore」を使って厳密な ID に解決する（同名ノートでも正しい）。
  useEffect(() => {
    if (!onOpenNoteInPeek) return;
    const root = sidePeekRef.current;
    if (!root) return;
    const isMentionSpan = (el: HTMLElement): boolean => {
      if (el.getAttribute("data-style-type") !== "textColor" || el.getAttribute("data-value") !== "blue") return false;
      if (!el.closest(".bn-editor")) return false;
      if (el.closest("table")) return false;
      const text = el.textContent?.trim();
      return !!text && text.startsWith("@") && !text.startsWith("@#");
    };
    const onClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (!isMentionSpan(target)) return;
      const noteName = target.textContent!.trim().slice(1);
      const blockId = target.closest("[data-id]")?.getAttribute("data-id") ?? null;
      let resolved = resolveMentionTargetFromLinks(
        blockId,
        noteName,
        linkStoreRef.current.getAllLinks(),
        noteIndex ?? null,
      );
      if (!resolved) {
        const entry = noteIndex?.notes.find((n) => n.title === noteName);
        if (entry) resolved = { noteId: entry.noteId, isWiki: entry.source === "ai" };
      }
      if (!resolved) return;
      e.preventDefault();
      e.stopPropagation();
      // References の「Source: @ラベル」等は linkStore の targetNoteId に外部ソース ID
      // （url:/pdf:/document:/chat:）がそのまま入る。ノートピークとして開き直すと
      // loadFile が失敗して「読み込みに失敗しました」になるため、素材ピークへ振り分ける。
      const ext = parseExternalSource(resolved.noteId);
      if (ext) {
        if (ext.kind === "url") {
          if (onOpenMaterialPeek) {
            onOpenMaterialPeek(buildUrlPeekEntry(ext.key, mediaIndex ?? null));
          } else {
            void openExternalUrl(ext.key);
          }
        } else if (ext.kind === "pdf" || ext.kind === "document") {
          const entry = mediaIndex?.media.find((m) => m.fileId === ext.key);
          if (entry && onOpenMaterialPeek) onOpenMaterialPeek(entry);
        }
        // chat: は開ける実体が無いので何もしない（グラフノードと同じ扱い）
        return;
      }
      onOpenNoteInPeek(resolved.isWiki ? `wiki:${resolved.noteId}` : resolved.noteId);
    };
    root.addEventListener("click", onClick, true);
    return () => root.removeEventListener("click", onClick, true);
  }, [onOpenNoteInPeek, onOpenMaterialPeek, noteIndex, mediaIndex, sidePeekEditor]);

  // SidePeek エディタごとに picker callback を登録する。
  // 同じスラッシュアイテムを main editor / SidePeek 双方で使うため、
  // どちらのエディタからクリックされたかを WeakMap で識別する。
  useEffect(() => {
    if (!sidePeekEditor) return;
    setMediaPickerCallback(sidePeekEditor, setPickerMediaType);
    setMemoPickerCallback(sidePeekEditor, () => setMemoPickerOpen(true));
    setBookmarkPickerCallback(sidePeekEditor, () => setUrlSlashPickerOpen(true));
    setCitePickerCallback(sidePeekEditor, setCitePickerKind);
    return () => {
      setMediaPickerCallback(sidePeekEditor, null);
      setMemoPickerCallback(sidePeekEditor, null);
      setBookmarkPickerCallback(sidePeekEditor, null);
      setCitePickerCallback(sidePeekEditor, null);
    };
  }, [sidePeekEditor]);

  // スラッシュ用に「直前のスラッシュブロック」を退避する。
  // BlockNote はスラッシュアイテム選択時点で `/` を含む空ブロックの中身を消すが、
  // 完全に空のパラグラフが残るため、挿入後に削除して見た目をすっきりさせる。
  // currentBlock を都度取り直すと、ピッカーモーダル表示中にフォーカスが移って
  // cursor position が変わる可能性があるので、useState で記憶する。

  // スラッシュ起点で inline コンテンツ（@リンク / ハイパーリンク）を挿入する
  // （main editor の insertInlineAtSlash と同じ流儀）。
  const insertInlineAtSlash = useCallback((editor: any, currentBlock: any, inline: any[]) => {
    const content = currentBlock.content;
    const isSlashOnly =
      Array.isArray(content) &&
      content.length <= 1 &&
      (!content[0] || (content[0].type === "text" && content[0].text.replace("/", "").trim() === ""));
    if (isSlashOnly) {
      editor.updateBlock(currentBlock, { type: "paragraph", content: [] });
    }
    const target = editor.getBlock(currentBlock.id) ?? currentBlock;
    editor.setTextCursorPosition(target, "end");
    setTimeout(() => {
      editor.insertInlineContent(inline);
    }, 0);
  }, []);

  // 既存メディアから挿入（main editor の handlePickerSelect と同じ挙動）。
  // displayMode:
  //   "embed" → 中身を展開（pdf / file / image / video / audio ブロック）
  //   "link"  → @素材名 の inline リンク + citedAssetFileIds に登録
  //             （Cmd-K / チャットの AI がその素材を読めるようにする。
  //              doSave は docRef.current を spread するので一緒に永続化される）
  const handlePickerSelect = useCallback((entry: MediaIndexEntry, displayMode: AssetDisplayMode) => {
    const editor = editorRef.current;
    if (!editor) return;
    const currentBlock = editor.getTextCursorPosition()?.block;
    if (!currentBlock) {
      setPickerMediaType(null);
      return;
    }
    if (displayMode === "link") {
      const cur = docRef.current;
      if (entry.fileId && cur && !(cur.citedAssetFileIds ?? []).includes(entry.fileId)) {
        docRef.current = {
          ...cur,
          citedAssetFileIds: [...(cur.citedAssetFileIds ?? []), entry.fileId],
        };
      }
      // insertInlineContent の onChange 経由で自動保存される
      insertInlineAtSlash(editor, currentBlock, [
        { type: "text", text: `@${entry.name}`, styles: { textColor: "blue" } },
        { type: "text", text: " ", styles: {} },
      ]);
      setPickerMediaType(null);
      return;
    }
    const newBlock = entry.type === "pdf"
      ? { type: "pdf", props: { url: entry.url, name: entry.name } }
      : entry.type === "document"
        ? { type: "file", props: { url: entry.url, name: entry.name } }
        : {
            type: entry.type === "video" ? "video" : entry.type === "audio" ? "audio" : "image",
            props: { url: entry.url, name: entry.name },
          };
    editor.insertBlocks([newBlock], currentBlock, "after");
    const content = currentBlock.content;
    if (
      Array.isArray(content) &&
      content.length <= 1 &&
      (!content[0] || (content[0].type === "text" && content[0].text.replace("/", "").trim() === ""))
    ) {
      editor.removeBlocks([currentBlock]);
    }
    setPickerMediaType(null);
  }, [insertInlineAtSlash]);

  // /claims, /Insights で選んだ claim / atom ノートを引用挿入。
  // main editor (note-app.tsx handleCitePickerConfirm) と同じ流儀:
  // 青色 `@title` paragraph + knowledge レイヤの reference リンク。
  const handleCiteConfirm = useCallback((entries: NoteIndexEntry[]) => {
    const editor = editorRef.current;
    if (!editor || entries.length === 0) {
      setCitePickerKind(null);
      return;
    }
    const currentBlock = editor.getTextCursorPosition()?.block;
    if (!currentBlock) {
      setCitePickerKind(null);
      return;
    }
    const newBlocks = entries.map((entry) => ({
      type: "paragraph" as const,
      content: [
        {
          type: "text" as const,
          text: `@${entry.title || "(untitled)"}`,
          styles: { textColor: "blue" },
        },
      ],
    }));
    const inserted = editor.insertBlocks(newBlocks, currentBlock, "after");
    const insertedArr = Array.isArray(inserted) ? inserted : [];
    entries.forEach((entry, i) => {
      const blockId = insertedArr[i]?.id;
      if (!blockId) return;
      linkStore.addLink({
        sourceBlockId: blockId,
        targetBlockId: "",
        targetNoteId: entry.noteId,
        type: "reference",
        createdBy: "human",
      });
    });
    const content = currentBlock.content;
    if (
      Array.isArray(content) &&
      content.length <= 1 &&
      (!content[0] || (content[0].type === "text" && content[0].text.replace("/", "").trim() === ""))
    ) {
      editor.removeBlocks([currentBlock]);
    }
    setCitePickerKind(null);
  }, [linkStore]);

  // 既存 URL ピッカーから挿入（main editor の handleUrlSlashPickerSelect と同じ挙動）。
  // displayMode "link" はインラインのハイパーリンク、"embed" は bookmark ブロック。
  const handleUrlSlashPickerSelect = useCallback((entry: MediaIndexEntry, displayMode: AssetDisplayMode) => {
    const editor = editorRef.current;
    if (!editor) return;
    const currentBlock = editor.getTextCursorPosition()?.block;
    if (!currentBlock) {
      setUrlSlashPickerOpen(false);
      return;
    }
    if (displayMode === "link") {
      insertInlineAtSlash(editor, currentBlock, [
        { type: "link", href: entry.url, content: [{ type: "text", text: entry.name, styles: {} }] },
        { type: "text", text: " ", styles: {} },
      ]);
      // 既存エントリの usedIn にこのノートをマージする（peek の保存は syncUsedIn を
      // 通らないため。handleAddUrlBookmark は重複 URL のとき usedIn をマージする）
      onAddUrlBookmark?.({
        ...entry,
        usedIn: [{ noteId, noteTitle: docRef.current?.title ?? "", blockId: currentBlock.id }],
      });
      setUrlSlashPickerOpen(false);
      return;
    }
    editor.insertBlocks(
      [{
        type: "bookmark",
        props: {
          url: entry.url,
          title: entry.name,
          description: entry.urlMeta?.description ?? "",
          ogImage: entry.urlMeta?.ogImage ?? "",
          domain: entry.urlMeta?.domain ?? extractDomain(entry.url),
        },
      }],
      currentBlock,
      "after",
    );
    const content = currentBlock.content;
    if (
      Array.isArray(content) &&
      content.length <= 1 &&
      (!content[0] || (content[0].type === "text" && content[0].text.replace("/", "").trim() === ""))
    ) {
      editor.removeBlocks([currentBlock]);
    }
    setUrlSlashPickerOpen(false);
  }, [insertInlineAtSlash, onAddUrlBookmark, noteId]);

  // メモピッカーから挿入
  const handleMemoSelect = useCallback((entry: CaptureEntry) => {
    const editor = editorRef.current;
    if (!editor) return;
    const block = buildMemoInsertBlock(entry);
    if (!block) return;
    const currentBlock = editor.getTextCursorPosition()?.block;
    if (currentBlock) {
      editor.insertBlocks([block], currentBlock, "after");
      const content = currentBlock.content;
      if (Array.isArray(content) && content.length <= 1) {
        const text = content[0]?.text?.trim() ?? "";
        if (text === "" || text === "/memo") {
          editor.removeBlocks([currentBlock]);
        }
      }
    }
    setMemoPickerOpen(false);
  }, []);

  // 表示・編集の基準ドキュメント。タイトル編集は doc（state）にのみ反映されるため
  // doc を優先する。初回レンダリング（load effect 実行前）は doc が null なので
  // mount 時の cachedDoc へフォールバックして即時表示を維持する。
  // （cachedDoc を優先すると title 編集が stale な cachedDoc.title に固定され、
  //  サイドピークで「タイトルが変えられない」不具合になる。）
  const effectiveDoc = doc ?? initialCachedDoc;
  const initialContent = effectiveDoc?.pages?.[0]?.blocks?.length
    ? sanitizeBlocks(effectiveDoc.pages[0].blocks)
    : undefined;

  // docRef も cachedDoc から即時設定（保存時に必要）
  if (initialCachedDoc && !docRef.current) {
    docRef.current = initialCachedDoc;
  }

  // getCachedDoc は親の再レンダーで変わり得るため ref 経由で最新を参照する
  // （doSave の依存を noteId のみに保つ。labelStoreRef 等と同じ流儀）
  const getCachedDocRef = useRef(getCachedDoc);
  getCachedDocRef.current = getCachedDoc;

  // 保存処理（ref 経由で最新の store を参照し、依存を noteId のみに安定化）
  const doSave = useCallback(async () => {
    const editor = editorRef.current;
    if (!editor || !docRef.current) return;

    const currentBlocks = editor.document;
    // ページ差分フィールド（labels / provLinks / knowledgeLinks / blockAlignments）は
    // メインエディタ（note-app.tsx buildDocument）と同じ組み立てを共有モジュールに集約。
    // リンクは restoreLinks 済みの linkStore を真実として layer 別に書き出す
    // （/claims /Insights の引用で追加した reference リンクを永続化するため）。
    const { labels, provLinks, knowledgeLinks, blockAlignments } = buildSavedPageFields({
      labelStore: labelStoreRef.current,
      linkStore: linkStoreRef.current,
      blockAlignmentStore: blockAlignmentStoreRef.current,
    });

    // chats はピーク内で編集されないため、doc キャッシュ側が新しければそちらを
    // 採用する（チャット run のアプリレベル書き戻しが、ピーク表示中のノートの
    // chats を更新した場合に docRef の旧 chats で巻き戻さないため）
    const latestChats = getCachedDocRef.current?.(noteId)?.chats;

    // SidePeek は歴史的に syncUsedIn / recordRevision を迂回する（=メタデータは
    // docRef.current の spread で温存する）。この迂回はバグではなく現行仕様であり、
    // 共有モジュール（saveNoteDoc）も来歴・usedIn 同期は行わない。統合は別 PR。
    const updatedDoc: GraphiumDocument = {
      ...docRef.current,
      ...(latestChats ? { chats: latestChats } : {}),
      pages: [
        {
          ...docRef.current.pages[0],
          blocks: currentBlocks,
          labels,
          provLinks,
          knowledgeLinks,
          blockAlignments,
        },
      ],
      modifiedAt: new Date().toISOString(),
    };

    setSaveStatus("saving");
    try {
      // saveNoteDoc が provider への保存と wiki:/skill: の振り分けを担い、
      // 保存成功時のみ onSaved を発火する（#514: 保存後 reindex 漏れ防止の順序を強制）。
      await saveNoteDoc({
        noteId,
        doc: updatedDoc,
        onSaved: (savedId, savedDoc) => {
          docRef.current = savedDoc;
          setSaveStatus("saved");
          // 親の doc キャッシュ / インデックスを保存済み doc で最新化する。
          // これが無いと再オープン時に stale な cachedDoc が出て、そこからの保存で
          // 旧内容がディスクへ書き戻される。
          onSavedRef.current?.(savedId, savedDoc);
        },
      });
    } catch (err) {
      console.error("サイドピーク保存に失敗:", err);
      setSaveStatus("dirty");
    }
  }, [noteId]);

  const doSaveRef = useRef(doSave);
  useEffect(() => {
    doSaveRef.current = doSave;
  }, [doSave]);

  // 変更検知 → ラベル自動設定 + 3秒後に自動保存
  // labelAutoRef はメインエディタ（note-app.tsx の handleContentChange）と同様、
  // 毎変更時に呼ぶ契約（箇条書き Enter のラベル継承・削除ブロックの孤立ラベル清掃）
  const handleChange = useCallback(() => {
    setSaveStatus("dirty");
    labelAutoRef.current?.();
    if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current);
    autoSaveTimerRef.current = setTimeout(() => {
      doSaveRef.current();
    }, 3000);
  }, []);

  // URL ペーストメニュー → ブックマーク/リンク選択（メインエディタと同じ挙動）。
  // 素材登録の usedIn にはこのピークのノートを入れる: SidePeek の保存
  // （doSave）は provider 直呼びで syncUsedIn を通らないため、登録時点で
  // 利用ノートを確定させないとアセットグラフ・近傍グラフに URL が出ない
  // （次にメインエディタで保存されたとき syncUsedIn が正として上書きする）。
  // エディタ変更（insertBlocks / updateBlock）は onChange 経由で自動保存される。
  const buildPeekUsage = useCallback((blockId: string) => ([{
    noteId,
    noteTitle: docRef.current?.title ?? "",
    blockId,
  }]), [noteId]);

  const handlePasteBookmarkSelect = useCallback((url: string, blockId: string) => {
    setPastedUrl(null);
    const editor = editorRef.current;
    if (!editor) return;
    const insertedId = insertBookmarkBlockFromPaste(editor, url, blockId);
    // 挿入に失敗した場合（ブロック消失など）は usedIn を充填しない
    // （実体のないグラフエッジを作らない。登録自体はメインエディタと同様に行う）
    registerUrlAsset(url, insertedId ? buildPeekUsage(insertedId) : [], onAddUrlBookmark);
  }, [buildPeekUsage, onAddUrlBookmark]);

  const handlePasteLinkSelect = useCallback((url: string, blockId: string) => {
    setPastedUrl(null);
    const editor = editorRef.current;
    retroLinkifyPastedUrl(editor, url, blockId);
    // リンクが実際にブロックに存在する場合のみ usedIn を充填する
    // （codeBlock などリンク化が no-op のケースで実体のないエッジを作らない）
    const linked = blockContainsUrlLink(editor, blockId, url);
    registerUrlAsset(url, linked ? buildPeekUsage(blockId) : [], onAddUrlBookmark);
  }, [buildPeekUsage, onAddUrlBookmark]);

  // 文脈ラベルの初期化（ノートを開いた最初のロード時に doc から取り込む。noteId 単位で一度だけ、
  // 以降の本文編集による doc 変化ではリセットしない）。
  useEffect(() => {
    if (!effectiveDoc) return;
    if (contextsInitRef.current === noteId) return;
    contextsInitRef.current = noteId;
    setPeekContexts(normalizeNoteContexts(effectiveDoc.noteContexts) ?? []);
  }, [effectiveDoc, noteId]);

  // 文脈ラベルの更新: ローカル state + docRef を更新し、SidePeek 自身の doSave で保存する
  // （doSave は ...docRef.current を spread するので noteContexts も一緒に書き出される）。
  // 保存の完了を待ってから onNoteContextsChange に「保存済み doc」を渡し、一覧インデックスと
  // doc キャッシュを再構築させる。await してから通知することで、一覧復帰時に ensureIndex が
  // 保存前の古いノートファイルを読んで index を上書きしてしまう競合を避ける。
  const applyPeekContexts = useCallback(
    async (next: string[]) => {
      const normalized = normalizeNoteContexts(next);
      setPeekContexts(normalized ?? []);
      if (docRef.current) {
        docRef.current = { ...docRef.current, noteContexts: normalized };
      }
      setDoc((d) => (d ? { ...d, noteContexts: normalized } : d));
      await doSaveRef.current();
      onNoteContextsChange?.(noteId, docRef.current);
    },
    [noteId, onNoteContextsChange],
  );

  // 配置揃え変更時にもオートセーブをトリガー（editor.onChange を通らないため）
  const prevAlignmentsRef = useRef(blockAlignmentStore.alignments);
  useEffect(() => {
    if (prevAlignmentsRef.current !== blockAlignmentStore.alignments) {
      prevAlignmentsRef.current = blockAlignmentStore.alignments;
      handleChange();
    }
  }, [blockAlignmentStore.alignments, handleChange]);

  // Cmd+S / Ctrl+S
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "s") {
        const peekEl = sidePeekRef.current;
        if (peekEl && peekEl.contains(document.activeElement)) {
          e.preventDefault();
          e.stopPropagation();
          if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current);
          doSaveRef.current();
        }
      }
    };
    document.addEventListener("keydown", handler, { capture: true });
    return () => document.removeEventListener("keydown", handler, { capture: true });
  }, []);

  // 閉じるときに未保存を保存
  const handleClose = useCallback(async () => {
    if (autoSaveTimerRef.current) {
      clearTimeout(autoSaveTimerRef.current);
      autoSaveTimerRef.current = null;
    }
    try {
      if (saveStatus === "dirty") {
        await doSaveRef.current();
      }
    } catch (err) {
      console.error("閉じる前の保存に失敗:", err);
    }
    onClose();
  }, [saveStatus, onClose]);

  // フルで開くときも保存
  const handleNavigate = useCallback(async () => {
    if (autoSaveTimerRef.current) {
      clearTimeout(autoSaveTimerRef.current);
      autoSaveTimerRef.current = null;
    }
    try {
      if (saveStatus === "dirty") {
        await doSaveRef.current();
      }
    } catch (err) {
      console.error("遷移前の保存に失敗:", err);
    }
    // 保存済みドキュメントを渡してキャッシュ即時更新（API再取得の遅延を回避）
    onNavigate(noteId, docRef.current ?? undefined);
  }, [saveStatus, noteId, onNavigate]);

  const statusText = saveStatus === "saving" ? t("common.saving")
    : saveStatus === "dirty" ? t("common.unsaved")
    : t("common.saved");

  const statusColor = saveStatus === "dirty" ? "var(--color-warning)"
    : "var(--color-text-tertiary)";

  const containerStyle: React.CSSProperties = inline
    ? {
        // inline: 親 flex レイアウトに組み込まれる。エディタ領域がその分圧縮される。
        // 狭いデスクトップ（768〜1100px）で固定 480px だとエディタが極端に細るため、
        // ビューポート幅に応じて 320〜480px の範囲で伸縮させる。
        position: "relative",
        height: "100%",
        flexShrink: 0,
        width: "clamp(320px, 38vw, 480px)",
        background: "var(--color-card)",
        borderLeft: "1px solid var(--color-border-subtle)",
        display: "flex",
        flexDirection: "column",
        animation: "sidePeekSlideIn 0.2s ease-out",
      }
    : {
        // overlay（従来）: 画面右端から fixed で被せる
        position: "fixed",
        top: 0,
        right: 0,
        bottom: 0,
        width: "55%",
        // 小型スマホ（〜420px）で固定 400px だと画面外にはみ出すため、ビューポート幅で頭打ちにする
        minWidth: "min(400px, 90vw)",
        maxWidth: 800,
        background: "var(--color-card)",
        borderLeft: "1px solid var(--color-border-subtle)",
        boxShadow: "-4px 0 24px rgba(0,0,0,0.08)",
        zIndex: 100,
        display: "flex",
        flexDirection: "column",
        animation: "sidePeekSlideIn 0.2s ease-out",
      };

  const body = (
    <div
      ref={sidePeekRef}
      data-side-peek
      style={containerStyle}
    >
      {/* ヘッダー */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 4,
          padding: "8px 12px",
          borderBottom: "1px solid var(--color-border-subtle)",
          background: "var(--color-surface)",
          flexShrink: 0,
        }}
      >
        <button
          onClick={handleClose}
          title={t("sidePeek.close")}
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            width: 28,
            height: 28,
            borderRadius: 4,
            border: "none",
            background: "transparent",
            cursor: "pointer",
            color: "var(--color-text-tertiary)",
            transition: "background 0.15s",
          }}
          onMouseEnter={(e) => {
            (e.currentTarget as HTMLElement).style.background = "var(--color-surface-hover)";
          }}
          onMouseLeave={(e) => {
            (e.currentTarget as HTMLElement).style.background = "transparent";
          }}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="13 17 18 12 13 7" />
            <polyline points="6 17 11 12 6 7" />
          </svg>
        </button>

        <button
          onClick={handleNavigate}
          title={t("sidePeek.fullscreen")}
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            width: 28,
            height: 28,
            borderRadius: 4,
            border: "none",
            background: "transparent",
            cursor: "pointer",
            color: "var(--color-text-tertiary)",
            transition: "background 0.15s",
          }}
          onMouseEnter={(e) => {
            (e.currentTarget as HTMLElement).style.background = "var(--color-surface-hover)";
          }}
          onMouseLeave={(e) => {
            (e.currentTarget as HTMLElement).style.background = "transparent";
          }}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="15 3 21 3 21 9" />
            <line x1="14" y1="10" x2="21" y2="3" />
            <polyline points="9 21 3 21 3 15" />
            <line x1="10" y1="14" x2="3" y2="21" />
          </svg>
        </button>

        <span
          style={{
            flex: 1,
            fontSize: 13,
            fontWeight: 600,
            color: "var(--color-foreground)",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            marginLeft: 4,
          }}
        >
          {effectiveDoc?.title ?? ""}
        </span>

        {!noteId.startsWith("wiki:") && (
          <KnowledgeStatusChip
            wikiEntries={wikiEntries ?? []}
            onAdd={onAddToKnowledge}
            onOpen={(wikiNoteId) => onNavigate(wikiNoteId)}
          />
        )}

        <span
          style={{
            fontSize: 10,
            color: statusColor,
            flexShrink: 0,
            fontWeight: 500,
          }}
        >
          {statusText}
        </span>
      </div>

      {/* コンテンツ */}
      <div ref={setWrapperEl} data-label-wrapper style={{ flex: 1, overflow: "auto", background: "var(--color-background)", position: "relative" }}>
        {loading && (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              height: 200,
              color: "var(--color-text-tertiary)",
              fontSize: 13,
            }}
          >
            {t("common.loading")}
          </div>
        )}
        {error && (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              height: 200,
              color: "var(--color-destructive)",
              fontSize: 13,
            }}
          >
            {error}
          </div>
        )}
        {/* initialContent ではなく effectiveDoc でゲートする。空ノート（blocks 0 件、
            例: `@` から新規作成した直後）は initialContent が undefined になるが、
            SandboxEditor は undefined を既定の空段落として扱えるので、編集可能な
            エディタ本体を描画する必要がある。 */}
        {!loading && !error && effectiveDoc && (
          <>
            <ProvIndicatorLayer wrapperEl={wrapperEl} />
            <BlockHoverHighlight wrapperEl={wrapperEl} zIndex={101} />
            <ProvIndicatorHoverHint wrapperEl={wrapperEl} zIndex={101} />
            <LabelDropdownPortal />
            {/* 右ガター（80px）はラベル/リンクのインジケータを置く場所。
                何も付いていないノートでは左右非対称な余白が「歪み」に見えるため、
                ラベルもリンクも無いときは左右対称（24px）にする。 */}
            <div
              style={{
                padding: "16px 24px",
                paddingRight:
                  labelStore.labels.size > 0 || linkStore.links.length > 0 ? 80 : 24,
              }}
            >
              {/* アーカイブ済みノートの状態表示 + 復元導線。エディタは read-only
                  （editable={!archived}）なので、ここで状態を可視化する。 */}
              {archived && (
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    marginBottom: 12,
                    padding: "6px 12px",
                    borderRadius: "var(--r-1)",
                    background: "var(--paper)",
                    border: "1px solid var(--rule)",
                    color: "var(--ink-2)",
                    fontSize: 13,
                  }}
                >
                  <Archive size={14} style={{ flexShrink: 0, color: "var(--ink-3)" }} />
                  <span style={{ flex: 1, lineHeight: 1.4 }}>{t("archive.archivedHint")}</span>
                  {onRestoreFromArchive && (
                    <button
                      onClick={onRestoreFromArchive}
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        gap: 4,
                        flexShrink: 0,
                        padding: "4px 10px",
                        borderRadius: "var(--r-1)",
                        border: "1px solid var(--rule)",
                        background: "var(--paper-2)",
                        color: "var(--ink-2)",
                        fontSize: 12,
                        fontWeight: 500,
                        cursor: "pointer",
                      }}
                      title={t("archive.restore")}
                    >
                      <ArchiveRestore size={13} />
                      {t("archive.restore")}
                    </button>
                  )}
                </div>
              )}
              {/* ゴミ箱ノートの状態表示 + 復元導線。archived と排他。 */}
              {trashed && (
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    marginBottom: 12,
                    padding: "6px 12px",
                    borderRadius: "var(--r-1)",
                    background: "var(--paper)",
                    border: "1px solid var(--rule)",
                    color: "var(--ink-2)",
                    fontSize: 13,
                  }}
                >
                  <Trash2 size={14} style={{ flexShrink: 0, color: "var(--ink-3)" }} />
                  <span style={{ flex: 1, lineHeight: 1.4 }}>{t("trash.trashedHint")}</span>
                  {onRestoreFromTrash && (
                    <button
                      onClick={onRestoreFromTrash}
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        gap: 4,
                        flexShrink: 0,
                        padding: "4px 10px",
                        borderRadius: "var(--r-1)",
                        border: "1px solid var(--rule)",
                        background: "var(--paper-2)",
                        color: "var(--ink-2)",
                        fontSize: 12,
                        fontWeight: 500,
                        cursor: "pointer",
                      }}
                      title={t("trash.restoreFromTrash")}
                    >
                      <ArchiveRestore size={13} />
                      {t("trash.restoreFromTrash")}
                    </button>
                  )}
                </div>
              )}
              <textarea
                value={effectiveDoc?.title ?? ""}
                onChange={(e) => {
                  const newTitle = e.target.value.replace(/\r?\n/g, "");
                  if (docRef.current) {
                    docRef.current = { ...docRef.current, title: newTitle };
                  }
                  setDoc((d) => (d ? { ...d, title: newTitle } : d));
                  handleChange();
                }}
                onInput={(e) => {
                  const el = e.currentTarget;
                  el.style.height = "auto";
                  el.style.height = el.scrollHeight + "px";
                }}
                ref={(el) => {
                  if (el) {
                    el.style.height = "auto";
                    el.style.height = el.scrollHeight + "px";
                  }
                }}
                {...titleCompositionHandlers}
                onKeyDown={(e) => {
                  // IME 変換確定の Enter を奪わない。isComposing / keyCode 229 だけの
                  // ガードでは WKWebView（デスクトップ）の compositionend → keydown(13)
                  // 順を取りこぼし、確定 Enter でフォーカスが本文へ飛んで確定文字が
                  // 本文の 1 行目へ流れ込む（同じ文字の二重出現・迷子の改行の原因）。
                  if (e.key === "Enter" && !isTitleImeKey(e)) {
                    e.preventDefault();
                    editorRef.current?.focus();
                  }
                }}
                rows={1}
                placeholder={tStatic("editor.titlePlaceholder")}
                aria-label={tStatic("editor.titlePlaceholder")}
                className="block w-full bg-transparent border-none outline-none text-foreground placeholder:text-muted-foreground/50 text-3xl font-bold leading-tight mt-1 mb-4 px-[54px] resize-none overflow-hidden break-words"
              />
              {/* 文脈タグ行（タイトル直下・人間ノートのみ）。メインエディタと同じ見た目。
                  保存は SidePeek 自身の doSave（noteContexts も spread で書き出す）。 */}
              {effectiveDoc &&
                effectiveDoc.source !== "ai" &&
                effectiveDoc.source !== "skill" &&
                !noteId.startsWith("wiki:") &&
                !noteId.startsWith("skill:") &&
                (peekContexts.length > 0 || !archived) && (
                  <div className="px-[54px] -mt-2 mb-4 flex flex-wrap items-center gap-1.5">
                    {peekContexts.map((c) => (
                      <ContextBadge
                        key={c}
                        value={c}
                        onRemove={
                          archived
                            ? undefined
                            : () => applyPeekContexts(removeNoteContext(peekContexts, c) ?? [])
                        }
                        removeLabel={t("nav.removeContext")}
                      />
                    ))}
                    {!archived && (
                      <button
                        type="button"
                        onClick={(e) => {
                          if (peekContextPickerPos) {
                            setPeekContextPickerPos(null);
                            return;
                          }
                          const r = e.currentTarget.getBoundingClientRect();
                          setPeekContextPickerPos({ top: r.bottom + 4, left: r.left });
                        }}
                        className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full border border-dashed border-border text-muted-foreground hover:text-foreground hover:border-primary/40 transition-colors"
                        title={peekContexts.length > 0 ? t("nav.addContext") : t("nav.noteContextsTooltip")}
                      >
                        ＋ {t("nav.noteContexts")}
                      </button>
                    )}
                    {peekContextPickerPos && (
                      <ContextTagPicker
                        position={peekContextPickerPos}
                        onClose={() => setPeekContextPickerPos(null)}
                        title={t("nav.noteContexts")}
                        selected={peekContexts}
                        suggestions={aggregateNoteContexts(noteIndex?.notes ?? [])}
                        placeholder={t("nav.contextPlaceholder")}
                        createLabel={(v) => t("nav.createContext", { value: v })}
                        clearLabel={t("nav.clearContexts")}
                        emptyText={t("nav.contextEmpty")}
                        onDeleteCandidate={onDeleteContextEverywhere}
                        onAdd={(v) => applyPeekContexts(addNoteContext(peekContexts, v) ?? [])}
                        onRemove={(v) => applyPeekContexts(removeNoteContext(peekContexts, v) ?? [])}
                        onClear={() => applyPeekContexts([])}
                      />
                    )}
                  </div>
                )}
              {/* wiki の成長ストリップ（タイトル直下・文脈タグ行の鏡像）。
                  SidePeek には WikiBanner / 履歴タブが無いパリティギャップの最小埋め:
                  #553 で記録される wiki_* 操作のサマリを 1 行で出す。
                  育っていないエントリには何も出さない（summarizeWikiGrowth が undefined）。 */}
              {effectiveDoc && noteId.startsWith("wiki:") && (() => {
                const growth = summarizeWikiGrowth(effectiveDoc);
                if (!growth) return null;
                const key = activityTypeLabelKey(growth.lastOp);
                const op = key ? t(key as never) : growth.lastOp;
                return (
                  <div className="px-[54px] -mt-2 mb-4 flex items-center gap-1.5 text-xs text-muted-foreground">
                    <TrendingUp size={12} className="shrink-0" />
                    {t("graph.growthSummary", { count: String(growth.count), op })}
                  </div>
                );
              })()}
              {/* table / audio / file の配置揃えを CSS で適用 */}
              <AlignmentStyleLayer />
              <SandboxEditor
                key={noteId}
                editable={!archived && !trashed}
                blocks={customBlockEntries}
                initialContent={initialContent}
                sideMenu={SidePeekSideMenu}
                // メインエディタと同じ slash items を出す。
                // 各 slash item の onItemClick はクリック時のエディタを
                // ピッカーに渡すよう改修済みなので、SidePeek で開いた場合は
                // SidePeek のエディタに挿入される。
                extraSlashMenuItems={[
                  ...(provLabelsEnabled ? buildLabelSlashMenuItems() : []),
                  ...getMediaSlashMenuItems(),
                  bookmarkSlashItem,
                  calloutSlashItem,
                  getMemoSlashMenuItem(),
                  ...(noteIndex ? getCiteSlashMenuItems() : []),
                ]}
                excludeDefaultSlashTitles={DEFAULT_MEDIA_SLASH_TITLES}
                onEditorReady={handleEditorReady}
                onChange={handleChange}
                onHashtagSelect={(blockId, label) => labelStoreRef.current.setLabel(blockId, label)}
                // `@` 参照: 他ノートの参照 + 「新規ノートを作成」。メインエディタと同じく
                // 挿入後はピーク内に留まり、青い @テキストをクリックすると（note-app の
                // document クリックハンドラが .bn-editor を拾うため）サイドピークで開く。
                getMentionSuggestions={(query) => {
                  // 見出し候補は DOM 全体から拾ってしまい（メイン+ピークが同居）紛れるため、
                  // ピークでは他ノート参照と新規作成のみに絞る。
                  const base = getNoteSuggestions([], noteId, noteIndex);
                  if (onCreateLinkedNote) {
                    const createItem = getCreateNoteSuggestion(query, base);
                    if (createItem) base.push(createItem);
                  }
                  return base;
                }}
                onMentionSelect={async (sourceBlockId, suggestion) => {
                  let s = suggestion;
                  if (s.id === CREATE_NEW_NOTE_ID) {
                    if (!onCreateLinkedNote) return;
                    // 名前の確定は必ず IME 安全な入力欄で。打った文字は下書きとして渡す。
                    const draft = s.createTitle ?? "";
                    const title = (await promptNoteName(draft))?.trim() ?? "";
                    if (!title) return;
                    const newId = await onCreateLinkedNote(title, noteId);
                    if (!newId) return;
                    s = { type: "note", id: newId, label: title, group: "" };
                  }
                  if (s.type !== "note") return;
                  linkStoreRef.current.addLink({
                    sourceBlockId,
                    targetBlockId: "",
                    targetNoteId: s.id,
                    type: "reference",
                    createdBy: "human",
                  });
                  const noteRefId = s.id;
                  const label = s.label;
                  setTimeout(() => {
                    // href に noteId を埋めた link として挿入（同名ノートでも正しく解決）
                    insertNoteMentionInline(editorRef.current, noteRefId, label);
                    handleChange();
                  }, 100);
                }}
                // メインエディタと同様にメディア URL を解決する。
                // これがないと image / video / audio のブロックが
                // local-media:// 等の生 URL のままになり、BlockNote
                // デフォルトの「ファイル読み込み中」状態で止まって見える。
                resolveFileUrl={async (url: string) => {
                  const p = getActiveProvider();
                  const fid = p.extractFileId(url);
                  if (fid) return p.getMediaBlobUrl(fid);
                  return url;
                }}
              />
            </div>
          </>
        )}
      </div>

      <style>{`
        @keyframes sidePeekSlideIn {
          from { transform: translateX(100%); }
          to { transform: translateX(0); }
        }
      `}</style>

      {/* @ メニュー「新しいノートを作成」の名前入力ダイアログ（IME 安全） */}
      {newNoteNameDialog}

      {/* URL ペースト → ブックマーク/リンク選択メニュー（メインエディタと同じ） */}
      {pastedUrl && (
        <UrlPasteMenu
          url={pastedUrl.url}
          position={pastedUrl.position}
          onSelectBookmark={() => handlePasteBookmarkSelect(pastedUrl.url, pastedUrl.blockId)}
          onSelectLink={() => handlePasteLinkSelect(pastedUrl.url, pastedUrl.blockId)}
          onDismiss={() => setPastedUrl(null)}
        />
      )}

      {/* スラッシュメニューのピッカーモーダル。
          SidePeek overlay (z-index:100) より前面に出すため、
          z-index:200 の wrapper で stacking context を切る。
          (MediaPickerModal の内部 z-50 は wrapper 内で相対化される。) */}
      <div style={{ position: "fixed", inset: 0, zIndex: 200, pointerEvents: pickerMediaType || urlSlashPickerOpen || memoPickerOpen || citePickerKind ? "auto" : "none" }}>
        {pickerMediaType && (
          <MediaPickerModal
            mediaIndex={mediaIndex ?? null}
            mediaType={pickerMediaType}
            onSelect={handlePickerSelect}
            onClose={() => setPickerMediaType(null)}
            onUpload={uploadFile}
            allowDisplayMode
          />
        )}
        {citePickerKind && (
          <CitePickerModal
            noteIndex={noteIndex ?? null}
            kind={citePickerKind}
            onConfirm={handleCiteConfirm}
            onClose={() => setCitePickerKind(null)}
          />
        )}
        {urlSlashPickerOpen && (
          <MediaPickerModal
            mediaIndex={mediaIndex ?? null}
            mediaType="url"
            onSelect={handleUrlSlashPickerSelect}
            onClose={() => setUrlSlashPickerOpen(false)}
            onAddUrlBookmark={onAddUrlBookmark}
            allowDisplayMode
          />
        )}
        <MemoPickerModal
          open={memoPickerOpen}
          onClose={() => setMemoPickerOpen(false)}
          captureIndex={captureIndex ?? null}
          onSelect={handleMemoSelect}
        />
      </div>
    </div>
  );

  if (inline) return body;
  return createPortal(body, document.body);
}
