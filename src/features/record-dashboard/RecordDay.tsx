// 1 日分のまとまり（日付の見出し＋記録の行）。デザイン提案・Storybook のみ。
import "./record-dashboard.css";
import { RECORD_COPY, type RecordCopy } from "./copy";
import { daysAgo, formatDate, formatWeekday, matchesQuery } from "./model";
import { RecordRow, WhoMark } from "./RecordRow";
import type { RecordItem, RecordLocale, RecordWho } from "./types";

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
};

export function RecordDay({ dayKey, items, now, locale = "ja", query, variant = "rail", dimMisses }: RecordDayProps) {
  const copy = RECORD_COPY[locale];
  const ago = daysAgo(dayKey, now);
  const relative = ago === 0 ? copy.today : ago === 1 ? copy.yesterday : null;
  const headingId = `rd-day-${dayKey}`;
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
        {items.map((item) => (
          <RecordRow
            key={item.id}
            item={item}
            locale={locale}
            query={query}
            variant={variant}
            dim={dimMisses && !!query?.trim() && !matchesQuery(item, query)}
          />
        ))}
      </ol>
    </section>
  );
}
