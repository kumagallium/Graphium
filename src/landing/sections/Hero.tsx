import { useI18n } from "../i18n";
import { MomentsPicture } from "./MomentsPicture";
import { DESKTOP_DOWNLOAD_URL, labSampleHref } from "../links";

export function Hero() {
  const { t, locale } = useI18n();
  // ボタンは主 1 つ・副 1 つ。主はデスクトップ版（AI の接続・Web のクリップ・録音の文字起こしが揃う形）、
  // 副は実験ノートの見本（AI をつながずに開ける）。ブラウザ版と GitHub は「はじめる」とフッターに置く
  return (
    <section className="lp-section" id="top">
      <p className="lp-eyebrow">{t("hero.eyebrow")}</p>
      <h1 className="lp-h1" lang={locale} style={{ marginTop: "0.6rem" }}>
        {t("hero.title")}
      </h1>
      <p className="lp-lead" style={{ marginTop: "1.4rem" }}>
        {t("hero.subtitle")}
      </p>
      <div className="lp-cta-row">
        <a className="lp-btn lp-btn-primary" href={DESKTOP_DOWNLOAD_URL} target="_blank" rel="noreferrer noopener">
          {t("hero.download")} →
        </a>
        <a className="lp-btn lp-btn-secondary" href={labSampleHref(locale)}>
          {t("hero.seeSample")}
        </a>
      </div>
      <MomentsPicture />
    </section>
  );
}
