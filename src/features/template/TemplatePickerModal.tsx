// テンプレートピッカーモーダル
// /template スラッシュコマンドから呼び出し、テンプレートをテーブル表示で選択する
//
// 表は 1 つ。公式テンプレート（getAllTemplates() の TemplateDef）の後ろに、
// 自分のテンプレート（user-template-store の appData）、その後ろに
// チームのテンプレート（共有ライブラリの type=template = SharedEntry）を行として並べる。
// 別セクションに分けないのは、選ぶ人にとってはどちらも「使えるテンプレート」で、
// 枠組みが違うと同じ土俵で比べられなくなるため（見え方は「提供元」列で区別する）。
// 一方、選んだあとの経路は違う: 公式は id をその場で組み立て、チームは共有ルートから
// 本文を読み出す。本文の読み出し・hash 照合・shared-blob: の解決は呼び出し側
// （useTemplatePicker → insert.ts の loadSharedTemplate）が担うので、コールバックを
// onSelect / onSelectShared に分けてある。

import { DIALOG_LAYER } from "@/ui/z-layers";
import { useEffect, useMemo, useRef, useState } from "react";
import { Pencil, Trash2 } from "lucide-react";
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
import {
  deleteUserTemplate,
  getUserTemplateProvider,
  renameUserTemplate,
  useUserTemplates,
  type UserTemplateRecord,
} from "./user-template-store";

type Props = {
  onSelect: (templateId: string) => void;
  /**
   * 自分のテンプレートを選んだとき。本文の読み出しと挿入は呼び出し側の責務。
   * 公式・チームと同じく、行を選ぶと「いまのノートへ差し込み」。
   */
  onSelectUser?: (id: string) => void;
  /**
   * チームのテンプレートを選んだとき。本文の読み出しと挿入は呼び出し側の責務。
   * 未指定でも行は出す（共有ルートがあるのに消えると「無い」と誤解されるため）。
   */
  onSelectShared?: (entry: SharedEntry) => void;
  onClose: () => void;
};

/** 表の列数。チーム行の空状態を colspan で 1 行に潰すのに使う */
const COLUMN_COUNT = 3;

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

export function TemplatePickerModal({ onSelect, onSelectUser, onSelectShared, onClose }: Props) {
  const t = useT();
  const [searchQuery, setSearchQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const sharedLibrary = useSharedLibrary();
  const userTemplates = useUserTemplates();
  // 改名中の行（id）と入力中の題名。同時に直せるのは 1 行だけ
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");

  // 保存先が個人テンプレートに対応していないときは、自分の行そのものを出さない。
  // 0 件の案内も出さない（入口はノートの ⋯ メニューにあり、ここで教える必要が無い）
  const userSupported = useMemo(() => getUserTemplateProvider() !== null, []);

  // 共有ルート（デスクトップ + 設定済みのときだけ非 null）。
  // このモーダルは開くたびにマウントされるので、マウント時に固定して構わない。
  const sharedRoot = useMemo(() => getSharedLibraryRoot(), []);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // 開いた時点で共有ルートを 1 回読み直す。Library タブを一度も開いていなくても
  // チーム行が空にならないようにするため（ストア側で進行中の読みは共有される）。
  useEffect(() => {
    if (!sharedRoot) return;
    void refreshSharedLibrary();
  }, [sharedRoot]);

  // 開くたびに自分のテンプレートも読み直す（別の端末・タブで保存した分を拾う）
  const { refresh: refreshUser } = userTemplates;
  useEffect(() => {
    if (!userSupported) return;
    void refreshUser();
  }, [userSupported, refreshUser]);

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        // 改名中の Esc は改名の取り消しだけ（モーダルまで閉じない）
        if (renamingId) return;
        onClose();
      }
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [onClose, renamingId]);

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

  // 検索は題名・説明に効かせる
  const filteredUser = useMemo(() => {
    if (!userSupported) return [];
    const q = searchQuery.trim().toLowerCase();
    if (!q) return userTemplates.items;
    return userTemplates.items.filter((rec) =>
      `${rec.title} ${rec.description ?? ""}`.toLowerCase().includes(q),
    );
  }, [userSupported, userTemplates.items, searchQuery]);

  const commitRename = async (id: string) => {
    const next = renameValue.trim();
    // 空のままでは確定しない（入力を残して、直すか Esc で戻すかを選べるようにする）
    if (!next) return;
    setRenamingId(null);
    await renameUserTemplate(id, next);
  };

  const handleDelete = async (rec: UserTemplateRecord) => {
    if (!window.confirm(t("template.user.deleteConfirm", { title: rec.title }))) return;
    await deleteUserTemplate(rec.id);
  };

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

  // 件数は画面に出ている行数と合わせる（公式だけ数えるとチーム行の分だけ嘘になる）
  const visibleCount = filtered.length + filteredUser.length + filteredShared.length;

  // 共有ルートが無ければチームの存在自体を見せない。あるなら 0 件でも
  // 「まだ無い」と分かる 1 行を出す（読み込み中は読み込み中と言う）。
  const teamPlaceholder =
    sharedRoot && filteredShared.length === 0
      ? sharedLibrary.loading
        ? t("template.picker.teamLoading")
        : t("template.picker.teamEmpty")
      : null;

  // 公式もチームも 1 行も出せないなら、表の骨だけ見せても意味がないので空表示にする
  const hasAnyRow =
    filtered.length > 0 ||
    filteredUser.length > 0 ||
    filteredShared.length > 0 ||
    teamPlaceholder !== null;

  return (
    <div
      className={`fixed inset-0 ${DIALOG_LAYER} flex items-center justify-center bg-black/40`}
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
            data-tooltip={t("common.close")}
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

        {/* テーブル（公式とチームを 1 つの表にまとめる） */}
        <div className="flex-1 overflow-auto">
          {!hasAnyRow ? (
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
                    data-testid="official-template-row"
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

                {/* 自分のテンプレートは公式の後ろ・チームの前。行を選ぶと差し込み（公式・チームと同じ）。
                    右端の操作はホバー / focus-within でだけ見せ、クリックは行の選択に伝えない */}
                {filteredUser.map((rec) => {
                  const renaming = renamingId === rec.id;
                  return (
                    <tr
                      key={rec.id}
                      data-testid="user-template-row"
                      onClick={() => {
                        if (!renaming) onSelectUser?.(rec.id);
                      }}
                      className="group cursor-pointer hover:bg-muted/50 focus-within:bg-muted/50 border-b border-border/50 transition-colors"
                    >
                      <td className="px-4 py-3 align-top">
                        <div className="flex items-start gap-2">
                          <div className="min-w-0 flex-1">
                            {renaming ? (
                              <input
                                autoFocus
                                type="text"
                                value={renameValue}
                                aria-label={t("template.user.renameLabel")}
                                onClick={(e) => e.stopPropagation()}
                                onChange={(e) => setRenameValue(e.target.value)}
                                onKeyDown={(e) => {
                                  e.stopPropagation();
                                  if (e.key === "Enter") {
                                    e.preventDefault();
                                    void commitRename(rec.id);
                                  } else if (e.key === "Escape") {
                                    e.preventDefault();
                                    setRenamingId(null);
                                  }
                                }}
                                onBlur={() => setRenamingId(null)}
                                className="w-full text-xs px-2 py-1 rounded border border-border bg-background text-foreground outline-none focus:border-primary"
                              />
                            ) : (
                              <div className="font-medium text-foreground">{rec.title}</div>
                            )}
                            {rec.description && (
                              <div
                                className="text-[11px] text-muted-foreground mt-0.5 truncate"
                                title={rec.description}
                              >
                                {rec.description}
                              </div>
                            )}
                          </div>
                          {!renaming && (
                            <div className="flex shrink-0 items-center gap-0.5 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity">
                              <button
                                type="button"
                                aria-label={t("template.user.rename")}
                                data-tooltip={t("template.user.rename")}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setRenameValue(rec.title);
                                  setRenamingId(rec.id);
                                }}
                                className="p-1 rounded text-muted-foreground hover:text-foreground hover:bg-muted"
                              >
                                <Pencil size={12} />
                              </button>
                              <button
                                type="button"
                                aria-label={t("template.user.delete")}
                                data-tooltip={t("template.user.delete")}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  void handleDelete(rec);
                                }}
                                className="p-1 rounded text-muted-foreground hover:text-foreground hover:bg-muted"
                              >
                                <Trash2 size={12} />
                              </button>
                            </div>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-3 align-top whitespace-nowrap">
                        <SourceBadge source="user" t={t} />
                      </td>
                      <td className="px-4 py-3 align-top" />
                    </tr>
                  );
                })}

                {/* チームのテンプレートは公式の後ろに続ける。列の意味は公式と同じで、
                    タグは共有側に無いので空セルのまま（列をずらさない） */}
                {filteredShared.map((entry) => {
                  const description = sharedDescription(entry);
                  const authorName = entry.author?.name ?? "";
                  return (
                    <tr
                      key={entry.id}
                      data-testid="team-template-row"
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
                      <td className="px-4 py-3 align-top whitespace-nowrap">
                        <span className="inline-flex items-center gap-1.5">
                          <SourceBadge source="team" t={t} />
                          {authorName && (
                            <span className="text-[10px] text-muted-foreground">
                              {authorName}
                            </span>
                          )}
                        </span>
                      </td>
                      <td className="px-4 py-3 align-top" />
                    </tr>
                  );
                })}

                {teamPlaceholder && (
                  <tr data-testid="team-template-placeholder">
                    <td
                      colSpan={COLUMN_COUNT}
                      className="px-4 py-3 text-[11px] text-muted-foreground border-b border-border/50"
                    >
                      {teamPlaceholder}
                    </td>
                  </tr>
                )}
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
  source: "official" | "user" | "team";
  t: (key: string) => string;
}) {
  // 公式だけ強調色。ユーザー / チームは同じ弱い色にして、公式との差だけを目立たせる
  const label =
    source === "official"
      ? t("template.source.official")
      : source === "team"
        ? t("template.modal.sourceTeam")
        : t("template.source.user");
  return (
    <span
      className={
        "inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium border " +
        (source === "official"
          ? "bg-primary/10 text-primary border-primary/30"
          : "bg-muted text-muted-foreground border-border")
      }
    >
      {label}
    </span>
  );
}
