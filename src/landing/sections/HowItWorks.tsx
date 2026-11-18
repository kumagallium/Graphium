import { useI18n } from "../i18n";

export function HowItWorks() {
  const { t, locale } = useI18n();
  // 主要体験 1 本の動画（音声なし・字幕入り）。見本と同じ題材で、言語ごとに 1 本。
  // AI が記録をつなぎ、答えの出どころまで辿る様子なので、手順（入れる・探す・AI とつながる）の下に置く。
  // ヒーローの絵は「AI なしでも成り立つ」ことを伝え、動画はその先を見せる
  const videoSrc = `/Graphium/demo/graphium-demo-${locale === "ja" ? "ja" : "en"}.mp4`;
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

      <figure className="lp-hero-shot">
        <video
          controls
          preload="none"
          playsInline
          poster="/Graphium/landing/hero.png"
          src={videoSrc}
          aria-label={t("hero.videoLabel")}
        />
        <figcaption className="lp-hero-caption">{t("hero.videoCaption")}</figcaption>
      </figure>
    </section>
  );
}
