// LP のコンセプトの絵（検討中の 3 案）を見比べるストーリー。
// ヒーローの題のすぐ下に置いたときの見え方を確かめるため、題と副題を仮に添えている。

import type { Meta, StoryObj } from "@storybook/react-vite";
import "../landing.css";
import { en, ja } from "../i18n";
import { MomentsPicture, type MomentsLocale, type MomentsVariant } from "./MomentsPicture";

function InHero({ variant, locale }: { variant: MomentsVariant; locale: MomentsLocale }) {
  const dict = locale === "ja" ? ja : en;
  return (
    <div className="lp-root">
      <section className="lp-section">
        <p className="lp-eyebrow">{dict["hero.eyebrow"]}</p>
        <h1 className="lp-h1" style={{ marginTop: "0.6rem" }}>
          {dict["hero.title"]}
        </h1>
        <MomentsPicture variant={variant} locale={locale} />
      </section>
    </div>
  );
}

const meta: Meta<typeof InHero> = {
  title: "Landing/Moments Picture",
  component: InHero,
  parameters: { layout: "fullscreen" },
  argTypes: {
    variant: { control: "inline-radio", options: ["found", "scenes", "day", "contrast"] },
    locale: { control: "inline-radio", options: ["ja", "en"] },
  },
  args: { locale: "ja" },
};
export default meta;

type Story = StoryObj<typeof InHero>;

// 組み合わせ案: 今日の記録（左）と、言葉で見つかる様子（右）
export const Found: Story = { args: { variant: "found" } };
export const FoundEnglish: Story = { args: { variant: "found", locale: "en" } };

// 案 1: 場面のカードから、同じ 1 つの棚へ
export const Scenes: Story = { args: { variant: "scenes" } };

// 案 2: 1 日の記録が時刻順に 1 本に並ぶ
export const Day: Story = { args: { variant: "day" } };

// 案 3: そのままだと散らばる／入れると探せる
export const Contrast: Story = { args: { variant: "contrast" } };

export const ScenesEnglish: Story = { args: { variant: "scenes", locale: "en" } };
