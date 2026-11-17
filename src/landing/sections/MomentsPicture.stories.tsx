// LP のコンセプトの絵を、ヒーローの題のすぐ下に置いたときの見え方で確かめるストーリー。
// 題は仮に添えている（LandingPage にはまだ組み込んでいない）。

import type { Meta, StoryObj } from "@storybook/react-vite";
import "../landing.css";
import { en, ja } from "../i18n";
import { MomentsPicture, type MomentsLocale } from "./MomentsPicture";

function InHero({ locale }: { locale: MomentsLocale }) {
  const dict = locale === "ja" ? ja : en;
  return (
    <div className="lp-root">
      <section className="lp-section">
        <p className="lp-eyebrow">{dict["hero.eyebrow"]}</p>
        <h1 className="lp-h1" style={{ marginTop: "0.6rem" }}>
          {dict["hero.title"]}
        </h1>
        <MomentsPicture locale={locale} />
      </section>
    </div>
  );
}

const meta: Meta<typeof InHero> = {
  title: "Landing/Moments Picture",
  component: InHero,
  parameters: { layout: "fullscreen" },
  argTypes: {
    locale: { control: "inline-radio", options: ["ja", "en"] },
  },
  args: { locale: "ja" },
};
export default meta;

type Story = StoryObj<typeof InHero>;

// 今日の記録（左）と、同じ記録が言葉で見つかる様子（右）
export const Found: Story = {};
export const FoundEnglish: Story = { args: { locale: "en" } };
