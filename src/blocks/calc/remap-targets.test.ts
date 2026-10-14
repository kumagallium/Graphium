// 計算ブロックの書き戻し先の貼り替え。テンプレート・複製・コピペで表と計算を
// まとめて運んだとき、計算が元の表を指したまま残ると書き戻しが黙って止まる。

import { describe, it, expect, vi } from "vitest";
import {
  hasCalcTargetWithin,
  remapCalcTargetsInBlocks,
  remapCalcTargetsInEditor,
  remapCalcTargetsProp,
} from "./remap-targets";
import { parseCalcTargets } from "./writeback";

const targets = (o: Record<string, { tableBlockId: string; column: string }>) => JSON.stringify(o);

describe("remapCalcTargetsProp", () => {
  it("一緒に運ばれた表を指す書き戻し先だけを新しい id に貼り替える", () => {
    const raw = targets({
      mol: { tableBlockId: "t1", column: "mol" },
      g: { tableBlockId: "other", column: "投入量" },
    });
    const next = remapCalcTargetsProp(raw, new Map([["t1", "t1-new"]]));
    expect(parseCalcTargets(next!)).toEqual({
      mol: { tableBlockId: "t1-new", column: "mol" },
      g: { tableBlockId: "other", column: "投入量" },
    });
  });

  it("変化が無い・空・壊れた JSON は null（書き込みを省ける）", () => {
    const map = new Map([["t1", "t1-new"]]);
    expect(remapCalcTargetsProp(targets({ v: { tableBlockId: "x", column: "c" } }), map)).toBeNull();
    expect(remapCalcTargetsProp("", map)).toBeNull();
    expect(remapCalcTargetsProp("{broken", map)).toBeNull();
  });
});

describe("remapCalcTargetsInBlocks", () => {
  it("入れ子の計算ブロックもその場で貼り替える", () => {
    const blocks: any[] = [
      {
        id: "s1",
        type: "step",
        children: [
          { id: "c1", type: "calc", props: { source: "mol = 1", targets: targets({ mol: { tableBlockId: "t1", column: "mol" } }) }, children: [] },
        ],
      },
    ];
    remapCalcTargetsInBlocks(blocks, new Map([["t1", "t9"]]));
    expect(parseCalcTargets(blocks[0].children[0].props.targets).mol.tableBlockId).toBe("t9");
  });
});

describe("remapCalcTargetsInEditor", () => {
  it("新しく入った計算ブロックだけを書き換え、元のブロックには触らない", () => {
    const raw = targets({ mol: { tableBlockId: "t1", column: "mol" } });
    const blocks: Record<string, any> = {
      c1: { id: "c1", type: "calc", props: { targets: raw } },
      c2: { id: "c2", type: "calc", props: { targets: raw } },
      t2: { id: "t2", type: "table", props: {} },
    };
    const editor = { getBlock: (id: string) => blocks[id], updateBlock: vi.fn() };
    remapCalcTargetsInEditor(editor, new Map([["c1", "c2"], ["t1", "t2"]]));
    expect(editor.updateBlock).toHaveBeenCalledTimes(1);
    const [id, update] = editor.updateBlock.mock.calls[0];
    expect(id).toBe("c2");
    expect(parseCalcTargets(update.props.targets).mol.tableBlockId).toBe("t2");
  });

  it("表を一緒に運ばなかった計算は元の表を指したまま", () => {
    const raw = targets({ mol: { tableBlockId: "t1", column: "mol" } });
    const editor = { getBlock: () => ({ id: "c2", type: "calc", props: { targets: raw } }), updateBlock: vi.fn() };
    remapCalcTargetsInEditor(editor, new Map([["c1", "c2"]]));
    expect(editor.updateBlock).not.toHaveBeenCalled();
  });
});

describe("hasCalcTargetWithin", () => {
  const blocks: Record<string, any> = {
    t1: { id: "t1", type: "table" },
    c1: { id: "c1", type: "calc", props: { targets: targets({ mol: { tableBlockId: "t1", column: "mol" } }) } },
    p1: { id: "p1", type: "paragraph" },
  };
  const editor = { getBlock: (id: string) => blocks[id] };

  it("計算と書き戻し先の表が両方コピー範囲にあれば true", () => {
    expect(hasCalcTargetWithin(editor, ["t1", "c1"])).toBe(true);
  });

  it("計算だけ・表だけのコピーは false", () => {
    expect(hasCalcTargetWithin(editor, ["c1", "p1"])).toBe(false);
    expect(hasCalcTargetWithin(editor, ["t1", "p1"])).toBe(false);
  });
});
