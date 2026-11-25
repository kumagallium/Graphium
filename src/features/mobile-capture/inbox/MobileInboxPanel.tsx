// 右パネルの受信箱。ノートを開いたまま、スマホから届いたものをその場でノートに入れる。
//
// 全画面の受信箱（InboxView）と同じ Inbox を見る別の入口。並ぶのは **まだ取り込んで
// いない** ファイルだけで、ここが空なら整理が済んでいる。タイルをノートへドラッグするか
// ダブルクリックすると「取り込み＋ノートへの挿入」を 1 操作で行う（実処理は呼び出し側。
// ここは見た目と選択だけを持つ）。クリックは選ぶだけ — ファイル一覧と同じ手つきにして、
// うっかり 1 回押しただけでノートが変わらないようにする。
//
// 一覧の走査は持たない（items を受け取る）。届いたものを自動で並べる見張りは
// 呼び出し側が全画面の受信箱と共用する。

import { useMemo, useState } from "react";
import { Check, Loader2, Plus, RefreshCw } from "lucide-react";
import { useT } from "../../../i18n";
import { formatDateTime } from "../../../lib/format-datetime";
import { extractDomain } from "../../asset-browser/media-index";
import { captureFilePreview } from "./capture-file";
import {
  KindIcon,
  refKind,
  useCaptureRefPayload,
  useInboxThumbnailUrl,
  type InboxSource,
} from "./InboxView";
import type { CaptureRef } from "./types";

export type MobileInboxPanelProps = {
  /** 受信箱の読み取り面。null = 同期フォルダ未接続。 */
  source: InboxSource | null;
  /** 未取り込みのアイテム。並べ替えはパネル側（新しい順）。 */
  items: CaptureRef[];
  /** いまノートへ入れている最中のファイル名（タイルを待ち表示にする）。 */
  busyNames?: ReadonlySet<string>;
  /** 一覧の読み込み中（更新ボタンを回す）。 */
  loading?: boolean;
  /**
   * ダブルクリック・＋・「選んだ N 件を入れる」。カーソルの位置に入れる。複数のときは撮った順（古い順）で渡る。
   * ドラッグで落とした場合はここを通らない（落とし先が INBOX_DRAG_MIME を読んで処理する）。
   */
  onInsert: (refs: CaptureRef[]) => void;
  onRefresh?: () => void;
  onConnect?: () => void;
};

/** ドラッグで運ぶときの種別（中身は Inbox のファイル名の JSON 配列）。 */
export const INBOX_DRAG_MIME = "application/x-graphium-inbox";

function byNewest(a: CaptureRef, b: CaptureRef): number {
  return (b.modifiedAt ?? "").localeCompare(a.modifiedAt ?? "");
}

function InboxTile({
  entryRef,
  source,
  selected,
  selecting,
  busy,
  onInsert,
  onSelectOnly,
  onToggle,
  dragNames,
}: {
  entryRef: CaptureRef;
  source: InboxSource;
  selected: boolean;
  /** 1 件でも選ばれている間は、チェックを常に見せる。 */
  selecting: boolean;
  busy: boolean;
  /** ダブルクリック・Enter・＋ボタン。 */
  onInsert: () => void;
  /** クリック: これだけを選ぶ（ファイル一覧と同じ）。 */
  onSelectOnly: () => void;
  /** チェック・⌘/Ctrl＋クリック: 選択に足す・外す。 */
  onToggle: () => void;
  dragNames: string[];
}) {
  const t = useT();
  const kind = refKind(entryRef);
  const { holderRef, url } = useInboxThumbnailUrl(entryRef, source);
  const payload = useCaptureRefPayload(entryRef, source);
  const label = payload ? captureFilePreview(payload) : entryRef.name;
  const detail = payload?.kind === "url" ? extractDomain(payload.url) : null;
  const time = entryRef.modifiedAt ? formatDateTime(entryRef.modifiedAt) : "";

  return (
    <div
      ref={holderRef}
      data-test="mobileInboxTile"
      data-selected={selected ? "true" : undefined}
      draggable={!busy}
      onDragStart={(e) => {
        e.dataTransfer.setData(INBOX_DRAG_MIME, JSON.stringify(dragNames));
        e.dataTransfer.effectAllowed = "copy";
      }}
      className={`group relative aspect-square rounded-lg border overflow-hidden bg-muted/40 transition-all duration-200 ${
        selected ? "border-primary ring-2 ring-primary/40" : "border-border hover:border-primary/60"
      }`}
    >
      <button
        type="button"
        disabled={busy}
        onClick={(e) => (e.metaKey || e.ctrlKey ? onToggle() : onSelectOnly())}
        onDoubleClick={onInsert}
        onKeyDown={(e) => {
          // Enter はノートに入れる（クリック扱いにしない）。Space は既定どおり選ぶ
          if (e.key === "Enter") {
            e.preventDefault();
            onInsert();
          }
        }}
        aria-label={label}
        className="absolute inset-0 flex flex-col items-stretch text-left cursor-grab active:cursor-grabbing disabled:cursor-default"
      >
        {url ? (
          <img src={url} alt="" className="w-full h-full object-cover" draggable={false} />
        ) : (
          // 上の 1 段は、左上のチェックと右上の ＋ のために空けておく（文字に重ねない）
          <span className="flex-1 flex flex-col gap-1.5 px-2.5 pt-8 pb-2.5 min-h-0">
            <span className="text-xs text-foreground leading-snug line-clamp-4 break-words">
              {label}
            </span>
            {detail && (
              <span className="text-[10px] text-muted-foreground truncate">{detail}</span>
            )}
          </span>
        )}
        {/* 下の帯: 種類のアイコンと届いた時刻（アイコンを左上に置くと、選ぶときのチェックと重なる） */}
        <span className="absolute inset-x-0 bottom-0 flex items-center gap-1.5 px-2 py-1 text-[10px] bg-background/85 text-muted-foreground">
          <span className="shrink-0 inline-flex">
            <KindIcon kind={kind} size={12} />
          </span>
          <span className="truncate">{time}</span>
        </span>
      </button>

      {/* ＋: ダブルクリックやドラッグに気づかなくても、1 回押せば入る */}
      <button
        type="button"
        disabled={busy}
        onClick={onInsert}
        data-tooltip={t("mobile.panel.insertOne")}
        aria-label={`${t("mobile.panel.insertOne")}: ${label}`}
        className="absolute top-1.5 right-1.5 w-6 h-6 rounded-md border border-border bg-background/90 text-foreground flex items-center justify-center opacity-0 group-hover:opacity-100 focus-visible:opacity-100 hover:bg-muted transition-opacity"
      >
        <Plus size={13} />
      </button>

      {/* 選ぶ: 複数枚をまとめて入れるときだけ使う。ふだんは hover まで出さない */}
      <button
        type="button"
        role="checkbox"
        aria-checked={selected}
        aria-label={`${t("mobile.panel.select")}: ${label}`}
        disabled={busy}
        onClick={onToggle}
        className={`absolute top-1.5 left-1.5 w-5 h-5 rounded border flex items-center justify-center transition-opacity ${
          selected
            ? "bg-primary border-primary text-primary-foreground opacity-100"
            : `bg-background/90 border-border text-transparent ${
                selecting ? "opacity-100" : "opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
              }`
        }`}
      >
        <Check size={13} />
      </button>

      {busy && (
        <span className="absolute inset-0 flex items-center justify-center bg-background/70">
          <Loader2 size={18} className="animate-spin text-muted-foreground" />
        </span>
      )}
    </div>
  );
}

export function MobileInboxPanel({
  source,
  items,
  busyNames,
  loading = false,
  onInsert,
  onRefresh,
  onConnect,
}: MobileInboxPanelProps) {
  const t = useT();
  const sorted = useMemo(() => [...items].sort(byNewest), [items]);
  const [selectedNames, setSelectedNames] = useState<ReadonlySet<string>>(new Set());

  // 取り込まれて一覧から消えたものは、選択からも外れたものとして扱う
  // 一覧は新しい順だが、まとめて入れるときは撮った順（古い順）に並べる。
  // 実験の記録は起きた順に読むので、ノートの上から下へ時系列になるようにする
  const selectedRefs = useMemo(
    () => sorted.filter((r) => selectedNames.has(r.name)).reverse(),
    [sorted, selectedNames],
  );
  const selecting = selectedRefs.length > 0;

  const toggle = (name: string) =>
    setSelectedNames((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });

  if (!source) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 py-12 px-5 text-center">
        <p className="text-xs text-muted-foreground">{t("mobile.connectHint")}</p>
        {onConnect && (
          <button
            type="button"
            onClick={onConnect}
            className="px-4 py-2 text-xs rounded bg-primary text-primary-foreground hover:opacity-90 transition-opacity"
          >
            {t("mobile.connectFolder")}
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full min-h-0" data-test="mobileInboxPanel">
      <div className="flex items-center gap-2 px-3 pt-3 pb-1">
        <span className="text-xs text-foreground">
          {t("mobile.pendingCount", { count: String(sorted.length) })}
        </span>
        <span className="flex-1" />
        {onRefresh && (
          <button
            type="button"
            onClick={onRefresh}
            disabled={loading}
            data-tooltip={t("mobile.refresh")}
            aria-label={t("mobile.refresh")}
            className="inline-flex items-center justify-center w-7 h-7 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors disabled:opacity-50"
          >
            <RefreshCw size={13} className={loading ? "animate-spin" : undefined} />
          </button>
        )}
      </div>

      {sorted.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-1.5 py-12 px-5 text-center">
          <p className="text-sm text-foreground">{t("mobile.emptyInbox")}</p>
          <p className="text-xs text-muted-foreground">{t("mobile.emptyInboxHint")}</p>
        </div>
      ) : (
        <>
          <p className="px-3 pb-2 text-[11px] text-muted-foreground">{t("mobile.panel.hint")}</p>
          <div className="flex-1 min-h-0 overflow-y-auto px-3 pb-3">
            <div
              className="grid gap-2"
              style={{ gridTemplateColumns: "repeat(auto-fill, minmax(120px, 1fr))" }}
            >
              {sorted.map((ref) => {
                const selected = selectedNames.has(ref.name);
                return (
                  <InboxTile
                    key={ref.name}
                    entryRef={ref}
                    source={source}
                    selected={selected}
                    selecting={selecting}
                    busy={busyNames?.has(ref.name) ?? false}
                    // 選んだものの上でダブルクリックすると、選んだ全部を入れる（ドラッグと同じ）
                    onInsert={() => {
                      onInsert(selected ? selectedRefs : [ref]);
                      setSelectedNames(new Set());
                    }}
                    onSelectOnly={() => setSelectedNames(new Set([ref.name]))}
                    onToggle={() => toggle(ref.name)}
                    // 選んだものの上から引くと、選んだ全部を運ぶ
                    dragNames={selected ? selectedRefs.map((r) => r.name) : [ref.name]}
                  />
                );
              })}
            </div>
          </div>
          {selecting && (
            <div className="flex items-center gap-2 px-3 py-2 border-t border-border bg-background">
              <button
                type="button"
                onClick={() => {
                  onInsert(selectedRefs);
                  setSelectedNames(new Set());
                }}
                className="flex-1 px-3 py-2 text-xs rounded bg-primary text-primary-foreground hover:opacity-90 transition-opacity"
              >
                {t("mobile.panel.insertSelected", { count: String(selectedRefs.length) })}
              </button>
              <button
                type="button"
                onClick={() => setSelectedNames(new Set())}
                className="px-3 py-2 text-xs rounded border border-border text-foreground hover:bg-muted transition-colors whitespace-nowrap"
              >
                {t("mobile.deselectAll")}
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
