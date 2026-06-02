// テンプレートピッカーモーダル
// /template スラッシュコマンドから呼び出し、テンプレートをテーブル表示で選択する

import { useEffect, useMemo, useRef, useState } from "react";
import { useT } from "../../i18n";
import { getAllTemplates, type TemplateDef } from "./templates";

type Props = {
  onSelect: (templateId: string) => void;
  onClose: () => void;
};

export function TemplatePickerModal({ onSelect, onClose }: Props) {
  const t = useT();
  const [searchQuery, setSearchQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [onClose]);

  const allTemplates = useMemo(() => getAllTemplates(), []);

  const filtered = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return allTemplates;
    return allTemplates.filter((tmpl) => {
      const fields = [
        t(tmpl.titleKey),
        t(tmpl.descKey),
        ...(tmpl.tagKeys ?? []).map((k) => t(k)),
      ].join(" ").toLowerCase();
      return fields.includes(q);
    });
  }, [allTemplates, searchQuery, t]);

  const handleSelect = (tmpl: TemplateDef) => {
    onSelect(tmpl.id);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="bg-background border border-border rounded-lg shadow-2xl w-[640px] max-h-[70vh] flex flex-col overflow-hidden">
        {/* ヘッダー */}
        <div className="flex items-center gap-3 px-4 py-3 border-b border-border">
          <h2 className="text-sm font-semibold text-foreground">
            {t("template.modal.title")}
          </h2>
          <span className="text-[10px] text-muted-foreground">
            {t("template.modal.count", { count: String(filtered.length) })}
          </span>
          <button
            onClick={onClose}
            className="ml-auto text-muted-foreground hover:text-foreground transition-colors text-lg leading-none px-1"
            aria-label={t("common.close")}
          >
            ✕
          </button>
        </div>

        {/* 検索 */}
        <div className="px-4 py-2 border-b border-border">
          <input
            ref={inputRef}
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={t("template.modal.search")}
            className="w-full text-xs px-3 py-1.5 rounded border border-border bg-background text-foreground placeholder:text-muted-foreground outline-none focus:border-primary transition-colors"
          />
        </div>

        {/* テーブル */}
        <div className="flex-1 overflow-auto">
          {filtered.length === 0 ? (
            <div className="p-8 text-center text-xs text-muted-foreground">
              {t("template.modal.empty")}
            </div>
          ) : (
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-background border-b border-border">
                <tr className="text-left text-[10px] text-muted-foreground">
                  <th className="px-4 py-2 font-medium">{t("template.modal.colName")}</th>
                  <th className="px-4 py-2 font-medium">{t("template.modal.colSource")}</th>
                  <th className="px-4 py-2 font-medium">{t("template.modal.colTags")}</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((tmpl) => (
                  <tr
                    key={tmpl.id}
                    onClick={() => handleSelect(tmpl)}
                    className="cursor-pointer hover:bg-muted/50 border-b border-border/50 transition-colors"
                  >
                    <td className="px-4 py-3 align-top">
                      <div className="font-medium text-foreground">{t(tmpl.titleKey)}</div>
                      <div className="text-[11px] text-muted-foreground mt-0.5">
                        {t(tmpl.descKey)}
                      </div>
                    </td>
                    <td className="px-4 py-3 align-top whitespace-nowrap">
                      <SourceBadge source={tmpl.source} t={t} />
                    </td>
                    <td className="px-4 py-3 align-top">
                      <div className="flex flex-wrap gap-1">
                        {(tmpl.tagKeys ?? []).map((tagKey) => (
                          <span
                            key={tagKey}
                            className="px-1.5 py-0.5 rounded text-[10px] bg-muted text-muted-foreground border border-border"
                          >
                            {t(tagKey)}
                          </span>
                        ))}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}

function SourceBadge({
  source,
  t,
}: {
  source: "official" | "user";
  t: (key: string) => string;
}) {
  const isOfficial = source === "official";
  return (
    <span
      className={
        "inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium border " +
        (isOfficial
          ? "bg-primary/10 text-primary border-primary/30"
          : "bg-muted text-muted-foreground border-border")
      }
    >
      {isOfficial ? t("template.source.official") : t("template.source.user")}
    </span>
  );
}
