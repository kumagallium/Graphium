// 手入れ画面の「もの単位にまとめる」の節。
// 同じものについてのページが性質ごとに分かれている組（planThingGroups の結果）を並べ、
// 押したときだけまとめる（押すまで何も変わらない）。折りたたみ・行・ボタン・チェックボックスの
// 作りは WikiLintView の既存の節（手動で点検する / 推奨どおりまとめて統合）をそのまま使う。

import { useMemo, useState } from "react";
import { ChevronDown, GitMerge, Loader2 } from "lucide-react";
import { useT } from "../../i18n";
import { confirmAction } from "../../ui/confirm-dialog";
import type { ThingGroup } from "./thing-groups";

/** 1 組の実行結果 */
export type ThingGroupResult = { keepId: string; ok: boolean };

/** 実行中の進み具合を知らせるための呼び出し口（行ごとの進行表示に使う） */
export type ThingGroupProgressHooks = {
  onGroupStart?: (keepId: string) => void;
  onGroupDone?: (keepId: string, ok: boolean) => void;
};

export type ThingGroupsSectionProps = {
  groups: ThingGroup[];
  /** 無いときは、ボタンを無効にする（まとめるのに AI は使わない） */
  onMerge?: (groups: ThingGroup[], hooks?: ThingGroupProgressHooks) => Promise<ThingGroupResult[]> | ThingGroupResult[];
  /** ストーリー用: 最初から開いておく */
  defaultOpen?: boolean;
  /** ストーリー用: 最初から選んでおく組（keepId） */
  defaultSelected?: string[];
  /** ストーリー用: 実行中の見た目を固定する（keepId） */
  previewRunningId?: string;
  /** ストーリー用: 失敗の印を出しておく組（keepId） */
  previewFailedIds?: string[];
};

/** メンバーをそのまま全部見せる上限。超えたら先頭 3 件だけ見せて「ほか N 件」にする */
const MAX_SHOWN_MEMBERS = 4;
const SHOWN_WHEN_TRUNCATED = 3;

/** 題が「X の」で始まるものは「〜の…」に縮める（X は組の題。表記ゆれがあるときは縮めずそのまま） */
function shortenMemberTitle(title: string, thing: string): string {
  const nfkc = title.normalize("NFKC");
  const x = thing.normalize("NFKC");
  const m = /^(.+?)\s*の\s*(.+)$/.exec(nfkc);
  if (m && m[1].trim() === x) return `〜の${m[2]}`;
  return title;
}

export function ThingGroupsSection({
  groups,
  onMerge,
  defaultOpen = false,
  defaultSelected,
  previewRunningId,
  previewFailedIds,
}: ThingGroupsSectionProps) {
  const t = useT();
  const [open, setOpen] = useState(defaultOpen);
  const [selected, setSelected] = useState<Set<string>>(new Set(defaultSelected ?? []));
  const [running, setRunning] = useState(false);
  const [currentId, setCurrentId] = useState<string | null>(previewRunningId ?? null);
  const [doneIds, setDoneIds] = useState<Set<string>>(new Set());
  const [failedIds, setFailedIds] = useState<Set<string>>(new Set(previewFailedIds ?? []));
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(
    previewRunningId ? { done: 0, total: 1 } : null,
  );

  const visible = useMemo(() => groups.filter((g) => !doneIds.has(g.keepId)), [groups, doneIds]);
  if (visible.length === 0) return null;

  const busy = running || previewRunningId !== undefined;
  const disabledNoHandler = !onMerge;
  const selectedGroups = visible.filter((g) => selected.has(g.keepId));

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  // 確認（アプリ内）→ 実行。1 組の失敗で止めない。成功した組は一覧から消え、失敗した組は印を出して残す
  const run = async (target: ThingGroup[]) => {
    if (!onMerge || target.length === 0 || busy) return;
    const pages = target.reduce((sum, g) => sum + g.memberTitles.length, 0);
    const ok = await confirmAction(
      t("thingGroups.confirm", {
        groups: String(target.length),
        pages: String(pages),
      }),
    );
    if (!ok) return;
    setRunning(true);
    setFailedIds((prev) => {
      const next = new Set(prev);
      for (const g of target) next.delete(g.keepId);
      return next;
    });
    setProgress({ done: 0, total: target.length });
    let finished = 0;
    try {
      const results = await onMerge(target, {
        onGroupStart: (id) => setCurrentId(id),
        onGroupDone: () => {
          finished += 1;
          setProgress({ done: finished, total: target.length });
        },
      });
      const succeeded = results.filter((r) => r.ok).map((r) => r.keepId);
      const failed = results.filter((r) => !r.ok).map((r) => r.keepId);
      setDoneIds((prev) => new Set([...prev, ...succeeded]));
      setFailedIds((prev) => new Set([...prev, ...failed]));
      setSelected((prev) => {
        const next = new Set(prev);
        for (const id of succeeded) next.delete(id);
        return next;
      });
    } catch (err) {
      // 実行そのものが落ちたときは、対象をすべて失敗の印つきで残す（理由は実行側のトーストが出している）
      console.error("Group by thing failed:", err);
      setFailedIds((prev) => new Set([...prev, ...target.map((g) => g.keepId)]));
    } finally {
      setRunning(false);
      setCurrentId(null);
      setProgress(null);
    }
  };

  const buttonClass =
    "inline-flex items-center gap-1 rounded px-2 py-1 text-xs border border-primary/50 text-primary hover:bg-primary/10 transition-colors disabled:opacity-50";

  return (
    <>
      <div className="px-4 pt-3 pb-1">
        <button
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
        >
          <ChevronDown size={13} className={`transition-transform ${open ? "" : "-rotate-90"}`} />
          {t("thingGroups.header", { count: String(visible.length) })}
        </button>
        {open && (
          <p className="text-xs text-muted-foreground mt-1 ml-4 leading-relaxed">{t("thingGroups.hint")}</p>
        )}
      </div>
      {open && (
        <div>
          <div className="divide-y divide-border">
            {visible.map((g) => {
              const shown = (g.memberTitles.length > MAX_SHOWN_MEMBERS ? g.memberTitles.slice(0, SHOWN_WHEN_TRUNCATED) : g.memberTitles).map((m) => shortenMemberTitle(m, g.thing));
              const rest = g.memberTitles.length - shown.length;
              const isCurrent = currentId === g.keepId;
              const failed = failedIds.has(g.keepId);
              const rowTitle = t("thingGroups.rowTitle", { thing: g.thing, count: String(g.memberTitles.length) });
              return (
                <div key={g.keepId} className={`px-4 py-3 ${selected.has(g.keepId) ? "bg-primary/5" : ""}`}>
                  <div className="flex items-start gap-2">
                    <input
                      type="checkbox"
                      checked={selected.has(g.keepId)}
                      onChange={() => toggle(g.keepId)}
                      disabled={busy || disabledNoHandler}
                      aria-label={t("thingGroups.select", { thing: g.thing })}
                      className="mt-1 shrink-0"
                    />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className="text-sm text-foreground">{rowTitle}</span>
                        {g.retitle && (
                          <span
                            data-tooltip={t("thingGroups.retitleHint", { thing: g.thing })}
                            className="inline-flex items-center rounded px-1.5 py-0.5 text-xs border border-border bg-muted text-muted-foreground"
                          >
                            {t("thingGroups.retitleBadge")}
                          </span>
                        )}
                        {failed && <span className="text-xs text-destructive">{t("thingGroups.failed")}</span>}
                      </div>
                      <p className="text-xs text-muted-foreground mt-1">
                        {shown.join(" ・ ")}
                        {rest > 0 && ` ${t("thingGroups.memberRest", { count: String(rest) })}`}
                      </p>
                    </div>
                    <button
                      onClick={() => void run([g])}
                      disabled={busy || disabledNoHandler}
                      aria-label={t("thingGroups.buttonAria", { thing: g.thing, count: String(g.memberTitles.length) })}
                      className={buttonClass}
                    >
                      {isCurrent ? <Loader2 size={12} className="animate-spin" /> : <GitMerge size={12} />}
                      {isCurrent ? t("thingGroups.running") : t("thingGroups.button")}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
          <div className="px-4 py-3 flex items-center gap-2 flex-wrap">
            <button
              onClick={() => void run(selectedGroups)}
              disabled={busy || disabledNoHandler || selectedGroups.length === 0}
              aria-label={t("thingGroups.bulkButton", { count: String(selectedGroups.length) })}
              className={buttonClass}
            >
              {busy && progress ? (
                <>
                  <Loader2 size={12} className="animate-spin" />
                  {t("thingGroups.bulkProgress", { done: String(progress.done), total: String(progress.total) })}
                </>
              ) : (
                <>
                  <GitMerge size={12} />
                  {t("thingGroups.bulkButton", { count: String(selectedGroups.length) })}
                </>
              )}
            </button>
          </div>
        </div>
      )}
    </>
  );
}
