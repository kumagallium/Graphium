// 表を包む枠の幅に応じて、隠す列の数を決めるフック（判定の中身は lib/responsive-columns）
//
// 使い方:
//   const cols = useResponsiveColumns(plan);
//   <table ref={cols.tableRef} style={{ minWidth: tableMinWidth(plan) }}>
//     <th className={cn("…", cols.hidden.has("author") && "hidden")} />
//
// 枠 = 表の親要素（overflow-auto の器）。ビューポートではなく枠を測るので、サイドピークを
// 並べたときやサイドバーを畳んだときにも効く。測るのは offsetWidth（スクロールバーを含む）から
// padding を引いた値で、縦スクロールの出入りで値が変わらない。だから隠す/戻すの往復
// （隠す → 行が低くなる → スクロールバーが消える → 幅が増えて戻す → …）が起きない。

import { useCallback, useLayoutEffect, useMemo, useState } from "react";
import { resolveHiddenCount, type ColumnPlan } from "../lib/responsive-columns";

export function useResponsiveColumns<K extends string>(plan: ColumnPlan<K>) {
  const [table, setTable] = useState<HTMLElement | null>(null);
  const [count, setCount] = useState(0);
  // plan は毎回の描画で作り直されるので、中身の同一性で effect を回す
  const planKey = `${plan.baseWidth}|${plan.hideable.map((c) => `${c.key}:${c.width}`).join(",")}`;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const stablePlan = useMemo(() => plan, [planKey]);

  const tableRef = useCallback((el: HTMLElement | null) => setTable(el), []);

  // 描画の前に測る（先に全列を描くと、開いた瞬間に列がちらつく）
  useLayoutEffect(() => {
    const frame = table?.parentElement;
    if (!frame) {
      setCount(0);
      return;
    }
    const measure = () => {
      const cs = getComputedStyle(frame);
      const inner =
        frame.offsetWidth - (parseFloat(cs.paddingLeft) || 0) - (parseFloat(cs.paddingRight) || 0);
      setCount(resolveHiddenCount(inner, stablePlan));
    };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(frame);
    return () => observer.disconnect();
  }, [table, stablePlan]);

  const hidden = useMemo<ReadonlySet<K>>(
    () => new Set(stablePlan.hideable.slice(0, count).map((c) => c.key)),
    [stablePlan, count],
  );
  return { tableRef, hidden };
}
