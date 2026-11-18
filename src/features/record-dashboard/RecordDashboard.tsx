// 記録の画面の中身。アプリでは RecordsView が layout="find" で使う（stream と ledger は見比べ用に Storybook に残している）。
// 同じ部品（記録 1 行・1 日分のまとまり）を、3 通りの構図に並べて見比べる。
//   stream … 1 本の流れ。上で絞って、下を読む
//   find   … 左に日ごとの記録、右に言葉で見つかった記録を横に並べる（採用。LP の絵の組み合わせ案が元）
//   ledger … いつ・どこで・誰が・何を の 4 列の台帳。左で絞る
import { CalendarDays, LocateFixed, Search, X } from "lucide-react";
import { type ReactNode, useMemo, useRef, useState } from "react";
import "./record-dashboard.css";
import { type Locale, useLocale } from "../../i18n";
import { type RecordCopy, useRecordCopy } from "./copy";
import {
  BUNDLE_MIN,
  bundleRuns,
  countByDay,
  countOrigins,
  dayKeyOf,
  daysAgo,
  daysWithinBudget,
  formatDate,
  formatTime,
  formatWeekday,
  groupByDay,
  lastSevenDays,
  matchesFolder,
  matchesOrigin,
  isHit,
  matchesQuery,
  type BodyHit,
  type BodyHits,
  matchesWho,
  monthKeyOf,
  type RecordDayGroup,
  summarizeFolders,
  timeOf,
} from "./model";
import { RecordCalendar } from "./RecordCalendar";
import { RecordDay } from "./RecordDay";
import { RecordFolderFilter } from "./RecordFolderFilter";
import { Marked, ORIGIN_STYLE, WhoLabel, WhoMark } from "./RecordRow";
import type { RecordItem, RecordKind, RecordOrigin, RecordWho, WhoFilter } from "./types";

export type RecordDashboardLayout = "stream" | "find" | "ledger";

export type RecordDashboardProps = {
  items: readonly RecordItem[];
  /** 今日・昨日の判定に使う「いま」（ISO 8601） */
  now: string;
  layout: RecordDashboardLayout;
  initialQuery?: string;
  initialWho?: WhoFilter;
  /** 記録を開く。渡すと、行と見つかった記録を押したときに呼ばれる */
  onOpen?: (item: RecordItem) => void;
  /** いま横で開いている記録の id（"note:abc" の形）。一覧の同じ行に色を付ける */
  openId?: string | null;
  /**
   * 本文でも探す。探す言葉を渡すと、本文で当たった記録の id と抜粋を返す（全文の索引を引く）。
   * 渡さないとき・索引がまだ無いときは、題・見出し・メモの本文・URL の抜粋だけで探す
   */
  findInBody?: (query: string) => BodyHits;
};

const NO_BODY_HITS: BodyHits = new Map();

/** 本文で当たった箇所の抜粋。強調する範囲を <mark> で囲む */
function BodySnippet({ hit }: { hit: BodyHit }) {
  const parts: ReactNode[] = [];
  let at = 0;
  hit.ranges.forEach((r, i) => {
    if (r.start > at) parts.push(hit.text.slice(at, r.start));
    parts.push(<mark key={i}>{hit.text.slice(r.start, r.end)}</mark>);
    at = r.end;
  });
  if (at < hit.text.length) parts.push(hit.text.slice(at));
  return <>{parts}</>;
}

const WHO_FILTERS: { value: WhoFilter; mark?: RecordWho["type"] }[] = [
  { value: "all" },
  { value: "self", mark: "self" },
  { value: "ai", mark: "ai" },
  { value: "other", mark: "other" },
];

const KINDS: RecordKind[] = ["note", "media", "memo", "wiki"];

/** 畳んでいるときに出す出どころの数 */
const ORIGIN_CHIPS_FOLDED = 5;

/** 狭い幅で、畳んでいるときに出す見つかった記録の数（CSS の nth-child と揃える） */
const HITS_FOLDED = 3;

/** 広い幅で、畳んでいるときに出す見つかった記録の数 */
const HITS_MAX = 20;

/** 一度に描く行の数の目安。超える分は「前の日を見る」で足す（まとめ行は 1 行に数える） */
const ROW_BUDGET = 120;

function SearchField({
  value,
  onChange,
  copy,
  count,
  strong,
}: {
  value: string;
  onChange: (v: string) => void;
  copy: RecordCopy;
  count?: number;
  strong?: boolean;
}) {
  return (
    <label className="rd-search" data-strong={strong ? "true" : undefined}>
      <Search size={16} aria-hidden="true" />
      <input
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={copy.searchPlaceholder}
        aria-label={copy.searchLabel}
      />
      {value && count !== undefined && <span className="rd-search-count">{copy.hits(count)}</span>}
      {value && (
        <button type="button" className="rd-search-clear" onClick={() => onChange("")} aria-label={copy.clear}>
          <X size={14} aria-hidden="true" />
        </button>
      )}
    </label>
  );
}

/** 誰での絞り込み。選べるのは 1 つ */
function WhoSwitch({ value, onChange, copy }: { value: WhoFilter; onChange: (v: WhoFilter) => void; copy: RecordCopy }) {
  return (
    <div className="rd-seg" role="group" aria-label={copy.facetWho}>
      {WHO_FILTERS.map((f) => (
        <button key={f.value} type="button" aria-pressed={value === f.value} onClick={() => onChange(f.value)}>
          {f.mark && <WhoMark type={f.mark} />}
          {copy.whoFilter[f.value]}
        </button>
      ))}
    </div>
  );
}

/** 出どころでの絞り込み。いくつでも選べる */
function OriginChips({
  counts,
  selected,
  onToggle,
  onClear,
  copy,
}: {
  counts: { origin: RecordOrigin; count: number }[];
  selected: ReadonlySet<RecordOrigin>;
  onToggle: (o: RecordOrigin) => void;
  onClear: () => void;
  copy: RecordCopy;
}) {
  // 出どころは種類が多い。初めは件数の多い順に数個だけ出し、残りは「ほか」で開く。
  // 選んでいるものは、畳んでいても必ず出す（何で絞っているかが隠れないように）
  const [open, setOpen] = useState(false);
  const shown = open ? counts : counts.filter((c, i) => i < ORIGIN_CHIPS_FOLDED || selected.has(c.origin));
  const rest = counts.length - shown.length;
  return (
    <div className="rd-chips" role="group" aria-label={copy.facetOrigin}>
      <button type="button" className="rd-chip" aria-pressed={selected.size === 0} onClick={onClear}>
        {copy.allOrigins}
      </button>
      {shown.map(({ origin, count }) => {
        const { icon: Icon, tone } = ORIGIN_STYLE[origin];
        return (
          <button
            key={origin}
            type="button"
            className="rd-chip"
            data-tone={tone}
            aria-pressed={selected.has(origin)}
            onClick={() => onToggle(origin)}
          >
            <Icon size={13} aria-hidden="true" />
            {copy.origin[origin]}
            <span className="rd-chip-count">{count}</span>
          </button>
        );
      })}
      {(rest > 0 || open) && counts.length > ORIGIN_CHIPS_FOLDED && (
        <button type="button" className="rd-chip rd-chip-more" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
          {open ? copy.fewer : copy.more(rest)}
        </button>
      )}
    </div>
  );
}

/** この 7 日の件数を棒で見せる（どの日に多く残したか） */
function WeekStrip({ items, now, locale, copy }: { items: readonly RecordItem[]; now: string; locale: Locale; copy: RecordCopy }) {
  const days = lastSevenDays(items, now);
  const max = Math.max(1, ...days.map((d) => d.count));
  return (
    <figure className="rd-week">
      <figcaption>{copy.week}</figcaption>
      <ol>
        {days.map((d) => (
          <li key={d.key} data-today={daysAgo(d.key, now) === 0 ? "true" : undefined} data-empty={d.count === 0 ? "true" : undefined}>
            <span className="rd-week-n">{d.count > 0 ? d.count : ""}</span>
            <span className="rd-week-bar" style={{ height: `${Math.max(d.count > 0 ? 14 : 4, (d.count / max) * 100)}%` }} />
            <span className="rd-week-d">{formatWeekday(d.key, locale, "short")}</span>
            <span className="rd-sr">
              {formatDate(d.key, locale)} {copy.count(d.count)}
            </span>
          </li>
        ))}
      </ol>
    </figure>
  );
}

/** 日ごとのまとまりを、行の数が目安に収まる日まで出す。残りはボタンで足す */
function DayList({
  days,
  now,
  locale,
  query,
  bodyHits,
  copy,
  variant = "rail",
  dimMisses,
  activeId,
  onOpen,
}: {
  days: RecordDayGroup[];
  now: string;
  locale: Locale;
  query: string;
  bodyHits?: BodyHits;
  copy: RecordCopy;
  variant?: "rail" | "ledger";
  dimMisses?: boolean;
  activeId?: string | null;
  onOpen?: (item: RecordItem) => void;
}) {
  const [budget, setBudget] = useState(ROW_BUDGET);
  const searching = query.trim().length > 0;
  const countRows = (day: RecordDayGroup) =>
    variant === "ledger"
      ? day.items.length
      : bundleRuns(day.items, BUNDLE_MIN, (it) => !!dimMisses && searching && isHit(it, query, bodyHits)).length;
  // 探しているあいだ（当たった日だけが並ぶ）は区切らない。見つかった記録から、その行へ飛べるようにするため
  const visible = dimMisses && searching ? days.length : daysWithinBudget(days, budget, countRows);
  const rest = days.length - visible;
  return (
    <>
      {days.slice(0, visible).map((d) => (
        <RecordDay
          key={d.key}
          dayKey={d.key}
          items={d.items}
          now={now}
          query={query}
          bodyHits={bodyHits}
          variant={variant}
          dimMisses={dimMisses}
          activeId={activeId}
          onOpen={onOpen}
        />
      ))}
      {rest > 0 && (
        <button type="button" className="rd-more-days" onClick={() => setBudget((b) => b + ROW_BUDGET)}>
          {copy.moreDays(rest)}
        </button>
      )}
    </>
  );
}

function Empty({ copy }: { copy: RecordCopy }) {
  return <p className="rd-empty">{copy.empty}</p>;
}

/** 4 つの問い（いつ・どこで・誰が・何を）を、行と同じ列で見出しにする */
function Legend({ copy, variant }: { copy: RecordCopy; variant: "rail" | "ledger" }) {
  const { when, where, who, what } = copy.legend;
  if (variant === "ledger") {
    return (
      <p className="rd-lhead" aria-hidden="true">
        <span>{when}</span>
        <span>{where}</span>
        <span>{who}</span>
        <span>{what}</span>
      </p>
    );
  }
  return (
    <p className="rd-legend" aria-hidden="true">
      <span>{when}</span>
      <span />
      <span>
        {where} · {who} · {what}
      </span>
    </p>
  );
}

export function RecordDashboard({ items, now, layout, initialQuery = "", initialWho = "all", onOpen, openId, findInBody }: RecordDashboardProps) {
  const { locale } = useLocale();
  const copy = useRecordCopy();
  const [query, setQuery] = useState(initialQuery);
  const [who, setWho] = useState<WhoFilter>(initialWho);
  const [origins, setOrigins] = useState<ReadonlySet<RecordOrigin>>(new Set());
  const [kind, setKind] = useState<RecordKind | null>(null);
  // 絞っているフォルダ。undefined は絞っていない、null は「フォルダなし」
  const [folder, setFolder] = useState<string | null | undefined>(undefined);
  // 狭い幅では見つかった記録を初めの数件だけ出す（下の記録が押し下げられないように）
  const [hitsOpen, setHitsOpen] = useState(false);
  // 見つかった記録の側で指している記録（左の同じ行に色を付ける）
  const [activeId, setActiveId] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  // カレンダーで選んだ日。選ぶと、その日から前の記録を出す（null は最新から）
  const [anchorDay, setAnchorDay] = useState<string | null>(null);
  // カレンダーで自分で動かした月。動かすまで（null）は、いま出している記録のいちばん新しい月を開く
  // （索引があとから読み終わったときや、フォルダで絞ったときに、記録のある月へ付いていく）
  const [pickedMonth, setPickedMonth] = useState<string | null>(null);
  // 狭い幅でカレンダーを開いているか（広い幅では常に出す）
  const [calOpen, setCalOpen] = useState(false);
  // 見つかった記録を押したら、左の同じ行まで動かす
  const jumpTo = (id: string) => {
    setActiveId(id);
    const row = rootRef.current?.querySelector(`[data-record-id="${CSS.escape(id)}"]`);
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    row?.scrollIntoView({ block: "center", behavior: reduce ? "auto" : "smooth" });
  };

  const toggleOrigin = (o: RecordOrigin) =>
    setOrigins((prev) => {
      const next = new Set(prev);
      if (next.has(o)) next.delete(o);
      else next.add(o);
      return next;
    });

  // 誰・出どころ・種類で絞ったもの（探す言葉はまだ掛けない）
  const faceted = useMemo(
    () =>
      items.filter(
        (it) => matchesWho(it, who) && matchesOrigin(it, origins) && (!kind || it.kind === kind) && (folder === undefined || matchesFolder(it, folder)),
      ),
    [items, who, origins, kind, folder],
  );
  // フォルダの並びと件数は、誰で絞ったあとの記録で数える（フォルダでは絞らない。選び直せるように）
  const folders = useMemo(() => summarizeFolders(items.filter((it) => matchesWho(it, who))), [items, who]);
  // フォルダに入っている記録が 1 つも無ければ、絞り込みは出さない
  const hasFolders = folders.some((f) => f.name !== null) || folder !== undefined;
  const newestDay = useMemo(
    () =>
      faceted.reduce((max, it) => {
        const k = dayKeyOf(it.at);
        return k > max ? k : max;
      }, ""),
    [faceted],
  );
  const calMonth = pickedMonth ?? monthKeyOf(newestDay || dayKeyOf(now));
  // フォルダを選び直したら、月もそのフォルダのいちばん新しい記録の月に戻し、日の指定も外す
  const changeFolder = (next: string | null | undefined) => {
    setFolder(next);
    setPickedMonth(null);
    setAnchorDay(null);
  };
  // 本文で当たった記録（全文の索引）。索引ができあがると findInBody が替わり、引き直される
  const bodyHits = useMemo(() => (query.trim() && findInBody ? findInBody(query) : NO_BODY_HITS), [findInBody, query]);
  const hits = useMemo(() => faceted.filter((it) => isHit(it, query, bodyHits)), [faceted, query, bodyHits]);
  const originCounts = useMemo(() => countOrigins(items.filter((it) => matchesWho(it, who))), [items, who]);
  const hasQuery = query.trim().length > 0;

  if (layout === "find") {
    // 左は絞っただけの記録をすべて残し、探す言葉に当たらない行は薄くする。
    // 右に、当たった記録だけを新しい順に並べる
    // 探しているあいだは、当たった記録のある日だけを出す（何千件もあると、当たらない日ばかりが並ぶため）
    const allDays = groupByDay(faceted).filter((d) => !hasQuery || d.items.some((it) => isHit(it, query, bodyHits)));
    // カレンダーで日を選んでいれば、その日から前だけを出す
    const days = anchorDay ? allDays.filter((d) => d.key <= anchorDay) : allDays;
    // カレンダーの件数は、いま一覧に出しうる記録で数える（探しているあいだは、当たった記録だけ）
    const dayCounts = countByDay(hasQuery ? hits : faceted);
    const maxDayCount = Math.max(0, ...dayCounts.values());
    const oldest = items.reduce((min, it) => { const k = dayKeyOf(it.at); return k && k < min ? k : min; }, dayKeyOf(now));
    const selectDay = (dayKey: string) => {
      setAnchorDay((prev) => (prev === dayKey ? null : dayKey));
      const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      rootRef.current?.querySelector(".rd-log")?.scrollIntoView({ block: "start", behavior: reduce ? "auto" : "smooth" });
    };
    const found = [...hits].sort((a, b) => timeOf(b.at) - timeOf(a.at));
    return (
      <div className="rd-root" data-layout="find" lang={locale} ref={rootRef}>
        <div className="rd-stage">
          <section className="rd-log">
            <header className="rd-log-head">
              <h2 className="rd-h">{copy.title}</h2>
              <span className="rd-total">{copy.count(faceted.length)}</span>
            </header>
            <div className="rd-controls">
              <WhoSwitch value={who} onChange={setWho} copy={copy} />
              {hasFolders && <RecordFolderFilter folders={folders} value={folder} onChange={changeFolder} now={now} locale={locale} copy={copy} />}
            </div>
            {anchorDay && (
              <p className="rd-anchor">
                <CalendarDays size={14} aria-hidden="true" />
                <span>{copy.showingFrom(formatDate(anchorDay, locale))}</span>
                <button type="button" onClick={() => setAnchorDay(null)}>
                  {copy.backToLatest}
                </button>
              </p>
            )}
            <Legend copy={copy} variant="rail" />
            {days.length === 0 && <Empty copy={copy} />}
            {/* 日を選び直したら、描く行の数の区切りも初めに戻す */}
            <DayList
              key={`${anchorDay ?? "latest"}|${folder === undefined ? "" : folder === null ? "none" : `f:${folder}`}`}
              days={days}
              now={now}
              locale={locale}
              query={query}
              bodyHits={bodyHits}
              copy={copy}
              dimMisses
              // 横で開いている記録があれば、そちらを指す（見つかった記録の側で指した行より優先）
              activeId={openId ?? activeId}
              onOpen={onOpen}
            />
          </section>
          <div className="rd-side">
          <div className="rd-cal-wrap" data-open={calOpen ? "true" : undefined}>
            <button type="button" className="rd-cal-toggle" aria-expanded={calOpen} onClick={() => setCalOpen((v) => !v)}>
              <CalendarDays size={14} aria-hidden="true" />
              {copy.calendar}
            </button>
            <RecordCalendar
              counts={dayCounts}
              maxCount={maxDayCount}
              month={calMonth}
              onMonthChange={setPickedMonth}
              selectedDay={anchorDay}
              onSelectDay={selectDay}
              today={dayKeyOf(now)}
              minMonth={monthKeyOf(oldest)}
              maxMonth={monthKeyOf(dayKeyOf(now))}
              locale={locale}
              copy={copy}
            />
          </div>
          <aside className="rd-find" aria-label={copy.findTitle}>
            <SearchField value={query} onChange={setQuery} copy={copy} count={found.length} strong />
            {!hasQuery && <p className="rd-find-hint">{copy.findEmpty}</p>}
            {hasQuery && found.length === 0 && <p className="rd-find-hint">{copy.findNone}</p>}
            {hasQuery && found.length > 0 && (
              <>
                <ul className="rd-hits" data-open={hitsOpen ? "true" : undefined}>
                  {(hitsOpen ? found : found.slice(0, HITS_MAX)).map((it) => {
                    const { icon: Icon, tone } = ORIGIN_STYLE[it.origin];
                    return (
                      <li
                        key={it.id}
                        tabIndex={0}
                        data-active={activeId === it.id ? "true" : undefined}
                        onMouseEnter={() => setActiveId(it.id)}
                        onFocus={() => setActiveId(it.id)}
                        onClick={() => (onOpen ? onOpen(it) : jumpTo(it.id))}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" && e.target === e.currentTarget) (onOpen ? onOpen(it) : jumpTo(it.id));
                        }}
                      >
                        {onOpen && (
                          <button
                            type="button"
                            className="rd-hit-locate"
                            aria-label={copy.showInLog}
                            data-tooltip={copy.showInLog}
                            onClick={(e) => {
                              e.stopPropagation();
                              jumpTo(it.id);
                            }}
                          >
                            <LocateFixed size={14} aria-hidden="true" />
                          </button>
                        )}
                        <p className="rd-hit">
                          <Marked text={it.title ?? it.text ?? ""} query={query} />
                        </p>
                        {it.title && it.detail && matchesQuery({ ...it, title: undefined, domain: undefined }, query) && (
                          <p className="rd-hit-detail">
                            <Marked text={it.detail} query={query} />
                          </p>
                        )}
                        {/* 題にも見出しにも言葉が無く、本文で当たった記録は、当たった箇所を出す */}
                        {!matchesQuery(it, query) && bodyHits.get(it.id) && (
                          <p className="rd-hit-detail" data-body="true">
                            <BodySnippet hit={bodyHits.get(it.id)!} />
                          </p>
                        )}
                        <p className="rd-hit-meta">
                          <span className="rd-hit-icon" data-tone={tone}>
                            <Icon size={12} aria-hidden="true" />
                          </span>
                          <span>
                            {formatDate(dayKeyOf(it.at), locale)} {formatTime(it.at)}
                          </span>
                          <span>{copy.origin[it.origin]}</span>
                          <WhoLabel who={it.who} copy={copy} />
                        </p>
                      </li>
                    );
                  })}
                </ul>
                {found.length > HITS_FOLDED && (
                  <button
                    type="button"
                    className="rd-hits-more"
                    data-wide={found.length > HITS_MAX ? "true" : undefined}
                    aria-expanded={hitsOpen} onClick={() => setHitsOpen((v) => !v)}>
                    {hitsOpen ? copy.fewer : copy.moreHits}
                  </button>
                )}
                <p className="rd-find-foot">{copy.findFoot}</p>
              </>
            )}
          </aside>
          </div>
        </div>
      </div>
    );
  }

  const days = groupByDay(hits);

  if (layout === "ledger") {
    const whoCount = (f: WhoFilter) => items.filter((it) => matchesWho(it, f)).length;
    const kindCount = (k: RecordKind) => items.filter((it) => matchesWho(it, who) && it.kind === k).length;
    const total = Math.max(1, items.length);
    return (
      <div className="rd-root" data-layout="ledger" lang={locale}>
       <div className="rd-ledger">
        <aside className="rd-facets">
          <h2 className="rd-h">{copy.title}</h2>
          <p className="rd-total">{copy.count(hits.length)}</p>
          <section>
            <h3>{copy.facetWho}</h3>
            <ul>
              {WHO_FILTERS.map((f) => (
                <li key={f.value}>
                  <button type="button" className="rd-facet" aria-pressed={who === f.value} onClick={() => setWho(f.value)}>
                    <span className="rd-facet-icon">{f.mark && <WhoMark type={f.mark} />}</span>
                    <span className="rd-facet-label">{copy.whoFilter[f.value]}</span>
                    <span className="rd-facet-count">{whoCount(f.value)}</span>
                    <span className="rd-facet-bar" style={{ width: `${(whoCount(f.value) / total) * 100}%` }} />
                  </button>
                </li>
              ))}
            </ul>
          </section>
          <section>
            <h3>{copy.facetOrigin}</h3>
            <ul>
              {originCounts.map(({ origin, count }) => {
                const { icon: Icon, tone } = ORIGIN_STYLE[origin];
                return (
                  <li key={origin}>
                    <button
                      type="button"
                      className="rd-facet"
                      data-tone={tone}
                      aria-pressed={origins.has(origin)}
                      onClick={() => toggleOrigin(origin)}
                    >
                      <span className="rd-facet-icon">
                        <Icon size={14} aria-hidden="true" />
                      </span>
                      <span className="rd-facet-label">{copy.origin[origin]}</span>
                      <span className="rd-facet-count">{count}</span>
                      <span className="rd-facet-bar" style={{ width: `${(count / total) * 100}%` }} />
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>
          <section>
            <h3>{copy.facetKind}</h3>
            <ul>
              {KINDS.map((k) => (
                <li key={k}>
                  <button
                    type="button"
                    className="rd-facet"
                    aria-pressed={kind === k}
                    onClick={() => setKind((prev) => (prev === k ? null : k))}
                  >
                    <span className="rd-facet-icon" />
                    <span className="rd-facet-label">{copy.kind[k]}</span>
                    <span className="rd-facet-count">{kindCount(k)}</span>
                    <span className="rd-facet-bar" style={{ width: `${(kindCount(k) / total) * 100}%` }} />
                  </button>
                </li>
              ))}
            </ul>
          </section>
        </aside>
        <div className="rd-ledger-main">
          <SearchField value={query} onChange={setQuery} copy={copy} count={hits.length} />
          <div className="rd-sheet">
            <Legend copy={copy} variant="ledger" />
            {days.length === 0 && <Empty copy={copy} />}
            <DayList days={days} now={now} locale={locale} query={query} bodyHits={bodyHits} copy={copy} variant="ledger" onOpen={onOpen} />
          </div>
        </div>
       </div>
      </div>
    );
  }

  return (
    <div className="rd-root" data-layout="stream" lang={locale}>
      <header className="rd-top">
        <div>
          <h2 className="rd-h">
            {copy.title}
            <span className="rd-total">{copy.count(hits.length)}</span>
          </h2>
          <p className="rd-lead">{copy.lead}</p>
        </div>
        <WeekStrip items={items} now={now} locale={locale} copy={copy} />
      </header>
      <div className="rd-controls">
        <SearchField value={query} onChange={setQuery} copy={copy} count={hits.length} />
        <WhoSwitch value={who} onChange={setWho} copy={copy} />
      </div>
      <OriginChips counts={originCounts} selected={origins} onToggle={toggleOrigin} onClear={() => setOrigins(new Set())} copy={copy} />
      <div className="rd-sheet">
        <Legend copy={copy} variant="rail" />
        {days.length === 0 && <Empty copy={copy} />}
        <DayList days={days} now={now} locale={locale} query={query} bodyHits={bodyHits} copy={copy} onOpen={onOpen} />
      </div>
    </div>
  );
}
