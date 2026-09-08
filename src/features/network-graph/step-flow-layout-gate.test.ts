import { describe, it, expect } from "vitest";
import { nextLayoutRequest } from "./step-flow-layout-gate";

describe("nextLayoutRequest（自動レイアウト要求の持ち越し）", () => {
  it("形が変わったら要求する", () => {
    expect(
      nextLayoutRequest({ pending: false, usingSavedLayout: false, structureChanged: true }),
    ).toBe(true);
  });

  it("形が変わっていなくても、実測待ちの要求は消さない（回帰: ノードが (0,0) に固定される）", () => {
    // nodes/edges 同期 effect はコールバックの参照が変わっただけでも走る。
    // その割り込みで要求が消えると、以後 tryLayout が何度呼ばれても先頭で
    // bail するため、Tidy up を押すまで永久に並ばなくなる
    expect(
      nextLayoutRequest({ pending: true, usingSavedLayout: false, structureChanged: false }),
    ).toBe(true);
  });

  it("形が変わっておらず要求も無いなら、何もしない", () => {
    expect(
      nextLayoutRequest({ pending: false, usingSavedLayout: false, structureChanged: false }),
    ).toBe(false);
  });

  it("手動配置を使っている間は ELK を流さない（形が変わっても）", () => {
    expect(
      nextLayoutRequest({ pending: true, usingSavedLayout: true, structureChanged: true }),
    ).toBe(false);
    expect(
      nextLayoutRequest({ pending: true, usingSavedLayout: true, structureChanged: false }),
    ).toBe(false);
  });

  it("ドラッグで要求が下りた後、形が同じなら要求は立たない（手で動かした位置が勝つ）", () => {
    // onNodeDrag で needsLayout=false / layoutAbandoned=true になった直後の再同期
    expect(
      nextLayoutRequest({ pending: false, usingSavedLayout: false, structureChanged: false }),
    ).toBe(false);
  });
});
