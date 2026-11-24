// 記録の画面の文言。辞書（src/i18n の records.*）から、部品が使いやすい形にまとめる。
import { useMemo } from "react";
import { useT } from "../../i18n";
import type { RecordKind, RecordOrigin } from "./types";

type Translate = (key: string, params?: Record<string, string>) => string;

export type RecordCopy = {
  title: string;
  lead: string;
  loading: string;
  legend: { when: string; where: string; who: string; what: string };
  kind: Record<RecordKind, string>;
  origin: Record<RecordOrigin, string>;
  who: { self: string; ai: string; selfWithAi: string; shared: string };
  whoFilter: { all: string; self: string; ai: string; other: string };
  today: string;
  yesterday: string;
  count: (n: number) => string;
  hits: (n: number) => string;
  usedIn: (n: number) => string;
  sources: (n: number) => string;
  /** 計画の題が分からないときに、行の名前の前に置く言葉 */
  planRowFallback: string;
  /** チェックの件数の読み上げ・ツールチップ */
  checksHint: (checked: number, total: number) => string;
  pages: (n: number) => string;
  searchPlaceholder: string;
  searchLabel: string;
  clear: string;
  findTitle: string;
  findEmpty: string;
  findNone: string;
  findFoot: string;
  showInLog: string;
  facetWho: string;
  facetOrigin: string;
  facetKind: string;
  week: string;
  empty: string;
  allOrigins: string;
  more: (n: number) => string;
  fewer: string;
  moreHits: string;
  bundle: (n: number) => string;
  moreInBundle: (next: number, rest: number) => string;
  moreDays: (n: number) => string;
  calendar: string;
  prevMonth: string;
  nextMonth: string;
  calLess: string;
  calMore: string;
  showingFrom: (date: string) => string;
  backToLatest: string;
  folder: string;
  allFolders: string;
  noFolder: string;
};

export function buildRecordCopy(t: Translate): RecordCopy {
  // 英語は 1 件のときだけ形が変わる。ほかの言語は .one に同じ文を入れてある
  const counted = (key: string) => (n: number) => t(n === 1 ? `${key}.one` : key, { n: String(n) });
  return {
    title: t("records.title"),
    lead: t("records.lead"),
    loading: t("records.loading"),
    legend: {
      when: t("records.legend.when"),
      where: t("records.legend.where"),
      who: t("records.legend.who"),
      what: t("records.legend.what"),
    },
    kind: {
      note: t("records.kind.note"),
      wiki: t("records.kind.wiki"),
      media: t("records.kind.media"),
      memo: t("records.kind.memo"),
    },
    origin: {
      written: t("records.origin.written"),
      recording: t("records.origin.recording"),
      webClip: t("records.origin.webClip"),
      aiChat: t("records.origin.aiChat"),
      knowledge: t("records.origin.knowledge"),
      phone: t("records.origin.phone"),
      file: t("records.origin.file"),
      template: t("records.origin.template"),
      quote: t("records.origin.quote"),
      memo: t("records.origin.memo"),
      shared: t("records.origin.shared"),
    },
    who: {
      self: t("records.who.self"),
      ai: t("records.who.ai"),
      selfWithAi: t("records.who.selfWithAi"),
      shared: t("records.who.shared"),
    },
    whoFilter: {
      all: t("records.whoFilter.all"),
      self: t("records.whoFilter.self"),
      ai: t("records.whoFilter.ai"),
      other: t("records.whoFilter.other"),
    },
    today: t("records.today"),
    yesterday: t("records.yesterday"),
    count: counted("records.count"),
    hits: counted("records.hits"),
    usedIn: counted("records.usedIn"),
    sources: counted("records.sources"),
    planRowFallback: t("records.planRowFallback"),
    checksHint: (checked, total) => t("planRecords.checksHint", { checked: String(checked), total: String(total) }),
    pages: counted("records.pages"),
    searchPlaceholder: t("records.searchPlaceholder"),
    searchLabel: t("records.searchLabel"),
    clear: t("records.clear"),
    findTitle: t("records.findTitle"),
    findEmpty: t("records.findEmpty"),
    findNone: t("records.findNone"),
    findFoot: t("records.findFoot"),
    showInLog: t("records.showInLog"),
    facetWho: t("records.facetWho"),
    facetOrigin: t("records.facetOrigin"),
    facetKind: t("records.facetKind"),
    week: t("records.week"),
    empty: t("records.empty"),
    allOrigins: t("records.allOrigins"),
    more: (n) => t("records.more", { n: String(n) }),
    fewer: t("records.fewer"),
    moreHits: t("records.moreHits"),
    bundle: (n) => t("records.bundle", { n: String(n) }),
    moreInBundle: (next, rest) => t("records.moreInBundle", { next: String(next), rest: String(rest) }),
    moreDays: counted("records.moreDays"),
    calendar: t("records.calendar"),
    prevMonth: t("records.prevMonth"),
    nextMonth: t("records.nextMonth"),
    calLess: t("records.calLess"),
    calMore: t("records.calMore"),
    showingFrom: (date) => t("records.showingFrom", { date }),
    backToLatest: t("records.backToLatest"),
    folder: t("records.folder"),
    allFolders: t("records.allFolders"),
    noFolder: t("records.noFolder"),
  };
}

/** いまの表示言語の文言。言語を切り替えると作り直される */
export function useRecordCopy(): RecordCopy {
  const t = useT();
  return useMemo(() => buildRecordCopy(t), [t]);
}
