// テンプレートピッカーモーダル
// /template スラッシュコマンドから呼び出し、テンプレートをテーブル表示で選択する
//
// セクションは 2 つ:
//   1. 公式テンプレート（getAllTemplates() の TemplateDef。id で選ぶ）
//   2. チームのテンプレート（共有ライブラリの type=template。SharedEntry で選ぶ）
// 混ぜないのは、公式は「その場で組み立てる定義」、チームは「共有ルートから本文を
// 読み出す実体」で、選んだあとの経路がまったく違うため（本文の読み出し・hash 照合・
// shared-blob: の解決は呼び出し側 = note-app が担う）。

import { useEffect, useMemo, useRef, useState } from "react";
import { useT } from "../../i18n";
import { getAllTemplates, type TemplateDef } from "./templates";
import type { SharedEntry } from "../../lib/storage/shared";
// 共有ライブラリの読み出しは単一入口のストアから。features/sharing のバレルを経由すると
// ShareTemplateDialog → share-template → features/template で循環参照になるので、
// ストアのモジュールを直接指す。
import {
  getSharedLibraryRoot,
  refreshSharedLibrary,
  useSharedLibrary,
} from "../sharing/shared-library-store";

type Props = {
  onSelect: (templateId: string) => void;
  /**
   * チームのテンプレートを選んだとき。本文の読み出しと挿入は呼び出し側の責務。
   * 未指定でも欄は出す（共有ルートがあるのに欄が消えると「無い」と誤解されるため）。
   */
  onSelectShared?: (entry: SharedEntry) => void;
  onClose: () => void;
};

/** 共有エントリの題名（共有時に extra.title へ書かれる。無ければ無題） */
function sharedTitle(entry: SharedEntry, t: (key: string) => string): string {
  const title = (entry.extra as Record<string, unknown> | undefined)?.title;
  if (typeof title === "string" && title.trim()) return title;
  return t("library.untitled");
}

/** 共有エントリの説明（テンプレート共有ダイアログで入力されたもの） */
function sharedDescription(entry: SharedEntry): string {
  const description = (entry.extra as Record<string, unknown> | undefined)?.description;
  return typeof description === "string" ? description : "";
}

export function TemplatePickerModal({ onSelect, onSelectShared, onClose }: Props) {
  const t = useT();
  const [searchQuery, setSearchQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const sharedLibrary = useSharedLibrary();

  // 共有ルート（デスクトップ + 設定済みのときだけ非 null）。
  // このモーダルは開くたびにマウントされるので、マウント時に固定して構わない。
  const sharedRoot = useMemo(() => getSharedLibraryRoot(), []);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // 開いた時点で共有ルートを 1 回読み直す。Library タブを一度も開いていなくても
  // チーム欄が空にならないようにするため（ストア側で進行中の読みは共有される）。
  useEffect(() => {
    if (!sharedRoot) return;
    void refreshSharedLibrary();
  }, [sharedRoot]);

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

  const sharedTemplates = useMemo(
    () => sharedLibrary.entries.filter((e) => e.type === "template"),
    [sharedLibrary.entries],
  );

  // 検索は公式と同じ 1 本の入力で両方に効かせる（題名・説明・作者）
  const filteredShared = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return sharedTemplates;
    return sharedTemplates.filter((entry) => {
      const fields = [
        sharedTitle(entry, t),
        sharedDescription(entry),
        entry.author?.name ?? "",
      ].join(" ").toLowerCase();
      return fields.includes(q);
    });
  }, [sharedTemplates, searchQuery, t]);

  const handleSelect = (tmpl: TemplateDef) => {
    onSelect(tmpl.id);
  };

  // 件数は画面に出ている行数と合わせる（公式だけ数えるとチーム欄の分だけ嘘になる）
  const visibleCount = filtered.length + filteredShared.length;

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
            {t("template.modal.count", { count: String(visibleCount) })}
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
          {filtered.length === 0 && !sharedRoot ? (
            <div className="p-8 text-center text-xs text-muted-foreground">
              {t("template.modal.empty")}
            </div>
          ) : (
            <>
              {filtered.length > 0 && (
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

              {/* チームのテンプレート（共有ルートが設定されているときだけ） */}
              {sharedRoot && (
                <section className="border-t border-border" data-testid="team-template-section">
                  <h3 className="px-4 py-2 text-[10px] font-medium text-muted-foreground bg-muted/30">
                    {t("template.picker.teamSection")}
                  </h3>
                  {filteredShared.length === 0 ? (
                    <div className="px-4 py-3 text-[11px] text-muted-foreground">
                      {sharedLibrary.loading
                        ? t("template.picker.teamLoading")
                        : t("template.picker.teamEmpty")}
                    </div>
                  ) : (
                    <table className="w-full text-xs">
                      <tbody>
                        {filteredShared.map((entry) => {
                          const description = sharedDescription(entry);
                          return (
                            <tr
                              key={entry.id}
                              onClick={() => onSelectShared?.(entry)}
                              className="cursor-pointer hover:bg-muted/50 border-b border-border/50 transition-colors"
                            >
                              <td className="px-4 py-3 align-top">
                                <div className="font-medium text-foreground">
                                  {sharedTitle(entry, t)}
                                </div>
                                {description && (
                                  <div
                                    className="text-[11px] text-muted-foreground mt-0.5 truncate"
                                    title={description}
                                  >
                                    {description}
                                  </div>
                                )}
                              </td>
                              <td className="px-4 py-3 align-top whitespace-nowrap text-[11px] text-muted-foreground">
                                {entry.author?.name ?? ""}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  )}
                </section>
              )}
            </>
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
