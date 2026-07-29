import { useI18n } from "../i18n";

export function Footer() {
  const { t } = useI18n();
  return (
    <footer className="lp-footer">
      <div className="lp-footer-inner">
        <div>
          {t("footer.builtBy")}{" "}
          <a
            href="https://github.com/kumagallium"
            target="_blank"
            rel="noreferrer noopener"
            style={{ marginRight: 0 }}
          >
            @kumagallium
          </a>
          {" · "}Apache 2.0
        </div>
        <div>
          <a
            href="https://github.com/kumagallium/Graphium"
            target="_blank"
            rel="noreferrer noopener"
          >
            {t("footer.repo")}
          </a>
          <a
            href="https://dev.to/kumagallium/i-want-to-build-a-note-app-where-discoveries-happen-496n"
            target="_blank"
            rel="noreferrer noopener"
          >
            {t("footer.blog")}
          </a>
          <a
            href="https://github.com/kumagallium/Graphium/releases"
            target="_blank"
            rel="noreferrer noopener"
          >
            {t("footer.releases")}
          </a>
          <a href="/Graphium/manual/">{t("footer.manual")}</a>
        </div>
      </div>
    </footer>
  );
}
