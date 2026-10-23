// 音声ノートのブロックの「清書」「要約」の表示と、「ノートに書き出す」メニュー（見た目だけ）
//
// 清書と要約はブロックの中で読むためのもの。ノートに入れるかどうかは、ユーザーが
// 「ノートに書き出す」で選ぶ（精度がそこそこの文が勝手にノートに入らないように）。

import { useEffect, useRef, useState } from "react";
import { ChevronDown, FileOutput, Play, Sparkles, Wand2 } from "lucide-react";
import { t } from "../../i18n";
import { mmss } from "../../features/meeting-recorder/transcript-format";
import type { ArtifactSource, CleanupDoc, SummaryDoc } from "../../features/meeting-recorder/artifacts";
import { SEARCH_SCOPE_ATTR } from "../../features/document-search/block-text-search";

/** ノート内検索（Cmd+F）の対象にする囲い（ボタンや案内の文は含めない） */
const searchScope = { [SEARCH_SCOPE_ATTR]: "" };

export type ArtifactTab = "transcript" | "cleanup" | "summary";
export type WriteOutKind = "summary" | "cleanup" | "transcript";

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
        {p.aiEnabled && p.editable && p.onRun && (
          <button type="button" className={btn} onClick={p.onRun}>
            <Wand2 size={12} />
            {t("meetingBlock.cleanupAgain")}
          </button>
        )}
      </div>
      {error}
      <MaskLine mask={p.mask} masked={p.cleanup.masked} again={t("meetingBlock.cleanupAgain")} />
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
          <div key={para.id} className="whitespace-pre-wrap leading-relaxed">
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
        {p.aiEnabled && p.editable && p.onRun && (
          <button type="button" className={btn} onClick={p.onRun}>
            <Sparkles size={12} />
            {t("meetingBlock.summarizeAgain")}
          </button>
        )}
      </div>
      {error}
      <MaskLine mask={p.mask} masked={p.summary.masked} again={t("meetingBlock.summarizeAgain")} />
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

/** 「ノートに書き出す ▾」。選んだものをブロックの下に段落として書き出す */
export function WriteOutMenu(p: {
  canSummary: boolean;
  canCleanup: boolean;
  canTranscript: boolean;
  /** 選べない理由（既定の「まだありません」の代わりに出す。伏せる設定のときなど） */
  reasons?: Partial<Record<WriteOutKind, string>>;
  busy?: boolean;
  onPick: (kind: WriteOutKind) => void;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const close = (refocus: boolean) => {
    setOpen(false);
    if (refocus) buttonRef.current?.focus();
  };
  useEffect(() => {
    if (!open) return;
    // 開いたら最初の選べる項目へフォーカス
    menuRef.current?.querySelector<HTMLButtonElement>("[role=menuitem]:not(:disabled)")?.focus();
    const onDown = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);
  // ↑↓ で項目を移り、Escape で閉じてボタンへ戻る。Tab でメニューの外へ出たら閉じる
  const onMenuKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      close(true);
      return;
    }
    if (e.key === "Tab") {
      setOpen(false);
      return;
    }
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    e.preventDefault();
    const list = [...(menuRef.current?.querySelectorAll<HTMLButtonElement>("[role=menuitem]:not(:disabled)") ?? [])];
    if (list.length === 0) return;
    const i = list.indexOf(document.activeElement as HTMLButtonElement);
    const next = e.key === "ArrowDown" ? (i + 1) % list.length : (i - 1 + list.length) % list.length;
    list[next].focus();
  };
  const items: Array<[WriteOutKind, string, boolean, string]> = [
    ["summary", t("meetingBlock.writeOutSummary"), p.canSummary, p.reasons?.summary ?? t("meetingBlock.writeOutSummaryNone")],
    ["cleanup", t("meetingBlock.writeOutCleanup"), p.canCleanup, p.reasons?.cleanup ?? t("meetingBlock.writeOutCleanupNone")],
    ["transcript", t("meetingBlock.writeOutTranscript"), p.canTranscript, p.reasons?.transcript ?? ""],
  ];
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
        onClick={() => setOpen((v) => !v)}
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
          {items.map(([kind, label, enabled, none]) => (
            <button
              key={kind}
              type="button"
              role="menuitem"
              disabled={!enabled}
              className="flex w-full items-center gap-2 whitespace-nowrap rounded-lg px-3 py-1.5 text-left text-foreground hover:bg-accent disabled:opacity-60 disabled:hover:bg-transparent transition-colors"
              onClick={() => {
                close(true);
                p.onPick(kind);
              }}
            >
              {label}
              {!enabled && none && <span className="ml-auto pl-3 text-xs text-muted-foreground">{none}</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
