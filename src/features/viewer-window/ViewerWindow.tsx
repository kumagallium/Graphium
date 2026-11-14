// 別ウィンドウのページ。
//
// メインのウィンドウとは別の JS 文脈で動く。NoteApp は載せない（索引・裏の処理・全文の索引を
// 2 つ動かさないため）。出し方は 2 つあり、メインからの知らせ（holds）で切り替える
// （決まりごとは lib/viewer-window.ts の「編集の受け渡し」）:
//
//   編集    … メインがこのノートを開いていないとき。サイドピークと同じ編集部品（SidePeek）を
//             ウィンドウいっぱいに出す。保存はここから行い、メインへ知らせる
//   表示のみ … メインがこのノートを開いているとき・メインの答えがまだ無いとき・版のスナップショット。
//             保存先から読んだノートを読み取り専用で描く。ここからは何も保存しない
//
// 表示のみの中身は次のときに読み直す:
//   - メインがこのノートを保存した（onViewerNoteSaved）
//   - このウィンドウが手前に来た（連絡が届かなかったときの保険）
// 読み直して中身が同じなら描き直さない（読んでいる位置が飛ばないように）。
//
// 編集の出し方では、本文の右に「ステップ」「グラフ」「メモ」のパネルを開ける（1 つだけ。タブで切り替える）。
// 全ノートの本文はここでは読まない:
//   - グラフはメインが作って返す（viewer-requests.ts の requestNoteGraph）
//   - メモの索引はここで読むだけ。作成・削除はメインに頼む（書くのはメインだけ）

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ListChecks, Network, PanelsTopLeft, StickyNote } from "lucide-react";
import type { GraphiumDocument } from "../../lib/document-types";
import { loadViewerDoc, viewerDocSignature } from "./load-viewer-doc";
import { SandboxEditor } from "../../base/editor";
import { customBlockEntries, sanitizeBlocksForLoad } from "../../blocks/registry";
import { useRemoteContentScope } from "../../blocks/remote-content";
import { LabelStoreProvider, ProvLabelsEnabledProvider } from "../context-label/store";
import { LinkStoreProvider, useLinkStore } from "../block-link/store";
import { TableMetaStoreProvider, useTableMetaStore, migrateTableMeta } from "../table-meta";
import { MediaInlineLabelProvider } from "../inline-label/media-store";
import { BlockAlignmentProvider, useBlockAlignmentStore, AlignmentStyleLayer } from "../block-alignment";
import { MemoQuoteProvider, useMemoQuoteStore } from "../memo-quote";
import { AiAssistantProvider } from "../ai-assistant/store";
import { useT } from "../../i18n";
import {
  ackViewerClose,
  onMessageFromMain,
  onViewerCloseRequested,
  onViewerNoteSaved,
  onViewerTargetChange,
  requestOpenInMain,
  sendToMain,
  type ViewerTarget,
} from "../../lib/viewer-window";
import {
  applyLiveBodyWidth,
  applyLiveExternalDoc,
  applyLiveMentionRename,
  flushPeekSaves,
  pendingPeekSave,
} from "../../lib/peek-save-queue";
import { flushEditorsBeforeExit } from "../../lib/flush-on-exit";
import { readIndexFile, type GraphiumIndex } from "../navigation/index-file";
import { SidePeek, type PeekStandalonePanelArgs } from "../index-table/side-peek";
import { ProvGraphPanel } from "../prov-generator/view";
import { useProvGeneration } from "../../hooks/use-prov-generation";
import { useLabelStore } from "../context-label/store";
import { isProvLabelsEnabled } from "../settings";
import { useMediaInlineLabelStore } from "../inline-label/media-store";
import { GraphLinksPanel } from "../network-graph";
import { NoteMemosSection } from "../asset-browser/NoteMemosSection";
import { readCaptureIndex, resolveMemoBlockLabel, type CaptureIndex } from "../mobile-capture";
import type { ViewerNoteGraph } from "../../lib/viewer-window";
import { requestMemoCreate, requestMemoDelete, requestNoteGraph } from "./viewer-requests";

type LoadState =
  | { phase: "loading" }
  | { phase: "ready"; doc: GraphiumDocument; signature: string }
  | { phase: "error"; message: string };

/** このウィンドウが最後に読んだ・保存した doc（保存のとき、メインが書いた chats などを古い値で戻さないため） */
const viewerDocCache = new Map<string, GraphiumDocument>();

/** メインからの知らせ（holds）を待つ間、問い合わせを繰り返す間隔 */
const HELLO_RETRY_MS = 1000;
/**
 * メインの知らせがこれだけ途絶えたら、そのメインはいないものとして扱う（タブを閉じた・固まった）。
 * メインは main-bridge の HOLDS_HEARTBEAT_MS ごとに送り直す
 */
const MAIN_STALE_MS = 13000;

/**
 * メインが開いているノートの一覧を追う。answered は、生きているメインが 1 つでも答えたか
 * （答えが無いうちは編集させない）
 */
function useMainHolds(): { answered: boolean; isHeld: (id: string) => boolean } {
  const mainsRef = useRef(new Map<string, { ids: Set<string>; seen: number }>());
  const [, bump] = useState(0);
  useEffect(() => {
    const mains = mainsRef.current;
    const off = onMessageFromMain((msg) => {
      if (msg.type === "holds") {
        const prev = mains.get(msg.mainId);
        mains.set(msg.mainId, { ids: new Set(msg.ids), seen: Date.now() });
        // 中身が同じ送り直し（生きている印）では描き直さない
        if (prev && prev.ids.size === msg.ids.length && msg.ids.every((id) => prev.ids.has(id))) return;
      } else if (msg.type === "bye") {
        if (!mains.delete(msg.mainId)) return;
      } else return;
      bump((n) => n + 1);
    });
    sendToMain({ type: "hello" });
    const timer = setInterval(() => {
      const now = Date.now();
      let pruned = false;
      for (const [mainId, main] of mains) {
        if (now - main.seen > MAIN_STALE_MS) {
          mains.delete(mainId);
          pruned = true;
        }
      }
      if (pruned) bump((n) => n + 1);
      // 受け口の登録（デスクトップは非同期）より先に答えが返ると取りこぼすので、答えが来るまで聞き直す
      if (mains.size === 0) sendToMain({ type: "hello" });
    }, HELLO_RETRY_MS);
    return () => {
      off();
      clearInterval(timer);
    };
  }, []);
  const mains = mainsRef.current;
  return {
    answered: mains.size > 0,
    isHeld: (id) => {
      for (const main of mains.values()) if (main.ids.has(id)) return true;
      return false;
    },
  };
}

export function ViewerWindow({ initialTarget }: { initialTarget: ViewerTarget }) {
  const [target, setTarget] = useState<ViewerTarget>(initialTarget);
  // デスクトップ: 開いたまま別のものを出すよう頼まれた
  useEffect(() => onViewerTargetChange((next) => setTarget(next)), []);
  const targetId = target.id;
  const targetIdRef = useRef(targetId);
  targetIdRef.current = targetId;

  const { answered, isHeld } = useMainHolds();
  const held = isHeld(targetId);
  // 版のスナップショットは不変（どこでも編集しない）
  const canEdit = answered && !held && !targetId.startsWith("snapshot:");
  // 外から内容が差し替わり、開いている編集部品が受け取れなかったときに作り直す番号
  const [editGen, setEditGen] = useState(0);

  // メインからの頼まれごと。編集部品（SidePeek）は、同じウィンドウのピークと同じ口
  // （lib/peek-save-queue.ts）に登録されているので、そこへ流す
  useEffect(
    () =>
      onMessageFromMain((msg) => {
        switch (msg.type) {
          case "flush": {
            // まず「受け取った」と返す（メインは、これが無ければこのウィンドウを閉じたものとして扱う）
            sendToMain({ type: "flush-ack", nonce: msg.nonce });
            const saves = flushPeekSaves(msg.id);
            const reply = (saved: boolean, doc: GraphiumDocument | null) =>
              sendToMain({ type: "flushed", nonce: msg.nonce, id: msg.id, saved, doc });
            if (!saves) reply(true, viewerDocCache.get(msg.id) ?? null);
            else {
              void saves.then(
                // 書けなかったときは、書こうとした形を返す（メインが開くときに引き取れるように）
                (outcome) => reply(outcome.saved, outcome.saved ? (viewerDocCache.get(msg.id) ?? outcome.doc) : outcome.doc),
                () => reply(false, null),
              );
            }
            return;
          }
          case "mention-rename":
            applyLiveMentionRename(msg.id, msg.renamedId, msg.oldTitle, msg.newTitle, msg.includeWikiLabels);
            return;
          case "body-width":
            viewerDocCache.set(msg.id, msg.doc);
            applyLiveBodyWidth(msg.id, msg.width, msg.doc);
            return;
          case "external-doc":
            viewerDocCache.set(msg.id, msg.doc);
            // 編集部品が受け取れなければ（読み込み中など）、保存先から開き直す
            if (applyLiveExternalDoc(msg.id, msg.doc) === 0 && msg.id === targetIdRef.current) {
              setEditGen((n) => n + 1);
            }
            return;
        }
      }),
    [],
  );

  // デスクトップ: ウィンドウを閉じる前に、未保存の編集を書き出す（Rust が閉じるのを止めて待っている）
  useEffect(
    () =>
      onViewerCloseRequested(async () => {
        await flushEditorsBeforeExit();
        sendToMain({ type: "editing-stopped", id: targetIdRef.current });
        ackViewerClose();
      }),
    [],
  );
  // Web で閉じるときは「編集をやめた」と知らせない。書き出し（installPageExitFlush が始める）の
  // 終わりを待てないので、先に知らせるとメインが書き込み中のファイルを読む。メインは、書き出しを
  // 頼んで返事が無いことで、このウィンドウが閉じたと知る（main-bridge の flush-ack）

  const openNote = useCallback((id: string) => setTarget({ kind: "note", id }), []);

  return (
    <div className="h-dvh flex flex-col bg-background text-foreground" data-viewer-window data-viewer-mode={canEdit ? "edit" : "view"}>
      {canEdit ? (
        <ViewerEditable key={`${targetId}:${editGen}`} noteId={targetId} onOpenNote={openNote} />
      ) : (
        <ViewerReadOnly targetId={targetId} held={held} />
      )}
    </div>
  );
}

type EditState =
  | { phase: "loading" }
  | { phase: "ready"; doc: GraphiumDocument }
  | { phase: "error" };

const noop = () => {};

/** 編集できる出し方。サイドピークの編集部品をウィンドウいっぱいに出す */
function ViewerEditable({ noteId, onOpenNote }: { noteId: string; onOpenNote: (id: string) => void }) {
  const t = useT();
  const [state, setState] = useState<EditState>({ phase: "loading" });
  const [title, setTitle] = useState("");
  // @ で入れる候補・引用・文脈ラベルの候補に使う索引（読むだけ。書くのはメイン）
  const [noteIndex, setNoteIndex] = useState<GraphiumIndex | null>(null);

  useEffect(() => {
    let cancelled = false;
    let announced = false;
    (async () => {
      // 表示のみから切り替わった直後は、このウィンドウの前の編集の書き出しが残っていることがある
      await pendingPeekSave(noteId);
      const doc = await loadViewerDoc(noteId);
      if (cancelled) return;
      viewerDocCache.set(noteId, doc);
      setTitle(doc.title ?? "");
      setState({ phase: "ready", doc });
      announced = true;
      sendToMain({ type: "editing", id: noteId, doc });
      readIndexFile()
        .then((index) => {
          if (!cancelled) setNoteIndex(index);
        })
        .catch(() => {});
    })().catch((e) => {
      console.error("[viewer-window] load failed", e);
      if (!cancelled) setState({ phase: "error" });
    });
    return () => {
      cancelled = true;
      if (!announced) return;
      // 編集部品は外れるときに未保存を書き出す（この後片付けより先に列へ並ぶ）。それが終わってから
      // 「やめた」と知らせる。先に知らせると、メインが書き出しの前のファイルから開く
      const stop = () => sendToMain({ type: "editing-stopped", id: noteId });
      const pending = pendingPeekSave(noteId);
      if (pending) void pending.then(stop, stop);
      else stop();
    };
  }, [noteId]);

  useEffect(() => {
    const shown = title || (state.phase === "ready" ? t("nav.untitled") : "");
    document.title = shown ? `${shown} — Graphium` : "Graphium";
  }, [title, state.phase, t]);

  // メインがこのノートのファイルを書いた（チャットの書き戻し・改名の反映など）。
  // 本文はこのウィンドウのエディタが持っているので描き直さず、次の保存に載せる外側の項目
  // （chats・wikiMeta）だけ新しくなるよう、読んだ doc を控えに入れる
  useEffect(
    () =>
      onViewerNoteSaved((id) => {
        if (id !== noteId) return;
        void loadViewerDoc(id)
          .then((doc) => viewerDocCache.set(id, doc))
          .catch(() => {});
      }),
    [noteId],
  );

  // メインが、このノートを別ウィンドウで編集中だと把握していなければ名乗り直す
  // （メインが読み込み直された・こちらの最初の知らせより後に起きた）。把握されていないと、
  // メインはこのウィンドウに未保存を書き出させずにノートを開く
  const unsavedRef = useRef(false);
  const ready = state.phase === "ready";
  useEffect(() => {
    if (!ready) return;
    return onMessageFromMain((msg) => {
      if (msg.type !== "holds" || msg.remotes.includes(noteId)) return;
      const doc = viewerDocCache.get(noteId);
      if (!doc) return;
      sendToMain({ type: "editing", id: noteId, doc });
      if (unsavedRef.current) sendToMain({ type: "dirty", id: noteId, unsaved: true });
    });
  }, [noteId, ready]);

  // このウィンドウがノートを保存するたびに進める番号（グラフのパネルが読み直す合図）
  const [savedTick, setSavedTick] = useState(0);
  const handleSaved = useCallback((id: string, savedDoc: GraphiumDocument) => {
    viewerDocCache.set(id, savedDoc);
    setTitle(savedDoc.title ?? "");
    sendToMain({ type: "saved", id, doc: savedDoc });
    setSavedTick((n) => n + 1);
  }, []);
  const handleSaveStatus = useCallback(
    (status: "saving" | "saved" | "dirty") => {
      unsavedRef.current = status !== "saved";
      sendToMain({ type: "dirty", id: noteId, unsaved: status !== "saved" });
    },
    [noteId],
  );
  const getCachedDoc = useCallback((id: string) => viewerDocCache.get(id), []);
  const openInMain = useCallback((id: string) => requestOpenInMain(id), []);

  if (state.phase === "loading") {
    return (
      <div className="flex items-center justify-center h-48 text-sm text-muted-foreground">
        {t("common.loading")}
      </div>
    );
  }
  if (state.phase === "error") {
    return (
      <div className="flex items-center justify-center h-48 text-sm text-destructive" role="alert">
        {t("sidePeek.loadError")}
      </div>
    );
  }
  const entry = noteIndex?.notes.find((n) => n.noteId === noteId);
  // 右のパネル（タブ）。アイコンと並びは本体の右パネルと同じ（グラフ → ステップ → メモ）。
  // ナレッジのページ（id に `:` を含む）には出さない。ステップはラベルの機能を切っているときも出さない
  const standalonePanels: {
    id: string;
    label: string;
    icon: ReactNode;
    render: (args: PeekStandalonePanelArgs) => ReactNode;
  }[] = [];
  if (!noteId.includes(":")) {
    standalonePanels.push({
      id: "graph",
      label: t("panel.graph"),
      icon: <Network size={18} />,
      render: () => <ViewerGraphPanel noteId={noteId} savedTick={savedTick} onOpenNote={onOpenNote} />,
    });
    if (isProvLabelsEnabled()) {
      standalonePanels.push({
        id: "prov",
        label: t("panel.prov"),
        icon: <ListChecks size={18} />,
        render: (args) => <ViewerProvPanel args={args} index={noteIndex} />,
      });
    }
    standalonePanels.push({
      id: "memos",
      label: t("panel.memos"),
      icon: <StickyNote size={18} />,
      render: (args) => <ViewerMemosPanel args={args} noteId={noteId} noteTitle={title} />,
    });
  }
  return (
    <MediaInlineLabelProvider>
      <AiAssistantProvider aiAvailable={false}>
        <SidePeek
          noteId={noteId}
          cachedDoc={state.doc}
          standalone
          inline
          onClose={noop}
          onNavigate={openInMain}
          onOpenNoteInPeek={onOpenNote}
          onSaved={handleSaved}
          onSaveStatusChange={handleSaveStatus}
          getCachedDoc={getCachedDoc}
          noteIndex={noteIndex}
          archived={!!entry?.archivedAt}
          trashed={!!entry?.deletedAt}
          standalonePanels={standalonePanels}
        />
      </AiAssistantProvider>
    </MediaInlineLabelProvider>
  );
}

/**
 * 別ウィンドウの右のパネル「ステップ」。メインの右パネルと同じ部品を、このノートのストアと
 * エディタにつないで出す。SidePeek のストアの内側で描かれる（standalonePanels）。
 * 線のメモは出さない（メモの一覧と作成はメインが持つ）
 */
function ViewerProvPanel({
  args,
  index,
}: {
  args: PeekStandalonePanelArgs;
  index: GraphiumIndex | null;
}) {
  const labelStore = useLabelStore();
  const linkStore = useLinkStore();
  const mediaInlineLabelStore = useMediaInlineLabelStore();
  const { provDoc, triggerRegeneration } = useProvGeneration(
    args.editorRef,
    labelStore.labels,
    linkStore.links,
    args.doc.documentProvenance,
    mediaInlineLabelStore.labels,
  );
  const { subscribeChange } = args;
  useEffect(() => subscribeChange(triggerRegeneration), [subscribeChange, triggerRegeneration]);
  return (
    <div className="flex-1 min-h-0 overflow-auto">
      <ProvGraphPanel
        doc={provDoc}
        editorRef={args.editorRef}
        noteId={args.noteId}
        noteContexts={args.noteContexts}
        index={index}
      />
    </div>
  );
}

/** 保存が続くときに、グラフの読み直しをまとめる時間 */
const GRAPH_RELOAD_DEBOUNCE_MS = 1000;

/**
 * 別ウィンドウの右のパネル「グラフ」。グラフはメインが作って返す（全ノートはここで読まない）。
 * 開いたときと、このウィンドウがノートを保存したあと（続けて来る保存は 1 秒ほどまとめる）に頼み直す。
 * 共有ライブラリ由来のノードとメモの引用ノードは足さない（メインの NoteGraphTabPanel は使わない）。
 * 素材・URL・メモを開く口は渡さない（それらを開く画面はこのウィンドウに無い）
 */
function ViewerGraphPanel({
  noteId,
  savedTick,
  onOpenNote,
}: {
  noteId: string;
  savedTick: number;
  onOpenNote: (id: string) => void;
}) {
  const t = useT();
  // loaded=false の間は読み込み中。読み直しの失敗では、出ているグラフを消さない
  const [state, setState] = useState<{ loaded: boolean; graph: ViewerNoteGraph | null }>({
    loaded: false,
    graph: null,
  });
  useEffect(() => {
    let cancelled = false;
    // 最初は待たずに頼む。保存のあとはまとめる
    const timer = setTimeout(
      () => {
        void requestNoteGraph(noteId).then((graph) => {
          if (!cancelled) setState((prev) => ({ loaded: true, graph: graph ?? prev.graph }));
        });
      },
      savedTick === 0 ? 0 : GRAPH_RELOAD_DEBOUNCE_MS,
    );
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [noteId, savedTick]);

  if (!state.loaded) {
    return (
      <div className="flex items-center justify-center h-48 text-sm text-muted-foreground">
        {t("common.loading")}
      </div>
    );
  }
  const { graph } = state;
  if (!graph || (graph.data.nodes.length <= 1 && (graph.lineageTree?.parents.length ?? 0) === 0)) {
    return (
      <div className="flex items-center justify-center h-48 px-4 text-center text-sm text-muted-foreground">
        {t("panel.graph.empty")}
      </div>
    );
  }
  return (
    <div className="flex-1 min-h-0">
      <GraphLinksPanel
        data={graph.data}
        lineageTree={graph.lineageTree}
        // 系譜の素データ（全ノートの本文）はここへ持ち込まない。系譜のタブも出さない（空になるため）
        lineageSources={null}
        hideGenealogy
        onNavigate={onOpenNote}
        onPeek={onOpenNote}
      />
    </div>
  );
}

/**
 * 別ウィンドウの右のパネル「メモ」。メモの索引は読むだけ（書くのはメイン）。
 * 作成・削除はメインに頼み、返事のあとと、メインから索引の変更が知らされたときに読み直す
 */
function ViewerMemosPanel({
  args,
  noteId,
  noteTitle,
}: {
  args: PeekStandalonePanelArgs;
  noteId: string;
  noteTitle: string;
}) {
  const [captureIndex, setCaptureIndex] = useState<CaptureIndex | null>(null);
  const reload = useCallback(() => {
    readCaptureIndex()
      .then(setCaptureIndex)
      .catch(() => {});
  }, []);
  useEffect(() => {
    reload();
    return onMessageFromMain((msg) => {
      if (msg.type === "captures-changed") reload();
    });
  }, [reload]);

  const { editorRef } = args;
  const handleCreate = useCallback(
    async (text: string) => {
      const ok = await requestMemoCreate({ noteId, title: noteTitle || undefined, text });
      reload();
      // 書く欄が書いた文を残せるよう、失敗は reject で返す（知らせは書く欄が出す）
      if (!ok) throw new Error("memo save failed");
    },
    [noteId, noteTitle, reload],
  );
  const handleDelete = useCallback(
    (memoId: string) => {
      void requestMemoDelete(memoId).then(reload);
    },
    [reload],
  );
  const resolveBlockLabel = useCallback(
    (blockId: string) => {
      const block = editorRef.current?.getBlock(blockId);
      return block ? resolveMemoBlockLabel(block) || null : null;
    },
    [editorRef],
  );
  return (
    <div className="flex-1 min-h-0 overflow-auto">
      <NoteMemosSection
        noteFileId={noteId}
        noteTitle={noteTitle}
        captureIndex={captureIndex}
        onCreateMemo={handleCreate}
        onDeleteMemo={handleDelete}
        resolveBlockLabel={resolveBlockLabel}
      />
    </div>
  );
}

/** 表示のみの出し方。held はメインがこのノートを開いているか（開いていなければ、メインの答え待ちか版） */
function ViewerReadOnly({ targetId, held }: { targetId: string; held: boolean }) {
  const t = useT();
  const [state, setState] = useState<LoadState>({ phase: "loading" });
  // 読み直しの合図（増やすと読み直す）
  const [reloadTick, setReloadTick] = useState(0);
  const scrollRef = useRef<HTMLDivElement>(null);
  // 描き直しをまたいで読んでいる位置を保つ
  const keepScrollRef = useRef<number | null>(null);

  // 行き先が変わったら読み込み中から始める（前のノートを出したままにしない）
  const shownIdRef = useRef<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (shownIdRef.current !== targetId) {
      shownIdRef.current = targetId;
      keepScrollRef.current = null;
      setState({ phase: "loading" });
    }
    // 編集から切り替わった直後は、このウィンドウの最後の書き出しが終わってから読む
    Promise.resolve(pendingPeekSave(targetId))
      .then(() => loadViewerDoc(targetId))
      .then((doc) => {
        if (cancelled) return;
        const signature = viewerDocSignature(doc);
        setState((prev) => {
          if (prev.phase === "ready" && prev.signature === signature) return prev;
          if (prev.phase === "ready") keepScrollRef.current = scrollRef.current?.scrollTop ?? null;
          return { phase: "ready", doc, signature };
        });
      })
      .catch((e) => {
        if (cancelled) return;
        // 読み直しの失敗では、出ている中身を消さない（保存の途中に当たっただけのことがある）
        setState((prev) =>
          prev.phase === "ready"
            ? prev
            : { phase: "error", message: e instanceof Error ? e.message : String(e) },
        );
      });
    return () => {
      cancelled = true;
    };
  }, [targetId, reloadTick]);

  // メインがこのノートを保存した → 読み直す。
  // 購読は 1 度だけ張り、いまの行き先は ref で比べる。行き先が変わるたびに張り直すと、
  // 張り直しの間（デスクトップは登録が非同期）に届いた知らせを取りこぼす — 未保存の編集が
  // あるピークから開くと、行き先の差し替え → 保存 → 知らせ、の順に続けて届く
  const targetIdRef = useRef(targetId);
  targetIdRef.current = targetId;
  useEffect(
    () =>
      onViewerNoteSaved((id) => {
        if (id === targetIdRef.current) setReloadTick((n) => n + 1);
      }),
    [],
  );

  // 手前に来たら読み直す（連絡が届かなかったときの保険）
  useEffect(() => {
    const reload = () => {
      if (document.visibilityState === "visible") setReloadTick((n) => n + 1);
    };
    window.addEventListener("focus", reload);
    document.addEventListener("visibilitychange", reload);
    return () => {
      window.removeEventListener("focus", reload);
      document.removeEventListener("visibilitychange", reload);
    };
  }, []);

  const title = state.phase === "ready" ? state.doc.title || t("nav.untitled") : "";
  useEffect(() => {
    document.title = title ? `${title} — Graphium` : "Graphium";
  }, [title]);

  // 描き直した後、読んでいた位置へ戻す
  const signature = state.phase === "ready" ? state.signature : null;
  useLayoutEffect(() => {
    const top = keepScrollRef.current;
    if (top === null || !scrollRef.current) return;
    scrollRef.current.scrollTop = top;
    // エディタの中身は 1 フレーム後に高さが決まることがあるので、もう一度合わせる
    const raf = requestAnimationFrame(() => {
      if (scrollRef.current) scrollRef.current.scrollTop = top;
      keepScrollRef.current = null;
    });
    return () => cancelAnimationFrame(raf);
  }, [signature]);

  // 版のスナップショットはメインで全画面に開けない（ピークの「フルスクリーンで開く」と同じ）
  const canOpenInMain = !targetId.startsWith("snapshot:");
  const handleOpenInMain = useCallback(() => requestOpenInMain(targetId), [targetId]);

  return (
    <>
      <header className="shrink-0 flex items-center gap-2 px-4 py-2 border-b border-border bg-[var(--color-surface)]">
        <span className="flex-1 min-w-0 truncate text-sm font-semibold" data-viewer-title>
          {title}
        </span>
        <span
          className="shrink-0 text-[11px] text-muted-foreground px-1.5 py-0.5 rounded border border-border"
          data-tooltip={held ? t("viewerWindow.heldByMainHint") : undefined}
          data-viewer-view-only
        >
          {held ? t("viewerWindow.heldByMain") : t("viewerWindow.viewOnly")}
        </span>
        {canOpenInMain && (
          <button
            type="button"
            onClick={handleOpenInMain}
            className="shrink-0 inline-flex items-center gap-1.5 px-2 py-1 rounded-md text-xs text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
            data-tooltip={t("viewerWindow.openInMainHint")}
          >
            <PanelsTopLeft size={14} />
            {t("viewerWindow.openInMain")}
          </button>
        )}
      </header>
      <div ref={scrollRef} className="flex-1 min-h-0 overflow-auto" data-viewer-scroll>
        {state.phase === "loading" && (
          <div className="flex items-center justify-center h-48 text-sm text-muted-foreground">
            {t("common.loading")}
          </div>
        )}
        {state.phase === "error" && (
          <div className="flex items-center justify-center h-48 text-sm text-destructive" role="alert">
            {t("sidePeek.loadError")}
          </div>
        )}
        {state.phase === "ready" && (
          <div className="mx-auto w-full max-w-[860px] py-6">
            <h1 className="px-[54px] mb-4 text-2xl font-bold break-words">{title}</h1>
            {/* 中身が変わったら、ストアごと作り直す（前の中身の注釈を残さない） */}
            <ViewerNoteBody key={`${targetId}:${state.signature.length}:${hashOf(state.signature)}`} noteId={targetId} doc={state.doc} />
          </div>
        )}
      </div>
    </>
  );
}

/** key 用の短い指紋（中身の比較そのものは signature の文字列で行う） */
function hashOf(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return h;
}

function ViewerNoteBody({ noteId, doc }: { noteId: string; doc: GraphiumDocument }) {
  // SandboxEditor は note-app と同じ Context 群を要る（共有ノートのプレビューと同じ積み方）。
  // ラベルの印と AI は出さない
  return (
    <ProvLabelsEnabledProvider enabled={false}>
      <LabelStoreProvider>
        <LinkStoreProvider noteId={noteId}>
          <TableMetaStoreProvider>
            <MediaInlineLabelProvider>
              <BlockAlignmentProvider>
                <MemoQuoteProvider>
                  <AiAssistantProvider aiAvailable={false}>
                    <ViewerNoteEditor doc={doc} />
                  </AiAssistantProvider>
                </MemoQuoteProvider>
              </BlockAlignmentProvider>
            </MediaInlineLabelProvider>
          </TableMetaStoreProvider>
        </LinkStoreProvider>
      </LabelStoreProvider>
    </ProvLabelsEnabledProvider>
  );
}

function ViewerNoteEditor({ doc }: { doc: GraphiumDocument }) {
  const remoteScope = useRemoteContentScope();
  const linkStore = useLinkStore();
  const tableMetaStore = useTableMetaStore();
  const blockAlignmentStore = useBlockAlignmentStore();
  const memoQuoteStore = useMemoQuoteStore();
  const page = doc.pages?.[0];

  // ストアは毎レンダリング新しいオブジェクトになるので ref で持ち、復元は 1 度だけにする
  const storesRef = useRef({ linkStore, tableMetaStore, blockAlignmentStore, memoQuoteStore });
  storesRef.current = { linkStore, tableMetaStore, blockAlignmentStore, memoQuoteStore };
  useEffect(() => {
    if (!page) return;
    const s = storesRef.current;
    const links = [
      ...(page.provLinks ?? []),
      ...(page.knowledgeLinks ?? []),
      ...(((page as { links?: unknown[] }).links ?? []) as never[]),
    ];
    if (links.length > 0) s.linkStore.restoreLinks(links);
    // 配置揃え・引用したメモ・表の注釈（名前・列のふるまい）。ピークと同じ復元
    s.blockAlignmentStore.restoreSnapshot(page.blockAlignments);
    s.memoQuoteStore.restoreSnapshot(page.memoQuotes);
    s.tableMetaStore.restore(migrateTableMeta(page));
  }, [page]);

  const initialContent = useMemo(() => sanitizeBlocksForLoad(page?.blocks ?? []), [page]);

  return (
    <>
      <AlignmentStyleLayer />
      <SandboxEditor
        blocks={customBlockEntries}
        initialContent={initialContent as never[]}
        editable={false}
        remoteContentScope={remoteScope}
      />
    </>
  );
}
