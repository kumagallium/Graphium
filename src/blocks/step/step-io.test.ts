import { describe, expect, it, vi } from "vitest";
import {
  appendEntitySpanToStep,
  removeDedicatedStepInputEntity,
  updateStepInputEntityText,
} from "./step-io";

const material = (text: string, entityId: string) => ({
  type: "text",
  text,
  styles: { inlineMaterial: entityId },
});

describe("step input entity helpers", () => {
  it("指定した entityId で専用 material 行を追加する", () => {
    const document = [
      {
        id: "s1",
        type: "step",
        children: [{ id: "p1", type: "paragraph", content: [], children: [] }],
      },
    ];
    const editor = { document, updateBlock: vi.fn(), insertBlocks: vi.fn() };

    expect(appendEntitySpanToStep(editor, "s1", "material", "試料", "material-ref")).toBe(
      "material-ref",
    );
    expect(editor.updateBlock).toHaveBeenCalledWith("p1", {
      content: [
        {
          type: "text",
          text: "試料",
          styles: { inlineMaterial: "material-ref" },
        },
      ],
    });
  });

  it("指定 step 内の span だけを entityId で改名する", () => {
    const document = [
      {
        id: "s1",
        type: "step",
        children: [
          {
            id: "p1",
            type: "paragraph",
            content: [material("改", "material-ref"), material("名前", "material-ref")],
            children: [],
          },
          {
            id: "nested",
            type: "step",
            children: [
              {
                id: "p-nested",
                type: "paragraph",
                content: [material("別工程", "material-ref")],
                children: [],
              },
            ],
          },
        ],
      },
    ];
    const editor = { document, updateBlock: vi.fn() };

    expect(updateStepInputEntityText(editor, "s1", "material-ref", "改名後")).toBe(1);
    expect(editor.updateBlock).toHaveBeenCalledWith("p1", {
      content: [material("改名後", "material-ref")],
    });
    expect(editor.updateBlock).not.toHaveBeenCalledWith("p-nested", expect.anything());
  });

  it("専用行を削除し、文章に混在する span だけを取り除く", () => {
    const document = [
      {
        id: "s1",
        type: "step",
        children: [
          {
            id: "dedicated",
            type: "paragraph",
            content: [material("試料", "material-ref")],
            children: [],
          },
          {
            id: "sentence",
            type: "paragraph",
            content: [
              material("試料", "material-ref"),
              { type: "text", text: "を加える", styles: {} },
            ],
            children: [],
          },
        ],
      },
    ];
    const editor = { document, removeBlocks: vi.fn(), updateBlock: vi.fn() };

    expect(removeDedicatedStepInputEntity(editor, "s1", "material-ref")).toBe(2);
    expect(editor.removeBlocks).toHaveBeenCalledWith(["dedicated"]);
    expect(editor.updateBlock).toHaveBeenCalledWith("sentence", {
      content: [{ type: "text", text: "を加える", styles: {} }],
    });
  });

  it("専用行が step の唯一の子なら空段落に戻す", () => {
    const document = [
      {
        id: "s1",
        type: "step",
        children: [
          {
            id: "only",
            type: "paragraph",
            content: [material("試料", "material-ref")],
            children: [],
          },
        ],
      },
    ];
    const editor = { document, removeBlocks: vi.fn(), updateBlock: vi.fn() };

    expect(removeDedicatedStepInputEntity(editor, "s1", "material-ref")).toBe(1);
    expect(editor.updateBlock).toHaveBeenCalledWith("only", { content: [] });
    expect(editor.removeBlocks).not.toHaveBeenCalled();
  });

  it("リンク内の対象 span を再帰的に除去し、他の content を保持する", () => {
    const link = {
      type: "link",
      href: "https://example.com",
      content: [
        material("試料", "material-ref"),
        { type: "text", text: "の詳細", styles: {} },
      ],
    };
    const document = [
      {
        id: "s1",
        type: "step",
        children: [
          {
            id: "linked",
            type: "paragraph",
            content: [link, { type: "text", text: "を参照", styles: {} }],
            children: [],
          },
        ],
      },
    ];
    const editor = { document, removeBlocks: vi.fn(), updateBlock: vi.fn() };

    expect(removeDedicatedStepInputEntity(editor, "s1", "material-ref")).toBe(1);
    expect(editor.updateBlock).toHaveBeenCalledWith("linked", {
      content: [
        {
          ...link,
          content: [{ type: "text", text: "の詳細", styles: {} }],
        },
        { type: "text", text: "を参照", styles: {} },
      ],
    });
  });
});

// ── 外部参照の表行受け取り（D-1）──

import {
  appendExternalInputRowToStep,
  findRowByIdentity,
  removeExternalInputRow,
  updateExternalInputRowText,
} from "./step-io";

/** updateBlock / insertBlocks が document に実際へ反映されるモックエディタ */
function liveEditor(document: any[]) {
  const findAndPatch = (blocks: any[], id: string, patch: any): boolean => {
    for (let i = 0; i < blocks.length; i += 1) {
      const b = blocks[i];
      if (b?.id === id) {
        blocks[i] = { ...b, ...patch };
        return true;
      }
      if (Array.isArray(b?.children) && findAndPatch(b.children, id, patch)) return true;
    }
    return false;
  };
  const editor: any = {
    document,
    updateBlock: (id: string, patch: any) => {
      if (!findAndPatch(document, id, patch)) throw new Error(`block not found: ${id}`);
    },
    insertBlocks: (blocks: any[], refId: string, placement: "after" | "before") => {
      const inserted = blocks.map((b, i) => ({ id: `ins-${i}`, children: [], ...b }));
      const visit = (list: any[]): boolean => {
        const idx = list.findIndex((b) => b?.id === refId);
        if (idx >= 0) {
          list.splice(placement === "after" ? idx + 1 : idx, 0, ...inserted);
          return true;
        }
        return list.some((b) => Array.isArray(b?.children) && visit(b.children));
      };
      visit(document);
      return inserted;
    },
    replaceBlocks: (targetIds: string[], blocks: any[]) => {
      const inserted = blocks.map((b, i) => ({ id: `rep-${i}`, children: [], ...b }));
      const visit = (list: any[]): boolean => {
        const idx = list.findIndex((b) => targetIds.includes(b?.id));
        if (idx >= 0) {
          list.splice(idx, 1, ...inserted);
          return true;
        }
        return list.some((b) => Array.isArray(b?.children) && visit(b.children));
      };
      visit(document);
      return { insertedBlocks: inserted };
    },
  };
  return editor;
}

const idCell = (text: string, identity: string) => [
  { type: "text", text, styles: { tableRowIdentity: identity } },
];
const plainCell = (text: string) => [{ type: "text", text, styles: {} }];

describe("external input rows (cross-note pick)", () => {
  it("material 表が無ければ作って行を足し、rowIdentity を返す", () => {
    const document = [
      {
        id: "s1",
        type: "step",
        children: [{ id: "p1", type: "paragraph", content: [], children: [] }],
      },
    ];
    const editor = liveEditor(document);
    const result = appendExternalInputRowToStep(editor, "s1", "焼成ペレット", () => null, "名前");
    expect(result).not.toBeNull();
    expect(result!.created).toBe(true);
    expect(result!.rowIdentity).toMatch(/^row_/);
    // 追加された行から identity で引ける
    const hit = findRowByIdentity(editor.document, result!.rowIdentity);
    expect(hit).toMatchObject({ tableBlockId: result!.tableBlockId, rowName: "焼成ペレット" });
  });

  it("既存の material 表があれば行だけ足す", () => {
    const document = [
      {
        id: "s1",
        type: "step",
        children: [
          {
            id: "t1",
            type: "table",
            content: {
              type: "tableContent",
              rows: [
                { cells: [plainCell("名前")] },
                { cells: [idCell("既存材料", "row_existing")] },
              ],
            },
            children: [],
          },
        ],
      },
    ];
    const editor = liveEditor(document);
    const result = appendExternalInputRowToStep(editor, "s1", "焼成ペレット", () => "t1", "名前");
    expect(result).toMatchObject({ tableBlockId: "t1", created: false });
    const rows = editor.document[0].children[0].content.rows;
    expect(rows).toHaveLength(3);
    // 既存行の identity は変わらない
    expect(findRowByIdentity(editor.document, "row_existing")?.rowName).toBe("既存材料");
  });

  it("rowIdentity で行名を追随更新する（同名行があっても対象行だけ）", () => {
    const document = [
      {
        id: "t1",
        type: "table",
        content: {
          type: "tableContent",
          rows: [
            { cells: [plainCell("名前")] },
            { cells: [idCell("試料", "row_a")] },
            { cells: [idCell("試料", "row_b")] },
          ],
        },
        children: [],
      },
    ];
    const editor = liveEditor(document);
    expect(updateExternalInputRowText(editor, "row_b", "試料X")).toBe(true);
    const rows = editor.document[0].content.rows;
    expect(rows[1].cells[0][0].text).toBe("試料");
    expect(rows[2].cells[0][0].text).toBe("試料X");
    // identity は改名後も残る（withCellText が styles を保持）
    expect(findRowByIdentity(editor.document, "row_b")?.rowName).toBe("試料X");
  });

  it("rowIdentity で行を削除する（同名行があっても対象行だけ）", () => {
    const document = [
      {
        id: "t1",
        type: "table",
        content: {
          type: "tableContent",
          rows: [
            { cells: [plainCell("名前")] },
            { cells: [idCell("試料", "row_a")] },
            { cells: [idCell("試料", "row_b")] },
          ],
        },
        children: [],
      },
    ];
    const editor = liveEditor(document);
    expect(removeExternalInputRow(editor, "row_a")).toBe(true);
    const rows = editor.document[0].content.rows;
    expect(rows).toHaveLength(2);
    expect(findRowByIdentity(editor.document, "row_a")).toBeNull();
    expect(findRowByIdentity(editor.document, "row_b")?.rowName).toBe("試料");
  });

  it("identity が見つからないときは no-op で false", () => {
    const editor = liveEditor([]);
    expect(updateExternalInputRowText(editor, "row_missing", "x")).toBe(false);
    expect(removeExternalInputRow(editor, "row_missing")).toBe(false);
  });
});
