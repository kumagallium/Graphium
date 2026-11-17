// 記録のダッシュボード（デザイン提案）の文言。
// 案が決まるまで i18n.ts には入れず、ここに仮置きする（LP の MomentsPicture と同じ進め方）。
import type { RecordKind, RecordLocale, RecordOrigin } from "./types";

export type RecordCopy = {
  title: string;
  lead: string;
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
  pages: (n: number) => string;
  searchPlaceholder: string;
  searchLabel: string;
  clear: string;
  findTitle: string;
  findEmpty: string;
  findNone: string;
  findFoot: string;
  facetWho: string;
  facetOrigin: string;
  facetKind: string;
  week: string;
  empty: string;
  allOrigins: string;
  more: (n: number) => string;
  fewer: string;
  moreHits: (n: number) => string;
};

export const RECORD_COPY: Record<RecordLocale, RecordCopy> = {
  ja: {
    title: "記録",
    lead: "ノートも、素材も、メモも、AI のページも、残した順に並びます",
    legend: { when: "いつ", where: "どこで", who: "誰が", what: "何を" },
    kind: { note: "ノート", wiki: "AI のページ", media: "素材", memo: "メモ" },
    origin: {
      written: "手で書いた",
      webClip: "Web クリップ",
      aiChat: "AI から",
      knowledge: "ナレッジ化",
      phone: "スマホから",
      file: "取り込んだファイル",
      template: "テンプレートから",
      quote: "素材からの引用",
      memo: "メモ",
      shared: "共有ライブラリ",
    },
    who: { self: "自分", ai: "AI", selfWithAi: "自分と AI", shared: "共有" },
    whoFilter: { all: "すべて", self: "自分", ai: "AI", other: "共有の作者" },
    today: "今日",
    yesterday: "昨日",
    count: (n) => `${n} 件`,
    hits: (n) => `${n} 件`,
    usedIn: (n) => `${n} つのノートで使っています`,
    sources: (n) => `元の記録 ${n} 件`,
    pages: (n) => `${n} ページ`,
    searchPlaceholder: "言葉で探す",
    searchLabel: "記録を言葉で探す",
    clear: "消す",
    findTitle: "言葉で探す",
    findEmpty: "言葉を入れると、種類をまたいで探します",
    findNone: "この言葉を含む記録はありません",
    findFoot: "残した場面が違っても、同じ言葉で見つかります",
    facetWho: "誰が",
    facetOrigin: "どこで",
    facetKind: "種類",
    week: "この 7 日",
    empty: "この条件に合う記録はありません",
    allOrigins: "すべて",
    more: (n) => `ほか ${n}`,
    fewer: "たたむ",
    moreHits: (n) => `ほか ${n} 件を見る`,
  },
  en: {
    title: "Records",
    lead: "Notes, materials, memos and AI pages, in the order you kept them",
    legend: { when: "When", where: "Where", who: "Who", what: "What" },
    kind: { note: "Note", wiki: "AI page", media: "Material", memo: "Memo" },
    origin: {
      written: "Written by hand",
      webClip: "Web clip",
      aiChat: "From AI",
      knowledge: "Made into knowledge",
      phone: "From phone",
      file: "Imported file",
      template: "From a template",
      quote: "Quote from a material",
      memo: "Memo",
      shared: "Shared library",
    },
    who: { self: "Me", ai: "AI", selfWithAi: "Me and AI", shared: "shared" },
    whoFilter: { all: "All", self: "Me", ai: "AI", other: "Shared authors" },
    today: "Today",
    yesterday: "Yesterday",
    count: (n) => (n === 1 ? "1 record" : `${n} records`),
    hits: (n) => (n === 1 ? "1 result" : `${n} results`),
    usedIn: (n) => (n === 1 ? "Used in 1 note" : `Used in ${n} notes`),
    sources: (n) => (n === 1 ? "From 1 record" : `From ${n} records`),
    pages: (n) => (n === 1 ? "1 page" : `${n} pages`),
    searchPlaceholder: "Find by words",
    searchLabel: "Find records by words",
    clear: "Clear",
    findTitle: "Find by words",
    findEmpty: "Type a word to search across every kind of record",
    findNone: "No record has this word",
    findFoot: "Different moments, found by the same word",
    facetWho: "Who",
    facetOrigin: "Where",
    facetKind: "Kind",
    week: "Last 7 days",
    empty: "No record matches",
    allOrigins: "All",
    more: (n) => `${n} more`,
    fewer: "Show fewer",
    moreHits: (n) => `Show ${n} more`,
  },
};
