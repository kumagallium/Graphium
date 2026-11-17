// 1 日分のまとまり（日付の見出し＋記録の行）。デザイン提案・Storybook のみ。
import { ChevronDown } from "lucide-react";
import { useState } from "react";
import "./record-dashboard.css";
import { RECORD_COPY, type RecordCopy } from "./copy";
import {
  BUNDLE_MIN,
  bundleRuns,
  daysAgo,
  formatDate,
  formatTime,
  formatWeekday,
  isBundle,
  matchesQuery,
  type RecordBundle,
} from "./model";
import { OriginBadge, RecordRow, WhoLabel, WhoMark } from "./RecordRow";
import type { RecordItem, RecordLocale, RecordWho } from "./types";

/** まとめ行を開いたときに、一度に出す件数 */
const BUNDLE_PAGE = 30;

/** その日の記録を、残した人の印ごとに数える（見出しの右に小さく出す） */
function whoTally(items: readonly RecordItem[]): { type: RecordWho["type"]; count: number }[] {
  const order: RecordWho["type"][] = ["self", "selfWithAi", "ai", "other"];
  return order.map((type) => ({ type, count: items.filter((it) => it.who.type === type).length })).filter((t) => t.count > 0);
}

function whoTallyLabel(type: RecordWho["type"], copy: RecordCopy): string {
  if (type === "self") return copy.who.self;
  if (type === "ai") return copy.who.ai;
  if (type === "selfWithAi") return copy.who.selfWithAi;
  return copy.whoFilter.other;
}

/** まとめ行では、残した人の種類だけを出す（モデル名や名前は行ごとに違いうる） */
function whoWithoutDetail(who: RecordWho): RecordWho {
  if (who.type === "ai" || who.type === "selfWithAi") return { type: who.type };
  return who;
}

/** 続いた記録を 1 行にまとめたもの。押すと中の記録が開く */
function BundleRow({
  bundle,
  copy,
  open,
  dim,
  onToggle,
}: {
  bundle: RecordBundle;
  copy: RecordCopy;
  open: boolean;
  dim?: boolean;
  onToggle: () => void;
}) {
  const first = bundle.items[0];
  const last = bundle.items[bundle.items.length - 1];
  const peek = bundle.items
    .slice(0, 2)
    .map((it) => it.title ?? it.text ?? "")
    .filter(Boolean)
    .join(" · ");
  return (
    <li className="rd-row rd-bundle" data-open={open ? "true" : undefined} data-dim={dim ? "true" : undefined}>
      <time className="rd-time" dateTime={first.at}>
        {formatTime(first.at)}
        {formatTime(last.at) !== formatTime(first.at) && <span className="rd-time-to">{formatTime(last.at)}</span>}
      </time>
      <span className="rd-node">
        <WhoMark type={first.who.type} />
      </span>
      <div className="rd-body">
        <p className="rd-meta">
          <OriginBadge origin={first.origin} copy={copy} />
          <WhoLabel who={whoWithoutDetail(first.who)} copy={copy} />
          <span className="rd-kind">{copy.kind[first.kind]}</span>
        </p>
        <button type="button" className="rd-bundle-toggle" aria-expanded={open} onClick={onToggle}>
          <span className="rd-bundle-count">{copy.bundle(bundle.items.length)}</span>
          {peek && <span className="rd-bundle-peek">{peek}</span>}
          <ChevronDown size={16} aria-hidden="true" />
        </button>
      </div>
    </li>
  );
}

export type RecordDayProps = {
  /** "2026-11-17" */
  dayKey: string;
  items: readonly RecordItem[];
  /** 今日・昨日の判定に使う「いま」 */
  now: string;
  locale?: RecordLocale;
  query?: string;
  variant?: "rail" | "ledger";
  /** true のとき、探す言葉に当たらない行を消さずに薄くする */
  dimMisses?: boolean;
  /** 同じ種類・出どころ・残した人がこの件数以上続いたら 1 行にまとめる（0 でまとめない）。台帳ではまとめない */
  bundleMin?: number;
};

export function RecordDay({
  dayKey,
  items,
  now,
  locale = "ja",
  query,
  variant = "rail",
  dimMisses,
  bundleMin = BUNDLE_MIN,
}: RecordDayProps) {
  const copy = RECORD_COPY[locale];
  // まとめ行ごとの、開いて出している件数（無ければ閉じている）
  const [shown, setShown] = useState<Record<string, number>>({});
  const ago = daysAgo(dayKey, now);
  const relative = ago === 0 ? copy.today : ago === 1 ? copy.yesterday : null;
  const headingId = `rd-day-${dayKey}`;
  const searching = !!query?.trim();
  const isMiss = (item: RecordItem) => !!dimMisses && searching && !matchesQuery(item, query ?? "");
  // 探す言葉に当たった記録はまとめに入れない（薄くして残す構図のときだけ区別が要る）
  const entries =
    variant === "ledger" ? [...items] : bundleRuns(items, bundleMin, (it) => !!dimMisses && searching && matchesQuery(it, query ?? ""));

  const row = (item: RecordItem) => (
    <RecordRow key={item.id} item={item} locale={locale} query={query} variant={variant} dim={isMiss(item)} />
  );

  return (
    <section className="rd-day" data-variant={variant} aria-labelledby={headingId}>
      <header className="rd-day-head">
        <h3 id={headingId} className="rd-day-title">
          {relative && <span className="rd-day-rel">{relative}</span>}
          <span className="rd-day-date">{formatDate(dayKey, locale)}</span>
          <span className="rd-day-wd">{formatWeekday(dayKey, locale)}</span>
        </h3>
        <p className="rd-day-tally">
          {whoTally(items).map((t) => (
            <span key={t.type} data-tooltip={whoTallyLabel(t.type, copy)}>
              <WhoMark type={t.type} />
              <span className="rd-sr">{whoTallyLabel(t.type, copy)}</span>
              {t.count}
            </span>
          ))}
          <span className="rd-day-count">{copy.count(items.length)}</span>
        </p>
      </header>
      <ol className={variant === "ledger" ? "rd-lrows" : "rd-rows"}>
        {entries.flatMap((entry) => {
          if (!isBundle(entry)) return [row(entry)];
          const count = shown[entry.id] ?? 0;
          const rest = entry.items.length - count;
          return [
            <BundleRow
              key={entry.id}
              bundle={entry}
              copy={copy}
              open={count > 0}
              dim={!!dimMisses && searching}
              onToggle={() => setShown((prev) => ({ ...prev, [entry.id]: count > 0 ? 0 : BUNDLE_PAGE }))}
            />,
            ...entry.items.slice(0, count).map(row),
            ...(count > 0 && rest > 0
              ? [
                  <li key={`${entry.id}:more`} className="rd-bundle-more">
                    <button type="button" onClick={() => setShown((prev) => ({ ...prev, [entry.id]: count + BUNDLE_PAGE }))}>
                      {copy.moreInBundle(Math.min(BUNDLE_PAGE, rest), rest)}
                    </button>
                  </li>,
                ]
              : []),
          ];
        })}
      </ol>
    </section>
  );
}
