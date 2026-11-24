// 記録 1 行のデザイン提案。小さい部品から順に見て決めるための最初の段。
// 並びは「いつ ｜ どこで・誰が ｜ 何を」。使っているのは、いまのデータに入っている項目だけ。

import type { Meta, StoryObj } from "@storybook/react-vite";
import { useRecordCopy } from "./copy";
import { OriginBadge, RecordRow, WhoLabel, WhoMark } from "./RecordRow";
import { SAMPLE_QUERY, SAMPLE_RECORDS } from "./sample-records";
import { StoryCaption, StoryFrame, StorySheet } from "./story-frame";
import type { RecordItem, SampleLocale, RecordOrigin, RecordWho } from "./types";

type Args = { locale: SampleLocale; variant: "rail" | "ledger"; width?: number; query?: string };

const pick = (locale: SampleLocale, ids: string[]): RecordItem[] =>
  ids.map((id) => SAMPLE_RECORDS[locale].find((r) => r.id === id)!).filter(Boolean);

function Rows({ items, variant, query }: { items: RecordItem[] } & Args) {
  return (
    <ol className={variant === "ledger" ? "rd-lrows" : "rd-rows"}>
      {items.map((item) => (
        <RecordRow key={item.id} item={item} variant={variant} query={query} />
      ))}
    </ol>
  );
}

const meta: Meta<Args> = {
  title: "Record Dashboard/1 Record Row",
  parameters: { layout: "fullscreen" },
  argTypes: {
    locale: { control: "inline-radio", options: ["ja", "en"] },
    variant: { control: "inline-radio", options: ["rail", "ledger"] },
  },
  args: { locale: "ja", variant: "rail" },
};
export default meta;

type Story = StoryObj<Args>;

const KIND_IDS = ["r02", "r07", "r04", "r01"];

// 種類ごとの見え方: ノート / AI のページ / 素材 / メモ
export const Kinds: Story = {
  render: (args) => (
    <StoryFrame width={args.width} locale={args.locale}>
      <StoryCaption>
        {args.locale === "ja"
          ? "種類ごとの 1 行。ノートと AI のページは題を太く、メモは本文をそのまま、素材は左に小さな面を置きます。"
          : "One row per kind. Notes and AI pages lead with a bold title, memos show the text itself, materials get a small tile."}
      </StoryCaption>
      <StorySheet maxWidth={args.variant === "ledger" ? 960 : 720}>
        <Rows items={pick(args.locale, KIND_IDS)} {...args} />
      </StorySheet>
    </StoryFrame>
  ),
};

export const KindsEnglish: Story = { ...Kinds, args: { locale: "en" } };
export const KindsNarrow: Story = { ...Kinds, args: { width: 375 } };
export const KindsLedger: Story = { ...Kinds, args: { variant: "ledger" } };

const WHO_IDS = ["r12", "r06", "r07", "r11"];

// 誰の違い: 自分 / 自分と AI / AI / 共有の作者。線の上の印の形が変わる
export const Who: Story = {
  render: (args) => {
    const copy = useRecordCopy();
    const marks: { who: RecordWho; note: string }[] =
      args.locale === "ja"
        ? [
            { who: { type: "self" }, note: "AI の印も共有の作者も無い記録" },
            { who: { type: "selfWithAi", model: "claude-opus-4-7" }, note: "AI が書き、自分が指示したノート" },
            { who: { type: "ai", model: "claude-opus-4-7" }, note: "AI のページ" },
            { who: { type: "other", name: "みなと" }, note: "共有ライブラリの作者" },
          ]
        : [
            { who: { type: "self" }, note: "No AI mark and no shared author" },
            { who: { type: "selfWithAi", model: "claude-opus-4-7" }, note: "Written by AI at your request" },
            { who: { type: "ai", model: "claude-opus-4-7" }, note: "AI page" },
            { who: { type: "other", name: "Minato" }, note: "Author in the shared library" },
          ];
    return (
      <StoryFrame width={args.width} locale={args.locale}>
        <StoryCaption>
          {args.locale === "ja"
            ? "残した人は、文字と、線の上の印の形の両方で示します（色だけに頼らない）。"
            : "Who kept it is shown by the label and by the shape of the mark on the line, not by color alone."}
        </StoryCaption>
        <StorySheet>
          <ul style={{ display: "grid", gap: 8, padding: "0 12px 16px", marginBottom: 12, borderBottom: "1px solid var(--rule-2)" }}>
            {marks.map((m) => (
              <li key={m.who.type} style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                <WhoMark type={m.who.type} />
                <WhoLabel who={m.who} copy={copy} />
                <span style={{ fontSize: 12, color: "var(--ink-3)" }}>{m.note}</span>
              </li>
            ))}
          </ul>
          <Rows items={pick(args.locale, WHO_IDS)} {...args} />
        </StorySheet>
      </StoryFrame>
    );
  },
};

export const WhoEnglish: Story = { ...Who, args: { locale: "en" } };

const ORIGINS: RecordOrigin[] = [
  "written",
  "template",
  "file",
  "memo",
  "shared",
  "webClip",
  "quote",
  "aiChat",
  "knowledge",
  "phone",
];

// 出どころの札の一覧。色は 3 系統＋無彩色に抑えている
export const Origins: Story = {
  render: (args) => {
    const copy = useRecordCopy();
    return (
      <StoryFrame width={args.width} locale={args.locale}>
        <StoryCaption>
          {args.locale === "ja"
            ? "出どころの札。人の手とファイル（無彩色）／Web（amber）／AI（sky）／スマホ（forest）で色を分けます。"
            : "Origin badges. Hand and files (neutral), web (amber), AI (sky), phone (forest)."}
        </StoryCaption>
        <StorySheet>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, padding: "4px 12px" }}>
            {ORIGINS.map((o) => (
              <OriginBadge key={o} origin={o} copy={copy} />
            ))}
          </div>
        </StorySheet>
      </StoryFrame>
    );
  },
};

export const OriginsEnglish: Story = { ...Origins, args: { locale: "en" } };

// 言葉で探したときの印。題・本文・題の下の 1 行のどれに当たっても付く
export const SearchHit: Story = {
  render: (args) => (
    <StoryFrame width={args.width} locale={args.locale}>
      <StorySheet maxWidth={args.variant === "ledger" ? 960 : 720}>
        <Rows items={pick(args.locale, ["r01", "r04", "r05", "r06"])} {...args} query={SAMPLE_QUERY[args.locale]} />
      </StorySheet>
    </StoryFrame>
  ),
};

// 共有ライブラリの記録（案）。ほかの人が共有したノートが、残した順の流れに 1 行として並ぶ。
// 計画の行の記録なら「計画の題 › 行の名前」を、チェックリストがあれば共有した時点の件数を添える。
// どれも共有の封筒にある値で、本文は読まない。件数は数えた結果で、割合・並べ替え・色の印にはしない
const SHARED_ROWS: Record<SampleLocale, RecordItem[]> = {
  ja: [
    {
      id: "shared:1",
      kind: "note",
      at: "2026-11-24T14:20:00",
      origin: "shared",
      who: { type: "other", name: "佐藤 花" },
      title: "一次発酵",
      planRow: { planTitle: "食パンの計画", rowName: "一次発酵" },
      checks: { checked: 3, total: 5 },
    },
    {
      id: "shared:2",
      kind: "note",
      at: "2026-11-24T11:05:00",
      origin: "shared",
      who: { type: "other", name: "田中 蓮" },
      title: "計量とこね（全粒粉 30%）",
      planRow: { planTitle: "食パンの計画", rowName: "計量とこね" },
    },
    {
      id: "shared:3",
      kind: "note",
      at: "2026-11-24T09:30:00",
      origin: "shared",
      who: { type: "other", name: "佐藤 花" },
      title: "焼き色の比較",
      planRow: { rowName: "焼成" },
      checks: { checked: 4, total: 4 },
    },
    {
      id: "shared:4",
      kind: "note",
      at: "2026-11-23T16:00:00",
      origin: "shared",
      who: { type: "other", name: "みなと" },
      title: "スパイスカレーの基本の配合",
      checks: { checked: 0, total: 6 },
    },
    {
      id: "shared:5",
      kind: "note",
      at: "2026-11-23T10:10:00",
      origin: "shared",
      who: { type: "other", name: "みなと" },
      title: "オーブンの予熱の目安",
    },
  ],
  en: [
    {
      id: "shared:1",
      kind: "note",
      at: "2026-11-24T14:20:00",
      origin: "shared",
      who: { type: "other", name: "Maya Sato" },
      title: "Bulk ferment",
      planRow: { planTitle: "Sandwich loaf plan", rowName: "Bulk ferment" },
      checks: { checked: 3, total: 5 },
    },
    {
      id: "shared:2",
      kind: "note",
      at: "2026-11-24T11:05:00",
      origin: "shared",
      who: { type: "other", name: "Leo Tanaka" },
      title: "Mix and knead (30% whole wheat)",
      planRow: { planTitle: "Sandwich loaf plan", rowName: "Mix and knead" },
    },
    {
      id: "shared:3",
      kind: "note",
      at: "2026-11-24T09:30:00",
      origin: "shared",
      who: { type: "other", name: "Maya Sato" },
      title: "Crust colour comparison",
      planRow: { rowName: "Bake" },
      checks: { checked: 4, total: 4 },
    },
    {
      id: "shared:4",
      kind: "note",
      at: "2026-11-23T16:00:00",
      origin: "shared",
      who: { type: "other", name: "Minato" },
      title: "A basic spice curry ratio",
      checks: { checked: 0, total: 6 },
    },
    {
      id: "shared:5",
      kind: "note",
      at: "2026-11-23T10:10:00",
      origin: "shared",
      who: { type: "other", name: "Minato" },
      title: "Oven preheating notes",
    },
  ],
};

export const SharedRowRecords: Story = {
  render: (args) => (
    <StoryFrame width={args.width} locale={args.locale}>
      <StoryCaption>
        {args.locale === "ja"
          ? "共有ライブラリの記録（案）。上から: 計画の行の記録で件数あり / 件数なし / 計画の題が分からない / 計画に結び付かない共有ノートで件数あり / どちらも無い。"
          : "Records from the shared library (proposal). From the top: a plan row record with a count / without one / plan title unknown / a shared note with a count but no plan / neither."}
      </StoryCaption>
      <StorySheet maxWidth={args.variant === "ledger" ? 960 : 720}>
        <Rows items={SHARED_ROWS[args.locale]} {...args} />
      </StorySheet>
    </StoryFrame>
  ),
};

export const SharedRowRecordsEnglish: Story = { ...SharedRowRecords, args: { locale: "en" } };
export const SharedRowRecordsNarrow: Story = { ...SharedRowRecords, args: { width: 375 } };
export const SharedRowRecordsLedger: Story = { ...SharedRowRecords, args: { variant: "ledger" } };
