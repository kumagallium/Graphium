import { describe, it, expect, vi } from "vitest";
import {
  flattenBlockIds,
  computeIdMap,
  buildClipboardPayload,
  parseClipboardPayload,
  applyClipboardPayload,
  embedPayloadInHtml,
  extractPayloadFromHtml,
  GRAPHIUM_CLIPBOARD_VERSION,
  type GraphiumClipboardPayload,
} from "./clipboard";
import type { BlockLink } from "../block-link/link-types";
import type { StepAttributes } from "../context-label/label-attributes";

// ── flattenBlockIds ──

describe("flattenBlockIds", () => {
  it("フラットなブロック配列をそのままの順序で返す", () => {
    expect(flattenBlockIds([{ id: "a" }, { id: "b" }, { id: "c" }])).toEqual(["a", "b", "c"]);
  });

  it("ネストされたブロックを深さ優先で親→子の順に列挙する", () => {
    const blocks = [
      { id: "a", children: [{ id: "a1" }, { id: "a2", children: [{ id: "a2a" }] }] },
      { id: "b" },
    ];
    expect(flattenBlockIds(blocks)).toEqual(["a", "a1", "a2", "a2a", "b"]);
  });

  it("id を持たないブロックはスキップする", () => {
    expect(flattenBlockIds([{ id: "a" }, {}, { id: "b" }])).toEqual(["a", "b"]);
  });

  it("空配列に耐える", () => {
    expect(flattenBlockIds([])).toEqual([]);
  });
});

// ── computeIdMap ──

describe("computeIdMap", () => {
  it("同じ長さの配列を順序対応でマップ化する", () => {
    const map = computeIdMap(["a", "b", "c"], ["x", "y", "z"]);
    expect(map.get("a")).toBe("x");
    expect(map.get("b")).toBe("y");
    expect(map.get("c")).toBe("z");
    expect(map.size).toBe(3);
  });

  it("新配列が短い場合は短い方に合わせる", () => {
    const map = computeIdMap(["a", "b", "c"], ["x", "y"]);
    expect(map.size).toBe(2);
    expect(map.get("c")).toBeUndefined();
  });

  it("旧配列が短い場合は短い方に合わせる", () => {
    const map = computeIdMap(["a"], ["x", "y", "z"]);
    expect(map.size).toBe(1);
  });

  it("同じ ID の場合はマップに入れない（恒等）", () => {
    const map = computeIdMap(["a", "b"], ["a", "c"]);
    expect(map.has("a")).toBe(false);
    expect(map.get("b")).toBe("c");
  });
});

// ── buildClipboardPayload ──

function makeLink(
  id: string,
  sourceBlockId: string,
  targetBlockId: string,
  type: BlockLink["type"] = "informed_by",
): BlockLink {
  return {
    id,
    sourceBlockId,
    targetBlockId,
    type,
    layer: "prov",
    createdBy: "human",
  };
}

describe("buildClipboardPayload", () => {
  it("選択範囲のラベル・両端が範囲内のリンクを含むペイロードを返す", () => {
    const payload = buildClipboardPayload({
      blockIds: ["a", "b", "c"],
      getLabel: (id) => ({ a: "procedure", b: "material" }[id] ?? undefined),
      getAttributes: () => undefined,
      allLinks: [
        makeLink("l1", "a", "b"),
        makeLink("l2", "a", "outside"), // 片端が範囲外 → 除外
        makeLink("l3", "outside", "b"), // 片端が範囲外 → 除外
      ],
    });
    expect(payload).not.toBeNull();
    expect(payload!.version).toBe(GRAPHIUM_CLIPBOARD_VERSION);
    expect(payload!.blockIds).toEqual(["a", "b", "c"]);
    expect(payload!.labels).toEqual({ a: "procedure", b: "material" });
    expect(payload!.links).toHaveLength(1);
    expect(payload!.links[0].id).toBe("l1");
  });

  it("連動属性（StepAttributes）も運ぶ", () => {
    const stepAttrs: StepAttributes = { checked: true, executor: "ai", status: "done" };
    const payload = buildClipboardPayload({
      blockIds: ["a"],
      getLabel: () => "procedure",
      getAttributes: (id) => (id === "a" ? stepAttrs : undefined),
      allLinks: [],
    });
    expect(payload!.attributes).toEqual({ a: stepAttrs });
  });

  it("ラベルもリンクもない選択は null を返す（カスタム MIME を載せる意味がないため）", () => {
    const payload = buildClipboardPayload({
      blockIds: ["a", "b"],
      getLabel: () => undefined,
      getAttributes: () => undefined,
      allLinks: [],
    });
    expect(payload).toBeNull();
  });

  it("リンクだけあってラベルがないケースも運ぶ", () => {
    const payload = buildClipboardPayload({
      blockIds: ["a", "b"],
      getLabel: () => undefined,
      getAttributes: () => undefined,
      allLinks: [makeLink("l1", "a", "b")],
    });
    expect(payload).not.toBeNull();
    expect(payload!.labels).toEqual({});
    expect(payload!.links).toHaveLength(1);
  });
});

// ── parseClipboardPayload ──

describe("parseClipboardPayload", () => {
  it("正しい JSON を復元する", () => {
    const payload: GraphiumClipboardPayload = {
      version: GRAPHIUM_CLIPBOARD_VERSION,
      blockIds: ["a", "b"],
      labels: { a: "procedure" },
      links: [makeLink("l1", "a", "b")],
    };
    const parsed = parseClipboardPayload(JSON.stringify(payload));
    expect(parsed).not.toBeNull();
    expect(parsed!.labels).toEqual({ a: "procedure" });
    expect(parsed!.links).toHaveLength(1);
  });

  it("null / undefined / 空文字を安全に扱う", () => {
    expect(parseClipboardPayload(null)).toBeNull();
    expect(parseClipboardPayload(undefined)).toBeNull();
    expect(parseClipboardPayload("")).toBeNull();
  });

  it("不正な JSON は null", () => {
    expect(parseClipboardPayload("{not json")).toBeNull();
  });

  it("version が一致しないペイロードは拒否する（将来の互換性ガード）", () => {
    const bad = { version: 999, blockIds: [], labels: {}, links: [] };
    expect(parseClipboardPayload(JSON.stringify(bad))).toBeNull();
  });

  it("必須フィールドが欠けていれば null", () => {
    expect(parseClipboardPayload(JSON.stringify({ version: 1 }))).toBeNull();
    expect(parseClipboardPayload(JSON.stringify({ version: 1, blockIds: [], labels: {} }))).toBeNull();
  });
});

// ── applyClipboardPayload ──

describe("applyClipboardPayload", () => {
  it("idMap に含まれる旧 ID の labels / links を新 ID 側に適用する", () => {
    const target = {
      setLabel: vi.fn(),
      setAttributes: vi.fn(),
      addLink: vi.fn(),
    };
    const payload: GraphiumClipboardPayload = {
      version: 1,
      blockIds: ["old1", "old2"],
      labels: { old1: "procedure", old2: "material" },
      attributes: { old1: { checked: false, executor: "human", status: "planned" } },
      links: [makeLink("l1", "old1", "old2")],
    };
    const idMap = new Map([
      ["old1", "new1"],
      ["old2", "new2"],
    ]);
    applyClipboardPayload(idMap, payload, target);

    expect(target.setLabel).toHaveBeenCalledWith("new1", "procedure");
    expect(target.setLabel).toHaveBeenCalledWith("new2", "material");
    expect(target.setAttributes).toHaveBeenCalledWith(
      "new1",
      expect.objectContaining({ executor: "human" }),
    );
    expect(target.addLink).toHaveBeenCalledTimes(1);
    expect(target.addLink).toHaveBeenCalledWith(
      expect.objectContaining({ sourceBlockId: "new1", targetBlockId: "new2" }),
    );
  });

  it("HTML 経由（OS クリップボード）でも payload を round-trip できる", () => {
    const payload: GraphiumClipboardPayload = {
      version: GRAPHIUM_CLIPBOARD_VERSION,
      blockIds: ["a", "b"],
      labels: { a: "procedure", b: "material" },
      links: [makeLink("l1", "a", "b")],
    };
    const existingHtml = "<p>こんにちは 👋 &amp; world</p>";
    const wrapped = embedPayloadInHtml(payload, existingHtml);
    expect(wrapped).toContain(existingHtml);
    expect(extractPayloadFromHtml(wrapped)).toEqual(payload);
  });

  it("Graphium ペイロードが含まれない HTML は null", () => {
    expect(extractPayloadFromHtml("<p>plain html</p>")).toBeNull();
    expect(extractPayloadFromHtml(null)).toBeNull();
    expect(extractPayloadFromHtml("")).toBeNull();
  });

  it("idMap に含まれない旧 ID はスキップ（paste 範囲外）", () => {
    const target = {
      setLabel: vi.fn(),
      setAttributes: vi.fn(),
      addLink: vi.fn(),
    };
    const payload: GraphiumClipboardPayload = {
      version: 1,
      blockIds: ["old1", "old2"],
      labels: { old1: "procedure", old2: "material" },
      links: [makeLink("l1", "old1", "old2")],
    };
    const idMap = new Map([["old1", "new1"]]); // old2 は欠落

    applyClipboardPayload(idMap, payload, target);

    expect(target.setLabel).toHaveBeenCalledWith("new1", "procedure");
    expect(target.setLabel).not.toHaveBeenCalledWith("new2", expect.anything());
    // 両端マッピングが揃わないリンクは追加しない
    expect(target.addLink).not.toHaveBeenCalled();
  });
});
