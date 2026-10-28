// 見本の順路 — 右下の小さな札で「いま見ているもの」と「次」を案内する。
// 歩の中身（題・一言・行き先）は束（bundle.tour）が持つ。部品は言語を知らない。
// 進み具合は sessionStorage（タブを閉じれば消える。見本の DB を消す「最初から」でも消す）。

import { useCallback, useEffect, useState } from "react";
import { ChevronLeft, ChevronRight, X } from "lucide-react";
import { useT } from "../../i18n";
import { getDemoId } from "../../lib/demo/demo-mode";
import { DEMO_LOAD_EVENT, getDemoLoadState, type DemoLoadState } from "../../lib/demo/load";
import type { DemoTour as DemoTourData } from "../../lib/demo/bundle";

export const tourStorageKey = (id: string) => `graphium-demo-tour:${id}`;

type Saved = { index: number; closed?: boolean };

function readSaved(id: string): Saved | null {
  try {
    const raw = sessionStorage.getItem(tourStorageKey(id));
    if (!raw) return null;
    const v = JSON.parse(raw) as Saved;
    return typeof v.index === "number" ? v : null;
  } catch {
    return null;
  }
}

function writeSaved(id: string, v: Saved): void {
  try {
    sessionStorage.setItem(tourStorageKey(id), JSON.stringify(v));
  } catch {
    // 保存できなくても案内は出す
  }
}

export function DemoTour() {
  const t = useT();
  const id = getDemoId();
  const [state, setState] = useState<DemoLoadState>(() => getDemoLoadState());
  const [saved, setSaved] = useState<Saved | null>(() => (id ? readSaved(id) : null));

  useEffect(() => {
    const onChange = (e: Event) => setState((e as CustomEvent<DemoLoadState>).detail);
    window.addEventListener(DEMO_LOAD_EVENT, onChange);
    return () => window.removeEventListener(DEMO_LOAD_EVENT, onChange);
  }, []);

  const tour: DemoTourData | undefined = state.status === "ready" ? state.bundle.tour : undefined;
  const steps = tour?.steps ?? [];
  const index = Math.min(saved?.index ?? 0, Math.max(steps.length - 1, 0));

  const go = useCallback((next: number) => {
    if (!id) return;
    const step = steps[next];
    if (!step) return;
    const v = { index: next };
    writeSaved(id, v);
    setSaved(v);
    // ハッシュを変えるだけでアプリの画面が切り替わる（use-hash-router が hashchange を見ている）
    if (location.hash !== step.hash) location.hash = step.hash;
  }, [id, steps]);

  // 初めて開いたとき（記録なし）は 1 歩目へ連れて行く
  useEffect(() => {
    if (!id || steps.length === 0 || saved) return;
    go(0);
  }, [id, steps, saved, go]);

  if (!id || steps.length === 0 || saved?.closed) return null;
  const step = steps[index];

  return (
    <aside
      data-demo-tour
      aria-label={t("demo.tour.label")}
      className="fixed bottom-4 right-4 z-[80] w-[22rem] max-w-[calc(100vw-2rem)] rounded-lg border border-border bg-background p-3 text-sm shadow-lg"
    >
      <div className="mb-1 flex items-center gap-2 text-xs text-muted-foreground">
        <span>{t("demo.tour.stepOf", { n: String(index + 1), total: String(steps.length) })}</span>
        <span className="flex-1" />
        <button
          type="button"
          className="rounded-sm p-0.5 hover:bg-foreground/10"
          aria-label={t("demo.tour.close")}
          data-tooltip={t("demo.tour.close")}
          onClick={() => {
            const v = { index, closed: true };
            if (id) writeSaved(id, v);
            setSaved(v);
          }}
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
      <button
        type="button"
        className="block w-full text-left font-medium hover:underline"
        onClick={() => go(index)}
        title={t("demo.tour.open")}
      >
        {step.title}
      </button>
      <p className="mt-1 text-muted-foreground">{step.body}</p>
      <div className="mt-2 flex items-center gap-2">
        <button
          type="button"
          className="inline-flex items-center gap-1 rounded-sm border border-border px-2 py-1 text-xs hover:bg-foreground/5 disabled:opacity-40"
          disabled={index === 0}
          onClick={() => go(index - 1)}
        >
          <ChevronLeft className="h-3.5 w-3.5" />
          {t("demo.tour.prev")}
        </button>
        <span className="flex-1" />
        {index < steps.length - 1 ? (
          <button
            type="button"
            className="inline-flex items-center gap-1 rounded-sm bg-foreground px-2 py-1 text-xs font-medium text-background hover:opacity-90"
            onClick={() => go(index + 1)}
          >
            {t("demo.tour.next")}
            <ChevronRight className="h-3.5 w-3.5" />
          </button>
        ) : (
          <button
            type="button"
            className="inline-flex items-center gap-1 rounded-sm border border-border px-2 py-1 text-xs hover:bg-foreground/5"
            onClick={() => go(0)}
          >
            {t("demo.tour.restart")}
          </button>
        )}
      </div>
    </aside>
  );
}
