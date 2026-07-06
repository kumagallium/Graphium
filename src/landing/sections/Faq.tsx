import { useI18n } from "../i18n";

export function Faq() {
  const { t } = useI18n();
  const items = [
    { q: t("faq.ai.q"), a: t("faq.ai.a") },
    { q: t("faq.scope.q"), a: t("faq.scope.a") },
    { q: t("faq.zettel.q"), a: t("faq.zettel.a") },
    { q: t("faq.data.q"), a: t("faq.data.a") },
    { q: t("faq.free.q"), a: t("faq.free.a") },
  ];

  return (
    <section className="lp-section" id="faq">
      <p className="lp-eyebrow">FAQ</p>
      <h2 className="lp-h2" style={{ marginTop: "0.5rem" }}>
        {t("faq.heading")}
      </h2>

      <div className="lp-faq">
        {items.map((item) => (
          <details key={item.q}>
            <summary>{item.q}</summary>
            <p>{item.a}</p>
          </details>
        ))}
      </div>
    </section>
  );
}
