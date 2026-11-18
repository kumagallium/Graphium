// 「AI との会話」の区画: 取り込む作業フォルダを選ぶ一覧。
//
// 規則の 1 文 → 見出し行（すべて選ぶ）→ 一覧 → 選んだものの 1 行、の順に並ぶ。
// 読み込み中は IntakeReceptacle の「中身を確認しています…」と同じ出し方にする。

import { useEffect, useRef } from "react";
import { Loader2 } from "lucide-react";
import { useT } from "@/i18n";
import { formatDate } from "@/lib/format-datetime";
import { workdirName, type WorkdirSummary } from "@/lib/conversation/render";

type ConversationWorkdirListProps = {
  status: "loading" | "ready";
  items: WorkdirSummary[];
  /** 選んでいる作業フォルダ（workdir の文字列） */
  selected: ReadonlySet<string>;
  onToggle: (workdir: string) => void;
  onToggleAll: (next: boolean) => void;
  /** 読み込み中に出す補足（無くてよい） */
  scannedLabel?: string;
  /** 記録が 1 件も無いときに「探した場所」として出すパス */
  searchedPath?: string;
};

/** 取り込む会話の本数（本人の発言が無い会話は入れない） */
function attendedSessions(item: WorkdirSummary): number {
  return Math.max(0, item.sessions - item.unattendedSessions);
}

export function ConversationWorkdirList({
  status,
  items,
  selected,
  onToggle,
  onToggleAll,
  scannedLabel,
  searchedPath = "~/.claude/projects",
}: ConversationWorkdirListProps) {
  const t = useT();
  const allRef = useRef<HTMLInputElement>(null);

  // 「すべて選ぶ」の対象は、取り込む会話がある行だけ
  const selectable = items.filter((i) => attendedSessions(i) > 0);
  const selectedItems = selectable.filter((i) => selected.has(i.workdir));
  const allChecked = selectable.length > 0 && selectedItems.length === selectable.length;
  const someChecked = selectedItems.length > 0 && !allChecked;
  const selectedSessions = selectedItems.reduce((sum, i) => sum + attendedSessions(i), 0);

  // indeterminate は属性でなくプロパティでしか立てられない
  useEffect(() => {
    if (allRef.current) allRef.current.indeterminate = someChecked;
  }, [someChecked]);

  const period = (item: WorkdirSummary): string => {
    const from = item.startedAt ? formatDate(item.startedAt) : "";
    const to = item.endedAt ? formatDate(item.endedAt) : "";
    if (!from && !to) return "—";
    if (!from || !to || from === to) return from || to;
    return t("intake.conversation.period", { from, to });
  };

  return (
    <div className="flex flex-col gap-3">
      {/* 文ごとに改行する（語の途中で折り返さないよう、文言の側に改行を入れている） */}
      <p className="text-sm text-foreground whitespace-pre-line">{t("intake.conversation.rule")}</p>

      {status === "loading" ? (
        <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-border px-6 py-8 text-center">
          <div className="h-12 w-12 rounded-full bg-secondary text-primary flex items-center justify-center">
            <Loader2 size={24} className="animate-spin" />
          </div>
          <p className="text-sm font-medium text-foreground">{t("intake.conversation.loading")}</p>
          <p className="text-xs text-muted-foreground">{t("intake.conversation.loadingHint")}</p>
          {scannedLabel && <p className="text-xs text-muted-foreground">{scannedLabel}</p>}
        </div>
      ) : items.length === 0 ? (
        <div className="flex flex-col items-center gap-1 rounded-lg border border-border px-6 py-8 text-center">
          <p className="text-sm text-foreground">{t("intake.conversation.empty")}</p>
          <p className="text-xs text-muted-foreground">
            {t("intake.conversation.emptyWhere", { path: searchedPath })}
          </p>
        </div>
      ) : (
        <>
          {/* 下の一覧の行とチェックボックス・文字の左端を揃える（一覧の枠線 1px + 行の px-3 = 13px、間隔も gap-3） */}
          <label className="flex items-center gap-3 pl-[13px] text-sm text-foreground cursor-pointer w-fit">
            <input
              ref={allRef}
              type="checkbox"
              checked={allChecked}
              disabled={selectable.length === 0}
              onChange={() => onToggleAll(!allChecked)}
            />
            <span>{t("intake.conversation.selectAll")}</span>
            <span className="text-muted-foreground">
              {t("intake.conversation.folderCount", { count: String(items.length) })}
            </span>
          </label>

          <div className="max-h-[360px] overflow-y-auto rounded-lg border border-border divide-y divide-border">
            {items.map((item) => {
              const count = attendedSessions(item);
              const none = count === 0;
              return (
                <label
                  key={item.workdir}
                  className={`flex items-start gap-3 px-3 py-2.5 ${
                    none ? "opacity-60" : "cursor-pointer hover:bg-muted"
                  }`}
                >
                  <input
                    type="checkbox"
                    className="mt-1 shrink-0"
                    checked={!none && selected.has(item.workdir)}
                    disabled={none}
                    onChange={() => onToggle(item.workdir)}
                  />
                  <span className="min-w-0 flex-1 flex flex-col gap-0.5">
                    {/* 名前とパスは 1 段に並べる（行を低くして、一度に見えるフォルダを増やす）。
                        同じ名前のフォルダは、後ろのパスで見分ける */}
                    <span className="flex items-baseline gap-2 min-w-0">
                      <span className="text-sm font-medium text-foreground shrink-0 max-w-[60%] truncate">
                        {workdirName(item.workdir)}
                      </span>
                      <span className="text-xs text-muted-foreground truncate" title={item.workdir}>
                        {item.workdir}
                      </span>
                    </span>
                    {none ? (
                      <span className="text-xs text-muted-foreground">{t("intake.conversation.rowNone")}</span>
                    ) : (
                      // 本数・発言の量・期間は、それぞれの途中では折り返さない（日付が 2 行に割れると読みにくい）。
                      // 区切りの点は置かず、間隔で分ける（折り返したときに行末や行頭に点だけが残らない）
                      <span className="flex flex-wrap gap-x-3 text-xs text-muted-foreground">
                        <span className="whitespace-nowrap">
                          {t("intake.conversation.rowSessions", { sessions: String(count) })}
                        </span>
                        <span className="whitespace-nowrap">
                          {t("intake.conversation.rowOwnChars", { chars: item.ownChars.toLocaleString("en-US") })}
                        </span>
                        <span className="whitespace-nowrap">{period(item)}</span>
                      </span>
                    )}
                    {item.unattendedSessions > 0 && !none && (
                      <span className="text-xs text-muted-foreground">
                        {t("intake.conversation.rowUnattended", { count: String(item.unattendedSessions) })}
                      </span>
                    )}
                  </span>
                </label>
              );
            })}
          </div>

          <p className="text-xs text-muted-foreground" aria-live="polite">
            {selectedItems.length > 0
              ? t("intake.conversation.selectedSummary", {
                  folders: String(selectedItems.length),
                  sessions: String(selectedSessions),
                })
              : t("intake.conversation.selectedNone")}
          </p>
        </>
      )}
    </div>
  );
}
