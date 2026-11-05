// 照合の進捗に添える残り時間の目安（「残りおよそ N 分」）。
// 終えた件数が少ないうちは何も出さない（eta.ts の ETA_MIN_DONE）。経過は 15 秒ごとに描き直す

import { useEffect, useState } from "react";
import { useT } from "../../../i18n";
import { estimateRemainingMs, remainingMinutes } from "../eta";

export function SourceCheckEta({ startedAt, done, total }: { startedAt: number; done: number; total: number }) {
  const t = useT();
  // 完了が増えなくても時間は進むので、定期的に描き直す
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 15_000);
    return () => window.clearInterval(id);
  }, []);
  const ms = estimateRemainingMs(startedAt, done, total, Math.max(now, Date.now()));
  if (ms === null) return null;
  const minutes = remainingMinutes(ms);
  return (
    <span className="ml-2 text-muted-foreground">
      {minutes >= 1 ? t("sourceCheck.eta.minutes", { minutes: String(minutes) }) : t("sourceCheck.eta.underMinute")}
    </span>
  );
}
