// リンクした素材 1 件の中身の表示（素材ピーク・全画面の本体）。
//
// Graphium が持っているのは「置き場の中のどこにあるか」と、控えたときの大きさ・更新日時だけ。
// ファイルは写さず、中身も読まない。Web ページを取りに行く UrlReaderView は使わない。
//
// 状態は 5 通り（変わりなし／変わっています／見つかりません／置き場に届きません／この端末に未登録）。
// 「見つからない」「届かない」「未登録」のときは、開く・場所を表示を押せなくする。
// 「変わっています」のときは、控えといまを並べて見せ、「いまの状態を控え直す」で控えを更新できる
// （前の控えは履歴に積む）。

import { useCallback, useEffect, useMemo, useState } from "react";
import { File as FileIcon, FolderSearch, ExternalLink, Loader2, RefreshCw } from "lucide-react";
import { Button } from "@ui/button";
import { useT } from "../../i18n";
import { formatBytes } from "../../lib/format-bytes";
import { formatDateTime } from "../../lib/format-datetime";
import { persistLinkPatch, type MediaIndexEntry, type MediaLink } from "../asset-browser/media-index";
import { linkModifiedIso } from "./link-safe";
import { sanitizeMediaLink } from "./link-url";
import { acceptLinkChange, linkState, type LinkState } from "./linked-entry";
import { LinkedBadge, LinkStateBadge } from "./LinkStateBadge";
import {
  listPlaces,
  openLinkedFile,
  revealLinkedFile,
  statLinks,
  type LinkStat,
  type PlaceInfo,
} from "./places";

/** Rust 側 place_open が、開かない種類のファイルに返すエラー文字列の接頭辞 */
export const PLACE_OPEN_NOT_ALLOWED_PREFIX = "PLACE_OPEN_NOT_ALLOWED:";

export type LinkedFileViewProps = {
  entry: MediaIndexEntry;
  /**
   * Storybook / テスト用の差し替え口（本番では未指定）。
   * 置き場の操作は Tauri に依存するので、ここで置き換える。
   */
  __test?: {
    statLinks?: (items: { placeId: string; relPath: string }[]) => Promise<LinkStat[]>;
    listPlaces?: () => Promise<PlaceInfo[]>;
    openLinkedFile?: (placeId: string, relPath: string) => Promise<void>;
    revealLinkedFile?: (placeId: string, relPath: string) => Promise<void>;
    persistLinkPatch?: (fileId: string, link: MediaLink) => Promise<boolean>;
  };
};

export function LinkedFileView({ entry, __test }: LinkedFileViewProps) {
  const t = useT();
  const stat = __test?.statLinks ?? statLinks;
  const places = __test?.listPlaces ?? listPlaces;
  const open = __test?.openLinkedFile ?? openLinkedFile;
  const reveal = __test?.revealLinkedFile ?? revealLinkedFile;
  const persist = __test?.persistLinkPatch ?? persistLinkPatch;

  // 控え。控え直したら手元でも更新する（索引の再読み込みを待たずに表示へ反映）
  // 索引の値は細工されうるので、描く前に sanitizeMediaLink を通す（壊れていれば何も描かない）
  const safeLink = useMemo(() => sanitizeMediaLink(entry.link) ?? undefined, [entry.link]);
  const [link, setLink] = useState<MediaLink | undefined>(safeLink);
  useEffect(() => setLink(safeLink), [safeLink]);

  const [current, setCurrent] = useState<LinkStat | null>(null);
  const [checking, setChecking] = useState(false);
  const [placeName, setPlaceName] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const fail = useCallback(
    (e: unknown) => setMessage(t("linkedFile.actionFailed", { message: e instanceof Error ? e.message : String(e) })),
    [t],
  );

  // 「元のファイルを開く」: 開かない種類のファイルは Rust 側が PLACE_OPEN_NOT_ALLOWED: で断る。
  // invoke が投げる値は文字列のことも Error のこともある
  const failOpen = useCallback(
    (e: unknown) => {
      const text = e instanceof Error ? e.message : String(e);
      if (text.startsWith(PLACE_OPEN_NOT_ALLOWED_PREFIX)) setMessage(t("linkedFile.openNotAllowed"));
      else fail(e);
    },
    [t, fail],
  );

  const recheck = useCallback(async () => {
    if (!safeLink) return;
    setChecking(true);
    setMessage(null);
    try {
      const [s] = await stat([{ placeId: safeLink.placeId, relPath: safeLink.relPath }]);
      setCurrent(s ?? { state: "unregistered" });
    } catch (e) {
      fail(e);
    } finally {
      setChecking(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [safeLink?.placeId, safeLink?.relPath, stat, fail]);

  useEffect(() => {
    void recheck();
  }, [recheck]);

  // 置き場の「いまの名前」（登録がなければ、控えたときの名前のまま）
  useEffect(() => {
    let cancelled = false;
    void places()
      .then((list) => {
        if (cancelled) return;
        setPlaceName(list.find((p) => p.id === safeLink?.placeId)?.name ?? null);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [safeLink?.placeId, places]);

  if (!link) return null;

  const state: LinkState | null = current ? linkState(link, current) : null;
  const canUse = state === "ok" || state === "changed";
  const shownPlace = placeName ?? entry.urlMeta?.domain ?? "";

  const run = async (fn: () => Promise<void>, onError: (e: unknown) => void = fail) => {
    setMessage(null);
    try {
      await fn();
    } catch (e) {
      onError(e);
    }
  };

  const accept = async () => {
    if (!current) return;
    const next = acceptLinkChange(link, current, new Date().toISOString());
    if (next === link) return;
    setMessage(null);
    try {
      await persist(entry.fileId, next);
      setLink(next);
    } catch (e) {
      fail(e);
    }
  };

  const history = link.history ?? [];

  return (
    <div
      className="w-full max-w-xl mx-auto rounded-lg border border-border bg-card p-5 space-y-4 text-left"
      data-testid="linked-file-view"
    >
      <div className="flex items-center gap-2 min-w-0">
        <FileIcon size={18} className="shrink-0 text-muted-foreground" />
        <h2 className="text-sm font-semibold text-foreground truncate min-w-0" title={entry.name}>
          {entry.name}
        </h2>
        <LinkedBadge />
      </div>
      <p className="text-xs text-muted-foreground">{t("linkedFile.note")}</p>

      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-xs">
        <Field label={t("linkedFile.field.place")} value={shownPlace} />
        <Field label={t("linkedFile.field.path")} value={link.relPath} mono />
        <Field label={t("linkedFile.field.size")} value={formatBytes(link.size)} />
        <Field label={t("linkedFile.field.modified")} value={formatModified(link.mtimeMs)} />
        <Field label={t("linkedFile.field.recorded")} value={formatDateTime(link.recordedAt)} />
      </dl>

      {/* いまの状態と短い説明 */}
      <div className="space-y-1" aria-live="polite">
        <div className="text-[11px] text-muted-foreground">{t("linkedFile.field.status")}</div>
        {state ? (
          <>
            <LinkStateBadge state={state} />
            <p className="text-xs text-muted-foreground">{t(`linkedFile.stateDesc.${state}`)}</p>
          </>
        ) : (
          <p className="text-xs text-muted-foreground flex items-center gap-1">
            <Loader2 size={12} className="animate-spin" />
            {t("linkedFile.checking")}
          </p>
        )}
      </div>

      {/* 変わっているとき: 控えといまを並べる */}
      {state === "changed" && current && (
        <div className="rounded-md border border-border-subtle p-3 space-y-2" data-testid="linked-file-compare">
          <div className="text-[11px] text-muted-foreground">{t("linkedFile.compare.title")}</div>
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left text-muted-foreground">
                <th className="font-normal w-20" />
                <th className="font-normal">{t("linkedFile.compare.recorded")}</th>
                <th className="font-normal">{t("linkedFile.compare.current")}</th>
              </tr>
            </thead>
            <tbody className="tabular-nums">
              <tr>
                <td className="text-muted-foreground">{t("linkedFile.field.size")}</td>
                <td>{formatBytes(link.size)}</td>
                <td>{formatBytes(current.size)}</td>
              </tr>
              <tr>
                <td className="text-muted-foreground">{t("linkedFile.field.modified")}</td>
                <td>{formatModified(link.mtimeMs)}</td>
                <td>{current.mtimeMs == null ? "" : formatModified(current.mtimeMs)}</td>
              </tr>
            </tbody>
          </table>
          <div className="flex items-center gap-2 flex-wrap">
            <Button size="sm" variant="secondary" onClick={() => void accept()}>
              {t("linkedFile.accept")}
            </Button>
            <span className="text-[11px] text-muted-foreground">{t("linkedFile.acceptHint")}</span>
          </div>
        </div>
      )}

      <div className="flex items-center gap-2 flex-wrap">
        <Button
          size="sm"
          variant="outline"
          disabled={!canUse}
          onClick={() => void run(() => open(link.placeId, link.relPath), failOpen)}
        >
          <ExternalLink />
          {t("linkedFile.open")}
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={!canUse}
          onClick={() => void run(() => reveal(link.placeId, link.relPath))}
        >
          <FolderSearch />
          {t("linkedFile.reveal")}
        </Button>
        <Button size="sm" variant="ghost" disabled={checking} onClick={() => void recheck()}>
          {checking ? <Loader2 className="animate-spin" /> : <RefreshCw />}
          {t("linkedFile.recheck")}
        </Button>
      </div>

      {message && <p className="text-xs text-muted-foreground">{message}</p>}

      {/* 控え直しの履歴（折りたたみ。新しい順） */}
      {history.length > 0 && (
        <details className="text-xs" data-testid="linked-file-history">
          <summary className="cursor-pointer text-muted-foreground hover:text-foreground">
            {t("linkedFile.history", { count: String(history.length) })}
          </summary>
          <ul className="mt-1.5 space-y-1 tabular-nums">
            {history.map((h, i) => (
              <li key={`${h.recordedAt}-${i}`} className="text-muted-foreground">
                {formatDateTime(h.recordedAt)} · {formatBytes(h.size)} · {formatModified(h.mtimeMs)}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

/** 更新日時の表示。範囲外・壊れた値は空文字（Invalid Date を描かない）。 */
function formatModified(mtimeMs: number): string {
  const iso = linkModifiedIso(mtimeMs);
  return iso ? formatDateTime(iso) : "";
}

function Field({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className={`text-foreground break-all min-w-0 ${mono ? "font-mono" : ""}`}>{value}</dd>
    </>
  );
}
