import { useI18n } from "../i18n";

export function Hero() {
  const { t } = useI18n();
  return (
    <section className="lp-section" id="top">
      <p className="lp-eyebrow">{t("hero.eyebrow")}</p>
      <h1 className="lp-h1" style={{ marginTop: "0.6rem" }}>
        {t("hero.title")}
      </h1>
      <p className="lp-lead" style={{ marginTop: "1.4rem" }}>
        {t("hero.subtitle")}
      </p>
      <div className="lp-cta-row">
        <a className="lp-btn lp-btn-primary" href="/Graphium/app/">
          {t("hero.tryOnline")} →
        </a>
        <a
          className="lp-btn lp-btn-secondary"
          href="https://github.com/kumagallium/Graphium/releases/latest"
          target="_blank"
          rel="noreferrer noopener"
        >
          {t("hero.download")}
        </a>
        <a
          className="lp-btn lp-btn-ghost"
          href="https://github.com/kumagallium/Graphium"
          target="_blank"
          rel="noreferrer noopener"
        >
          ★ {t("hero.starOnGithub")}
        </a>
      </div>
      <figure className="lp-hero-shot">
        <img src="/Graphium/landing/hero.png" alt={t("hero.shotAlt")} />
      </figure>
    </section>
  );
}
