// テンプレートの一覧画面（メイン領域に開く）。
//
// 設計判断:
// - 公式（組み込み）・自分・共有（共有フォルダ）の 3 種類を 1 つの表にまとめる。
//   ピッカーは「差し込む 1 件を選ぶ」道具、共有フォルダの画面は「共有物を見る」道具で、
//   テンプレートを持っている全体を見て整える場所が無かったため。
// - 元のノートは「テンプレートが覚えている」記録（sourceNote）から出す。ただし共有テンプレートの
//   元ノート id は共有した本人の手元の id なので、開けるのは作者本人だけ。他人のものは題名だけ見せる。
// - 使ったノートは、ノート索引の templateFrom（種類 + id）を数える。索引に載るのは
//   ゴミ箱・アーカイブ外のノートだけにして、消えたノートは数えない。
// - 状態（ノート・開く・新規作成・共有解除）は呼び出し側（note-app）が持ち、ここは
//   表示と確認ダイアログまでを受け持つ。確認は confirmAction（window.confirm は使わない）。

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowDown, ArrowUp, LayoutTemplate, MoreHorizontal, Upload } from "lucide-react";
import { Dropdown, type DropdownPosition } from "@ui/dropdown";
import { IconButton } from "@ui/icon-button";
import { MenuItem } from "@ui/menu-item";
import { Breadcrumb } from "../../components/Breadcrumb";
import { useT } from "../../i18n";
import type { GraphiumDocument } from "../../lib/document-types";
import {
  findSharedFolderByRoot,
  getSharedFolders,
  sharedFolderLabel,
  type SharedEntry,
} from "../../lib/storage/shared";
import { confirmAction } from "../../ui/confirm-dialog";
import { loadAuthorIdentity } from "../identity";
import { NoteListToolbar, type SortDirection } from "../navigation/NoteListToolbar";
import type { NoteIndexEntry } from "../navigation/index-file";
import { ShareTemplateDialog } from "../sharing/ShareTemplateDialog";
// 循環参照を避けるため、共有ライブラリは features/sharing のバレルでなくストアを直接指す
import {
  getSharedLibraryRoot,
  refreshSharedLibrary,
  useSharedLibrary,
} from "../sharing/shared-library-store";
import { getAllTemplates } from "./templates";
import { exportTemplateToFile, importTemplateFromFile } from "./template-file-io";
import {
  getUserTemplateEditHandler,
  userTemplateAttributes,
  userTemplateToEditDocument,
} from "./template-edit";
import {
  deleteUserTemplate,
  getUserTemplateProvider,
  renameUserTemplate,
  useUserTemplates,
  type UserTemplateRecord,
} from "./user-template-store";

/** 索引から使うのは「どのテンプレートから作ったか」と題名だけ */
export type TemplateListNote = Pick<NoteIndexEntry, "noteId" | "title" | "templateFrom">;

export type TemplateListViewProps = {
  /** ホームへ戻る */
  onBack: () => void;
  /** 生きているノート（ゴミ箱・アーカイブを除く）。使ったノートの数と、元のノートの在りかの判定に使う */
  notes: TemplateListNote[];
  /** ノートを開く */
  onOpenNote: (noteId: string) => void;
  /** 公式 / 自分 / 共有のテンプレートから新しいノートを作る（失敗の通知は呼び出し側） */
  onCreateFromOfficial: (templateId: string) => void | Promise<void>;
  onCreateFromUser: (id: string) => void | Promise<void>;
  onCreateFromShared: (sharedId: string) => void | Promise<void>;
  /** 共有解除（実際の書き込みは呼び出し側。確認はこの画面で済ませてある） */
  onUnshare: (entry: SharedEntry) => void | Promise<void>;
  /** 読み込んだファイルの素材を手元の素材として登録する（登録した素材の URL を返す） */
  onUploadMedia: (file: File) => Promise<string>;
  /** 自分の端末の作者メール。共有テンプレートが自分のものかの判定（省くと設定の作者情報） */
  currentEmail?: string | null;
};

type Kind = "official" | "user" | "shared";
type KindFilter = "all" | Kind;
type SortKey = "title" | "kind" | "usedCount" | "updatedAt";

/** 「元のノート」列の状態 */
type SourceInfo =
  | { state: "na" } // 公式（元のノートという考え方が無い）
  | { state: "none" } // 記録なし
  | { state: "link"; noteId: string; title: string } // 開ける
  | { state: "missing"; title: string } // 記録はあるが見つからない
  | { state: "titleOnly"; title: string }; // 他人の共有（id が通じないので題名だけ）

type Row = {
  key: string;
  kind: Kind;
  id: string;
  title: string;
  description: string;
  place: string;
  /** 並べ替え用。公式は日付を持たない */
  updatedAt: string;
  source: SourceInfo;
  usedNotes: TemplateListNote[];
  record?: UserTemplateRecord;
  entry?: SharedEntry;
  /** 共有テンプレートが自分のものか */
  mine: boolean;
};

const SORT_OPTIONS: { key: SortKey; labelKey: string }[] = [
  { key: "updatedAt", labelKey: "templateList.col.updated" },
  { key: "title", labelKey: "templateList.col.name" },
  { key: "usedCount", labelKey: "templateList.col.used" },
  { key: "kind", labelKey: "templateList.col.kind" },
];

const KIND_ORDER: Record<Kind, number> = { user: 0, shared: 1, official: 2 };

const FILTERS: { key: KindFilter; labelKey: string }[] = [
  { key: "all", labelKey: "templateList.filter.all" },
  { key: "user", labelKey: "template.source.user" },
  { key: "shared", labelKey: "templateList.kind.shared" },
  { key: "official", labelKey: "template.source.official" },
];

const KIND_LABEL_KEY: Record<Kind, string> = {
  official: "template.source.official",
  user: "template.source.user",
  shared: "templateList.kind.shared",
};

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (!iso || isNaN(d.getTime())) return "—";
  return d.toLocaleDateString(undefined, { year: "numeric", month: "2-digit", day: "2-digit" });
}

/** 共有エントリの extra から文字列を取り出す */
function extraString(entry: SharedEntry, key: string): string {
  const v = (entry.extra as Record<string, unknown> | undefined)?.[key];
  return typeof v === "string" ? v : "";
}

/** 共有エントリの extra.sourceNote（無い・形が違うときは null） */
function extraSourceNote(entry: SharedEntry): { id?: string; title: string } | null {
  const v = (entry.extra as Record<string, unknown> | undefined)?.sourceNote;
  if (!v || typeof v !== "object") return null;
  const { id, title } = v as { id?: unknown; title?: unknown };
  const hasId = typeof id === "string" && !!id;
  if (!hasId && (typeof title !== "string" || !title)) return null;
  return { ...(hasId ? { id } : {}), title: typeof title === "string" ? title : "" };
}

/** 記録された元のノートを、生きているノートの中から探して状態にする */
function resolveSource(
  sourceNote: { id?: string; title: string } | null | undefined,
  alive: Map<string, TemplateListNote>,
): SourceInfo {
  if (!sourceNote) return { state: "none" };
  // id が無いもの（ファイルから読み込んだ分）は、手元に開く先が無いので題名だけ
  if (!sourceNote.id) return { state: "titleOnly", title: sourceNote.title };
  const found = alive.get(sourceNote.id);
  // 題名は今のノートの題名を優先（改名に追従）。無ければ記録時の題名
  if (found) return { state: "link", noteId: found.noteId, title: found.title || sourceNote.title };
  return { state: "missing", title: sourceNote.title };
}

export function TemplateListView({
  onBack,
  notes,
  onOpenNote,
  onCreateFromOfficial,
  onCreateFromUser,
  onCreateFromShared,
  onUnshare,
  onUploadMedia,
  currentEmail,
}: TemplateListViewProps) {
  const t = useT();
  const sharedLibrary = useSharedLibrary();
  const userTemplates = useUserTemplates();
  const [searchQuery, setSearchQuery] = useState("");
  const [kindFilter, setKindFilter] = useState<KindFilter>("all");
  const [sortKey, setSortKey] = useState<SortKey>("updatedAt");
  const [sortDir, setSortDir] = useState<SortDirection>("desc");
  /** 使ったノートの一覧を開いている行 */
  const [expandedKey, setExpandedKey] = useState<string | null>(null);
  const [menu, setMenu] = useState<{ row: Row; pos: DropdownPosition } | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [shareTarget, setShareTarget] = useState<UserTemplateRecord | null>(null);
  const [busy, setBusy] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const userSupported = useMemo(() => getUserTemplateProvider() !== null, []);
  const sharedRoot = useMemo(() => getSharedLibraryRoot(), []);
  const email = currentEmail !== undefined ? currentEmail : (loadAuthorIdentity()?.email ?? null);

  // 開くたびに自分の分・共有の分を読み直す（別の端末やタブで増減した分を拾う）
  const { refresh: refreshUser } = userTemplates;
  useEffect(() => {
    if (userSupported) void refreshUser();
  }, [userSupported, refreshUser]);
  useEffect(() => {
    if (sharedRoot) void refreshSharedLibrary();
  }, [sharedRoot]);

  const rows = useMemo<Row[]>(() => {
    const alive = new Map(notes.map((n) => [n.noteId, n]));
    // 「種類:id」ごとに、そのテンプレートから作ったノート
    const usedBy = new Map<string, TemplateListNote[]>();
    for (const n of notes) {
      if (!n.templateFrom) continue;
      const k = `${n.templateFrom.kind}:${n.templateFrom.id}`;
      const list = usedBy.get(k);
      if (list) list.push(n);
      else usedBy.set(k, [n]);
    }

    const out: Row[] = [];
    for (const def of getAllTemplates().filter((d) => d.source === "official")) {
      out.push({
        key: `official:${def.id}`,
        kind: "official",
        id: def.id,
        title: t(def.titleKey),
        description: t(def.descKey),
        place: t("templateList.place.graphium"),
        updatedAt: "",
        source: { state: "na" },
        usedNotes: usedBy.get(`official:${def.id}`) ?? [],
        mine: false,
      });
    }
    if (userSupported) {
      for (const rec of userTemplates.items) {
        out.push({
          key: `user:${rec.id}`,
          kind: "user",
          id: rec.id,
          title: rec.title,
          description: rec.description ?? "",
          place: t("templateList.place.thisPc"),
          updatedAt: rec.updatedAt,
          source: resolveSource(rec.sourceNote, alive),
          usedNotes: usedBy.get(`user:${rec.id}`) ?? [],
          record: rec,
          mine: true,
        });
      }
    }
    for (const entry of sharedLibrary.entries) {
      if (entry.type !== "template") continue;
      const mine = !!email && entry.author?.email === email;
      const sourceNote = extraSourceNote(entry);
      const root = sharedLibrary.entryRoots[entry.id];
      const folder = findSharedFolderByRoot(root);
      out.push({
        key: `shared:${entry.id}`,
        kind: "shared",
        id: entry.id,
        title: extraString(entry, "title") || t("templateList.untitled"),
        description: extraString(entry, "description"),
        place: root ? sharedFolderLabel(folder ?? { name: "", root }) : "—",
        updatedAt: entry.updated_at,
        // 他人の共有は id が自分の手元に通じない。題名だけ見せる
        // 題名を一緒に共有しなかったもの（id だけ）は、他の人には「記録なし」
        source: !sourceNote
          ? { state: "none" }
          : mine
            ? resolveSource(sourceNote, alive)
            : sourceNote.title
              ? { state: "titleOnly", title: sourceNote.title }
              : { state: "none" },
        usedNotes: usedBy.get(`shared:${entry.id}`) ?? [],
        entry,
        mine,
      });
    }
    return out;
  }, [notes, t, userSupported, userTemplates.items, sharedLibrary.entries, sharedLibrary.entryRoots, email]);

  const filtered = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    let list = rows;
    if (kindFilter !== "all") list = list.filter((r) => r.kind === kindFilter);
    if (q) list = list.filter((r) => `${r.title} ${r.description}`.toLowerCase().includes(q));
    const dir = sortDir === "desc" ? -1 : 1;
    return [...list].sort((a, b) => {
      let cmp = 0;
      switch (sortKey) {
        case "title":
          cmp = a.title.localeCompare(b.title);
          break;
        case "kind":
          cmp = KIND_ORDER[a.kind] - KIND_ORDER[b.kind];
          break;
        case "usedCount":
          cmp = a.usedNotes.length - b.usedNotes.length;
          break;
        case "updatedAt":
          cmp = a.updatedAt.localeCompare(b.updatedAt);
          break;
      }
      return cmp * dir;
    });
  }, [rows, kindFilter, searchQuery, sortKey, sortDir]);

  const handleSort = useCallback(
    (key: SortKey) => {
      if (key === sortKey) {
        setSortDir((d) => (d === "desc" ? "asc" : "desc"));
      } else {
        setSortKey(key);
        // 名前と種類は昇順、数と日付は多い順・新しい順から
        setSortDir(key === "title" || key === "kind" ? "asc" : "desc");
      }
    },
    [sortKey],
  );

  const hasOwnOrShared = rows.some((r) => r.kind !== "official");

  const commitRename = async (id: string) => {
    const next = renameValue.trim();
    // 空のままでは確定しない（入力を残して、直すか Esc で戻すかを選べるようにする）
    if (!next) return;
    setRenamingId(null);
    await renameUserTemplate(id, next);
  };

  const handleDelete = async (row: Row) => {
    if (!row.record) return;
    if (!(await confirmAction(t("template.user.deleteConfirm", { title: row.title }), { destructive: true }))) return;
    await deleteUserTemplate(row.id);
  };

  const handleUnshare = async (row: Row) => {
    if (!row.entry) return;
    if (!(await confirmAction(t("library.unshareConfirm", { title: row.title }), { destructive: true }))) return;
    await onUnshare(row.entry);
  };

  // ファイルに書き出す（公式・自分・共有のどれでも）
  const handleExport = async (row: Row) => {
    const src = row.record
      ? ({ kind: "user", record: row.record } as const)
      : row.entry
        ? ({ kind: "shared", entry: row.entry } as const)
        : ({ kind: "official", def: getAllTemplates().find((d) => d.id === row.id)! } as const);
    if (src.kind === "official" && !src.def) return;
    setBusy(true);
    try {
      const out = await exportTemplateToFile(src);
      if (out.status === "tooLarge") {
        window.alert(t("templateList.export.tooLarge", { size: String(out.totalMb), limit: String(out.limitMb) }));
      } else if (out.status === "failed") {
        window.alert(t("templateList.export.failed", { error: out.error }));
      } else if (out.status === "saved" && out.missing > 0) {
        window.alert(t("templateList.export.mediaMissing", { count: String(out.missing) }));
      }
    } finally {
      setBusy(false);
    }
  };

  // ファイルから読み込む（自分のテンプレートとして保存）
  const handleImportFile = async (file: File) => {
    setBusy(true);
    try {
      const out = await importTemplateFromFile(file, { uploadMedia: onUploadMedia });
      if (out.status === "rejected") {
        window.alert(t("templateList.import.rejected", { reason: t(out.messageKey, { detail: out.detail ?? "" }) }));
      } else if (out.status === "failed") {
        window.alert(t("templateList.import.failed", { error: out.error }));
      } else {
        if (out.missing > 0) window.alert(t("templateList.import.mediaMissing", { count: String(out.missing) }));
        setKindFilter((k) => (k === "shared" || k === "official" ? "all" : k));
      }
    } finally {
      setBusy(false);
    }
  };

  const handleCreate = (row: Row) => {
    if (row.kind === "official") void onCreateFromOfficial(row.id);
    else if (row.kind === "user") void onCreateFromUser(row.id);
    else void onCreateFromShared(row.id);
  };

  const openMenu = (row: Row, button: HTMLElement) => {
    const rect = button.getBoundingClientRect();
    setMenu({ row, pos: { top: rect.bottom + 4, left: rect.right - 220, anchorRect: rect } });
  };

  // 共有ダイアログに渡す本文。自分のテンプレートの中身から組み立てる
  const resolveShareSource = useCallback(async () => {
    if (!shareTarget) return null;
    const doc: GraphiumDocument = userTemplateToEditDocument(shareTarget);
    const page = doc.pages[0];
    if (!page) return null;
    return { doc, page, attributes: userTemplateAttributes(shareTarget) };
  }, [shareTarget]);

  const noShareFolder = getSharedFolders().length === 0;
  const editHandler = getUserTemplateEditHandler();

  const sortMark = (key: SortKey) =>
    sortKey === key ? (
      sortDir === "desc" ? <ArrowDown size={11} className="inline ml-0.5" /> : <ArrowUp size={11} className="inline ml-0.5" />
    ) : null;

  const renderSource = (s: SourceInfo) => {
    switch (s.state) {
      case "na":
        return <span className="text-muted-foreground">—</span>;
      case "none":
        return <span className="text-muted-foreground">{t("templateList.source.none")}</span>;
      case "link":
        return (
          <button
            type="button"
            data-testid="template-source-link"
            data-tooltip={t("templateList.source.openTooltip")}
            onClick={(e) => {
              e.stopPropagation();
              onOpenNote(s.noteId);
            }}
            className="text-left text-primary hover:underline truncate max-w-full"
          >
            {s.title}
          </button>
        );
      case "missing":
        return (
          <span data-testid="template-source-missing" className="text-muted-foreground" title={s.title}>
            {t("templateList.source.missing")}
          </span>
        );
      case "titleOnly":
        return (
          <span data-testid="template-source-title" className="truncate" title={s.title}>
            {s.title}
          </span>
        );
    }
  };

  return (
    <div className="flex flex-col h-full" data-testid="template-list-view">
      {/* ヘッダー */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-border">
        <Breadcrumb
          items={[{ label: t("nav.home"), onClick: onBack }, { label: t("sidebar.templates") }]}
        />
        <div className="flex items-center gap-2">
          <LayoutTemplate size={16} className="text-primary" />
          <span className="text-xs text-muted-foreground">({filtered.length})</span>
        </div>
        <div className="flex-1" />
        {/* 共有フォルダを読めない相手から受け取ったファイルを、自分のテンプレートにする */}
        {userSupported && (
          <>
            <button
              type="button"
              data-testid="template-import"
              disabled={busy}
              onClick={() => fileInputRef.current?.click()}
              className="flex items-center gap-1 px-2.5 py-1 text-xs rounded border border-border bg-background hover:bg-muted transition-colors disabled:opacity-50"
            >
              <Upload size={12} />
              <span>{t("templateList.import")}</span>
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept=".graphium-template,.json,application/json"
              data-testid="template-import-input"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                e.target.value = "";
                if (f) void handleImportFile(f);
              }}
            />
          </>
        )}
      </div>

      <NoteListToolbar<SortKey>
        sortKey={sortKey}
        sortDir={sortDir}
        onSort={handleSort}
        sortOptions={SORT_OPTIONS}
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
      />

      {/* 種類の絞り込み */}
      <div
        className="flex items-center gap-1 px-6 py-2"
        role="group"
        aria-label={t("templateList.filter.label")}
      >
        {FILTERS.map((f) => (
          <button
            key={f.key}
            type="button"
            aria-pressed={kindFilter === f.key}
            onClick={() => setKindFilter(f.key)}
            className={`px-2.5 py-1 rounded-full text-xs transition-colors ${
              kindFilter === f.key
                ? "bg-primary/10 text-primary font-semibold"
                : "text-muted-foreground hover:text-foreground hover:bg-muted"
            }`}
          >
            {t(f.labelKey)}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-auto">
        {/* 自分・共有が 1 件も無いときの案内（公式は常にあるので表は残す） */}
        {!hasOwnOrShared && (
          <div
            data-testid="template-list-empty"
            className="mx-6 mb-3 rounded-md bg-muted/60 px-4 py-3 text-xs text-muted-foreground"
          >
            {t("templateList.empty")}
          </div>
        )}

        {filtered.length === 0 ? (
          <div className="text-center py-12 text-sm text-muted-foreground">{t("library.noMatch")}</div>
        ) : (
          <table className="w-full min-w-[860px] text-sm">
            <thead>
              <tr className="text-left text-xs font-semibold bg-secondary text-secondary-foreground border-b border-border">
                <th className="py-2 px-3 cursor-pointer hover:text-foreground" onClick={() => handleSort("title")}>
                  {t("templateList.col.name")}
                  {sortMark("title")}
                </th>
                <th className="py-2 px-3 w-[80px] cursor-pointer hover:text-foreground" onClick={() => handleSort("kind")}>
                  {t("templateList.col.kind")}
                  {sortMark("kind")}
                </th>
                <th className="py-2 px-3 w-[140px]">{t("templateList.col.place")}</th>
                <th className="py-2 px-3 w-[180px]">{t("templateList.col.source")}</th>
                <th className="py-2 px-3 w-[110px] cursor-pointer hover:text-foreground" onClick={() => handleSort("usedCount")}>
                  {t("templateList.col.used")}
                  {sortMark("usedCount")}
                </th>
                <th className="py-2 px-3 w-[110px] cursor-pointer hover:text-foreground" onClick={() => handleSort("updatedAt")}>
                  {t("templateList.col.updated")}
                  {sortMark("updatedAt")}
                </th>
                <th className="py-2 px-3 w-[44px]" />
              </tr>
            </thead>
            <tbody>
              {filtered.map((row) => {
                const renaming = renamingId === row.id && row.kind === "user";
                const expanded = expandedKey === row.key;
                return (
                  <TemplateRows
                    key={row.key}
                    expanded={expanded}
                    colSpan={7}
                    usedNotes={row.usedNotes}
                    onOpenNote={onOpenNote}
                    emptyText={t("templateList.used.none")}
                    headingText={t("templateList.used.heading")}
                  >
                    <tr
                      data-testid="template-row"
                      data-kind={row.kind}
                      className="border-b border-border/50 hover:bg-muted/50 transition-colors group"
                    >
                      <td className="py-2 px-3 align-top">
                        {renaming ? (
                          <input
                            autoFocus
                            type="text"
                            value={renameValue}
                            aria-label={t("template.user.renameLabel")}
                            onChange={(e) => setRenameValue(e.target.value)}
                            onKeyDown={(e) => {
                              e.stopPropagation();
                              if (e.key === "Enter") {
                                e.preventDefault();
                                void commitRename(row.id);
                              } else if (e.key === "Escape") {
                                e.preventDefault();
                                setRenamingId(null);
                              }
                            }}
                            onBlur={() => setRenamingId(null)}
                            className="w-full text-xs px-2 py-1 rounded border border-border bg-background text-foreground outline-none focus:border-primary"
                          />
                        ) : (
                          <div className="font-medium text-foreground truncate">{row.title}</div>
                        )}
                        {row.description && (
                          <div className="text-[11px] text-muted-foreground mt-0.5 truncate" title={row.description}>
                            {row.description}
                          </div>
                        )}
                      </td>
                      <td className="py-2 px-3 align-top text-xs text-muted-foreground">
                        {t(KIND_LABEL_KEY[row.kind])}
                      </td>
                      <td className="py-2 px-3 align-top text-xs text-muted-foreground truncate" title={row.place}>
                        {row.place}
                      </td>
                      <td className="py-2 px-3 align-top text-xs max-w-[180px]">
                        <div className="flex min-w-0">{renderSource(row.source)}</div>
                      </td>
                      <td className="py-2 px-3 align-top text-xs">
                        <button
                          type="button"
                          data-testid="template-used-toggle"
                          aria-expanded={expanded}
                          data-tooltip={t("templateList.used.toggle")}
                          onClick={() => setExpandedKey(expanded ? null : row.key)}
                          className={`tabular-nums rounded px-1.5 py-0.5 hover:bg-muted ${
                            row.usedNotes.length > 0 ? "text-foreground" : "text-muted-foreground"
                          }`}
                        >
                          {t("templateList.used.count", { count: String(row.usedNotes.length) })}
                        </button>
                      </td>
                      <td className="py-2 px-3 align-top text-xs text-muted-foreground tabular-nums">
                        {formatDate(row.updatedAt)}
                      </td>
                      <td className="py-1.5 px-2 align-top">
                        <IconButton
                          size="sm"
                          aria-label={t("templateList.menu", { name: row.title })}
                          data-testid="template-row-menu"
                          onClick={(e) => openMenu(row, e.currentTarget)}
                        >
                          <MoreHorizontal />
                        </IconButton>
                      </td>
                    </tr>
                  </TemplateRows>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* 行の ⋯ メニュー */}
      {menu && (
        <Dropdown position={menu.pos} onClose={() => setMenu(null)} minWidth={220}>
          <MenuItem
            onClick={() => {
              const row = menu.row;
              setMenu(null);
              handleCreate(row);
            }}
          >
            {t("templateList.menu.newNote")}
          </MenuItem>
          {menu.row.source.state === "link" && (
            <MenuItem
              onClick={() => {
                const s = menu.row.source;
                setMenu(null);
                if (s.state === "link") onOpenNote(s.noteId);
              }}
            >
              {t("templateList.menu.openSource")}
            </MenuItem>
          )}
          <MenuItem
            onClick={() => {
              const key = menu.row.key;
              setMenu(null);
              setExpandedKey(key);
            }}
          >
            {t("templateList.menu.showUsed")}
          </MenuItem>
          <MenuItem
            disabled={busy}
            onClick={() => {
              const row = menu.row;
              setMenu(null);
              void handleExport(row);
            }}
          >
            {t("templateList.menu.export")}
          </MenuItem>
          {menu.row.kind === "user" && menu.row.record && (
            <>
              {editHandler && (
                <MenuItem
                  onClick={() => {
                    const id = menu.row.id;
                    setMenu(null);
                    editHandler(id);
                  }}
                >
                  {t("template.user.edit")}
                </MenuItem>
              )}
              <MenuItem
                onClick={() => {
                  const row = menu.row;
                  setMenu(null);
                  setRenameValue(row.title);
                  setRenamingId(row.id);
                }}
              >
                {t("template.user.rename")}
              </MenuItem>
              {/* 無効な理由は、押せない項目の上で分かるよう外側の要素に付ける */}
              <div data-tooltip={noShareFolder ? t("templateList.menu.shareDisabled") : undefined}>
                <MenuItem
                  disabled={noShareFolder}
                  className="disabled:opacity-50 disabled:cursor-not-allowed"
                  onClick={() => {
                    const rec = menu.row.record!;
                    setMenu(null);
                    setShareTarget(rec);
                  }}
                >
                  {t("templateList.menu.share")}
                </MenuItem>
              </div>
              <MenuItem
                className="text-red-600"
                onClick={() => {
                  const row = menu.row;
                  setMenu(null);
                  void handleDelete(row);
                }}
              >
                {t("template.user.delete")}
              </MenuItem>
            </>
          )}
          {menu.row.kind === "shared" && menu.row.mine && menu.row.entry && (
            <MenuItem
              className="text-red-600"
              onClick={() => {
                const row = menu.row;
                setMenu(null);
                void handleUnshare(row);
              }}
            >
              {t("library.unshare")}
            </MenuItem>
          )}
        </Dropdown>
      )}

      {/* 自分のテンプレートを共有する（共有先の選択欄はダイアログが出す） */}
      <ShareTemplateDialog
        open={!!shareTarget}
        defaultTitle={shareTarget?.title ?? ""}
        sourceNote={shareTarget?.sourceNote}
        resolveSource={resolveShareSource}
        onClose={() => setShareTarget(null)}
        onShared={() => window.alert(t("share.template.success"))}
      />
    </div>
  );
}

/** 1 行 + 開いたときの「使ったノート」の行。tbody 直下に並べるための Fragment */
function TemplateRows({
  expanded,
  colSpan,
  usedNotes,
  onOpenNote,
  emptyText,
  headingText,
  children,
}: {
  expanded: boolean;
  colSpan: number;
  usedNotes: TemplateListNote[];
  onOpenNote: (noteId: string) => void;
  emptyText: string;
  headingText: string;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLTableRowElement>(null);
  return (
    <>
      {children}
      {expanded && (
        <tr ref={ref} data-testid="template-used-panel" className="border-b border-border/50">
          <td colSpan={colSpan} className="px-3 pb-3 pt-0">
            <div className="rounded-md bg-muted/60 px-3 py-2">
              {usedNotes.length === 0 ? (
                <p className="text-xs text-muted-foreground">{emptyText}</p>
              ) : (
                <>
                  <p className="text-[11px] text-muted-foreground mb-1">{headingText}</p>
                  <ul className="space-y-0.5">
                    {usedNotes.map((n) => (
                      <li key={n.noteId}>
                        <button
                          type="button"
                          data-testid="template-used-note"
                          onClick={() => onOpenNote(n.noteId)}
                          className="text-xs text-primary hover:underline text-left"
                        >
                          {n.title || n.noteId}
                        </button>
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </div>
          </td>
        </tr>
      )}
    </>
  );
}
