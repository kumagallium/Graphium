// 設定「表示」の「新しいノートを A4 の幅で始める」のすぐ下に出す、これまでのノートの幅をまとめて変える 2 つのボタン。
//
// - 「これまでのノートも A4 にする」 / 「A4 のノートをすべて標準に戻す」
// - 押すと確認（window.confirm。この画面の一括操作と同じ作法）→ 1 件ずつ実行 → 進み具合と「止める」
// - 終わったら結果を 1 行（失敗があればもう一度押すと続きから直せる旨）
//
// 実際の読み書きは持たない（props の run が行う。use-file-manager の bulkChangeBodyWidth）。
// 画面を閉じたら（アンマウント）実行を止める。止めた分までは書けていて、もう一度押せば続きから進む。

import { useEffect, useRef, useState } from "react";
import { Button } from "@ui/button";
import { useT } from "../../i18n";
import type { BulkWidthMode, BulkWidthProgress, BulkWidthResult } from "../paper-mode/bulk-body-width";

export type BulkBodyWidthSectionProps = {
  /** 対象の候補の数（ゴミ箱を除いたノート数）。読み込む前に分かる数 */
  countTargets: () => number;
  /** 1 件ずつ順に実行する。止めるときは signal が aborted になる */
  run: (
    mode: BulkWidthMode,
    opts: { signal: AbortSignal; onProgress: (progress: BulkWidthProgress) => void },
  ) => Promise<BulkWidthResult>;
};

export function BulkBodyWidthSection({ countTargets, run }: BulkBodyWidthSectionProps) {
  const t = useT();
  const [running, setRunning] = useState<BulkWidthMode | null>(null);
  const [progress, setProgress] = useState<BulkWidthProgress | null>(null);
  const [outcome, setOutcome] = useState<{ mode: BulkWidthMode; result: BulkWidthResult } | null>(null);
  const [error, setError] = useState(false);
  const [stopping, setStopping] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const mountedRef = useRef(true);
  // StrictMode の試しのアンマウントで true に戻す（effect 本体で戻さないと dev で固まる）
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      abortRef.current?.abort();
    };
  }, []);

  const count = countTargets();

  const start = async (mode: BulkWidthMode) => {
    if (running) return;
    const n = countTargets();
    const message = t(mode === "a4" ? "settings.bulkWidth.confirmA4" : "settings.bulkWidth.confirmStandard", {
      count: String(n),
    });
    if (!window.confirm(message)) return;
    const controller = new AbortController();
    abortRef.current = controller;
    setRunning(mode);
    setStopping(false);
    setOutcome(null);
    setError(false);
    setProgress({ done: 0, total: n });
    try {
      const result = await run(mode, {
        signal: controller.signal,
        onProgress: (p) => {
          if (mountedRef.current) setProgress(p);
        },
      });
      if (mountedRef.current) setOutcome({ mode, result });
    } catch (err) {
      console.error("[bulk-body-width] 実行に失敗:", err);
      if (mountedRef.current) setError(true);
    } finally {
      abortRef.current = null;
      if (mountedRef.current) {
        setRunning(null);
        setProgress(null);
        setStopping(false);
      }
    }
  };

  const stop = () => {
    setStopping(true);
    abortRef.current?.abort();
  };

  const result = outcome?.result;
  const resultLine = result
    ? outcome.mode === "a4"
      ? t("settings.bulkWidth.resultA4", {
          changed: String(result.changed),
          fullWidth: String(result.skippedFullWidth),
          already: String(result.skippedAlready),
        })
      : t("settings.bulkWidth.resultStandard", {
          changed: String(result.changed),
          other: String(result.skippedOther),
        })
    : null;

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          variant="outline"
          onClick={() => void start("a4")}
          disabled={running !== null || count === 0}
        >
          {t("settings.bulkWidth.toA4")}
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={() => void start("standard")}
          disabled={running !== null || count === 0}
        >
          {t("settings.bulkWidth.toStandard")}
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">{t("settings.bulkWidth.help")}</p>

      {running && progress && (
        <div className="space-y-1" role="status">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs text-foreground">
              {t("settings.bulkWidth.progress", { done: String(progress.done), total: String(progress.total) })}
            </span>
            <Button size="sm" variant="ghost" onClick={stop} disabled={stopping}>
              {stopping ? t("settings.bulkWidth.stopping") : t("settings.bulkWidth.stop")}
            </Button>
          </div>
          <div className="h-1.5 rounded-full bg-muted overflow-hidden">
            <div
              className="h-full bg-primary transition-all"
              style={{ width: `${(progress.done / Math.max(1, progress.total)) * 100}%` }}
            />
          </div>
        </div>
      )}

      {!running && result && (
        <div className="space-y-0.5" role="status">
          <p className="text-xs text-foreground">
            {result.aborted ? `${t("settings.bulkWidth.stopped")} ` : ""}
            {resultLine}
          </p>
          {result.failed > 0 && (
            <p className="text-xs text-amber-600">
              {t("settings.bulkWidth.failed", { failed: String(result.failed) })}
            </p>
          )}
        </div>
      )}
      {!running && error && (
        <p className="text-xs text-amber-600" role="status">
          {t("settings.bulkWidth.error")}
        </p>
      )}
    </div>
  );
}
