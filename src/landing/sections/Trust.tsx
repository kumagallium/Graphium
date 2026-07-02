import { useI18n } from "../i18n";

export function Trust() {
  const { t } = useI18n();
  const cards: Array<{ icon: string; title: string; body: string }> = [
    { icon: "🤝", title: t("trust.ai.title"), body: t("trust.ai.body") },
    { icon: "💾", title: t("trust.storage.title"), body: t("trust.storage.body") },
    { icon: "🔓", title: t("trust.open.title"), body: t("trust.open.body") },
  ];

  return (
    <section className="lp-section" id="trust">
      <p className="lp-eyebrow">Trust</p>
      <h2 className="lp-h2" style={{ marginTop: "0.5rem" }}>
        {t("trust.heading")}
      </h2>
      <p className="lp-lead">{t("trust.sub")}</p>

      <div className="lp-grid-3">
        {cards.map((card) => (
          <article key={card.title} className="lp-card">
            <span className="lp-card-icon" aria-hidden="true">
              {card.icon}
            </span>
            <h3>{card.title}</h3>
            <p>{card.body}</p>
          </article>
        ))}
      </div>
    </section>
  );
}
