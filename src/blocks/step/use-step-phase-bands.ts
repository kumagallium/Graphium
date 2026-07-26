// step コンテナ内の「モード帯」を DOM に反映するフック
//
// 計画（plan）/ 結果（result）は step を入れ子にする "箱" ではなく、
// step 直下の子の並びに被せる "帯" として表す（階層を増やさない）。
// 帯は plan / result ラベルの付いた子から始まり、次の区切り（別の phase ラベル、
// または step の終わり）まで続く。既定は結果（＝マーク不要）。
//
// ラベルは labelStore（外部 Map）が持っていて DOM には出ないので、
// CSS で帯を塗るために data-step-phase 属性をブロック要素へ書き戻す。

import { useEffect } from "react";

type Phase = "plan" | "result";

/** step の子を順に見て、モード帯の phase を子孫まで割り当てる */
function computeBands(
  blocks: any[],
  labels: Map<string, string>,
  out: Map<string, Phase>,
): void {
  for (const block of blocks) {
    if (!block || typeof block !== "object") continue;
    if (block.type === "step" && Array.isArray(block.children)) {
      let current: Phase | undefined;
      const assign = (b: any, phase: Phase) => {
        if (b?.id) out.set(b.id, phase);
        if (Array.isArray(b?.children)) for (const c of b.children) assign(c, phase);
      };
      for (const child of block.children) {
        if (!child || typeof child !== "object") continue;
        const label = child.id ? labels.get(child.id) : undefined;
        if (label === "plan" || label === "result") current = label;
        // 内側の step は自前の帯を持つので、外側の帯を持ち込まない
        if (current && child.type !== "step") assign(child, current);
      }
    }
    if (Array.isArray(block.children)) computeBands(block.children, labels, out);
  }
}

/**
 * エディタの内容とラベルから step のモード帯を計算し、
 * 対象ブロックの DOM に data-step-phase を付ける（CSS が帯を塗る）。
 */
export function useStepPhaseBands(
  getDocument: () => any[] | undefined,
  labels: Map<string, string>,
  deps: unknown[] = [],
): void {
  useEffect(() => {
    if (typeof document === "undefined") return;
    const apply = () => {
      const blocks = getDocument();
      if (!blocks) return;
      const bands = new Map<string, Phase>();
      computeBands(blocks, labels, bands);

      // 前回付けた帯を掃除してから塗り直す（ブロック移動・ラベル解除に追随）
      document.querySelectorAll("[data-step-phase]").forEach((el) => {
        const id = el.getAttribute("data-id");
        if (!id || !bands.has(id)) el.removeAttribute("data-step-phase");
      });
      for (const [blockId, phase] of bands) {
        const el = document.querySelector(
          `[data-id="${blockId}"][data-node-type="blockOuter"]`,
        );
        el?.setAttribute("data-step-phase", phase);
      }
    };
    // BlockNote の描画が済んでから当てる
    const raf = requestAnimationFrame(apply);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [labels, ...deps]);
}
