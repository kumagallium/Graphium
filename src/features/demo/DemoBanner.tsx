// 見本モードの帯 — 画面の上に 1 行。「これは見本です」と、本人のノートへ戻る・最初からの 2 動作。
// アプリ本体の高さは app.css（html[data-demo]）で帯の分だけ縮めている。

import { useEffect, useState } from "react";
import { useT } from "../../i18n";
import { demoDbName, demoExitUrl, getDemoId } from "../../lib/demo/demo-mode";
import { DEMO_LOAD_EVENT, getDemoLoadState, resetDemo, type DemoLoadState } from "../../lib/demo/load";

export function DemoBanner() {
  const t = useT();
  const id = getDemoId();
  const [state, setState] = useState<DemoLoadState>(() => getDemoLoadState());

  useEffect(() => {
    const onChange = (e: Event) => setState((e as CustomEvent<DemoLoadState>).detail);
    window.addEventListener(DEMO_LOAD_EVENT, onChange);
    return () => window.removeEventListener(DEMO_LOAD_EVENT, onChange);
  }, []);

  if (!id) return null;

  const message =
    state.status === "loading" ? t("demo.loading")
    : state.status === "error" ? t("demo.loadFailed")
    : state.status === "ready" && state.bundle.generatedBy
      ? t("demo.bannerWithModel", { model: state.bundle.generatedBy })
    : t("demo.banner");

  return (
    <div
      role="status"
      data-demo-banner
      className="fixed inset-x-0 top-0 z-[90] flex h-9 items-center gap-3 border-b border-border bg-muted px-3 text-xs text-foreground"
    >
      <span className="rounded-sm bg-foreground/10 px-1.5 py-0.5 font-medium">{t("demo.label")}</span>
      <span className="min-w-0 flex-1 truncate" title={message}>{message}</span>
      <button
        type="button"
        className="rounded-sm px-2 py-1 hover:bg-foreground/10"
        onClick={() => void resetDemo(demoDbName(id))}
        data-tooltip={t("demo.resetHint")}
      >
        {t("demo.reset")}
      </button>
      <a
        className="rounded-sm bg-foreground px-2 py-1 font-medium text-background hover:opacity-90"
        href={demoExitUrl(location.pathname)}
      >
        {t("demo.exit")}
      </a>
    </div>
  );
}
