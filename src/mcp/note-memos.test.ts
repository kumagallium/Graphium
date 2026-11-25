// note-memos.ts の回帰テスト（手順・つながり・ノートに付けたメモを、付け先と一緒に返す）。
// 後半は一時 vault に置いたノートとメモで、get_note / get_note_steps の実際の返り値を見る。

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { CaptureEntry, CaptureIndex } from "../features/mobile-capture/capture-store";
import { TABLE_ROW_IDENTITY_STYLE } from "../lib/table-row-identity";
import {
  NOTE_MEMO_LIMIT,
  NOTE_MEMO_TEXT_LIMIT,
  collectNoteMemos,
  formatNoteMemosSection,
  formatStepMemos,
} from "./note-memos";
import { collectSteps } from "./note-text";
import { resetSearchIndex } from "./search";
import { resetMediaIndexCache } from "./sources";
import { registerTools } from "./tools";

const para = (id: string, text: string) => ({ id, type: "paragraph", content: [{ type: "text", text }], children: [] });
const step = (id: string, title: string, children: any[] = []) => ({
  id,
  type: "step",
  content: [{ type: "text", text: title }],
  children,
});

const doc = {
  title: "試料 4",
  pages: [
    {
      id: "p1",
      blocks: [
        para("intro", "はじめに"),
        step("s-mix", "混合", [para("mix-1", "エタノールを加えて 30 分混ぜる")]),
        step("s-calcine", "仮焼"),
        step("s-grind", "粉砕"),
      ],
    },
  ],
};

let seq = 0;
function memo(overrides: Partial<CaptureEntry>): CaptureEntry {
  seq++;
  return {
    id: `m${seq}`,
    text: `メモ ${seq}`,
    createdAt: `2026-11-${String(seq).padStart(2, "0")}T09:00:00.000Z`,
    sourceNote: { fileId: "n1" },
    ...overrides,
  };
}
const indexOf = (captures: CaptureEntry[]): CaptureIndex => ({ version: 1, updatedAt: "", captures });

describe("collectNoteMemos", () => {
  beforeEach(() => {
    seq = 0;
  });

  it("付け先（つながり・手順・手順の中・手順の外・ノート全体）を見分ける", () => {
    const captures = [
      memo({ text: "200℃ を下回ってから出す", sourceEdge: { graph: "steps", from: "s-calcine", to: "s-grind", fromLabel: "仮焼（古い名前）", toLabel: "粉砕" } }),
      memo({ text: "エタノールは数滴", sourceNote: { fileId: "n1", blockId: "s-mix", blockText: "混合" } }),
      memo({ text: "30 分は目安", sourceNote: { fileId: "n1", blockId: "mix-1", blockText: "エタノールを加えて 30 分混ぜる" } }),
      memo({ text: "前置きを直す", sourceNote: { fileId: "n1", blockId: "intro", blockText: "はじめに" } }),
      memo({ text: "次はロット B で" }),
    ];
    const { memos, omitted } = collectNoteMemos("n1", doc, collectSteps(doc), indexOf(captures));
    expect(omitted).toBe(0);
    expect(memos.map((m) => m.target.kind)).toEqual(["edge", "block", "block", "block", "note"]);
    // 端点の名前は今の手順名を優先する（作成時の名前は、手順が消えたときの控え）
    expect(memos[0].target).toMatchObject({ fromName: "仮焼", toName: "粉砕" });
    expect(memos[1].target).toMatchObject({ stepBlockId: "s-mix", stepTitle: "混合" });
    expect(memos[2].target).toMatchObject({ blockId: "mix-1", stepBlockId: "s-mix" });
    expect(memos[3].target).toEqual({ kind: "block", blockId: "intro", blockText: "はじめに" });
    expect(memos[0].date).toBe("2026-11-01");
  });

  it("消えた手順の端点は作成時の名前で残し、名前も無ければ「名前のない手順」にする", () => {
    const captures = [
      memo({ sourceEdge: { graph: "steps", from: "gone", to: "s-grind", fromLabel: "再仮焼" } }),
      memo({ sourceEdge: { graph: "steps", from: "gone", to: "gone2" } }),
    ];
    const { memos } = collectNoteMemos("n1", doc, collectSteps(doc), indexOf(captures));
    expect(memos[0].target).toMatchObject({ fromName: "再仮焼", toName: "粉砕" });
    expect(memos[1].target).toMatchObject({ fromName: "（名前のない手順）", toName: "（名前のない手順）" });
  });

  it("ほかのノートのメモ・アーカイブ・ゴミ箱・素材だけのメモは返さない", () => {
    const captures = [
      memo({ text: "別のノート", sourceNote: { fileId: "n2" } }),
      memo({ text: "アーカイブ", archivedAt: "2026-11-02T00:00:00.000Z" }),
      memo({ text: "ゴミ箱", deletedAt: "2026-11-02T00:00:00.000Z" }),
      memo({ text: "素材のメモ", sourceNote: undefined, sourceAsset: { fileId: "f1", type: "pdf" } as never }),
      memo({ text: "残る" }),
    ];
    const { memos } = collectNoteMemos("n1", doc, collectSteps(doc), indexOf(captures));
    expect(memos.map((m) => m.text)).toEqual(["残る"]);
  });

  it("wiki: の接頭辞の有無に依らず同じノートとして拾う", () => {
    const captures = [memo({ sourceNote: { fileId: "wiki:n1" } })];
    expect(collectNoteMemos("n1", doc, [], indexOf(captures)).memos).toHaveLength(1);
    expect(collectNoteMemos("wiki:n1", doc, [], indexOf([memo({})])).memos).toHaveLength(1);
  });

  it("件数と本文の長さに上限がある。作成者のメールアドレスは返さない", () => {
    const captures = Array.from({ length: NOTE_MEMO_LIMIT + 3 }, (_, i) =>
      memo({ createdAt: `2026-01-01T00:00:00.${String(i).padStart(3, "0")}Z` }),
    );
    const last = captures.length - 1;
    captures[last] = { ...captures[last], text: "あ".repeat(NOTE_MEMO_TEXT_LIMIT + 50), createdBy: "someone@example.com" };
    const result = collectNoteMemos("n1", doc, [], indexOf(captures));
    expect(result.memos).toHaveLength(NOTE_MEMO_LIMIT);
    expect(result.omitted).toBe(3);
    // 上限を超えたら新しいほうを残す（古い 3 件を落とす）。並びは書いた順のまま
    expect(result.memos[0].id).toBe(captures[3].id);
    expect(result.memos[result.memos.length - 1].id).toBe(captures[last].id);
    expect(formatStepMemos(result).tail).toContain("これより古いメモが 3 件あります");
    const long = result.memos.find((m) => m.text.startsWith("あ"))!;
    expect(long.text.endsWith("…（以下略）")).toBe(true);
    expect(JSON.stringify(result)).not.toContain("someone@example.com");
    expect(formatNoteMemosSection(result)).toContain(`（${NOTE_MEMO_LIMIT + 3} 件）`);
  });

  it("入れ子の手順では、いちばん内側の手順のメモになる", () => {
    const nested = { pages: [{ blocks: [step("outer", "焼結", [step("inner", "昇温", [para("in-1", "5℃/分")])])] }] };
    const captures = [memo({ sourceNote: { fileId: "n1", blockId: "in-1" } })];
    const { memos } = collectNoteMemos("n1", nested, collectSteps(nested), indexOf(captures));
    expect(memos[0].target).toMatchObject({ stepBlockId: "inner", stepTitle: "昇温" });
  });

  it("工程のつながりは、表の行の今の名前で出す（行が無ければ作成時の名前）", () => {
    const cell = (text: string, rowId?: string) => ({
      type: "tableCell",
      content: [{ type: "text", text, styles: rowId ? { [TABLE_ROW_IDENTITY_STYLE]: rowId } : {} }],
    });
    const plan = {
      pages: [
        {
          blocks: [
            {
              id: "t1",
              type: "table",
              content: { type: "tableContent", rows: [{ cells: [cell("工程")] }, { cells: [cell("合成", "r1")] }, { cells: [cell("測定", "r2")] }] },
            },
          ],
          tableMeta: { t1: { columns: { 工程: ["note-link"] } } },
        },
      ],
    };
    const captures = [memo({ sourceEdge: { graph: "plan", from: "r1", to: "gone", fromLabel: "古い名前", toLabel: "評価" } })];
    const { memos } = collectNoteMemos("n1", plan, [], indexOf(captures));
    expect(memos[0].target).toMatchObject({ kind: "edge", graph: "plan", fromName: "合成", toName: "評価" });
    expect(formatNoteMemosSection({ memos, omitted: 0 })).toContain("工程のつながり「");
  });

  it("形の崩れたメモは読み飛ばし、ノートの読み出しを落とさない", () => {
    const broken = [
      null,
      "text",
      { sourceNote: { fileId: 1 } },
      { id: "x1", sourceNote: { fileId: "n1" }, text: 42, createdAt: 7 },
      { id: "x2", sourceNote: { fileId: "n1", blockId: 9, blockText: {} }, text: "残る", createdAt: "2026-11-03T00:00:00Z" },
      { id: "x3", sourceNote: { fileId: "n1" }, sourceEdge: { graph: "other", from: 1, to: null, fromLabel: 5 }, text: "線", createdAt: "2026-11-04T00:00:00Z" },
    ] as never as CaptureEntry[];
    const result = collectNoteMemos("n1", doc, collectSteps(doc), indexOf(broken));
    expect(result.memos.map((m) => m.id)).toEqual(["x1", "x2", "x3"]);
    expect(result.memos[0]).toMatchObject({ text: "", date: "" });
    expect(result.memos[2].target).toMatchObject({ kind: "edge", graph: "steps", fromName: "（名前のない手順）" });
    expect(() => formatNoteMemosSection(result)).not.toThrow();
    for (const captures of [null, {}, "x", 3]) {
      expect(collectNoteMemos("n1", doc, [], { version: 1, updatedAt: "", captures } as never)).toEqual({ memos: [], omitted: 0 });
    }
  });

  it("改行の種類や付け先の名前の改行で、行頭から見出しや箇条書きを作れない", () => {
    const captures = [
      memo({ text: "1 行目\r## 偽の見出し\u2028- 偽の項目", sourceNote: { fileId: "n1", blockId: "s-mix" } }),
      memo({ sourceEdge: { graph: "steps", from: "gone", to: "s-grind", fromLabel: "仮焼\n## 偽の見出し" } }),
      memo({ sourceNote: { fileId: "n1", blockId: "intro", blockText: "はじめに\n- 偽の項目" } }),
    ];
    const result = collectNoteMemos("n1", doc, collectSteps(doc), indexOf(captures));
    const view = formatStepMemos(result);
    const out = [formatNoteMemosSection(result), ...view.byStep.get("s-mix")!, view.tail].join("\n");
    expect(out).not.toMatch(/^## 偽の見出し/m);
    expect(out).not.toMatch(/^- 偽の項目/m);
    expect(out).not.toMatch(/[\r\u2028]/);
  });

  it("メモの一覧が無い・メモが無いときは空を返し、節も作らない", () => {
    const none = collectNoteMemos("n1", doc, collectSteps(doc), null);
    expect(none).toEqual({ memos: [], omitted: 0 });
    expect(formatNoteMemosSection(none)).toBeNull();
    expect(formatStepMemos(none)).toEqual({ byStep: new Map(), tail: null });
  });
});

describe("get_note / get_note_steps の返り値", () => {
  type Handler = (args: Record<string, unknown>) => Promise<{ content: { type: string; text: string }[] }>;
  let root: string;
  let saved: string | undefined;
  let handlers: Map<string, Handler>;

  beforeEach(() => {
    seq = 0;
    saved = process.env.GRAPHIUM_ROOT;
    root = mkdtempSync(join(tmpdir(), "graphium-mcp-note-memos-"));
    process.env.GRAPHIUM_ROOT = root;
    mkdirSync(join(root, "notes"), { recursive: true });
    mkdirSync(join(root, "appdata"), { recursive: true });
    writeFileSync(join(root, "notes", "n1.json"), JSON.stringify({ ...doc, createdAt: "2026-11-01T00:00:00Z", modifiedAt: "2026-11-01T00:00:00Z" }));
    writeFileSync(join(root, "appdata", "media-index.json"), JSON.stringify({ version: 1, media: [] }));
    resetMediaIndexCache();
    resetSearchIndex();
    handlers = new Map();
    const server = { registerTool: (name: string, _cfg: unknown, h: Handler) => void handlers.set(name, h) };
    registerTools(server as never);
  });

  afterEach(() => {
    if (saved === undefined) delete process.env.GRAPHIUM_ROOT;
    else process.env.GRAPHIUM_ROOT = saved;
    rmSync(root, { recursive: true, force: true });
    resetSearchIndex();
  });

  const writeCaptures = (captures: CaptureEntry[]) =>
    writeFileSync(join(root, "appdata", "captures.json"), JSON.stringify(indexOf(captures)));

  it("メモが無ければ、これまでと同じ返り値（メモの節を足さない）", async () => {
    const steps = (await handlers.get("get_note_steps")!({ noteId: "n1" })).content[0].text;
    expect(steps).not.toContain("メモ");
    const note = (await handlers.get("get_note")!({ noteId: "n1" })).content[0].text;
    expect(note).not.toContain("このノートに付いたメモ");
  });

  it("get_note_steps は手順の下にメモを、手順のあとにつながりのメモを置く", async () => {
    writeCaptures([
      memo({ text: "エタノールは数滴\n入れすぎると混ぜ直し", sourceNote: { fileId: "n1", blockId: "s-mix" } }),
      memo({ text: "200℃ を下回ってから出す", sourceEdge: { graph: "steps", from: "s-calcine", to: "s-grind" } }),
      memo({ text: "次はロット B で" }),
    ]);
    const out = (await handlers.get("get_note_steps")!({ noteId: "n1" })).content[0].text;
    const mix = out.slice(out.indexOf("1. 混合"), out.indexOf("2. 仮焼"));
    expect(mix).toContain("メモ: エタノールは数滴\n         入れすぎると混ぜ直し  [memoId: m1 / 2026-11-01]");
    expect(out).toContain("## 手順のあいだに付いたメモ（1 件）");
    expect(out).toContain("- 仮焼 → 粉砕: 200℃ を下回ってから出す  [memoId: m2 / 2026-11-02]");
    expect(out).toContain("手順の外に付いたメモが 1 件あります");
    expect(out).not.toContain("次はロット B で");
    // 図の形式は変えない
    const mermaid = (await handlers.get("get_note_steps")!({ noteId: "n1", format: "mermaid" })).content[0].text;
    expect(mermaid).not.toContain("エタノールは数滴");
  });

  it("get_note はすべてのメモを付け先と一緒に並べる", async () => {
    writeCaptures([
      memo({ text: "エタノールは数滴", sourceNote: { fileId: "n1", blockId: "s-mix" } }),
      memo({ text: "200℃ を下回ってから出す", sourceEdge: { graph: "steps", from: "s-calcine", to: "s-grind" } }),
      memo({ text: "次はロット B で" }),
    ]);
    const out = (await handlers.get("get_note")!({ noteId: "n1" })).content[0].text;
    expect(out).toContain("## このノートに付いたメモ（3 件）");
    expect(out).toContain("- 手順「混合」: エタノールは数滴");
    expect(out).toContain("- 手順のつながり「仮焼 → 粉砕」: 200℃ を下回ってから出す");
    expect(out).toContain("- ノート全体: 次はロット B で");
    // 本文より前に置く（本文が長くてもメモが埋もれない）
    expect(out.indexOf("このノートに付いたメモ")).toBeLessThan(out.indexOf("## 本文"));
  });
});
