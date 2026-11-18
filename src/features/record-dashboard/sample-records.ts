// Storybook 用の仮の記録。パン作りと料理の、架空の内容。実在の人・組織は出てこない。
// 並びは新しい順ではなく、ここでは読みやすさのために日付ごとに書いている（表示側で並べ直す）。
import type { RecordItem, SampleLocale } from "./types";

/** ストーリーで「いま」とする時刻（今日・昨日の判定に使う） */
export const SAMPLE_NOW = "2026-11-17T22:00:00";

/** ストーリーで初めから入れておく探す言葉 */
export const SAMPLE_QUERY: Record<SampleLocale, string> = { ja: "温度", en: "temperature" };

const JA: RecordItem[] = [
  // ── 11/17（今日）
  {
    id: "r01",
    kind: "memo",
    at: "2026-11-17T09:05:00",
    origin: "memo",
    who: { type: "self" },
    text: "食パン、こね上げの温度を 26℃ に抑えたら、きめが揃った気がする",
  },
  {
    id: "r02",
    kind: "note",
    at: "2026-11-17T10:12:00",
    origin: "written",
    who: { type: "self" },
    title: "パン教室の打ち合わせ",
    detail: "決まったこと · 次回までに試すこと · 発酵の温度をどうするか",
  },
  {
    id: "r03",
    kind: "media",
    at: "2026-11-17T11:30:00",
    origin: "phone",
    who: { type: "self" },
    title: "IMG_2041.jpg",
    mediaType: "image",
    trace: { type: "usedIn", count: 1 },
  },
  {
    id: "r04",
    kind: "media",
    at: "2026-11-17T13:40:00",
    origin: "webClip",
    who: { type: "self" },
    title: "低温で長く発酵させると、風味が変わる理由",
    domain: "pan-no-techo.example",
    detail: "温度を下げると発酵はゆっくり進み、そのあいだに香りのもとが増えていく",
    mediaType: "url",
    trace: { type: "usedIn", count: 2 },
  },
  {
    id: "r05",
    kind: "memo",
    at: "2026-11-17T13:42:00",
    origin: "quote",
    who: { type: "self" },
    text: "冷蔵庫の温度なら、ひと晩かけても過発酵になりにくい",
  },
  {
    id: "r06",
    kind: "note",
    at: "2026-11-17T16:05:00",
    origin: "aiChat",
    who: { type: "selfWithAi", model: "claude-opus-4-7" },
    title: "発酵時間の見直し案",
    detail: "いまの手順 · 温度はそのままで時間を倍にする案 · 試す順番",
  },
  {
    id: "r07",
    kind: "wiki",
    at: "2026-11-17T16:20:00",
    origin: "knowledge",
    who: { type: "ai", model: "claude-opus-4-7" },
    title: "低温発酵と風味",
    detail: "発酵の温度と時間の関係 · 家庭の冷蔵庫でのやり方",
    trace: { type: "sources", count: 3 },
  },
  {
    id: "r08",
    kind: "media",
    at: "2026-11-17T21:30:00",
    origin: "file",
    who: { type: "self" },
    title: "製パンの基礎_第3章.pdf",
    pageCount: 24,
    mediaType: "pdf",
  },
  // ── 11/16（昨日）
  {
    id: "r09",
    kind: "note",
    at: "2026-11-16T08:20:00",
    origin: "template",
    who: { type: "self" },
    title: "食パン 試作 4 回目",
    detail: "材料 · 手順 · 焼き上がり",
  },
  {
    id: "r10",
    kind: "media",
    at: "2026-11-16T12:15:00",
    origin: "phone",
    who: { type: "self" },
    title: "こね上げ直後の声メモ.m4a",
    mediaType: "audio",
  },
  {
    id: "r11",
    kind: "note",
    at: "2026-11-16T15:00:00",
    origin: "shared",
    who: { type: "other", name: "みなと" },
    title: "スパイスカレーの基本の配合",
    detail: "ホールスパイス · 玉ねぎを炒める温度と時間 · 仕上げ",
  },
  {
    id: "r12",
    kind: "note",
    at: "2026-11-16T20:40:00",
    origin: "written",
    who: { type: "self" },
    title: "今週の振り返り",
    detail: "うまくいったこと · 次に変えること",
  },
  // ── 11/14
  {
    id: "r13",
    kind: "note",
    at: "2026-11-14T19:10:00",
    origin: "file",
    who: { type: "self" },
    title: "カレーの覚え書き",
    detail: "玉ねぎ · トマト · 煮込み",
  },
  {
    id: "r14",
    kind: "memo",
    at: "2026-11-14T22:05:00",
    origin: "memo",
    who: { type: "self" },
    text: "型を変えれば、焼く温度はそのままでいいかもしれない",
  },
];

const EN: RecordItem[] = [
  {
    id: "r01",
    kind: "memo",
    at: "2026-11-17T09:05:00",
    origin: "memo",
    who: { type: "self" },
    text: "Kept the dough temperature at 26°C after kneading, and the crumb looks more even",
  },
  {
    id: "r02",
    kind: "note",
    at: "2026-11-17T10:12:00",
    origin: "written",
    who: { type: "self" },
    title: "Baking class planning",
    detail: "Decisions · To try before next time · What temperature to proof at",
  },
  {
    id: "r03",
    kind: "media",
    at: "2026-11-17T11:30:00",
    origin: "phone",
    who: { type: "self" },
    title: "IMG_2041.jpg",
    mediaType: "image",
    trace: { type: "usedIn", count: 1 },
  },
  {
    id: "r04",
    kind: "media",
    at: "2026-11-17T13:40:00",
    origin: "webClip",
    who: { type: "self" },
    title: "Why a long, cold proof changes the flavor",
    domain: "bread-notebook.example",
    detail: "At a lower temperature the dough ferments slowly, and aroma compounds build up",
    mediaType: "url",
    trace: { type: "usedIn", count: 2 },
  },
  {
    id: "r05",
    kind: "memo",
    at: "2026-11-17T13:42:00",
    origin: "quote",
    who: { type: "self" },
    text: "At fridge temperature the dough rarely over-proofs, even overnight",
  },
  {
    id: "r06",
    kind: "note",
    at: "2026-11-17T16:05:00",
    origin: "aiChat",
    who: { type: "selfWithAi", model: "claude-opus-4-7" },
    title: "A new plan for the proofing time",
    detail: "Current steps · Same temperature, double the time · Order to try",
  },
  {
    id: "r07",
    kind: "wiki",
    at: "2026-11-17T16:20:00",
    origin: "knowledge",
    who: { type: "ai", model: "claude-opus-4-7" },
    title: "Cold proofing and flavor",
    detail: "How temperature and time trade off · Doing it in a home fridge",
    trace: { type: "sources", count: 3 },
  },
  {
    id: "r08",
    kind: "media",
    at: "2026-11-17T21:30:00",
    origin: "file",
    who: { type: "self" },
    title: "bread-basics-chapter-3.pdf",
    pageCount: 24,
    mediaType: "pdf",
  },
  {
    id: "r09",
    kind: "note",
    at: "2026-11-16T08:20:00",
    origin: "template",
    who: { type: "self" },
    title: "Sandwich loaf, trial 4",
    detail: "Ingredients · Steps · Result",
  },
  {
    id: "r10",
    kind: "media",
    at: "2026-11-16T12:15:00",
    origin: "phone",
    who: { type: "self" },
    title: "voice-memo-after-kneading.m4a",
    mediaType: "audio",
  },
  {
    id: "r11",
    kind: "note",
    at: "2026-11-16T15:00:00",
    origin: "shared",
    who: { type: "other", name: "Minato" },
    title: "A basic spice curry ratio",
    detail: "Whole spices · Temperature and time for the onions · Finishing",
  },
  {
    id: "r12",
    kind: "note",
    at: "2026-11-16T20:40:00",
    origin: "written",
    who: { type: "self" },
    title: "This week in review",
    detail: "What went well · What to change next",
  },
  {
    id: "r13",
    kind: "note",
    at: "2026-11-14T19:10:00",
    origin: "file",
    who: { type: "self" },
    title: "Curry notes",
    detail: "Onions · Tomatoes · Simmering",
  },
  {
    id: "r14",
    kind: "memo",
    at: "2026-11-14T22:05:00",
    origin: "memo",
    who: { type: "self" },
    text: "With a different tin, the same oven temperature might be fine",
  },
];

export const SAMPLE_RECORDS: Record<SampleLocale, RecordItem[]> = { ja: JA, en: EN };

/**
 * 記録の多い日の仮データ。ナレッジ化で AI のページが 40 件、取り込みでファイルが 12 件続く。
 * 実データでは 1 日に数百件が並ぶ日があるので、まとめ行の見え方を確かめるのに使う。
 */
export function busyDayRecords(locale: SampleLocale): RecordItem[] {
  const ja = locale === "ja";
  const pad = (n: number) => String(n).padStart(2, "0");
  const wiki: RecordItem[] = Array.from({ length: 40 }, (_, i) => ({
    id: `busy-w${i}`,
    kind: "wiki",
    at: `2026-11-17T06:${pad(10 + Math.floor(i / 2))}:00`,
    origin: "knowledge",
    who: { type: "ai", model: "claude-opus-4-7" },
    // 探す言葉（温度 / temperature）に当たるのは 20 件に 1 件だけにして、当たらない記録がまとまる様子も見られるようにする
    title:
      i % 20 === 7
        ? ja
          ? `発酵の温度についての知見 ${i + 1}`
          : `Finding ${i + 1} on proofing temperature`
        : ja
          ? `生地のこね方についての知見 ${i + 1}`
          : `Finding ${i + 1} on kneading the dough`,
    trace: { type: "sources", count: 1 + (i % 3) },
  }));
  const files: RecordItem[] = Array.from({ length: 12 }, (_, i) => ({
    id: `busy-f${i}`,
    kind: "media",
    at: `2026-11-17T08:${pad(i)}:00`,
    origin: "file",
    who: { type: "self" },
    title: ja ? `製パンの資料_${pad(i + 1)}.pdf` : `bread-reference-${pad(i + 1)}.pdf`,
    mediaType: "pdf",
    pageCount: 8 + i,
  }));
  return [...wiki, ...files, ...SAMPLE_RECORDS[locale]];
}

/**
 * 3 か月にわたる仮データ。カレンダーで月をまたいで移る様子を確かめるのに使う。
 * 9 月と 10 月に、日によって件数の違うメモを足す。10 月 12 日だけ 60 件（一括の取り込みを模した偏り）。
 */
export function longHistoryRecords(locale: SampleLocale): RecordItem[] {
  const ja = locale === "ja";
  const pad = (n: number) => String(n).padStart(2, "0");
  const plan: [month: number, day: number, count: number][] = [
    [9, 3, 1], [9, 8, 2], [9, 9, 1], [9, 15, 4], [9, 22, 2], [9, 28, 7],
    [10, 2, 3], [10, 5, 1], [10, 6, 9], [10, 12, 60], [10, 13, 2], [10, 19, 5], [10, 20, 1], [10, 27, 14], [10, 30, 2],
    [11, 2, 2], [11, 5, 6], [11, 9, 1], [11, 11, 3],
  ];
  const extra: RecordItem[] = plan.flatMap(([month, day, count]) =>
    Array.from({ length: count }, (_, i): RecordItem => {
      const file = count >= 20;
      return {
        id: `long-${month}-${day}-${i}`,
        kind: file ? "media" : "memo",
        at: `2026-${pad(month)}-${pad(day)}T${pad(9 + (i % 12))}:${pad((i * 7) % 60)}:00`,
        origin: file ? "file" : "memo",
        who: { type: "self" },
        ...(file
          ? { title: ja ? `レシピの写し_${pad(i + 1)}.pdf` : `recipe-copy-${pad(i + 1)}.pdf`, mediaType: "pdf" as const }
          : { text: ja ? `${month} 月 ${day} 日の試作の覚え書き ${i + 1}` : `Trial note ${i + 1} for ${month}/${day}` }),
      };
    }),
  );
  return [...SAMPLE_RECORDS[locale], ...extra];
}

/** 仮データのフォルダの名前 */
export const SAMPLE_FOLDERS: Record<SampleLocale, { loaf: string; classroom: string; curry: string; copies: string }> = {
  ja: { loaf: "食パンの試作", classroom: "パン教室", curry: "カレーの研究", copies: "レシピの写し" },
  en: { loaf: "Sandwich loaf trials", classroom: "Baking class", curry: "Curry study", copies: "Recipe copies" },
};

/**
 * フォルダに入れた仮データ。3 か月分の記録に、フォルダとチェックリストの数を足す。
 * 「今週の振り返り」と 11 月の覚え書きは、どのフォルダにも入れていない。
 */
export function folderRecords(locale: SampleLocale): RecordItem[] {
  const f = SAMPLE_FOLDERS[locale];
  const byId: Record<string, readonly string[]> = {
    r01: [f.loaf], r03: [f.loaf], r04: [f.loaf], r05: [f.loaf], r06: [f.loaf], r07: [f.loaf], r09: [f.loaf], r10: [f.loaf], r14: [f.loaf],
    // 1 つの記録が 2 つのフォルダに入っている例
    r02: [f.classroom, f.loaf], r08: [f.classroom],
    r11: [f.curry], r13: [f.curry],
  };
  const checklist: Record<string, { open: number; total: number }> = {
    r02: { open: 3, total: 5 },
    r09: { open: 2, total: 6 },
    r11: { open: 0, total: 4 },
  };
  return longHistoryRecords(locale).map((item): RecordItem => {
    const long = /^long-(\d+)-(\d+)-/.exec(item.id);
    const folders = long
      ? long[1] === "9"
        ? [f.curry]
        : long[1] === "10"
          ? [item.kind === "media" ? f.copies : f.loaf]
          : undefined
      : byId[item.id];
    return { ...item, ...(folders ? { folders } : {}), ...(checklist[item.id] ? { checklist: checklist[item.id] } : {}) };
  });
}

/** フォルダの多い仮データ。たたんだ見え方を確かめるのに使う */
export function manyFolderRecords(locale: SampleLocale): RecordItem[] {
  const ja = locale === "ja";
  const names = ja
    ? ["ピザ生地", "ベーグル", "あんパン", "クロワッサン", "スコーン"]
    : ["Pizza dough", "Bagels", "Sweet bean buns", "Croissants", "Scones"];
  const pad = (n: number) => String(n).padStart(2, "0");
  const extra: RecordItem[] = names.flatMap((name, i) =>
    Array.from({ length: 2 + i }, (_, j): RecordItem => ({
      id: `many-${i}-${j}`,
      kind: "memo",
      at: `2026-11-${pad(12 - i)}T${pad(10 + j)}:00:00`,
      origin: "memo",
      who: { type: "self" },
      text: ja ? `${name}の覚え書き ${j + 1}` : `${name} note ${j + 1}`,
      folders: [name],
    })),
  );
  return [...folderRecords(locale), ...extra];
}
