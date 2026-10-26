// 音声ノートのブロックの「清書」「要約」の表示と、「ノートに書き出す」メニュー（見た目だけ）
//
// 清書と要約はブロックの中で読むためのもの。ノートに入れるかどうかは、ユーザーが
// 「ノートに書き出す」で選ぶ（精度がそこそこの文が勝手にノートに入らないように）。

import { useEffect, useRef, useState } from "react";
import { Check, ChevronDown, ChevronLeft, ChevronRight, Copy, FileOutput, Play, Sparkles, Wand2 } from "lucide-react";
import { t } from "../../i18n";
import { mmss } from "../../features/meeting-recorder/transcript-format";
import type { ArtifactSource, CleanupDoc, SummaryDoc } from "../../features/meeting-recorder/artifacts";
import { SEARCH_SCOPE_ATTR } from "../../features/document-search/block-text-search";

/** ノート内検索（Cmd+F）の対象にする囲い（ボタンや案内の文は含めない） */
const searchScope = { [SEARCH_SCOPE_ATTR]: "" };

export type ArtifactTab = "transcript" | "cleanup" | "summary";
/** 書き出すもの（文字起こし・清書・要約） */
export type WriteOutPart = "transcript" | "cleanup" | "summary";
/** 書き出す先（このノート・議事録のノート・Markdown のファイル・テキストのファイル） */
export type WriteOutDest = "note" | "minutes" | "markdown" | "text";

const btn =
  "flex items-center gap-1 rounded-lg border border-border px-2 py-0.5 text-xs text-foreground hover:bg-accent disabled:opacity-50 transition-colors";
const primaryBtn =
  "flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1 text-xs font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50 transition-opacity";

/** 時刻の印。再生できるときはその位置から再生するボタン */
/**
 * 時刻の印。再生できるときは、その位置から再生するボタン。
 * 灰色の [00:19] だけだと押せると気付かれないので、▶ の印と枠を付けてボタンに見せる
 */
export function TimeChip({ startMs, onSeek }: { startMs: number; onSeek?: ((ms: number) => void) | null }) {
  if (onSeek) {
    return (
      <button
        type="button"
        className="inline-flex items-center gap-0.5 rounded border border-border px-1 align-baseline text-xs tabular-nums text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
        data-tooltip={t("meetingBlock.seekTooltip")}
        aria-label={t("meetingBlock.seekAria", { time: mmss(startMs) })}
        onClick={() => onSeek(startMs)}
      >
        <Play size={9} aria-hidden="true" />
        {mmss(startMs)}
      </button>
    );
  }
  return <span className="tabular-nums text-muted-foreground">[{mmss(startMs)}]</span>;
}

/** タブとパネルを結ぶ id（ブロックごとに別。idBase は useId で作る） */
export const tabId = (idBase: string, tab: ArtifactTab) => `${idBase}-tab-${tab}`;
export const panelId = (idBase: string) => `${idBase}-panel`;

export function ArtifactTabs({
  tab,
  onChange,
  idBase,
}: {
  tab: ArtifactTab;
  onChange: (tab: ArtifactTab) => void;
  idBase: string;
}) {
  const items: Array<[ArtifactTab, string]> = [
    ["transcript", t("meetingBlock.tabTranscript")],
    ["cleanup", t("meetingBlock.tabCleanup")],
    ["summary", t("meetingBlock.tabSummary")],
  ];
  const listRef = useRef<HTMLDivElement>(null);
  // ← → で隣のタブへ（選んだタブにフォーカスも移す）
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    e.preventDefault();
    const i = items.findIndex(([k]) => k === tab);
    const next = items[(i + (e.key === "ArrowRight" ? 1 : items.length - 1)) % items.length][0];
    onChange(next);
    requestAnimationFrame(() => listRef.current?.querySelector<HTMLButtonElement>(`#${CSS.escape(tabId(idBase, next))}`)?.focus());
  };
  return (
    <div
      ref={listRef}
      className="mt-2 flex gap-1 border-b border-border text-xs"
      role="tablist"
      aria-label={t("meetingBlock.tabsLabel")}
      onKeyDown={onKeyDown}
    >
      {items.map(([key, label]) => (
        <button
          key={key}
          id={tabId(idBase, key)}
          type="button"
          role="tab"
          aria-selected={tab === key}
          aria-controls={panelId(idBase)}
          tabIndex={tab === key ? 0 : -1}
          className={`-mb-px border-b-2 px-2.5 py-1 transition-colors ${
            tab === key
              ? "border-foreground font-medium text-foreground"
              : "border-transparent text-muted-foreground hover:text-foreground"
          }`}
          onClick={() => onChange(key)}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

type RunState = { done: number; total: number; etaMs?: number } | null;

/** 残り時間の目安の文（1 分未満・約 N 分） */
function etaText(etaMs: number | undefined): string | null {
  if (etaMs === undefined) return null;
  if (etaMs < 60_000) return t("meetingBlock.cleanupEtaUnderMinute");
  return t("meetingBlock.cleanupEta", { minutes: String(Math.round(etaMs / 60_000)) });
}

/** AI がまだ使えない・まだ作っていないときの案内と実行ボタン */
function Intro({
  text,
  aiEnabled,
  editable,
  runLabel,
  onRun,
  icon,
}: {
  text: string;
  aiEnabled: boolean;
  editable: boolean;
  runLabel: string;
  onRun?: () => void;
  icon: React.ReactNode;
}) {
  return (
    <div className="space-y-2 py-1">
      <p className="text-xs text-muted-foreground">{text}</p>
      {!aiEnabled ? (
        <p className="text-xs text-muted-foreground">{t("meetingBlock.aiNeeded")}</p>
      ) : editable && onRun ? (
        <button type="button" className={primaryBtn} onClick={onRun}>
          {icon}
          {runLabel}
        </button>
      ) : null}
    </div>
  );
}

/**
 * 清書できずに元の発言のまま（伏せるときは省いた旨）入れた部分の範囲。続いた段落を 1 つの範囲にまとめ、
 * 「[46:58]〜[53:45]」の形で返す
 */
export function rawRanges(paragraphs: CleanupDoc["paragraphs"]): string[] {
  const out: string[] = [];
  let start: number | null = null;
  let end = 0;
  const flush = () => {
    if (start === null) return;
    out.push(start === end ? `[${mmss(start)}]` : `[${mmss(start)}]〜[${mmss(end)}]`);
    start = null;
  };
  for (const p of paragraphs) {
    if (!p.raw) {
      flush();
      continue;
    }
    const last = Math.max(p.startMs, ...p.sources.map((s) => s.startMs));
    if (start === null) start = p.startMs;
    end = last;
  }
  flush();
  return out;
}

/** まとめてコピーするボタン（押したら少しのあいだ「コピーしました」） */
function CopyButton({ onCopy, tooltip }: { onCopy: () => Promise<boolean>; tooltip: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className={btn}
      data-tooltip={tooltip}
      onClick={() =>
        void onCopy().then((ok) => {
          if (!ok) return;
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        })
      }
    >
      {copied ? <Check size={12} /> : <Copy size={12} />}
      {copied ? t("meetingBlock.copied") : t("meetingBlock.copy")}
    </button>
  );
}

/** 伏せた文に残っている、人名らしい語の候補と「伏せる」ボタン */
function NameCandidates({ names, onHide }: { names?: string[]; onHide?: (names: string[]) => void }) {
  if (!names || names.length === 0) return null;
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-md border border-border px-2 py-1 text-xs text-foreground" role="status">
      <span>{t("meetingBlock.nameCandidates", { list: names.join(t("meetingBlock.cleanupFixesSeparator")) })}</span>
      {onHide && (
        <button type="button" className={btn} onClick={() => onHide(names)}>
          {t("meetingBlock.nameCandidatesHide")}
        </button>
      )}
    </div>
  );
}

/** 伏せる設定と、作った清書・要約が伏せてあるかの一文（伏せる設定でなければ出さない） */
function MaskLine({ mask, masked, again }: { mask?: boolean; masked?: boolean; again: string }) {
  if (!mask) return null;
  return (
    <div className="text-xs text-muted-foreground" role="status">
      {masked ? t("meetingBlock.maskDone") : t("meetingBlock.maskNotYet", { action: again })}
    </div>
  );
}

export function CleanupPanel(p: {
  cleanup: CleanupDoc | null;
  /** ブロックで「名前などを伏せる」にしているか */
  mask?: boolean;
  onCopy?: () => Promise<boolean>;
  nameCandidates?: string[];
  onHideNames?: (names: string[]) => void;
  aiEnabled: boolean;
  editable: boolean;
  running: RunState;
  error: string | null;
  onRun?: () => void;
  onSeek?: ((ms: number) => void) | null;
  labels: { system: string; mic: string };
}) {
  if (p.running) {
    return (
      <div className="py-1 text-xs text-muted-foreground" role="status">
        {t("meetingBlock.cleanupRunning", { done: String(p.running.done), total: String(p.running.total) })}
        {etaText(p.running.etaMs) && <> · {etaText(p.running.etaMs)}</>}
      </div>
    );
  }
  const error = p.error ? <div className="text-xs text-muted-foreground" role="status">{p.error}</div> : null;
  if (!p.cleanup) {
    return (
      <>
        <Intro
          text={t("meetingBlock.cleanupIntro")}
          aiEnabled={p.aiEnabled}
          editable={p.editable}
          runLabel={t("meetingBlock.cleanupRun")}
          onRun={p.onRun}
          icon={<Wand2 size={12} />}
        />
        {error}
      </>
    );
  }
  return (
    <div className="space-y-1.5 py-1">
      <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        <span>{t("meetingBlock.cleanupNote")}</span>
        <span className="flex-1" />
        {p.onCopy && <CopyButton onCopy={p.onCopy} tooltip={t("meetingBlock.copyCleanupTooltip")} />}
        {p.aiEnabled && p.editable && p.onRun && (
          <button type="button" className={btn} onClick={p.onRun}>
            <Wand2 size={12} />
            {t("meetingBlock.cleanupAgain")}
          </button>
        )}
      </div>
      {error}
      <MaskLine mask={p.mask} masked={p.cleanup.masked} again={t("meetingBlock.cleanupAgain")} />
      {rawRanges(p.cleanup.paragraphs).length > 0 && (
        <div className="text-xs text-muted-foreground" role="status">
          {t(p.cleanup.masked ? "meetingBlock.cleanupRawNoticeMasked" : "meetingBlock.cleanupRawNotice", {
            ranges: rawRanges(p.cleanup.paragraphs).join(t("meetingBlock.cleanupFixesSeparator")),
          })}
        </div>
      )}
      {p.editable && <NameCandidates names={p.nameCandidates} onHide={p.onHideNames} />}
      {p.cleanup.fixes && p.cleanup.fixes.length > 0 && (
        // AI が直した語。外れた直し（例: 意味の違う語に置き換えた）にすぐ気付けるように出す
        <div className="rounded-md border border-border px-2 py-1 text-xs text-muted-foreground">
          {t("meetingBlock.cleanupFixes", {
            list: p.cleanup.fixes.map((f) => `${f.heard} → ${f.meant}`).join(t("meetingBlock.cleanupFixesSeparator")),
          })}
        </div>
      )}
      <div {...searchScope} className="space-y-1.5">
        {p.cleanup.paragraphs.map((para) => (
          <div key={para.id} className={`whitespace-pre-wrap leading-relaxed ${para.raw ? "text-muted-foreground" : ""}`}>
            <TimeChip startMs={para.startMs} onSeek={p.onSeek} />{" "}
            {para.track && <span className="font-medium">{p.labels[para.track]}: </span>}
            {para.text}
          </div>
        ))}
      </div>
    </div>
  );
}

/** 根拠の時刻（最初の 3 つまで） */
function SourceChips({ sources, onSeek }: { sources: ArtifactSource[]; onSeek?: ((ms: number) => void) | null }) {
  const shown = [...sources].sort((a, b) => a.startMs - b.startMs).slice(0, 3);
  return (
    <span className="ml-1 inline-flex gap-1 text-xs">
      {shown.map((s) => (
        <TimeChip key={`${s.track}-${s.startMs}`} startMs={s.startMs} onSeek={onSeek} />
      ))}
    </span>
  );
}

export function SummaryPanel(p: {
  summary: SummaryDoc | null;
  /** ブロックで「名前などを伏せる」にしているか */
  mask?: boolean;
  onCopy?: () => Promise<boolean>;
  nameCandidates?: string[];
  onHideNames?: (names: string[]) => void;
  aiEnabled: boolean;
  editable: boolean;
  running: boolean;
  error: string | null;
  hasCleanup: boolean;
  onRun?: () => void;
  onSeek?: ((ms: number) => void) | null;
}) {
  if (p.running) {
    return (
      <div className="py-1 text-xs text-muted-foreground" role="status">
        {t("meetingBlock.summarizing")}
      </div>
    );
  }
  const error = p.error ? <div className="text-xs text-muted-foreground" role="status">{p.error}</div> : null;
  if (!p.summary) {
    return (
      <>
        <Intro
          text={p.hasCleanup ? t("meetingBlock.summaryIntroCleanup") : t("meetingBlock.summaryIntroTranscript")}
          aiEnabled={p.aiEnabled}
          editable={p.editable}
          runLabel={t("meetingBlock.summaryRun")}
          onRun={p.onRun}
          icon={<Sparkles size={12} />}
        />
        {error}
      </>
    );
  }
  const owner = t("meetingBlock.summaryOwner");
  const due = t("meetingBlock.summaryDue");
  const sections = [
    { title: t("meetingBlock.summaryDecisions"), items: p.summary.decisions.map((x) => ({ ...x, extra: "" })) },
    {
      title: t("meetingBlock.summaryTodos"),
      items: p.summary.todos.map((x) => ({
        ...x,
        extra: [x.owner ? `${owner}: ${x.owner}` : "", x.due ? `${due}: ${x.due}` : ""].filter(Boolean).join(" / "),
      })),
    },
    { title: t("meetingBlock.summaryIssues"), items: p.summary.issues.map((x) => ({ ...x, extra: "" })) },
  ].filter((s) => s.items.length > 0);
  return (
    <div className="space-y-2 py-1">
      <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        <span>
          {p.summary.basedOn === "cleanup" ? t("meetingBlock.summaryBasedOnCleanup") : t("meetingBlock.summaryBasedOnTranscript")}
        </span>
        <span className="flex-1" />
        {p.onCopy && <CopyButton onCopy={p.onCopy} tooltip={t("meetingBlock.copySummaryTooltip")} />}
        {p.aiEnabled && p.editable && p.onRun && (
          <button type="button" className={btn} onClick={p.onRun}>
            <Sparkles size={12} />
            {t("meetingBlock.summarizeAgain")}
          </button>
        )}
      </div>
      {error}
      <MaskLine mask={p.mask} masked={p.summary.masked} again={t("meetingBlock.summarizeAgain")} />
      {p.editable && <NameCandidates names={p.nameCandidates} onHide={p.onHideNames} />}
      <div {...searchScope} className="space-y-2">
      {sections.map((sec) => (
        <div key={sec.title}>
          <div className="text-xs font-semibold text-foreground">{sec.title}</div>
          <ul className="mt-0.5 list-disc space-y-0.5 pl-5 leading-relaxed">
            {sec.items.map((it, i) => (
              <li key={i}>
                {it.text}
                {it.extra && <span className="text-muted-foreground"> — {it.extra}</span>}
                <SourceChips sources={it.sources} onSeek={p.onSeek} />
              </li>
            ))}
          </ul>
        </div>
      ))}
      </div>
    </div>
  );
}

/**
 * 「書き出す ▾」。1 段目で何を（文字起こし → 清書 → 要約）、2 段目でどこへ（このノート・議事録のノート・ファイル）。
 * 見出しと項目を同じ字下げで並べると目がすべるので、選ぶ順（何を → どこへ）に入れ子にする
 */
export function WriteOutMenu(p: {
  canSummary: boolean;
  canCleanup: boolean;
  canTranscript: boolean;
  /** 要約・清書の項目を出すか（AI を使わない人には文字起こしだけ） */
  aiItems?: boolean;
  /** 議事録のノート（別のノート）に書き出せるか。メインエディタの中のブロックだけ */
  canMinutes?: boolean;
  /** 議事録のノートがもうある（行き先を「議事録のノートに」にする） */
  minutesExists?: boolean;
  /** 選べない理由（既定の「まだありません」の代わりに出す。伏せる設定のときなど） */
  reasons?: Partial<Record<WriteOutPart, string>>;
  busy?: boolean;
  onPick: (part: WriteOutPart, dest: WriteOutDest) => void;
}) {
  const [open, setOpen] = useState(false);
  // 2 段目を開いている 1 段目の項目と、キーボードで開いたか（開いたら 2 段目の先頭へフォーカス）
  const [sub, setSub] = useState<WriteOutPart | null>(null);
  const subByKeyRef = useRef(false);
  // 右に入りきらないときは 2 段目を左に出す
  const [subLeft, setSubLeft] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const subRef = useRef<HTMLDivElement>(null);
  const close = (refocus: boolean) => {
    setOpen(false);
    setSub(null);
    if (refocus) buttonRef.current?.focus();
  };
  useEffect(() => {
    if (!open) return;
    // 開いたら最初の選べる項目へフォーカス
    menuRef.current?.querySelector<HTMLButtonElement>("[data-level='1']:not(:disabled)")?.focus();
    const rect = menuRef.current?.getBoundingClientRect();
    setSubLeft(!!rect && rect.right + 240 > (typeof window !== "undefined" ? window.innerWidth : Infinity));
    const onDown = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) close(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);
  useEffect(() => {
    if (!sub || !subByKeyRef.current) return;
    subRef.current?.querySelector<HTMLButtonElement>("[data-level='2']")?.focus();
  }, [sub]);

  const parts: Array<[WriteOutPart, string, boolean, string]> = [
    ["transcript", t("meetingBlock.writeOutTranscript"), p.canTranscript, p.reasons?.transcript ?? ""],
    ...(p.aiItems === false
      ? []
      : ([
          ["cleanup", t("meetingBlock.writeOutCleanup"), p.canCleanup, p.reasons?.cleanup ?? t("meetingBlock.writeOutCleanupNone")],
          ["summary", t("meetingBlock.writeOutSummary"), p.canSummary, p.reasons?.summary ?? t("meetingBlock.writeOutSummaryNone")],
        ] as Array<[WriteOutPart, string, boolean, string]>)),
  ];
  // 2 段目: ノートの行き先 → 区切り → ファイル
  const noteDests: Array<[WriteOutDest, string]> = [
    ["note", t("meetingBlock.writeOutToNote")],
    ...(p.canMinutes
      ? ([["minutes", t(p.minutesExists ? "meetingBlock.writeOutToMinutes" : "meetingBlock.writeOutToNewNote")]] as Array<[WriteOutDest, string]>)
      : []),
  ];
  const fileDests: Array<[WriteOutDest, string]> = [
    ["markdown", t("meetingBlock.writeOutMarkdown")],
    ["text", t("meetingBlock.writeOutText")],
  ];

  // ↑↓ で同じ段の項目を移る
  const moveIn = (container: HTMLElement | null, level: "1" | "2", e: React.KeyboardEvent) => {
    const list = [...(container?.querySelectorAll<HTMLButtonElement>(`[data-level='${level}']:not(:disabled)`) ?? [])];
    if (list.length === 0) return;
    const i = list.indexOf(document.activeElement as HTMLButtonElement);
    const next = e.key === "ArrowDown" ? (i + 1) % list.length : (i - 1 + list.length) % list.length;
    list[next].focus();
  };
  const onMenuKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      close(true);
    } else if (e.key === "Tab") {
      close(false);
    } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      moveIn(menuRef.current, "1", e);
    }
  };
  const onSubKeyDown = (e: React.KeyboardEvent, part: WriteOutPart) => {
    e.stopPropagation();
    if (e.key === "ArrowLeft" || e.key === "Escape") {
      // 2 段目を閉じて 1 段目の項目へ戻る
      e.preventDefault();
      setSub(null);
      menuRef.current?.querySelector<HTMLButtonElement>(`[data-part='${part}']`)?.focus();
    } else if (e.key === "Tab") {
      close(false);
    } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      moveIn(subRef.current, "2", e);
    }
  };
  const itemClass =
    "flex w-full items-center gap-2 whitespace-nowrap rounded-lg px-3 py-1.5 text-left text-foreground hover:bg-accent focus:bg-accent focus:outline-none disabled:opacity-60 disabled:hover:bg-transparent transition-colors";

  return (
    <div ref={rootRef} className="relative">
      <button
        ref={buttonRef}
        type="button"
        className={btn}
        disabled={p.busy}
        aria-haspopup="menu"
        aria-expanded={open}
        data-tooltip={t("meetingBlock.writeOutTooltip")}
        onClick={() => (open ? close(false) : setOpen(true))}
      >
        <FileOutput size={12} />
        {t("meetingBlock.writeOut")}
        <ChevronDown size={12} />
      </button>
      {open && (
        <div
          ref={menuRef}
          className="absolute right-0 top-full z-50 mt-1 w-max min-w-[12rem] rounded-xl border border-border bg-popover p-1 text-sm shadow-lg"
          role="menu"
          aria-label={t("meetingBlock.writeOut")}
          onKeyDown={onMenuKeyDown}
        >
          {parts.map(([part, label, enabled, none]) => (
            <div
              key={part}
              className="relative"
              onMouseEnter={() => {
                if (!enabled) return;
                subByKeyRef.current = false;
                setSub(part);
              }}
            >
              <button
                type="button"
                role="menuitem"
                data-level="1"
                data-part={part}
                aria-haspopup={enabled ? "menu" : undefined}
                aria-expanded={enabled ? sub === part : undefined}
                disabled={!enabled}
                className={`${itemClass} ${sub === part ? "bg-accent" : ""}`}
                onClick={() => {
                  subByKeyRef.current = false;
                  setSub(sub === part ? null : part);
                }}
                onKeyDown={(e) => {
                  if (e.key === "ArrowRight" || e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    e.stopPropagation();
                    subByKeyRef.current = true;
                    setSub(part);
                  }
                }}
              >
                {label}
                <span className="ml-auto flex items-center pl-3 text-xs text-muted-foreground">
                  {/* 2 段目が開く向きを示す（右に入りきらないときは左に開く） */}
                  {!enabled && none ? (
                    none
                  ) : enabled ? (
                    subLeft ? (
                      <ChevronLeft size={12} aria-hidden="true" />
                    ) : (
                      <ChevronRight size={12} aria-hidden="true" />
                    )
                  ) : null}
                </span>
              </button>
              {sub === part && enabled && (
                <div
                  ref={subRef}
                  className={`absolute top-0 z-50 w-max min-w-[11rem] rounded-xl border border-border bg-popover p-1 text-sm shadow-lg ${
                    subLeft ? "right-full mr-1" : "left-full ml-1"
                  }`}
                  role="menu"
                  aria-label={label}
                  onKeyDown={(e) => onSubKeyDown(e, part)}
                >
                  {noteDests.map(([dest, destLabel]) => (
                    <button
                      key={dest}
                      type="button"
                      role="menuitem"
                      data-level="2"
                      className={itemClass}
                      onClick={() => {
                        close(true);
                        p.onPick(part, dest);
                      }}
                    >
                      {destLabel}
                    </button>
                  ))}
                  <div className="my-1 border-t border-border" role="separator" />
                  {fileDests.map(([dest, destLabel]) => (
                    <button
                      key={dest}
                      type="button"
                      role="menuitem"
                      data-level="2"
                      className={itemClass}
                      onClick={() => {
                        close(true);
                        p.onPick(part, dest);
                      }}
                    >
                      {destLabel}
                    </button>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
