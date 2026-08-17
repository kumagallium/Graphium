// 語彙インデックスを noteIndex / mediaIndex に追従させる React フック
//
// 配線の考え方（単一の入口）:
// - ノート・Wiki の「望ましい一覧」は noteIndex（ゴミ箱・アーカイブ除外済み）から導く。
//   保存・削除・復元・アーカイブはすべて noteIndex を動かすので、そこだけ見ていれば
//   個別ハンドラにフックを撒かなくて済む（撒くと埋め込み側のように削除漏れ = orphan が出る）
// - 本文は docCache 優先で読む。起動時は ensureMediaIndex が全ノート・全 Wiki を
//   docCache に載せ終えてから走らせるので、実質 I/O ゼロで初回構築が終わる
// - 素材は mediaIndex から導く。画像 OCR / URL 抜粋はインデックスに載っている
//   テキストをそのまま、PDF は 1 件ずつ背後で抽出する（一度索引すれば次回は不要）
//
// UI は lexicalSearch.subscribe で状態を購読できる（Settings の再構築ボタン等）。

import { useEffect, useRef, useState } from "react";
import type { GraphiumDocument } from "../../lib/document-types";
import type { GraphiumIndex } from "../navigation/index-file";
import type { MediaIndex } from "../asset-browser/media-index";
import { getActiveProvider } from "../../lib/storage/registry";
import { chunkNoteDocument, chunkPlainText } from "./chunk";
import { extractWikiSections } from "../wiki/section-extract";
import { desiredAssetSources, desiredNoteSources } from "./sources";
import { lexicalSearch, type DesiredSource, type LexicalStatus, type SourceLoader } from "./service";

/** noteIndex が動いてから reconcile を走らせるまでの待ち（自動保存の連打を 1 回にまとめる） */
const NOTE_RECONCILE_DEBOUNCE_MS = 1200;
/** mediaIndex が動いてから素材 reconcile を走らせるまでの待ち */
const ASSET_RECONCILE_DEBOUNCE_MS = 2500;
/** PDF 抽出は重いので 1 件ごとに間を空ける */
const PDF_DELAY_MS = 300;
/** 抽出対象にする PDF の上限サイズ（これより大きいものは飛ばす） */
const PDF_MAX_BYTES = 40 * 1024 * 1024;

export type LexicalSyncParams = {
  /** サインイン済みか。false の間は何もしない */
  authenticated: boolean;
  /** ゴミ箱・アーカイブ除外済みのノートインデックス */
  noteIndex: GraphiumIndex | null;
  /** メディアインデックス（null = まだ構築中）。null → 非 null になった時点で全ノートが docCache に載っている */
  mediaIndex: MediaIndex | null;
  /** docCache からの取得（ノートは id、Wiki は `wiki:${id}`） */
  getCachedDoc: (key: string) => GraphiumDocument | undefined;
  /** キャッシュ優先でノートを読む */
  loadDoc: (noteId: string) => Promise<GraphiumDocument | null>;
  /** 無効化したいとき（Storybook 等） */
  disabled?: boolean;
};

/** どのストレージの索引か（provider + アカウント） */
export function currentScopeKey(): string | null {
  try {
    const p = getActiveProvider();
    const email = p.getAuthState?.().userEmail ?? "";
    return `${p.id}:${email}`;
  } catch {
    return null;
  }
}

/** Wiki ドキュメントをキャッシュ優先で読む（無ければプロバイダーから） */
async function loadWikiDoc(
  wikiId: string,
  getCachedDoc: (key: string) => GraphiumDocument | undefined,
): Promise<GraphiumDocument | null> {
  const cached = getCachedDoc(`wiki:${wikiId}`);
  if (cached) return cached;
  try {
    const p = getActiveProvider();
    if (!p.loadWikiFile) return null;
    return await p.loadWikiFile(wikiId);
  } catch {
    return null;
  }
}

/** PDF のテキストを抽出する（pdfjs は遅延ロード）。失敗・巨大は null */
async function extractPdfTextForIndex(fileId: string): Promise<string | null> {
  try {
    const p = getActiveProvider();
    let blob: Blob | null = null;
    if (p.readMediaBytes) {
      const bytes = await p.readMediaBytes(fileId, PDF_MAX_BYTES);
      if (!bytes) return null;
      if (bytes.byteLength >= PDF_MAX_BYTES) return null;
      blob = new Blob([bytes as BlobPart], { type: "application/pdf" });
    } else {
      const url = await p.getMediaBlobUrl(fileId);
      const res = await fetch(url);
      blob = await res.blob();
      if (blob.size >= PDF_MAX_BYTES) return null;
    }
    const { extractPdfText } = await import("../wiki/pdf-text-extractor");
    const { text } = await extractPdfText(blob);
    return text?.trim() ? text : null;
  } catch {
    return null;
  }
}

/** サービスの状態を購読する（Settings の表示・再構築ボタン用） */
export function useLexicalStatus(): LexicalStatus {
  const [status, setStatus] = useState<LexicalStatus>(() => lexicalSearch.getStatus());
  useEffect(() => lexicalSearch.subscribe(setStatus), []);
  return status;
}

export function useLexicalIndexSync(params: LexicalSyncParams): void {
  const { authenticated, noteIndex, mediaIndex, getCachedDoc, loadDoc, disabled } = params;
  // reset（再構築）で世代が進んだら reconcile をやり直す
  const generation = useLexicalStatus().generation;
  const getCachedDocRef = useRef(getCachedDoc);
  const loadDocRef = useRef(loadDoc);
  getCachedDocRef.current = getCachedDoc;
  loadDocRef.current = loadDoc;
  const noteIndexRef = useRef(noteIndex);
  noteIndexRef.current = noteIndex;
  const mediaIndexRef = useRef(mediaIndex);
  mediaIndexRef.current = mediaIndex;

  // 1. サインイン後にスコープを決めてロード
  const scopeKey = authenticated ? currentScopeKey() : null;
  useEffect(() => {
    if (disabled || !scopeKey) return;
    lexicalSearch.ensureLoaded(scopeKey).catch(() => {});
  }, [scopeKey, disabled]);

  // 2. ノート・Wiki: noteIndex の変化に追従（mediaIndex が出来てから = docCache が温まってから）
  useEffect(() => {
    if (disabled || !scopeKey || !noteIndex || !mediaIndex) return;
    let cancelled = false;
    const timer = setTimeout(async () => {
      try {
        await lexicalSearch.ensureLoaded(scopeKey);
      } catch {
        return;
      }
      if (cancelled) return;
      const desired = desiredNoteSources(noteIndexRef.current?.notes ?? []);
      const titles = new Map((noteIndexRef.current?.notes ?? []).map((n) => [n.noteId, n.title] as const));
      const loader: SourceLoader = async (d: DesiredSource) => {
        const title = titles.get(d.sourceId) ?? "";
        if (d.kind === "wiki") {
          const doc = await loadWikiDoc(d.sourceId, getCachedDocRef.current);
          if (!doc) return null;
          const sections = extractWikiSections(d.sourceId, doc);
          return { kind: "wiki", sourceId: d.sourceId, title: doc.title || title, fingerprint: d.fingerprint, chunks: sections.map((s) => ({ chunkId: s.sectionId, text: s.text })) };
        }
        const doc = getCachedDocRef.current(d.sourceId) ?? (await loadDocRef.current(d.sourceId));
        if (!doc) return null;
        return { kind: "note", sourceId: d.sourceId, title: doc.title || title, fingerprint: d.fingerprint, chunks: chunkNoteDocument(doc) };
      };
      await lexicalSearch.reconcile(desired, loader, { kinds: ["note", "wiki"], delayMs: 0 });
    }, NOTE_RECONCILE_DEBOUNCE_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [scopeKey, noteIndex, mediaIndex, disabled, generation]);

  // 3. 素材: mediaIndex の変化に追従（ノート側の reconcile と直列にはしない。別 kinds なので干渉しない）
  useEffect(() => {
    if (disabled || !scopeKey || !mediaIndex) return;
    let cancelled = false;
    const timer = setTimeout(async () => {
      try {
        await lexicalSearch.ensureLoaded(scopeKey);
      } catch {
        return;
      }
      if (cancelled) return;
      const { desired, plans, names } = desiredAssetSources(mediaIndexRef.current?.media ?? []);
      const loader: SourceLoader = async (d: DesiredSource) => {
        const plan = plans.get(d.sourceId);
        const name = names.get(d.sourceId) ?? "";
        if (!plan) return null;
        if (plan.mode === "inline") {
          return { kind: "asset", sourceId: d.sourceId, title: name, fingerprint: d.fingerprint, chunks: chunkPlainText(plan.text) };
        }
        const text = await extractPdfTextForIndex(d.sourceId);
        // 抽出できなかった PDF は「空で索引済み」にして毎回の再抽出を避ける（uploadedAt が変われば再試行）
        return { kind: "asset", sourceId: d.sourceId, title: name, fingerprint: d.fingerprint, chunks: text ? chunkPlainText(text) : [] };
      };
      await lexicalSearch.reconcile(desired, loader, { kinds: ["asset"], delayMs: PDF_DELAY_MS });
    }, ASSET_RECONCILE_DEBOUNCE_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [scopeKey, mediaIndex, disabled, generation]);

  // 4. 終了前に未保存分を書く
  useEffect(() => {
    if (disabled) return;
    const onHide = () => {
      if (document.visibilityState === "hidden") void lexicalSearch.flush();
    };
    window.addEventListener("pagehide", onHide);
    document.addEventListener("visibilitychange", onHide);
    return () => {
      window.removeEventListener("pagehide", onHide);
      document.removeEventListener("visibilitychange", onHide);
    };
  }, [disabled]);
}
