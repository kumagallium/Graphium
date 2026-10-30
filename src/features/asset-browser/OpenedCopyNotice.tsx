// 外のアプリで編集された素材を知らせ、取り込むか捨てるかを選んでもらう（デスクトップ版のみ）
//
// 起動時と、Graphium のウィンドウに戻ってきたとき（Word で保存して切り替えた直後）に
// 確かめる。見つかった素材ごとに「どう取り込まれるか」（上書き / 新しい版）を先に
// 書いておき、利用者がボタンで選ぶ。勝手には取り込まない。
// 「あとで」で閉じた素材は、このセッションのあいだは再び出さない（次の起動でまた出る）。
// 取り込みの規則は opened-copy-sync.ts を参照。

import { useCallback, useEffect, useRef, useState } from "react";
import { Check, FileEdit, Loader2, X } from "lucide-react";
import { useT } from "../../i18n";
import { isTauri } from "../../lib/platform";
import { getActiveProvider } from "../../lib/storage/registry";
import { forgetFilesystemMediaCache } from "../../lib/storage/providers/filesystem";
import type { MediaIndex, MediaIndexEntry } from "./media-index";
import { readEntryBytes } from "./read-entry-bytes";
import { canCountPages, countDocumentPages } from "./document-info";
import { forgetPptxCover } from "./pptx-cover";
import {
  adoptOpenedCopy,
  decideAdoption,
  discardOpenedCopy,
  listChangedOpenedCopies,
  readOpenedCopy,
  rebaseOpenedCopy,
  revisionPatch,
  type AdoptionMode,
  type ExtraRefCounts,
} from "./opened-copy-sync";

type Item = { entry: MediaIndexEntry; fileName: string; mode: AdoptionMode };
type Result = { kind: "replaced" | "new-version" | "duplicate" | "discarded" | "failed"; name: string };

export type OpenedCopyNoticeProps = {
  mediaIndex: MediaIndex | null;
  /** 新しい版の登録（重複判定つきの素材登録） */
  uploadAsset: (
    file: File,
    options?: { derivedFromAssets?: string[] },
  ) => Promise<{ fileId: string; duplicate: boolean }>;
  patchMediaEntry: (fileId: string, patch: Partial<MediaIndexEntry>) => Promise<void>;
  /** usedIn 以外の引用（版スナップショット・テンプレート）を数える */
  countExtraRefs: (entry: MediaIndexEntry) => Promise<ExtraRefCounts>;
};

/** 確かめる間隔の下限（フォーカスの出入りが続いても走査を詰めない） */
const MIN_CHECK_INTERVAL_MS = 2000;

export function OpenedCopyNotice({ mediaIndex, uploadAsset, patchMediaEntry, countExtraRefs }: OpenedCopyNoticeProps) {
  const t = useT();
  const [items, setItems] = useState<Item[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const dismissedRef = useRef(new Set<string>());
  const mediaIndexRef = useRef(mediaIndex);
  mediaIndexRef.current = mediaIndex;
  const lastCheckRef = useRef(0);
  const checkingRef = useRef(false);

  const enabled = isTauri() && getActiveProvider().id === "filesystem";

  const check = useCallback(async () => {
    const index = mediaIndexRef.current;
    if (!enabled || !index || checkingRef.current) return;
    const now = Date.now();
    if (now - lastCheckRef.current < MIN_CHECK_INTERVAL_MS) return;
    lastCheckRef.current = now;
    checkingRef.current = true;
    try {
      const changed = await listChangedOpenedCopies();
      const next: Item[] = [];
      for (const c of changed) {
        if (dismissedRef.current.has(c.fileId)) continue;
        const entry = index.media.find((m) => m.fileId === c.fileId);
        if (!entry) continue;
        const mode = decideAdoption(entry, await countExtraRefs(entry));
        next.push({ entry, fileName: c.fileName, mode });
      }
      setItems(next);
    } catch (err) {
      console.warn("[opened-copy] 編集されたコピーの確認に失敗:", err);
    } finally {
      checkingRef.current = false;
    }
  }, [enabled, countExtraRefs]);

  // 起動時（インデックスが読めた時点）と、ウィンドウに戻ってきたとき
  const indexReady = !!mediaIndex;
  useEffect(() => {
    if (!enabled || !indexReady) return;
    void check();
    const onFocus = () => void check();
    const onVisible = () => {
      if (document.visibilityState === "visible") void check();
    };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [enabled, indexReady, check]);

  // 結果は数秒だけ出して消す
  useEffect(() => {
    if (!result) return;
    const timer = setTimeout(() => setResult(null), 5000);
    return () => clearTimeout(timer);
  }, [result]);

  const removeItem = (fileId: string) => setItems((prev) => prev.filter((i) => i.entry.fileId !== fileId));

  const adopt = async (item: Item) => {
    const { entry } = item;
    setBusy(entry.fileId);
    try {
      if (item.mode === "replace") {
        const contentHash = await adoptOpenedCopy(entry.fileId);
        forgetFilesystemMediaCache(entry.fileId);
        forgetPptxCover(entry.fileId);
        let pageCount: number | undefined;
        if (canCountPages(entry)) {
          pageCount = await countDocumentPages(await readEntryBytes(entry), entry);
        }
        await patchMediaEntry(entry.fileId, { contentHash, ...(pageCount !== undefined ? { pageCount } : {}) });
        setResult({ kind: "replaced", name: entry.name });
      } else {
        const bytes = await readOpenedCopy(entry.fileId);
        const file = new File([bytes as BlobPart], entry.name, { type: entry.mimeType });
        const { fileId: newId, duplicate } = await uploadAsset(file, { derivedFromAssets: [entry.fileId] });
        if (!duplicate) await patchMediaEntry(newId, revisionPatch(entry));
        // 以後の編集は新しい版（同じ中身の素材が既にあればそれ）への変更として扱う
        await rebaseOpenedCopy(entry.fileId, newId);
        setResult({ kind: duplicate ? "duplicate" : "new-version", name: entry.name });
      }
      removeItem(entry.fileId);
    } catch (err) {
      console.error("[opened-copy] 取り込みに失敗:", err);
      setResult({ kind: "failed", name: entry.name });
    } finally {
      setBusy(null);
    }
  };

  const discard = async (item: Item) => {
    setBusy(item.entry.fileId);
    try {
      await discardOpenedCopy(item.entry.fileId);
      removeItem(item.entry.fileId);
      setResult({ kind: "discarded", name: item.entry.name });
    } catch (err) {
      console.error("[opened-copy] 変更の破棄に失敗:", err);
      setResult({ kind: "failed", name: item.entry.name });
    } finally {
      setBusy(null);
    }
  };

  const later = (item: Item) => {
    dismissedRef.current.add(item.entry.fileId);
    removeItem(item.entry.fileId);
  };

  if (!enabled || (items.length === 0 && !result)) return null;

  return (
    <OpenedCopyNoticeView
      items={items}
      busy={busy}
      result={result}
      onAdopt={(i) => void adopt(i)}
      onDiscard={(i) => void discard(i)}
      onLater={later}
      t={t}
    />
  );
}

/** 表示だけ（Storybook で確かめる用に分けてある） */
export function OpenedCopyNoticeView({
  items,
  busy,
  result,
  onAdopt,
  onDiscard,
  onLater,
  t,
}: {
  items: Item[];
  busy: string | null;
  result: Result | null;
  onAdopt: (item: Item) => void;
  onDiscard: (item: Item) => void;
  onLater: (item: Item) => void;
  t: ReturnType<typeof useT>;
}) {
  return (
    <div className="fixed bottom-4 right-4 z-[9999] w-[360px] max-w-[calc(100vw-2rem)] flex flex-col gap-2">
      {items.map((item) => {
        const running = busy === item.entry.fileId;
        return (
          <div
            key={item.entry.fileId}
            role="status"
            className="rounded-lg border border-border bg-popover shadow-lg p-3 text-xs flex flex-col gap-2"
          >
            <div className="flex items-start gap-2">
              <FileEdit size={14} className="text-primary shrink-0 mt-0.5" />
              <div className="flex-1 min-w-0">
                <div className="text-foreground font-medium [overflow-wrap:anywhere]">
                  {t("asset.openedCopy.changed", { name: item.entry.name })}
                </div>
                <div className="text-muted-foreground mt-1 leading-relaxed">
                  {item.mode === "replace"
                    ? t("asset.openedCopy.willReplace")
                    : t("asset.openedCopy.willAddVersion")}
                </div>
              </div>
              <button
                type="button"
                onClick={() => onLater(item)}
                disabled={running}
                aria-label={t("asset.openedCopy.later")}
                data-tooltip={t("asset.openedCopy.later")}
                className="p-0.5 rounded text-muted-foreground hover:bg-muted hover:text-foreground shrink-0"
              >
                <X size={14} />
              </button>
            </div>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => onDiscard(item)}
                disabled={running}
                className="px-2.5 py-1 rounded-md text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-60"
              >
                {t("asset.openedCopy.discard")}
              </button>
              <button
                type="button"
                onClick={() => onAdopt(item)}
                disabled={running}
                className="px-2.5 py-1 rounded-md bg-primary text-primary-foreground hover:bg-primary/90 inline-flex items-center gap-1.5 disabled:opacity-60"
              >
                {running && <Loader2 size={12} className="animate-spin" />}
                {item.mode === "replace" ? t("asset.openedCopy.replace") : t("asset.openedCopy.addVersion")}
              </button>
            </div>
          </div>
        );
      })}
      {result && (
        <div
          role="status"
          className={`rounded-full border shadow-lg px-3.5 py-1.5 text-xs self-end flex items-center gap-1.5 ${
            result.kind === "failed"
              ? "bg-amber-50 border-amber-200 dark:bg-amber-900/20 dark:border-amber-800"
              : "bg-emerald-50 border-emerald-200 dark:bg-emerald-900/20 dark:border-emerald-800"
          }`}
        >
          {result.kind !== "failed" && <Check size={13} className="text-emerald-600 shrink-0" />}
          <span className="text-foreground">{t(`asset.openedCopy.result.${result.kind}`, { name: result.name })}</span>
        </div>
      )}
    </div>
  );
}
