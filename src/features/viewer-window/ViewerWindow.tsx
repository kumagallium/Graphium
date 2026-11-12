// 別ウィンドウ（参照用の表示ウィンドウ）のページ。
//
// メインのウィンドウとは別の JS 文脈で動く。NoteApp を載せず、保存先から読んだノートを
// 読み取り専用のエディタで描くだけにする（lib/viewer-window.ts の「なぜ表示だけか」）。
// ここからは何も保存しない。編集したいときは「メインのウィンドウで開く」で渡す。
//
// 中身は次のときに読み直す:
//   - メインがこのノートを保存した（onViewerNoteSaved）
//   - このウィンドウが手前に来た（連絡が届かなかったときの保険）
// 読み直して中身が同じなら描き直さない（読んでいる位置が飛ばないように）。

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { PanelsTopLeft } from "lucide-react";
import type { GraphiumDocument } from "../../lib/document-types";
import { getActiveProvider, probeServerProvider } from "../../lib/storage/registry";
import { loadSnapshot } from "../version-snapshots/snapshot-store";
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
  onViewerNoteSaved,
  onViewerTargetChange,
  requestOpenInMain,
  type ViewerTarget,
} from "../../lib/viewer-window";

type LoadState =
  | { phase: "loading" }
  | { phase: "ready"; doc: GraphiumDocument; signature: string }
  | { phase: "error"; message: string };

// 保存先の準備は、このウィンドウで 1 度だけ行う。読み直しのたびに行うと、デスクトップ版では
// そのたびにノートの一覧を取り直す（init が list を呼ぶ）。失敗したら次の読み込みでやり直す
let providerReady: Promise<void> | null = null;
function ensureProviderReady(): Promise<void> {
  if (!providerReady) {
    providerReady = (async () => {
      // Web のサーバー保存は起動後に見つかる。先に確かめないと IndexedDB を読みに行く
      await probeServerProvider();
      await getActiveProvider().init();
    })().catch((e) => {
      providerReady = null;
      throw e;
    });
  }
  return providerReady;
}

/** テスト用: 保存先の準備をやり直させる */
export function resetViewerProviderForTest(): void {
  providerReady = null;
}

/** 保存先からノートを読む。ピーク（side-peek.tsx）と同じ振り分け */
export async function loadViewerDoc(id: string): Promise<GraphiumDocument> {
  await ensureProviderReady();
  const provider = getActiveProvider();
  if (id.startsWith("snapshot:")) {
    const doc = await loadSnapshot(provider, id.slice("snapshot:".length));
    if (!doc) throw new Error("snapshot not found");
    return doc;
  }
  if (id.startsWith("wiki:")) {
    if (!provider.loadWikiFile) throw new Error("wiki not supported");
    return provider.loadWikiFile(id.slice("wiki:".length));
  }
  if (id.startsWith("skill:")) {
    if (!provider.loadSkillFile) throw new Error("skill not supported");
    return provider.loadSkillFile(id.slice("skill:".length));
  }
  return provider.loadFile(id);
}

/** 描き直すかどうかの判定に使う、見た目に効く部分の写し */
export function viewerDocSignature(doc: GraphiumDocument): string {
  const page = doc.pages?.[0];
  return JSON.stringify([doc.title ?? "", page ?? null]);
}

export function ViewerWindow({ initialTarget }: { initialTarget: ViewerTarget }) {
  const t = useT();
  const [target, setTarget] = useState<ViewerTarget>(initialTarget);
  const [state, setState] = useState<LoadState>({ phase: "loading" });
  // 読み直しの合図（増やすと読み直す）
  const [reloadTick, setReloadTick] = useState(0);
  const scrollRef = useRef<HTMLDivElement>(null);
  // 描き直しをまたいで読んでいる位置を保つ
  const keepScrollRef = useRef<number | null>(null);

  // デスクトップ: 開いたまま別のものを出すよう頼まれた
  useEffect(() => onViewerTargetChange((next) => setTarget(next)), []);

  // 行き先が変わったら読み込み中から始める（前のノートを出したままにしない）
  const targetId = target.id;
  const shownIdRef = useRef<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (shownIdRef.current !== targetId) {
      shownIdRef.current = targetId;
      keepScrollRef.current = null;
      setState({ phase: "loading" });
    }
    loadViewerDoc(targetId)
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
    <div className="h-dvh flex flex-col bg-background text-foreground" data-viewer-window>
      <header className="shrink-0 flex items-center gap-2 px-4 py-2 border-b border-border bg-[var(--color-surface)]">
        <span className="flex-1 min-w-0 truncate text-sm font-semibold" data-viewer-title>
          {title}
        </span>
        <span className="shrink-0 text-[11px] text-muted-foreground px-1.5 py-0.5 rounded border border-border">
          {t("viewerWindow.viewOnly")}
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
    </div>
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
