import { useI18n } from "../i18n";

export function Screens() {
  const { t } = useI18n();
  const rows = [
    {
      src: "/Graphium/landing/screen-editor.png",
      alt: t("screens.editor.alt"),
      title: t("screens.editor.title"),
      body: t("screens.editor.body"),
    },
    {
      src: "/Graphium/landing/screen-knowledge.png",
      alt: t("screens.knowledge.alt"),
      title: t("screens.knowledge.title"),
      body: t("screens.knowledge.body"),
    },
    {
      src: "/Graphium/landing/screen-trace.png",
      alt: t("screens.trace.alt"),
      title: t("screens.trace.title"),
      body: t("screens.trace.body"),
    },
  ];

  return (
    <section className="lp-section" id="screens">
      <p className="lp-eyebrow">Screens</p>
      <h2 className="lp-h2" style={{ marginTop: "0.5rem" }}>
        {t("screens.heading")}
      </h2>

      <div className="lp-screens">
        {rows.map((row) => (
          <div key={row.title} className="lp-screen-row">
            <figure className="lp-screen-shot">
              <img src={row.src} alt={row.alt} loading="lazy" />
            </figure>
            <div className="lp-screen-caption">
              <h3>{row.title}</h3>
              <p>{row.body}</p>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
