// 録音中の固定バー。● 経過時間・相手 / 自分のレベル・停止ボタン。
// 既存トースト群と同じ右下ピルの流儀（rounded・shadow-lg・popover 背景）。

import { Square } from "lucide-react";
import { useT } from "../../i18n";

export function formatElapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return [h, m, s].map((n) => String(n).padStart(2, "0")).join(":");
}

function LevelMeter({ label, level }: { label: string; level: number }) {
  // RMS は小さい値に偏るので見た目だけ平方根で持ち上げる
  const pct = Math.round(Math.min(1, Math.max(0, Math.sqrt(level))) * 100);
  return (
    <span className="flex items-center gap-1.5">
      <span className="text-muted-foreground">{label}</span>
      <span className="h-1.5 w-14 overflow-hidden rounded-full bg-muted" role="meter" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
        <span className="block h-full rounded-full bg-primary transition-[width] duration-300" style={{ width: `${pct}%` }} />
      </span>
    </span>
  );
}

export function MeetingRecorderBar({
  elapsedMs,
  level,
  stopping = false,
  warning = null,
  onStop,
}: {
  elapsedMs: number;
  level: { system: number; mic: number };
  stopping?: boolean;
  /** 録音中に起きたエラーの 1 行注意 */
  warning?: string | null;
  onStop: () => void;
}) {
  const t = useT();
  return (
    <div
      className="fixed bottom-4 left-1/2 z-[9999] flex -translate-x-1/2 items-center gap-4 rounded-xl border border-border bg-popover px-4 py-2 text-xs shadow-lg"
      role="status"
    >
      <span className="flex items-center gap-1.5 font-semibold text-foreground">
        <span className="h-2 w-2 animate-pulse rounded-full bg-red-500" />
        {t("meeting.recording")}
        <span className="tabular-nums">{formatElapsed(elapsedMs)}</span>
      </span>
      <LevelMeter label={t("meeting.trackOther")} level={level.system} />
      <LevelMeter label={t("meeting.trackSelf")} level={level.mic} />
      {warning && (
        <span className="max-w-[260px] truncate text-muted-foreground" title={warning}>
          {t("meeting.trackWarning", { message: warning })}
        </span>
      )}
      <button
        onClick={onStop}
        disabled={stopping}
        data-tooltip={t("meeting.stopTooltip")}
        className="flex items-center gap-1 rounded-lg border border-border px-2.5 py-1 text-foreground hover:bg-accent disabled:opacity-50 transition-colors"
      >
        <Square size={11} />
        {t("meeting.stop")}
      </button>
    </div>
  );
}
