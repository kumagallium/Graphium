import { useI18n } from "../i18n";
import { DESKTOP_DOWNLOAD_URL, labSampleHref } from "../links";

export function GetStarted() {
  const { t, locale } = useI18n();
  // 並びはヒーローと同じ順（デスクトップ版 → 見本 → ブラウザ版）
  const cards = [
    {
      title: t("start.desktop.title"),
      body: t("start.desktop.body"),
      cta: t("start.desktop.cta"),
      href: DESKTOP_DOWNLOAD_URL,
      external: true,
    },
    {
      title: t("start.sample.title"),
      body: t("start.sample.body"),
      cta: t("start.sample.cta"),
      href: labSampleHref(locale),
      external: false,
    },
    {
      title: t("start.online.title"),
      body: t("start.online.body"),
      cta: t("start.online.cta"),
      href: "/Graphium/app/?intro=1",
      external: false,
    },
  ];

  return (
    <section className="lp-section lp-section--accent" id="start">
      <p className="lp-eyebrow">Start</p>
      <h2 className="lp-h2" style={{ marginTop: "0.5rem" }}>
        {t("start.heading")}
      </h2>

      <div className="lp-grid-3">
        {cards.map((card) => (
          <a
            key={card.title}
            className="lp-cta-card"
            href={card.href}
            {...(card.external ? { target: "_blank", rel: "noreferrer noopener" } : {})}
          >
            <h3>{card.title}</h3>
            <p>{card.body}</p>
            <span className="lp-cta-link">{card.cta} →</span>
          </a>
        ))}
      </div>
    </section>
  );
}
