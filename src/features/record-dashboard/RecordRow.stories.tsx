// 記録 1 行のデザイン提案。小さい部品から順に見て決めるための最初の段。
// 並びは「いつ ｜ どこで・誰が ｜ 何を」。使っているのは、いまのデータに入っている項目だけ。

import type { Meta, StoryObj } from "@storybook/react-vite";
import { useRecordCopy } from "./copy";
import { OriginBadge, RecordRow, WhoLabel, WhoMark } from "./RecordRow";
import { SAMPLE_QUERY, SAMPLE_RECORDS, SAMPLE_SHARED_RECORDS, SAMPLE_UPDATED_RECORDS } from "./sample-records";
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

export const SharedRowRecords: Story = {
  render: (args) => (
    <StoryFrame width={args.width} locale={args.locale}>
      <StoryCaption>
        {args.locale === "ja"
          ? "共有フォルダの記録。上から: 計画の行の記録で件数あり / 件数なし / 計画の題が分からない / 計画に結び付かない共有ノート（2 件。件数は添えない）。"
          : "Records from the shared folder. From the top: a plan row record with a count / without one / plan title unknown / shared notes not tied to a plan (two; no count)."}
      </StoryCaption>
      <StorySheet maxWidth={args.variant === "ledger" ? 960 : 720}>
        <Rows items={SAMPLE_SHARED_RECORDS[args.locale]} {...args} />
      </StorySheet>
    </StoryFrame>
  ),
};

export const SharedRowRecordsEnglish: Story = { ...SharedRowRecords, args: { locale: "en" } };
export const SharedRowRecordsNarrow: Story = { ...SharedRowRecords, args: { width: 375 } };
export const SharedRowRecordsLedger: Story = { ...SharedRowRecords, args: { variant: "ledger" } };

// 更新の行。作った行は作った日に残したまま、書き換えた日ごとに「更新」の行を足す（ここでは今日の 3 件）
export const UpdatedRows: Story = {
  render: (args) => {
    const created = pick(args.locale, ["r02"]);
    return (
      <StoryFrame width={args.width} locale={args.locale}>
        <StoryCaption>
          {args.locale === "ja"
            ? "更新の行（上の 3 件）。出どころの札の位置に「更新」を置き、題の下に作った日を添えます。見出しや来歴は作った行に任せ、更新の行は題だけ。比べるために、いちばん下にふつうの作った行を置いています。"
            : "Updated rows (the top three). An Updated badge takes the place of the origin badge, and the day it was created goes under the title. Headings and traces stay on the created row; an updated row shows the title only. The last row is an ordinary created row, for comparison."}
        </StoryCaption>
        <StorySheet maxWidth={args.variant === "ledger" ? 960 : 720}>
          <Rows items={[...SAMPLE_UPDATED_RECORDS[args.locale].slice(0, 3), ...created]} {...args} />
        </StorySheet>
      </StoryFrame>
    );
  },
};

export const UpdatedRowsEnglish: Story = { ...UpdatedRows, args: { locale: "en" } };
export const UpdatedRowsNarrow: Story = { ...UpdatedRows, args: { width: 375 } };
export const UpdatedRowsLedger: Story = { ...UpdatedRows, args: { variant: "ledger" } };
