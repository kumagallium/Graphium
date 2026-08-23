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
