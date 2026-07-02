import { useI18n } from "../i18n";

export function HowItWorks() {
  const { t } = useI18n();
  const steps = [
    { num: "01", title: t("how.step1.title"), body: t("how.step1.body") },
    { num: "02", title: t("how.step2.title"), body: t("how.step2.body") },
    { num: "03", title: t("how.step3.title"), body: t("how.step3.body") },
  ];

  return (
    <section className="lp-section lp-section--accent" id="how">
      <p className="lp-eyebrow">How it works</p>
      <h2 className="lp-h2" style={{ marginTop: "0.5rem" }}>
        {t("how.heading")}
      </h2>

      <div className="lp-steps">
        {steps.map((step) => (
          <article key={step.num} className="lp-step">
            <span className="lp-step-num">{step.num}</span>
            <h3>{step.title}</h3>
            <p>{step.body}</p>
          </article>
        ))}
      </div>
    </section>
  );
}
