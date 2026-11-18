// LP のコンセプトの絵を、ヒーローの題のすぐ下に置いたときの見え方で確かめるストーリー。

import { useEffect } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import "../landing.css";
import { LocaleProvider, useI18n } from "../i18n";
import { MomentsPicture } from "./MomentsPicture";

type StoryLocale = "ja" | "en";

function Stage({ locale }: { locale: StoryLocale }) {
  const { t, setLocale, locale: current } = useI18n();
  // ストーリーの言語に合わせる（LP は保存された言語かブラウザの言語で始まる）
  useEffect(() => {
    if (current !== locale) setLocale(locale);
  }, [current, locale, setLocale]);
  if (current !== locale) return null;
  return (
    <div className="lp-root">
      <section className="lp-section">
        <p className="lp-eyebrow">{t("hero.eyebrow")}</p>
        <h1 className="lp-h1" lang={locale} style={{ marginTop: "0.6rem" }}>
          {t("hero.title")}
        </h1>
        <MomentsPicture />
      </section>
    </div>
  );
}

function InHero({ locale }: { locale: StoryLocale }) {
  return (
    <LocaleProvider>
      <Stage locale={locale} />
    </LocaleProvider>
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
