// 記録の画面のカレンダー（月の表示）。
// 日ごとの件数を濃淡で見せ、日を押すとその日からの記録へ移る。
// 記録の無い日は押せない（押しても見るものが無い）。
import { ChevronLeft, ChevronRight } from "lucide-react";
import type { Locale } from "../../i18n";
import "./record-dashboard.css";
import type { RecordCopy } from "./copy";
import { densityLevel, formatDate, formatMonth, monthGrid, shiftMonth, weekdayLabels } from "./model";

export type RecordCalendarProps = {
  /** 日（"2026-11-17"）ごとの件数 */
  counts: ReadonlyMap<string, number>;
  /** 濃淡の基準にする、1 日の最大の件数（月をまたいで同じ基準で比べるため、外から渡す） */
  maxCount: number;
  /** 表示している月（"2026-11"） */
  month: string;
  onMonthChange: (month: string) => void;
  /** 選んでいる日。その日からの記録を出している */
  selectedDay: string | null;
  onSelectDay: (dayKey: string) => void;
  /** 今日（"2026-11-17"） */
  today: string;
  /** 記録のある最初の月と、今日の月。この外へは動かせない */
  minMonth: string;
  maxMonth: string;
  locale: Locale;
  copy: RecordCopy;
};

export function RecordCalendar({
  counts,
  maxCount,
  month,
  onMonthChange,
  selectedDay,
  onSelectDay,
  today,
  minMonth,
  maxMonth,
  locale,
  copy,
}: RecordCalendarProps) {
  const weeks = monthGrid(month);
  const labels = weekdayLabels(locale);
  return (
    <section className="rd-cal" aria-label={copy.calendar}>
      <header className="rd-cal-head">
        <h3 aria-live="polite">{formatMonth(month, locale)}</h3>
        <div className="rd-cal-nav">
          <button type="button" aria-label={copy.prevMonth} data-tooltip={copy.prevMonth} disabled={month <= minMonth} onClick={() => onMonthChange(shiftMonth(month, -1))}>
            <ChevronLeft size={16} aria-hidden="true" />
          </button>
          <button type="button" aria-label={copy.nextMonth} data-tooltip={copy.nextMonth} disabled={month >= maxMonth} onClick={() => onMonthChange(shiftMonth(month, 1))}>
            <ChevronRight size={16} aria-hidden="true" />
          </button>
        </div>
      </header>
      <table className="rd-cal-grid">
        <thead>
          <tr>
            {labels.map((label, i) => (
              <th key={i} scope="col">
                {label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {weeks.map((week, w) => (
            <tr key={w}>
              {week.map((cell, d) => {
                if (!cell) return <td key={d} />;
                const count = counts.get(cell.key) ?? 0;
                return (
                  <td key={d}>
                    <button
                      type="button"
                      className="rd-cal-day"
                      data-level={densityLevel(count, maxCount)}
                      data-today={cell.key === today ? "true" : undefined}
                      aria-pressed={cell.key === selectedDay}
                      aria-label={`${formatDate(cell.key, locale)} ${copy.count(count)}`}
                      disabled={count === 0}
                      onClick={() => onSelectDay(cell.key)}
                    >
                      {cell.day}
                    </button>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      <p className="rd-cal-scale" aria-hidden="true">
        {copy.calLess}
        {[1, 2, 3, 4].map((level) => (
          <span key={level} className="rd-cal-swatch" data-level={level} />
        ))}
        {copy.calMore}
      </p>
    </section>
  );
}
