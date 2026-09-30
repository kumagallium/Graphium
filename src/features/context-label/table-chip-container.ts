// テーブルのラベルチップを右隣へ押し出すときの、右端の上限（ビューポート座標）を DOM から取る。
// 押し出し先の判定そのものは table-chip-position.ts（純関数）。ここは入れ物の右端を測るだけ。
//
// チップを含む入れ物の内側の右端から数 px 内側:
//   - ステップのカード（node-step を持つ .bn-block）の中の表 → カードの右の罫線の内側
//   - 入れ物のブロックグループ（列・入れ子）の中の表 → そのグループの右端
//   - 本文直下の表 → fallbackRight（本文枠の右端）
// 上限を超えない限り押し出し位置は変わらない（resolveTableChipPlacement）ので、
// 広い表・通常の本文の位置は今までと同じ。

import { TABLE_CHIP_CONTAINER_INSET } from "./table-chip-position";

function isStepCard(el: Element | null): boolean {
  return (
    !!el &&
    el.classList.contains("bn-block") &&
    Array.from(el.children).some((c) => c.classList.contains("node-step"))
  );
}

export function findChipContainerRight(outer: HTMLElement, fallbackRight: number): number {
  let el: HTMLElement | null = outer.parentElement;
  while (el && !el.hasAttribute("data-label-wrapper")) {
    if (isStepCard(el)) {
      // 罫線 1px の内側から更に数 px
      return el.getBoundingClientRect().right - 1 - TABLE_CHIP_CONTAINER_INSET;
    }
    // 本文直下のグループ（親が .bn-editor）は入れ物ではない。本文枠の右端で止める。
    // ステップのカードの中のグループは、その外側のカード（罫線の内側）を上限にしたいので飛ばす
    if (
      el.classList.contains("bn-block-group") &&
      !el.parentElement?.classList.contains("bn-editor") &&
      !isStepCard(el.parentElement)
    ) {
      return el.getBoundingClientRect().right - TABLE_CHIP_CONTAINER_INSET;
    }
    el = el.parentElement;
  }
  return fallbackRight;
}
