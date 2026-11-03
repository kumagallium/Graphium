import { useI18n } from "../i18n";

export function Hero() {
  const { t, locale } = useI18n();
  // 見本（features/demo）は言語ごとに束が分かれる（日本語はカレー作り、英語はパン作り）。LP の表示言語に合わせる
  const sampleHref = `/Graphium/app/?demo=${locale === "ja" ? "curry-ja" : "bread-en"}`;
  // 主要体験 1 本の動画（音声なし・字幕入り）。見本と同じ題材で、言語ごとに 1 本。
  // 静止画はこれまでの hero.png をポスターに使うので、再生するまで見た目は変わらない
  const videoSrc = `/Graphium/demo/graphium-demo-${locale === "ja" ? "ja" : "en"}.mp4`;
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
        <a className="lp-btn lp-btn-secondary" href={sampleHref}>
          {t("hero.seeSample")}
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
