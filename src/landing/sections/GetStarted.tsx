import { useI18n } from "../i18n";

export function GetStarted() {
  const { t } = useI18n();
  const cards = [
    {
      title: t("start.online.title"),
      body: t("start.online.body"),
      cta: t("start.online.cta"),
      href: "/Graphium/app/?intro=1",
      external: false,
    },
    {
      title: t("start.desktop.title"),
      body: t("start.desktop.body"),
      cta: t("start.desktop.cta"),
      href: "https://github.com/kumagallium/Graphium/releases/latest",
      external: true,
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
