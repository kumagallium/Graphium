import { useI18n } from "../i18n";

export function Header() {
  const { locale, setLocale, t } = useI18n();

  return (
    <header className="lp-header">
      <div className="lp-header-inner">
        <a href="#top" className="lp-brand">
          <img src="/Graphium/logo.png" alt="" />
          <span>Graphium</span>
        </a>
        <nav className="lp-nav">
          <a href="#how">{t("nav.how")}</a>
          <a href="#screens">{t("nav.screens")}</a>
          <a href="#start">{t("nav.start")}</a>
          <a href="#faq">{t("nav.faq")}</a>
          <a href="/Graphium/manual/">{t("nav.manual")}</a>
          <a
            href="https://github.com/kumagallium/Graphium"
            target="_blank"
            rel="noreferrer noopener"
          >
            GitHub
          </a>
          <button
            type="button"
            onClick={() => setLocale(locale === "en" ? "ja" : "en")}
            aria-label="Toggle language"
          >
            {locale === "en" ? "日本語" : "English"}
          </button>
        </nav>
      </div>
    </header>
  );
}
