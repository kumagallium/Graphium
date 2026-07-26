// step コンテナ内の「モード帯」を描くフック
//
// 計画（plan）/ 結果（result）は step を入れ子にする "箱" ではなく、
// step 直下の子の並びに被せる "帯" として表す（階層を増やさない）。
// 帯は plan / result ラベルの付いた子から始まり、次の区切り（別の phase ラベル、
// または step の終わり）まで続く。既定は結果（＝マーク不要）。
//
// ラベルは labelStore（外部 Map）が持っていて DOM には出ない。
// 帯を描くのにブロック要素へ属性やクラスを書き足す方法は使えない —
// ProseMirror は自分が管理する DOM を描き直すときに知らない属性を消すため、
// 書いた端から失われる（実測で確認済み）。
// そこで DOM には触れず、ブロック ID を狙う CSS ルールを動的に差し替える。
// スタイルシートは ProseMirror の管理外なので描き直しの影響を受けない。
//
// （PM の decoration でも実現できる。document-search 拡張が同じ問題を
//   decoration で解いている。将来 step 側でも装飾が増えるならそちらへ寄せる。）

import { useEffect } from "react";

type Phase = "plan" | "result";

const STYLE_ELEMENT_ID = "graphium-step-phase-bands";

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

/** 帯の見た目。色は app.css のトークンを参照する（ハードコード色は使わない） */
function buildCss(bands: Map<string, Phase>): string {
  const planIds = [...bands.entries()]
    .filter(([, phase]) => phase === "plan")
    .map(([id]) => id);
  if (planIds.length === 0) return "";
  const selector = planIds
    .map((id) => `.bn-editor [data-id="${CSS.escape(id)}"][data-node-type="blockOuter"]`)
    .join(",\n");
  return `${selector} {
  background: var(--color-info-bg);
  box-shadow: -8px 0 0 0 var(--color-info-bg), 8px 0 0 0 var(--color-info-bg);
}`;
}

/**
 * エディタの内容とラベルから step のモード帯を計算し、
 * 該当ブロックを塗る CSS を差し替える。
 */
export function useStepPhaseBands(
  getDocument: () => any[] | undefined,
  labels: Map<string, string>,
  deps: unknown[] = [],
): void {
  useEffect(() => {
    if (typeof document === "undefined") return;

    let raf = 0;

    const apply = () => {
      const blocks = getDocument();
      if (!blocks) return;
      const bands = new Map<string, Phase>();
      computeBands(blocks, labels, bands);

      let styleEl = document.getElementById(STYLE_ELEMENT_ID) as HTMLStyleElement | null;
      const css = buildCss(bands);
      if (!css) {
        styleEl?.remove();
        return;
      }
      if (!styleEl) {
        styleEl = document.createElement("style");
        styleEl.id = STYLE_ELEMENT_ID;
        document.head.appendChild(styleEl);
      }
      if (styleEl.textContent !== css) styleEl.textContent = css;
    };

    const schedule = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(apply);
    };

    schedule();

    // ブロックの追加・移動・削除に追随して塗り直す（ラベルは動かなくても帯の範囲は変わる）
    const observer = new MutationObserver(schedule);
    document
      .querySelectorAll(".bn-editor")
      .forEach((root) => observer.observe(root, { childList: true, subtree: true }));

    return () => {
      cancelAnimationFrame(raf);
      observer.disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [labels, ...deps]);
}
